//! wasmi 插件运行时与细粒度权限（W-12 第三批）。
//!
//! 与浏览器侧 `plugin-runtime.ts` 共用同一 ABI（见 `ocx-plugin-sample` 顶部注释）：
//! - `ocx_alloc(len) -> ptr`：宿主申请线性内存写入输入 JSON；
//! - `effect_*` / `command_*(ptr, len) -> i64`：返回 `(ptr << 32) | len` 指向输出 JSON；
//! - `ocx_dealloc(ptr, len)`：宿主归还输出内存。
//!
//! 沙箱边界（细粒度权限，逐层拒绝）：
//! 1. 默认零宿主导入：`load_plugin` 的 Linker 不注册任何 host 函数，含 import 即失败；
//! 2. 声明式权限（W-12 第五批）：`load_plugin_with_resources` 仅按 host 授予的
//!    `permissionScopes` 注入受控能力函数（当前 `ocx.resource_len`），函数内二次校验
//!    具体资源，deny-by-default；未授予任何 scope 时仍为零导入；
//! 3. manifest 白名单：只能调用 manifest 声明过、且 host 授予对应权限的 effect/command；
//! 4. WIT 契约白名单：导出名还必须出现在 host 内嵌 `.wit` 契约（W-12 第四批，IDL 单一事实来源）；
//! 5. fuel 上限：每次调用重置 fuel，耗尽即中断（防死循环/算力 DoS）；
//! 6. 内存边界：所有 ptr/len 访问前校验不越界、不超过输入/输出上限；
//! 7. 空模块/坏字节码：统一映射稳定错误码，不 panic。

use std::collections::BTreeMap;

use wasmi::{Caller, Config, Engine, Instance, Linker, Memory, Module, Store, TypedFunc};

use crate::model::{
    DEFAULT_FUEL_LIMIT, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, MAX_SCOPE_LEN, PERMISSION_COMMAND,
    PERMISSION_EFFECT, PluginError, Registration, SCOPE_CAPABILITY_MEDIA_READ,
};
#[cfg(not(target_arch = "wasm32"))]
use crate::io_scope::{
    parse_request_url, validate_output_buffer, validate_relative_path,
};
use crate::permissions::granted_allows;
use crate::wit::{WitContract, default_contract};

/// effect 导出的函数名前缀（与 `ocx-plugin-sample` / 浏览器侧一致）。
const EFFECT_PREFIX: &str = "effect_";
/// command 导出的函数名前缀。
const COMMAND_PREFIX: &str = "command_";
/// 受控能力函数所在模块名。
const CAPABILITY_MODULE: &str = "ocx";
/// 受控能力函数名：查询授予资源字节数（`resource key(ptr,len) -> i64 size`）。
const CAPABILITY_RESOURCE_LEN: &str = "resource_len";
/// 受控能力函数名：读取授予资源内容（W-12 core 扩展，media-read 从「可查长度」升级为「可读内容」）。
const CAPABILITY_RESOURCE_READ: &str = "resource_read";
/// 受控能力函数名：读取宿主允许目录内的文件（第八批，native-only）。
#[cfg(not(target_arch = "wasm32"))]
const CAPABILITY_FILE_READ: &str = "file_read";
/// 受控能力函数名：按白名单抓取 URL（第九批，native-only）。
#[cfg(not(target_arch = "wasm32"))]
const CAPABILITY_NET_FETCH: &str = "net_fetch";
/// scope 拒绝 trap 的稳定前缀（供错误映射识别）。
const SCOPE_DENIED_MARKER: &str = "scope_denied:";
/// 资源读取目标缓冲过大的稳定 trap 前缀。
const RESOURCE_BUFFER_MARKER: &str = "resource_buffer_too_small:";

/// 宿主注入的状态：授予的 scope + 可见资源表（声明式权限）。
#[derive(Debug, Default, Clone)]
pub struct HostState {
    /// 能力名 → 已授予资源 scope 列表（deny-by-default）。
    granted_scopes: BTreeMap<String, Vec<String>>,
    /// 资源 key（`ns:name`）→ 字节内容（host 提供的最小数据集）。
    resources: BTreeMap<String, Vec<u8>>,
    /// 文件命名空间（`file:*` scope 的 ns）→ 宿主允许的绝对路径根目录。
    /// 仅在 native 构建中存在；wasm32 下为空映射，能力函数不注入。
    #[cfg(not(target_arch = "wasm32"))]
    file_roots: BTreeMap<String, std::path::PathBuf>,
    /// 是否允许真实网络抓取（host 显式开启；wasm32 恒为 false）。
    #[cfg(not(target_arch = "wasm32"))]
    network_enabled: bool,
}

