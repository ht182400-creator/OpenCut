//! W-12 core 扩展回归：`ocx.resource_read` 受控能力（读内容 + scope 越权拒绝）。
//!
//! 用 `wat` 在测试期生成最小 core wasm 插件：导出 `effect_brightness`（契约内名称），
//! 内部调用宿主注入的 `ocx.resource_len` / `ocx.resource_read`，把授予资源内容原样
//! 作为输出 JSON 返回。不引入 component model / canonical ABI。

use std::collections::BTreeMap;

use ocx_plugin_host::{
    PluginError, check_manifest,
    runtime::{HostState, load_plugin_with_resources},
};
use serde_json::json;

/// 测试插件 WAT：写 key `clip:intro` 到线性内存 1024，读资源到 2048 并原样输出。
const PROBE_WAT: &str = r#"
(module
  (import "ocx" "resource_len" (func $len (param i32 i32) (result i64)))
  (import "ocx" "resource_read" (func $read (param i32 i32 i32 i32) (result i64)))
  (memory (export "memory") 2)
  (func (export "ocx_alloc") (param $n i32) (result i32)
    i32.const 65536)
  (func (export "ocx_dealloc") (param $ptr i32) (param $n i32))
  (func (export "effect_brightness") (param $ptr i32) (param $n i32) (result i64)
    ;; key = "clip:intro" 写入 1024
    i32.const 1024  i32.const 0x70696c63  i32.store   ;; "clip"
    i32.const 1028  i32.const 0x746e693a  i32.store   ;; ":int"
    i32.const 1032  i32.const 0x00006f72  i32.store   ;; "ro\0\0"
    ;; 调 resource_read(1024, 10, 2048, 1024) → len
    i32.const 1024  i32.const 10  i32.const 2048  i32.const 1024
    call $read
    ;; 返回 (2048 << 32) | (len & 0xffffffff)
    i64.const 2048  i64.const 32  i64.shl
    i64.or)
)
"#;

/// 资源型 manifest：声明 media-read + effect(brightness) 与 scope `clip:intro`。
const RESOURCE_MANIFEST: &str = r#"{
  "name": "probe-effects",
  "version": "1.0.0",
  "apiVersion": "0.1.0",
  "schemaVersion": "1",
  "capabilities": ["media-read", "effect"],
  "effects": ["brightness"],
  "commands": [],
  "permissionScopes": { "media-read": ["clip:intro"] }
}"#;

/** 构造宿主状态：给定授予 scope 与资源表。 */
fn host_state(scopes: &[&str], resources: &[(&str, &[u8])]) -> HostState {
    let mut granted = BTreeMap::new();
    granted.insert(
        "media-read".to_owned(),
        scopes.iter().map(|s| (*s).to_owned()).collect(),
    );
    let data = resources
        .iter()
        .map(|(k, v)| ((*k).to_owned(), v.to_vec()))
        .collect();
    HostState::new(granted, data)
}

/** 加载探测插件并返回实例。 */
fn probe_plugin(state: HostState) -> ocx_plugin_host::runtime::LoadedPlugin {
    let wasm = wat::parse_str(PROBE_WAT).expect("测试 WAT 应可编译");
    let checked = check_manifest(&["media-read", "effect"], RESOURCE_MANIFEST);
    assert!(checked.ok, "资源型 manifest 应注册成功: {:?}", checked.error);
    load_plugin_with_resources(
        &wasm,
        checked.registration.unwrap(),
        &["media-read".to_owned(), "effect".to_owned()],
        state,
    )
    .expect("探测插件应加载成功")
}

/// 授予 scope + 资源存在：resource_read 真读出资源内容（作为 JSON 输出）。
#[test]
fn resource_read_returns_granted_resource_content() {
    let resource = br#"{"from":"resource"}"#;
    let mut plugin = probe_plugin(host_state(&["clip:intro"], &[("clip:intro", resource)]));
    let output = plugin
        .call("effect_brightness", &json!({}), true)
        .expect("resource_read 应成功");
    assert_eq!(output["from"], "resource");
}

/// deny-by-default：scope 未命中时越权 trap 映射为 ScopeDenied。
#[test]
fn resource_read_denies_out_of_scope_resource() {
    let resource = br#"{"from":"resource"}"#;
    let mut plugin = probe_plugin(host_state(&["asset:*"], &[("clip:intro", resource)]));
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::ScopeDenied(String::new()).code());
    // 稳定错误码 + Display 中的资源名共同构成诊断信息（denied() 仅用于权限清单类错误）。
    assert!(
        error.to_string().contains("clip:intro"),
        "越权错误应携带资源名: {error}"
    );
}

/// 资源不存在时返回 -1 → 输出长度为 0 → 宿主 InvalidOutput（区分「无权」与「无此资源」）。
#[test]
fn resource_read_missing_resource_is_distinct_from_denied() {
    let mut plugin = probe_plugin(host_state(&["clip:intro"], &[]));
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::InvalidOutput.code());
    assert!(error.denied().is_empty());
}
