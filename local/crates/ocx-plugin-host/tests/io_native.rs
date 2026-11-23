//! W-12 第八批回归：`ocx.file_read` 受控文件读取（native-only）。
//!
//! 用 `wat` 在测试期生成最小 core wasm 插件：导出契约内 `effect_brightness`，
//! 内部调用宿主注入的 `ocx.file_read`，把读取到的文件内容原样作为 JSON 输出。
//! 覆盖：授予可读 / 越权 / 路径穿越 / 命名空间未绑定 / 文件不存在五类分支。
//! 本测试文件整体在 wasm32 下不编译（真实文件 I/O 仅 native 存在）。

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use ocx_plugin_host::{
    PluginError, check_manifest,
    runtime::{HostState, load_plugin_with_resources},
};
use serde_json::json;

/// 测试目录原子计数器，避免并行测试冲突。
static DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// 临时测试目录：构造时创建，析构时递归删除（含内部文件）。
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    /// 创建一个进程内唯一的临时目录。
    fn new(tag: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let seq = DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("ocx-io-{tag}-{nanos}-{seq}"));
        fs::create_dir_all(&path).expect("临时目录应可创建");
        Self { path }
    }
}

impl Drop for TempDir {
    /// 清理临时目录；清理失败不影响测试结论。
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/**
 * 生成把指定 key 写死到线性内存 1024、调用 `ocx.file_read` 并把结果原样输出的最小插件 WAT。
 * key 按 4 字节小端分块写入，长度按实际字节数传入。
 * @param key 形如 `assets:probe.txt` 的文件读取键
 * @returns {String} 可编译的 WAT 文本
 */
fn wat_for_file_read(key: &str) -> String {
    let bytes = key.as_bytes();
    let mut stores = String::new();
    let mut offset = 1024usize;
    let mut index = 0usize;
    while index < bytes.len() {
        let mut word = 0u32;
        for byte_index in 0..4 {
            if index + byte_index < bytes.len() {
                word |= (bytes[index + byte_index] as u32) << (byte_index * 8);
            }
        }
        stores.push_str(&format!(
            "    i32.const {offset}  i32.const {word}  i32.store\n"
        ));
        offset += 4;
        index += 4;
    }
    format!(
        r#"
(module
  (import "ocx" "file_read" (func $read (param i32 i32 i32 i32) (result i64)))
  (memory (export "memory") 2)
  (func (export "ocx_alloc") (param $n i32) (result i32) i32.const 65536)
  (func (export "ocx_dealloc") (param $ptr i32) (param $n i32))
  (func (export "effect_brightness") (param $ptr i32) (param $n i32) (result i64)
{stores}    i32.const 1024  i32.const {key_len}  i32.const 2048  i32.const 262144
    call $read
    i64.const 2048  i64.const 32  i64.shl
    i64.or)
)
"#,
        stores = stores,
        key_len = bytes.len()
    )
}

/**
 * 构造授予 `file-read` scope 的 manifest（能力声明与 scope 一致）。
 * @param scopes 授予的文件 scope 列表
 * @returns {String} manifest JSON
 */
fn manifest_with_scopes(scopes: &[&str]) -> String {
    let scope_items = scopes
        .iter()
        .map(|scope| format!("\"{scope}\""))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"{{
  "name": "io-probe",
  "version": "1.0.0",
  "apiVersion": "0.1.0",
  "schemaVersion": "1",
  "capabilities": ["file-read", "effect"],
  "effects": ["brightness"],
  "commands": [],
  "permissionScopes": {{ "file-read": [{scope_items}] }}
}}"#
    )
}

/**
 * 构造宿主状态：授予给定文件 scope，不含任何内存资源。
 * @param scopes 授予的文件 scope 列表
 * @returns {HostState} 宿主状态
 */
fn host_state(scopes: &[&str]) -> HostState {
    let mut granted = BTreeMap::new();
    granted.insert(
        "file-read".to_owned(),
        scopes.iter().map(|scope| (*scope).to_owned()).collect(),
    );
    HostState::new(granted, BTreeMap::new())
}