impl HostState {
    /**
     * 构造宿主状态：只有 scope 与资源同时存在的键才对插件可见。
     * @param granted_scopes 能力名 → 授予的 scope 列表
     * @param resources 资源 key → 字节内容
     * @returns {HostState} 宿主状态
     */
    pub fn new(
        granted_scopes: BTreeMap<String, Vec<String>>,
        resources: BTreeMap<String, Vec<u8>>,
    ) -> Self {
        Self {
            granted_scopes,
            resources,
            #[cfg(not(target_arch = "wasm32"))]
            file_roots: BTreeMap::new(),
            #[cfg(not(target_arch = "wasm32"))]
            network_enabled: false,
        }
    }

    /**
     * 绑定文件命名空间到宿主允许的目录（native-only）。
     * scope 中的 ns 必须先用此方法绑定，否则读取一律 `PATH_TRAVERSAL`。
     * @param namespace 文件 scope 的命名空间（如 `assets`）
     * @param root 宿主允许的绝对根目录
     * @returns {HostState} 自身（链式调用）
     */
    #[cfg(not(target_arch = "wasm32"))]
    pub fn with_file_root(mut self, namespace: &str, root: impl Into<std::path::PathBuf>) -> Self {
        self.file_roots.insert(namespace.to_owned(), root.into());
        self
    }

    /**
     * 显式开启真实网络抓取（native-only）。未开启时即便授予 scope 也不注入该能力。
     * @returns {HostState} 自身（链式调用）
     */
    #[cfg(not(target_arch = "wasm32"))]
    pub fn with_network(mut self) -> Self {
        self.network_enabled = true;
        self
    }
}

/// 已加载插件的运行时实例（一个插件一份 Store，避免交叉污染）。
pub struct LoadedPlugin {
    store: Store<HostState>,
    instance: Instance,
    memory: Memory,
    alloc: TypedFunc<i32, i32>,
    dealloc: TypedFunc<(i32, i32), ()>,
    registration: Registration,
    granted: Vec<String>,
    fuel_limit: u64,
    /// host 内嵌 WIT 契约（导出白名单的单一事实来源，W-12 第四批）。
    wit: WitContract,
}

impl LoadedPlugin {
    /// 已注册插件的清单视图（用于调用前校验白名单）。
    pub fn registration(&self) -> &Registration {
        &self.registration
    }
}

/// native I/O 错误的稳定 trap 前缀（供 `map_trap` 还原为 PluginError）。
const IO_ERROR_MARKER: &str = "ocx_io_error:";

/**
 * 从 native I/O trap 的 `CODE:消息` 还原稳定错误（跨端可用，wasm32 下未被触发但需编译）。
 * @param code 稳定错误码字符串
 * @param detail 错误详情（作为变体的负载）
 * @returns {PluginError} 对应变体；未知码回落为 FileReadFailed
 */
fn io_error_from_code(code: &str, detail: &str) -> PluginError {
    match code {
        "SCOPE_DENIED" => PluginError::ScopeDenied(detail.to_owned()),
        "PATH_TRAVERSAL" => PluginError::PathTraversal(detail.to_owned()),
        "FILE_NOT_FOUND" => PluginError::FileNotFound(detail.to_owned()),
        "FILE_READ_FAILED" => PluginError::FileReadFailed(detail.to_owned()),
        "INVALID_URL" => PluginError::InvalidUrl(detail.to_owned()),
        "NETWORK_FAILED" => PluginError::NetworkFailed(detail.to_owned()),
        "INVALID_SCOPE" => PluginError::InvalidScope(detail.to_owned()),
        "INVALID_OUTPUT" => PluginError::InvalidOutput,
        _ => PluginError::FileReadFailed(detail.to_owned()),
    }
}

