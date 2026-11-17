//! wasmi 插件运行时与细粒度权限（W-12 第三批）。
//!
//! 与浏览器侧 `plugin-runtime.ts` 共用同一 ABI（见 `ocx-plugin-sample` 顶部注释）：
//! - `ocx_alloc(len) -> ptr`：宿主申请线性内存写入输入 JSON；
//! - `effect_*` / `command_*(ptr, len) -> i64`：返回 `(ptr << 32) | len` 指向输出 JSON；
//! - `ocx_dealloc(ptr, len)`：宿主归还输出内存。
//!
//! 沙箱边界（细粒度权限，逐层拒绝）：
//! 1. 零宿主导入：Linker 不注册任何 host 函数，模块含 import 即实例化失败；
//! 2. 导出白名单：只能调用 manifest 声明过、且 host 授予对应权限的 effect/command；
//! 3. fuel 上限：每次调用重置 fuel，耗尽即中断（防死循环/算力 DoS）；
//! 4. 内存边界：所有 ptr/len 访问前校验不越界、不超过输入/输出上限；
//! 5. 空模块/坏字节码：统一映射稳定错误码，不 panic。

use wasmi::{Config, Engine, Instance, Linker, Memory, Module, Store, TypedFunc};

use crate::model::{
    DEFAULT_FUEL_LIMIT, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, PERMISSION_COMMAND, PERMISSION_EFFECT,
    PluginError, Registration,
};

/// effect 导出的函数名前缀（与 `ocx-plugin-sample` / 浏览器侧一致）。
const EFFECT_PREFIX: &str = "effect_";
/// command 导出的函数名前缀。
const COMMAND_PREFIX: &str = "command_";

/// 已加载插件的运行时实例（一个插件一份 Store，避免交叉污染）。
pub struct LoadedPlugin {
    store: Store<()>,
    instance: Instance,
    memory: Memory,
    alloc: TypedFunc<i32, i32>,
    dealloc: TypedFunc<(i32, i32), ()>,
    registration: Registration,
    granted: Vec<String>,
    fuel_limit: u64,
}

impl LoadedPlugin {
    /// 已注册插件的清单视图（用于调用前校验白名单）。
    pub fn registration(&self) -> &Registration {
        &self.registration
    }
}

/// 把 wasmi 的实例化/调用错误按来源映射为稳定错误码。
fn map_trap(error: &wasmi::Error, out_of_fuel: bool) -> PluginError {
    let text = error.to_string();
    let lowered = text.to_ascii_lowercase();
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
 * 带自定义 fuel 上限加载插件（测试/严格环境可下调）。
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
    if fuel_limit == 0 {
        return Err(PluginError::FuelExhausted);
    }
    // wasmi 2.0 的 Config 只实现 Default，不提供 new()。
    let mut config = Config::default();
    config.consume_fuel(true);
    let engine = Engine::new(&config);
    let module = Module::new(&engine, wasm_bytes).map_err(|error| map_trap(&error, false))?;

    // 不注册任何 host 函数：插件若 import 任何宿主能力，实例化必然失败。
    let linker = Linker::<()>::new(&engine);
    let mut store = Store::new(&engine, ());
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
    store: &Store<()>,
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