/**
 * 加载探测插件：manifest 声明的 scope 与宿主授予 scope 可分别指定，便于测越权。
 * @param key 插件请求的文件键
 * @param manifest_scopes manifest 声明的 scope（须通过校验）
 * @param state 宿主状态（决定实际授予 scope / 目录绑定）
 * @returns {ocx_plugin_host::runtime::LoadedPlugin} 已加载实例
 */
fn load_probe(key: &str, manifest_scopes: &[&str], state: HostState) -> ocx_plugin_host::runtime::LoadedPlugin {
    let wasm = wat::parse_str(wat_for_file_read(key)).expect("测试 WAT 应可编译");
    let checked = check_manifest(&["file-read", "effect"], &manifest_with_scopes(manifest_scopes));
    assert!(checked.ok, "manifest 应注册成功: {:?}", checked.error);
    load_plugin_with_resources(
        &wasm,
        checked.registration.unwrap(),
        &["file-read".to_owned(), "effect".to_owned()],
        state,
    )
    .expect("探测插件应加载成功")
}

/// FR01：授予 scope + 目录绑定 + 文件存在 → 真读出文件内容。
#[test]
fn file_read_returns_granted_file_content() {
    let temp = TempDir::new("ok");
    fs::write(temp.path.join("probe.txt"), br#"{"from":"file"}"#).expect("测试文件应可写");
    let state = host_state(&["assets:*"]).with_file_root("assets", &temp.path);
    let mut plugin = load_probe("assets:probe.txt", &["assets:*"], state);
    let output = plugin
        .call("effect_brightness", &json!({}), true)
        .expect("授予文件应可读");
    assert_eq!(output["from"], "file");
}

/// FR02：宿主授予 scope 不含请求命名空间 → SCOPE_DENIED。
#[test]
fn file_read_denies_out_of_scope_namespace() {
    let temp = TempDir::new("deny");
    fs::write(temp.path.join("secret.txt"), br#"{"secret":true}"#).expect("测试文件应可写");
    // manifest 声明 assets:*，但宿主只授予 other:*（模拟 host 收紧）。
    let state = host_state(&["other:*"]).with_file_root("assets", &temp.path);
    let mut plugin = load_probe("assets:secret.txt", &["assets:*"], state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::ScopeDenied(String::new()).code());
    assert!(error.to_string().contains("assets:secret.txt"));
}

/// FR03：key 含 `..` 段 → 字符串层拒绝（INVALID_SCOPE），不触碰文件系统。
#[test]
fn file_read_rejects_parent_traversal() {
    let temp = TempDir::new("traversal");
    let state = host_state(&["assets:*"]).with_file_root("assets", &temp.path);
    let mut plugin = load_probe("assets:../secret.txt", &["assets:*"], state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::InvalidScope(String::new()).code());
}

/// FR04：命名空间未绑定宿主目录 → PATH_TRAVERSAL（deny-by-default）。
#[test]
fn file_read_rejects_unbound_namespace() {
    let state = host_state(&["assets:*"]);
    let mut plugin = load_probe("assets:probe.txt", &["assets:*"], state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(
        error.code(),
        PluginError::PathTraversal(String::new()).code()
    );
}

/// FR05：授予 + 绑定但文件不存在 → FILE_NOT_FOUND（区别于越权与未绑定）。
#[test]
fn file_read_missing_file_is_distinct() {
    let temp = TempDir::new("missing");
    let state = host_state(&["assets:*"]).with_file_root("assets", &temp.path);
    let mut plugin = load_probe("assets:absent.txt", &["assets:*"], state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::FileNotFound(String::new()).code());
}

/// FR06：manifest 声明路径穿越 scope → 注册阶段即被专用校验拒绝。
#[test]
fn manifest_rejects_traversal_scope() {
    let checked = check_manifest(&["file-read", "effect"], &manifest_with_scopes(&["assets:../x"]));
    assert!(!checked.ok);
    assert_eq!(checked.error.as_deref(), Some("INVALID_SCOPE"));
}