/// 把 wasmi 的实例化/调用错误按来源映射为稳定错误码。
fn map_trap(error: &wasmi::Error, out_of_fuel: bool) -> PluginError {
    let text = error.to_string();
    let lowered = text.to_ascii_lowercase();
    // native-only I/O 能力优先：其 SCOPE_DENIED 文本也含 "scope_denied:" 子串，
    // 必须先用更具体的 ocx_io_error 前缀还原，保留完整资源名（避免被通用分支截断）。
    if let Some(index) = lowered.find(IO_ERROR_MARKER) {
        let begin = index + IO_ERROR_MARKER.len();
        let payload = &text[begin..];
        let mut parts = payload.splitn(2, ':');
        let code = parts.next().unwrap_or("");
        let detail = parts.next().unwrap_or("");
        return io_error_from_code(code, detail);
    }
    // 声明式权限：能力函数用 Result::Err(trap) 拒绝越权资源，按稳定前缀提取资源名。
    if let Some(index) = lowered.find(SCOPE_DENIED_MARKER) {
        let begin = index + SCOPE_DENIED_MARKER.len();
        let resource = text[begin..]
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_owned();
        return PluginError::ScopeDenied(resource);
    }
    // wasmi 2.0 的 Error::is_out_of_fuel() 是 pub(crate)，外部只能按稳定错误文本判定；
    // 同时保留调用点的 get_fuel()==0 信号，双路兜底。
    if out_of_fuel || lowered.contains("out of fuel") || lowered.contains("fuel") {
        return PluginError::FuelExhausted;
    }
    // 模块声明了 Linker 未提供的导入时，wasmi 报 "unknown import ..."。
    if lowered.contains("import") {
        PluginError::DisallowedImport
    } else {
        PluginError::InvalidWasm
    }
}

/**
 * 加载 WASM 插件并实例化（零宿主导入沙箱）。
 * @param wasm_bytes 插件 wasm 二进制
 * @param registration 已通过 `check_manifest` 校验的注册项
 * @param granted host 授予的权限（调用时再次校验）
 * @returns {Result<LoadedPlugin, PluginError>} 已加载实例；坏字节码/含导入/导出缺失时给稳定错误
 */
pub fn load_plugin(
    wasm_bytes: &[u8],
    registration: Registration,
    granted: &[String],
) -> Result<LoadedPlugin, PluginError> {
    load_plugin_with_fuel(wasm_bytes, registration, granted, DEFAULT_FUEL_LIMIT)
}

/**
 * 带自定义 fuel 上限加载插件（零宿主导入沙箱，向后兼容）。
 * @param wasm_bytes 插件 wasm 二进制
 * @param registration 已校验注册项
 * @param granted host 授予的权限
 * @param fuel_limit 单次调用 fuel 上限
 * @returns {Result<LoadedPlugin, PluginError>} 已加载实例
 */
pub fn load_plugin_with_fuel(
    wasm_bytes: &[u8],
    registration: Registration,
    granted: &[String],
    fuel_limit: u64,
) -> Result<LoadedPlugin, PluginError> {
    instantiate(
        wasm_bytes,
        registration,
        granted,
        fuel_limit,
        HostState::default(),
        false,
    )
}

/**
 * 以声明式权限加载插件：只为授予的 scope 注入受控能力函数，其余导入仍被拒。
 * @param wasm_bytes 插件 wasm 二进制
 * @param registration 已校验注册项（含 permissionScopes）
 * @param granted host 授予的权限
 * @param host_state 宿主状态（授予 scope + 可见资源表）
 * @returns {Result<LoadedPlugin, PluginError>} 已加载实例
 */
pub fn load_plugin_with_resources(
    wasm_bytes: &[u8],
    registration: Registration,
    granted: &[String],
    host_state: HostState,
) -> Result<LoadedPlugin, PluginError> {
    instantiate(
        wasm_bytes,
        registration,
        granted,
        DEFAULT_FUEL_LIMIT,
        host_state,
        true,
    )
}

/**
 * 注入受控能力函数 `ocx.resource_len(ptr,len) -> i64`：读资源 key，按授予 scope 校验后返回字节数。
 * 越权时返回 `Result::Err(trap)`，由 `map_trap` 映射为 `SCOPE_DENIED`。
 * @param linker 宿主链接器（数据类型为 HostState）
 * @returns {Result<(), PluginError>} 注册失败给稳定错误码
 */
