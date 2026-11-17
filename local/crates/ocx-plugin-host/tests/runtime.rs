//! W-12 第三批回归：wasmi 运行时 + 细粒度权限（零导入沙箱、导出白名单、fuel、内存边界）。
//! 示例插件 wasm 与 `apps/web/public/fixtures/sample-plugin.wasm` 同源（同一产物）。

use std::collections::BTreeMap;

use ocx_plugin_host::{
    MAX_INPUT_BYTES, PluginError, Registration, check_manifest, load_plugin, load_plugin_with_fuel,
};
use serde_json::json;

const SAMPLE_MANIFEST: &str = include_str!("fixtures/sample_plugin.json");
/// 示例插件 wasm（116313B，与浏览器侧同一产物）。
const SAMPLE_WASM: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../apps/web/public/fixtures/sample-plugin.wasm"
));
const GRANTED: &[&str] = &["effect", "command", "snapshot", "discover"];

/** 加载示例插件的便捷函数。 */
fn sample_plugin(granted: &[&str]) -> ocx_plugin_host::runtime::LoadedPlugin {
    let result = check_manifest(granted, SAMPLE_MANIFEST);
    assert!(result.ok, "示例 manifest 应注册成功");
    let granted_owned: Vec<String> = granted.iter().map(|item| (*item).to_owned()).collect();
    load_plugin(SAMPLE_WASM, result.registration.unwrap(), &granted_owned)
        .expect("示例 wasm 应加载成功")
}

#[test]
fn real_wasm_effect_and_command_are_invoked_via_wasmi() {
    let mut plugin = sample_plugin(GRANTED);
    // 示例插件 effect_brightness 把 amount 翻倍：0.25 → 0.5。
    let effect = plugin
        .call("effect_brightness", &json!({ "amount": 0.25 }), true)
        .expect("effect 应真实调用成功");
    assert_eq!(effect["brightness"], 0.5);
    // command_ping 回显 value：7 → 7。
    let command = plugin
        .call("command_ping", &json!({ "value": 7 }), false)
        .expect("command 应真实调用成功");
    assert_eq!(command["pong"], 7);
}

#[test]
fn ungranted_permission_blocks_call() {
    // manifest 需要 effect + command，但这里只授予 command —— 注册阶段就会拒绝。
    let result = check_manifest(&["command"], SAMPLE_MANIFEST);
    assert_eq!(result.error.as_deref(), Some("PERMISSION_DENIED"));
    // 构造合法注册后再收回权限：load 时 granted 为空，调用应拒绝。
    let registered = check_manifest(GRANTED, SAMPLE_MANIFEST)
        .registration
        .unwrap();
    let mut plugin = load_plugin(SAMPLE_WASM, registered, &[]).expect("加载本身不检查调用权限");
    assert_eq!(
        plugin
            .call("effect_brightness", &json!({ "amount": 1.0 }), true)
            .unwrap_err()
            .code(),
        PluginError::PermissionDenied(vec![]).code()
    );
}

#[test]
fn export_not_declared_is_rejected() {
    let mut plugin = sample_plugin(GRANTED);
    // ocx_alloc 是内部 ABI 函数，未在 manifest effects/commands 声明 → 禁止作为 effect 调用。
    assert_eq!(
        plugin
            .call("ocx_alloc", &json!({}), true)
            .unwrap_err()
            .code(),
        PluginError::ExportNotDeclared(String::new()).code()
    );
}

#[test]
fn fuel_exhaustion_is_mapped_to_stable_error() {
    let registered = check_manifest(GRANTED, SAMPLE_MANIFEST)
        .registration
        .unwrap();
    let granted: Vec<String> = GRANTED.iter().map(|item| (*item).to_owned()).collect();
    // 极低 fuel 连分配都做不完，应映射为 FUEL_EXHAUSTED。
    let mut plugin = load_plugin_with_fuel(SAMPLE_WASM, registered, &granted, 1)
        .expect("加载阶段应有足够 fuel 实例化");
    let error = plugin
        .call("effect_brightness", &json!({ "amount": 0.25 }), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::FuelExhausted.code());
}

#[test]
fn malformed_wasm_is_rejected() {
    let registered = check_manifest(GRANTED, SAMPLE_MANIFEST)
        .registration
        .unwrap();
    let granted: Vec<String> = GRANTED.iter().map(|item| (*item).to_owned()).collect();
    let error = match load_plugin(b"not a wasm module", registered, &granted) {
        Ok(_) => panic!("坏字节码不应加载成功"),
        Err(error) => error,
    };
    assert_eq!(error.code(), PluginError::InvalidWasm.code());
}

#[test]
fn module_with_host_import_is_rejected() {
    // WAT 模块声明一个宿主导入；本 host 的 Linker 刻意不注册任何函数 → 实例化必须失败。
    let wat = r#"(module
        (import "host" "log" (func $log (param i32)))
        (memory (export "memory") 1)
        (func (export "ocx_alloc") (param i32) (result i32) i32.const 1)
        (func (export "ocx_dealloc") (param i32 i32))
        (func (export "effect_brightness") (param i32 i32) (result i64) i64.const 0)
    )"#;
    let registered = check_manifest(GRANTED, SAMPLE_MANIFEST)
        .registration
        .unwrap();
    let granted: Vec<String> = GRANTED.iter().map(|item| (*item).to_owned()).collect();
    let error = match load_plugin(wat.as_bytes(), registered, &granted) {
        Ok(_) => panic!("含宿主导入的模块不应加载成功"),
        Err(error) => error,
    };
    assert_eq!(error.code(), PluginError::DisallowedImport.code());
}

#[test]
fn oversized_input_is_rejected() {
    let mut plugin = sample_plugin(GRANTED);
    let payload = json!({ "amount": "x".repeat(MAX_INPUT_BYTES) });
    assert_eq!(
        plugin
            .call("effect_brightness", &payload, true)
            .unwrap_err()
            .code(),
        PluginError::InputTooLarge.code()
    );
}

#[test]
fn effect_missing_from_wit_contract_is_rejected_even_if_manifest_allows_it() {
    // WAT 模块真实导出 effect_mystery，且提供合法 ABI；manifest 与权限都放行，
    // 但 host 内嵌 WIT 契约没有 mystery → WIT 层必须作为独立第二道白名单拦截。
    let wat = r#"(module
        (memory (export "memory") 1)
        (func (export "ocx_alloc") (param i32) (result i32) i32.const 8)
        (func (export "ocx_dealloc") (param i32 i32))
        (func (export "effect_mystery") (param i32 i32) (result i64) i64.const 0)
    )"#;
    let registration = Registration {
        name: "mystery-plugin".to_owned(),
        version: "1.0.0".to_owned(),
        schema_version: "1".to_owned(),
        capabilities: vec!["effect".to_owned()],
        effects: vec!["mystery".to_owned()],
        commands: Vec::new(),
        permission_scopes: BTreeMap::new(),
    };
    let granted: Vec<String> = vec!["effect".to_owned()];
    let mut plugin = load_plugin(wat.as_bytes(), registration, &granted)
        .expect("契约外导出不影响加载，只在调用时拦截");
    let error = plugin.call("effect_mystery", &json!({}), true).unwrap_err();
    assert_eq!(
        error.code(),
        PluginError::WitExportNotDeclared(String::new()).code()
    );
}