fn register_capabilities(linker: &mut Linker<HostState>) -> Result<(), PluginError> {
    linker
        .func_wrap(
            CAPABILITY_MODULE,
            CAPABILITY_RESOURCE_LEN,
            |caller: Caller<'_, HostState>, ptr: i32, len: i32| -> Result<i64, wasmi::Error> {
                if ptr <= 0 || len <= 0 || len as usize > MAX_SCOPE_LEN {
                    return Err(wasmi::Error::new("invalid resource key length"));
                }
                let memory = caller
                    .get_export("memory")
                    .and_then(|external| external.into_memory())
                    .ok_or_else(|| wasmi::Error::new("missing memory"))?;
                let mut buffer = vec![0u8; len as usize];
                memory
                    .read(&caller, ptr as usize, &mut buffer)
                    .map_err(|error| wasmi::Error::new(format!("memory read failed: {error}")))?;
                let key = String::from_utf8(buffer)
                    .map_err(|_| wasmi::Error::new("invalid utf8 resource key"))?;
                // 声明式权限：deny-by-default，未命中授予 scope 直接拒绝。
                if !granted_allows(
                    &caller.data().granted_scopes,
                    SCOPE_CAPABILITY_MEDIA_READ,
                    &key,
                ) {
                    return Err(wasmi::Error::new(format!("{SCOPE_DENIED_MARKER}{key}")));
                }
                // 资源不存在返回 -1（调用方据此区分「无权」与「无此资源」）。
                Ok(caller
                    .data()
                    .resources
                    .get(&key)
                    .map(|bytes| bytes.len() as i64)
                    .unwrap_or(-1))
            },
        )
        .map_err(|_| PluginError::InvalidWasm)?;
    // W-12 core 扩展：受控能力 `ocx.resource_read`，把授予资源的内容写入插件缓冲。
    linker
        .func_wrap(
            CAPABILITY_MODULE,
            CAPABILITY_RESOURCE_READ,
            |mut caller: Caller<'_, HostState>,
             key_ptr: i32,
             key_len: i32,
             out_ptr: i32,
             out_cap: i32|
             -> Result<i64, wasmi::Error> {
                if key_ptr <= 0 || key_len <= 0 || key_len as usize > MAX_SCOPE_LEN {
                    return Err(wasmi::Error::new("invalid resource key length"));
                }
                if out_ptr <= 0 || out_cap <= 0 {
                    return Err(wasmi::Error::new("invalid output buffer"));
                }
                let memory = caller
                    .get_export("memory")
                    .and_then(|external| external.into_memory())
                    .ok_or_else(|| wasmi::Error::new("missing memory"))?;
                let mut key_buffer = vec![0u8; key_len as usize];
                memory
                    .read(&caller, key_ptr as usize, &mut key_buffer)
                    .map_err(|error| wasmi::Error::new(format!("memory read failed: {error}")))?;
                let key = String::from_utf8(key_buffer)
                    .map_err(|_| wasmi::Error::new("invalid utf8 resource key"))?;
                // deny-by-default：未命中授予 scope 直接拒绝，与 resource_len 共用稳定标记。
                if !granted_allows(
                    &caller.data().granted_scopes,
                    SCOPE_CAPABILITY_MEDIA_READ,
                    &key,
                ) {
                    return Err(wasmi::Error::new(format!("{SCOPE_DENIED_MARKER}{key}")));
                }
                let size = caller.data().resources.get(&key).map(|bytes| bytes.len());
                match size {
                    // 资源不存在返回 -1（区分「无权」与「无此资源」）。
                    None => Ok(-1),
                    // 先查大小再克隆，避免超大资源触发 OOM。
                    Some(len) if len > MAX_OUTPUT_BYTES => {
                        Err(wasmi::Error::new("resource exceeds max output bytes"))
                    }
                    Some(len) if len > out_cap as usize => Err(wasmi::Error::new(format!(
                        "{RESOURCE_BUFFER_MARKER}{len}"
                    ))),
                    Some(len) => {
                        let bytes = caller
                            .data()
                            .resources
                            .get(&key)
                            .cloned()
                            .unwrap_or_default();
                        memory
                            .write(&mut caller, out_ptr as usize, &bytes)
                            .map_err(|error| {
                                wasmi::Error::new(format!("memory write failed: {error}"))
                            })?;
                        Ok(len as i64)
                    }
                }
            },
        )
        .map_err(|_| PluginError::InvalidWasm)?;
    Ok(())
}

/**
 * 从插件线性内存读取一段长度受限的 UTF-8 字符串（能力函数入参统一读取）。
 * @param memory 插件线性内存
 * @param caller wasmi 调用上下文
 * @param ptr 字符串指针（须 > 0）
 * @param len 字符串字节长度
 * @param max_len 允许的最大长度
 * @returns {Result<String, wasmi::Error>} 读取到的字符串
 */
#[cfg(not(target_arch = "wasm32"))]
fn read_guest_string(
    memory: &Memory,
    caller: &Caller<'_, HostState>,
    ptr: i32,
    len: i32,
    max_len: usize,
) -> Result<String, wasmi::Error> {
    if ptr <= 0 || len <= 0 || len as usize > max_len {
        return Err(wasmi::Error::new("invalid guest string length"));
    }
    let mut buffer = vec![0u8; len as usize];
    memory
        .read(caller, ptr as usize, &mut buffer)
        .map_err(|error| wasmi::Error::new(format!("memory read failed: {error}")))?;
    String::from_utf8(buffer).map_err(|_| wasmi::Error::new("invalid utf8 guest string"))
}

/**
 * 将稳定错误映射为 wasmi trap（native I/O 能力函数在 trap 中携带稳定前缀供 map_trap 识别）。
 * @param error 稳定错误
 * @returns {wasmi::Error} 带稳定标记的 trap
 */
#[cfg(not(target_arch = "wasm32"))]
fn io_trap(error: &PluginError) -> wasmi::Error {
    wasmi::Error::new(format!("{IO_ERROR_MARKER}{}:{}", error.code(), error))
}

/**
 * 注册 native-only 受控能力：`ocx.file_read` 与 `ocx.net_fetch`。
 * 仅在授予对应 scope 且 host 显式允许时注入；wasm32 下整个函数不存在。
 * @param linker 宿主链接器（数据类型为 HostState）
 * @param host_state 宿主状态（读取文件根目录/网络开关决定注入哪些）
 * @returns {Result<(), PluginError>} 注册失败给稳定错误码
 */
#[cfg(not(target_arch = "wasm32"))]
fn register_native_capabilities(
    linker: &mut Linker<HostState>,
    host_state: &HostState,
) -> Result<(), PluginError> {
    use crate::model::{
        MAX_FILE_KEY_LEN, PluginError, SCOPE_CAPABILITY_FILE_READ,
        SCOPE_CAPABILITY_NETWORK_FETCH,
    };

    // ---- 文件读取：ocx.file_read(key_ptr,key_len,out_ptr,out_cap) -> i64 ----
    // key 形如 `assets:images/logo.png`：ns 必须绑定到宿主目录，相对路径经字符串层 + canonicalize 双重校验。
    let file_scopes = host_state
        .granted_scopes
        .get(SCOPE_CAPABILITY_FILE_READ)
        .cloned()
        .unwrap_or_default();
    let file_roots = host_state.file_roots.clone();
    if !file_scopes.is_empty() {
        linker
            .func_wrap(
                CAPABILITY_MODULE,
                CAPABILITY_FILE_READ,
                move |mut caller: Caller<'_, HostState>,
                      key_ptr: i32,
                      key_len: i32,
                      out_ptr: i32,
                      out_cap: i32|
                      -> Result<i64, wasmi::Error> {
                    let memory = caller
                        .get_export("memory")
                        .and_then(|external| external.into_memory())
                        .ok_or_else(|| wasmi::Error::new("missing memory"))?;
                    let key = read_guest_string(&memory, &caller, key_ptr, key_len, MAX_FILE_KEY_LEN)?;
                    let (namespace, relative) = key.split_once(':').ok_or_else(|| {
                        io_trap(&PluginError::InvalidScope(key.clone()))
                    })?;
                    // 第一层：key 的 ns:relative 必须命中授予 scope（deny-by-default）。
                    if !granted_allows(&caller.data().granted_scopes, SCOPE_CAPABILITY_FILE_READ, &key) {
                        return Err(io_trap(&PluginError::ScopeDenied(key.clone())));
                    }
                    // 第二层：相对路径字符串层校验（拒绝 .. / 绝对路径 / 反斜杠 / 控制字符）。
                    validate_relative_path(relative)
                        .map_err(|error| io_trap(&error))?;
                    // 第三层：ns 必须绑定到宿主目录；canonicalize 后必须仍在根目录内（防 symlink 逃逸）。
                    let root = file_roots.get(namespace).ok_or_else(|| {
                        io_trap(&PluginError::PathTraversal(key.clone()))
                    })?;
                    let candidate = root.join(relative);
                    let canonical_root = root.canonicalize().map_err(|_| {
                        io_trap(&PluginError::FileReadFailed(namespace.to_owned()))
                    })?;
                    let canonical_file = candidate.canonicalize().map_err(|error| {
                        if error.kind() == std::io::ErrorKind::NotFound {
                            io_trap(&PluginError::FileNotFound(key.clone()))
                        } else {
                            io_trap(&PluginError::FileReadFailed(key.clone()))
                        }
                    })?;
                    if !canonical_file.starts_with(&canonical_root) {
                        return Err(io_trap(&PluginError::PathTraversal(key.clone())));
                    }
                    // canonicalize 结果必须是普通文件（拒绝目录/设备）。
                    if !canonical_file.is_file() {
                        return Err(io_trap(&PluginError::FileNotFound(key.clone())));
                    }
                    let size = std::fs::metadata(&canonical_file)
                        .map(|meta| meta.len() as usize)
                        .map_err(|_| io_trap(&PluginError::FileReadFailed(key.clone())))?;
                    if size > MAX_OUTPUT_BYTES {
                        return Err(io_trap(&PluginError::FileReadFailed(key.clone())));
                    }
                    if size > out_cap as usize {
                        return Err(wasmi::Error::new(format!("{RESOURCE_BUFFER_MARKER}{size}")));
                    }
                    let bytes = std::fs::read(&canonical_file)
                        .map_err(|_| io_trap(&PluginError::FileReadFailed(key.clone())))?;
                    memory
                        .write(&mut caller, out_ptr as usize, &bytes)
                        .map_err(|error| wasmi::Error::new(format!("memory write failed: {error}")))?;
                    Ok(bytes.len() as i64)
                },
            )
            .map_err(|_| PluginError::InvalidWasm)?;
    }

    // ---- 网络抓取：ocx.net_fetch(url_ptr,url_len,out_ptr,out_cap) -> i64 ----
    // 仅 host 显式 with_network() 且授予 network-fetch scope 时注入；ureq 走 native TLS。
    let net_scopes = host_state
        .granted_scopes
        .get(SCOPE_CAPABILITY_NETWORK_FETCH)
        .cloned()
        .unwrap_or_default();
    if host_state.network_enabled && !net_scopes.is_empty() {
        linker
            .func_wrap(
                CAPABILITY_MODULE,
                CAPABILITY_NET_FETCH,
                move |mut caller: Caller<'_, HostState>,
                      url_ptr: i32,
                      url_len: i32,
                      out_ptr: i32,
                      out_cap: i32|
                      -> Result<i64, wasmi::Error> {
                    let memory = caller
                        .get_export("memory")
                        .and_then(|external| external.into_memory())
                        .ok_or_else(|| wasmi::Error::new("missing memory"))?;
                    let url = read_guest_string(&memory, &caller, url_ptr, url_len, MAX_SCOPE_LEN)?;
                    let (scheme, host) = parse_request_url(&url).map_err(|error| io_trap(&error))?;
                    let scope_key = format!("{scheme}:{host}");
                    // scope 命中按 `scheme:host` 判定（精确主机或 `scheme:*` 通配）。
                    if !granted_allows(
                        &caller.data().granted_scopes,
                        SCOPE_CAPABILITY_NETWORK_FETCH,
                        &scope_key,
                    ) {
                        return Err(io_trap(&PluginError::ScopeDenied(url.clone())));
                    }
                    validate_output_buffer(out_ptr, out_cap)
                        .map_err(|error| io_trap(&error))?;
                    // 委托给独立的真实请求函数（便于单测与 cfg 隔离）。
                    let bytes = http_get_bounded(&url, out_cap as usize)
                        .map_err(|error| io_trap(&error))?;
                    memory
                        .write(&mut caller, out_ptr as usize, &bytes)
                        .map_err(|error| wasmi::Error::new(format!("memory write failed: {error}")))?;
                    Ok(bytes.len() as i64)
                },
            )
            .map_err(|_| PluginError::InvalidWasm)?;
    }
    Ok(())
}

/**
 * 执行一次带超时与响应体上限的 HTTP GET（native-only，UREQ）。
 * @param url 已通过 scope 校验的 URL
 * @param max_bytes 响应体最大字节数
 * @returns {Result<Vec<u8>, PluginError>} 响应体字节；失败映射稳定错误码
 */
#[cfg(not(target_arch = "wasm32"))]
fn http_get_bounded(url: &str, max_bytes: usize) -> Result<Vec<u8>, PluginError> {
    use std::time::Duration;

    use ureq::config::Config;
    use ureq::Error as UreqError;

    use crate::model::NETWORK_TIMEOUT_SECS;

    let config = Config::builder()
        .timeout_global(Some(Duration::from_secs(NETWORK_TIMEOUT_SECS)))
        .timeout_connect(Some(Duration::from_secs(NETWORK_TIMEOUT_SECS)))
        .build();
    let agent = config.new_agent();
    let mut response = agent
        .get(url)
        .call()
        .map_err(|error| PluginError::NetworkFailed(format_ureq_error(&error)))?;
    response
        .body_mut()
        .with_config()
        .limit(max_bytes as u64)
        .read_to_vec()
        .map_err(|error: UreqError| PluginError::NetworkFailed(format_ureq_error(&error)))
}

/**
 * 把 ureq 错误压成稳定的一行文本（不泄露 URL 凭据，因为 URL 已在入口拒绝内嵌凭据）。
 * @param error ureq 错误
 * @returns {String} 简短错误描述
 */
#[cfg(not(target_arch = "wasm32"))]
fn format_ureq_error(error: &ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(code) => format!("HTTP {code}"),
        other => other.to_string().lines().next().unwrap_or("network error").to_owned(),
    }
}

/**
 * 实例化插件的共用实现：零导入或按 scope 注入能力函数两种模式。
 * @param wasm_bytes 插件 wasm 二进制
 * @param registration 已校验注册项
 * @param granted host 授予的权限
 * @param fuel_limit 单次调用 fuel 上限
 * @param host_state 宿主状态
 * @param with_capabilities 是否注入受控能力函数
 * @returns {Result<LoadedPlugin, PluginError>} 已加载实例
 */
fn instantiate(
    wasm_bytes: &[u8],
    registration: Registration,
    granted: &[String],
    fuel_limit: u64,
    host_state: HostState,
    with_capabilities: bool,
) -> Result<LoadedPlugin, PluginError> {
    if fuel_limit == 0 {
        return Err(PluginError::FuelExhausted);
    }
    // 加载 host 内嵌 WIT 契约；契约损坏时直接拒绝（不静默降级为无契约）。
    let wit = default_contract().map_err(|_| PluginError::InvalidWit)?;
    // wasmi 2.0 的 Config 只实现 Default，不提供 new()。
    let mut config = Config::default();
    config.consume_fuel(true);
    let engine = Engine::new(&config);
    let module = Module::new(&engine, wasm_bytes).map_err(|error| map_trap(&error, false))?;

    let mut linker = Linker::<HostState>::new(&engine);
    // 仅按授予 scope 注入受控能力；未授予任何 scope 时保持零导入语义。
    let has_scopes = host_state
        .granted_scopes
        .values()
        .any(|scopes| !scopes.is_empty());
    if with_capabilities && has_scopes {
        register_capabilities(&mut linker)?;
        // native-only 能力：按授予的 file-read / network-fetch scope 精细注入。
        #[cfg(not(target_arch = "wasm32"))]
        register_native_capabilities(&mut linker, &host_state)?;
    }
    let mut store = Store::new(&engine, host_state);
    store
        .set_fuel(fuel_limit)
        .map_err(|error| map_trap(&error, false))?;
    let instance = linker
        .instantiate_and_start(&mut store, &module)
        .map_err(|error| map_trap(&error, store.get_fuel().is_ok_and(|fuel| fuel == 0)))?;

    let memory = instance
        .get_memory(&store, "memory")
        .ok_or(PluginError::InvalidWasm)?;
    let alloc = instance
        .get_typed_func::<i32, i32>(&store, "ocx_alloc")
        .map_err(|error| map_trap(&error, false))?;
    let dealloc = instance
        .get_typed_func::<(i32, i32), ()>(&store, "ocx_dealloc")
        .map_err(|error| map_trap(&error, false))?;

    Ok(LoadedPlugin {
        store,
        instance,
        memory,
        alloc,
        dealloc,
        registration,
        granted: granted.to_vec(),
        fuel_limit,
        wit,
    })
}

/** 解析 `(ptr << 32) | len`，校验指针非零、长度在合法范围。 */
fn decode_output(packed: i64) -> Result<(usize, usize), PluginError> {
    if packed == 0 {
        return Err(PluginError::InvalidOutput);
    }
    let ptr = (packed >> 32) as u32 as usize;
    let len = (packed & 0xFFFF_FFFF) as u32 as usize;
    if len == 0 || len > MAX_OUTPUT_BYTES {
        return Err(PluginError::InvalidOutput);
    }
    Ok((ptr, len))
}

/** 校验 [offset, offset+len) 落在插件线性内存内（防越界读写）。 */
fn ensure_memory_range(
    memory: &Memory,
    store: &Store<HostState>,
    offset: usize,
    len: usize,
) -> Result<(), PluginError> {
    let bytes = memory.data(store).len();
    let end = offset
        .checked_add(len)
        .ok_or(PluginError::MemoryOutOfBounds)?;
    if end > bytes {
        return Err(PluginError::MemoryOutOfBounds);
    }
    Ok(())
}

impl LoadedPlugin {
    /**
     * 调用前校验：权限已授予 + 逻辑名在 manifest 声明。
     * wasm 导出名带 `effect_`/`command_` 前缀，manifest 声明的是去掉前缀的逻辑名。
     */
    fn authorize(&self, export_name: &str) -> Result<(), PluginError> {
        let (permission, logical, declared) =
            if let Some(logical) = export_name.strip_prefix(EFFECT_PREFIX) {
                (PERMISSION_EFFECT, logical, &self.registration.effects)
            } else if let Some(logical) = export_name.strip_prefix(COMMAND_PREFIX) {
                (PERMISSION_COMMAND, logical, &self.registration.commands)
            } else {
                // 无有效前缀的内部 ABI（如 ocx_alloc）一律拒绝。
                return Err(PluginError::ExportNotDeclared(export_name.to_owned()));
            };
        if !self.granted.iter().any(|item| item == permission) {
            return Err(PluginError::PermissionDenied(vec![permission.to_owned()]));
        }
        if !declared.iter().any(|item| item == logical) {
            return Err(PluginError::ExportNotDeclared(export_name.to_owned()));
        }
        // 第二层白名单：即便 manifest 声明，导出名也必须能在 host 内嵌 WIT 契约里找到。
        // 契约逻辑名是 kebab-case（如 get-info），core wasm 导出是 snake_case
        // （effect_get_info），因此统一用 to_export_name 映射后比对。
        let in_wit = if export_name.starts_with(EFFECT_PREFIX) {
            self.wit
                .effects
                .iter()
                .any(|item| WitContract::to_export_name(EFFECT_PREFIX, item) == export_name)
        } else {
            self.wit
                .commands
                .iter()
                .any(|item| WitContract::to_export_name(COMMAND_PREFIX, item) == export_name)
        };
        if !in_wit {
            return Err(PluginError::WitExportNotDeclared(export_name.to_owned()));
        }
        Ok(())
    }

    /**
     * 通过 wasmi 真实调用插件导出的 effect / command。
     * @param name 导出函数名（须在 manifest 声明且 host 授予对应权限）
     * @param payload 输入 JSON（会序列化后写入插件线性内存）
     * @param is_effect true 走 effect 权限与白名单，false 走 command
     * @returns {Result<serde_json::Value, PluginError>} 插件输出 JSON；异常映射稳定错误码
     */
    pub fn call(
        &mut self,
        name: &str,
        payload: &serde_json::Value,
        is_effect: bool,
    ) -> Result<serde_json::Value, PluginError> {
        // is_effect 仅作为文档性标记保留；真实权限由导出名前缀推导（防止调用方传错）。
        let _ = is_effect;
        self.authorize(name)?;

        let input = serde_json::to_vec(payload).map_err(|_| PluginError::InvalidWasm)?;
        if input.is_empty() || input.len() > MAX_INPUT_BYTES {
            return Err(PluginError::InputTooLarge);
        }

        // 每次调用重置 fuel，保证单次调用有独立算力预算。
        self.store
            .set_fuel(self.fuel_limit)
            .map_err(|error| map_trap(&error, false))?;

        // 申请输入缓冲：ptr<=0 表示插件拒绝分配。
        let ptr = self
            .alloc
            .call(&mut self.store, input.len() as i32)
            .map_err(|error| map_trap(&error, self.store.get_fuel().is_ok_and(|fuel| fuel == 0)))?;
        if ptr <= 0 {
            return Err(PluginError::InvalidOutput);
        }
        let ptr = ptr as usize;
        ensure_memory_range(&self.memory, &self.store, ptr, input.len())?;
        self.memory
            .write(&mut self.store, ptr, &input)
            .map_err(|_| PluginError::MemoryOutOfBounds)?;

        // 取导出函数并调用（(ptr,len) -> i64）。
        let func = self
            .instance
            .get_typed_func::<(i32, i32), i64>(&self.store, name)
            .map_err(|error| map_trap(&error, false))?;
        let result = func
            .call(&mut self.store, (ptr as i32, input.len() as i32))
            .map_err(|error| map_trap(&error, self.store.get_fuel().is_ok_and(|fuel| fuel == 0)))?;

        let (out_ptr, out_len) = decode_output(result)?;
        ensure_memory_range(&self.memory, &self.store, out_ptr, out_len)?;
        let mut out = vec![0u8; out_len];
        self.memory
            .read(&self.store, out_ptr, &mut out)
            .map_err(|_| PluginError::MemoryOutOfBounds)?;
        // 归还插件输出内存；dealloc 失败不影响已读到的结果。
        let _ = self
            .dealloc
            .call(&mut self.store, (out_ptr as i32, out_len as i32));
        serde_json::from_slice(&out).map_err(|_| PluginError::InvalidOutput)
    }
}
