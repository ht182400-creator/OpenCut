//! W-12 第五批回归：声明式权限（resource scope）。
//! 用例说明见 `tests/PLUGIN_CASES.md`。

use std::collections::BTreeMap;

use ocx_plugin_host::{
    HostState, SCOPE_CAPABILITY_MEDIA_READ, check_manifest, load_plugin, load_plugin_with_resources,
};
use serde_json::json;

/// 被授予的 media-read scope + host 资源表。
fn host_state(scopes: &[&str], resources: &[&str]) -> HostState {
    let scope_map = BTreeMap::from([(
        SCOPE_CAPABILITY_MEDIA_READ.to_owned(),
        scopes
            .iter()
            .map(|item| (*item).to_owned())
            .collect::<Vec<_>>(),
    )]);
    let resource_map = resources
        .iter()
        .map(|key| ((*key).to_owned(), b"payload".to_vec()))
        .collect::<BTreeMap<_, _>>();
    HostState::new(scope_map, resource_map)
}

/// 输出 JSON `{"ok":true}` 的长度与内存偏移（用于 effect 返回合法 packed 指针）。
const OUTPUT_JSON: &str = r#"{"ok":true}"#;
/// 输出 JSON 在插件线性内存中的偏移。
const OUTPUT_OFFSET: i64 = 64;

/**
 * 构造一个真实 WAT 模块：导入 ocx.resource_len，把固定 key 写入线性内存后调用
 * （越权时能力函数 trap 传播为 SCOPE_DENIED），随后返回预置的合法 JSON；
 * effect 名用契约内的 brightness 以通过白名单。
 */
fn probe_wat(key: &str) -> String {
    // 能力函数结果 drop 掉——本测试只验证授权放行的副作用（不 trap）。
    let output_len = OUTPUT_JSON.len() as i64;
    let packed = (OUTPUT_OFFSET << 32) | output_len;
    // WAT data 字符串内的双引号必须转义为 \"。
    let output_json_wat = OUTPUT_JSON.replace('"', "\\\"");
    format!(
        r#"(module
            (import "ocx" "resource_len" (func $rlen (param i32 i32) (result i64)))
            (memory (export "memory") 1)
            (data (i32.const 16) "{key}")
            (data (i32.const {output_offset}) "{output_json}")
            (func (export "ocx_alloc") (param i32) (result i32) i32.const 128)
            (func (export "ocx_dealloc") (param i32 i32))
            (func (export "effect_brightness") (param i32 i32) (result i64)
                i32.const 16
                i32.const {key_len}
                call $rlen
                drop
                i64.const {packed}
            )
        )"#,
        key_len = key.len(),
        output_offset = OUTPUT_OFFSET,
        output_json = output_json_wat,
    )
}

/** 带 permissionScopes 的 manifest；缺省仅 effect 能力。 */
fn scoped_manifest(scopes: &[&str]) -> String {
    json!({
        "name": "scoped-plugin",
        "capabilities": ["effect", SCOPE_CAPABILITY_MEDIA_READ],
        "effects": ["brightness"],
        "permissionScopes": { (SCOPE_CAPABILITY_MEDIA_READ): scopes }
    })
    .to_string()
}

#[test]
fn exact_scope_grants_capability_function_call() {
    let manifest = scoped_manifest(&["clip:intro"]);
    let registration = check_manifest(&["effect", SCOPE_CAPABILITY_MEDIA_READ], &manifest)
        .registration
        .expect("带合法 scope 的 manifest 应注册成功");
    let granted = vec!["effect".to_owned(), SCOPE_CAPABILITY_MEDIA_READ.to_owned()];
    let wat = probe_wat("clip:intro");
    let state = host_state(&["clip:intro"], &["clip:intro"]);
    let mut plugin = load_plugin_with_resources(wat.as_bytes(), registration, &granted, state)
        .expect("授予 scope 后含能力导入的模块应加载成功");
    // 能力函数放行（不 trap），effect 返回合法 JSON。
    let result = plugin
        .call("effect_brightness", &json!({}), true)
        .expect("授权资源应调用成功");
    assert_eq!(result, json!({ "ok": true }));
}

#[test]
fn out_of_scope_resource_is_denied_at_runtime() {
    let manifest = scoped_manifest(&["clip:intro"]);
    let registration = check_manifest(&["effect", SCOPE_CAPABILITY_MEDIA_READ], &manifest)
        .registration
        .expect("注册应成功");
    let granted = vec!["effect".to_owned(), SCOPE_CAPABILITY_MEDIA_READ.to_owned()];
    // 插件请求 secret:key，但授予 scope 只有 clip:intro → 能力函数 trap → SCOPE_DENIED。
    let wat = probe_wat("secret:key");
    let state = host_state(&["clip:intro"], &["secret:key"]);
    let mut plugin = load_plugin_with_resources(wat.as_bytes(), registration, &granted, state)
        .expect("加载本身不校验具体资源");
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), "SCOPE_DENIED");
    assert!(format!("{error}").contains("secret:key"));
}

#[test]
fn wildcard_scope_grants_namespace() {
    let manifest = scoped_manifest(&["clip:*"]);
    let registration = check_manifest(&["effect", SCOPE_CAPABILITY_MEDIA_READ], &manifest)
        .registration
        .expect("通配 scope 应注册成功");
    let granted = vec!["effect".to_owned(), SCOPE_CAPABILITY_MEDIA_READ.to_owned()];
    let wat = probe_wat("clip:any-name");
    let state = host_state(&["clip:*"], &["clip:any-name"]);
    let mut plugin = load_plugin_with_resources(wat.as_bytes(), registration, &granted, state)
        .expect("通配 scope 覆盖命名空间");
    let result = plugin
        .call("effect_brightness", &json!({}), true)
        .expect("命名空间内资源应放行");
    assert_eq!(result, json!({ "ok": true }));
}

#[test]
fn absent_capability_import_still_rejected_in_zero_import_mode() {
    // 零导入模式（load_plugin）不注册任何 host 函数：含 ocx.resource_len 导入的模块仍被拒。
    let manifest = scoped_manifest(&["clip:intro"]);
    let registration = check_manifest(&["effect", SCOPE_CAPABILITY_MEDIA_READ], &manifest)
        .registration
        .expect("注册应成功");
    let granted = vec!["effect".to_owned(), SCOPE_CAPABILITY_MEDIA_READ.to_owned()];
    let wat = probe_wat("clip:intro");
    let error = match load_plugin(wat.as_bytes(), registration, &granted) {
        Ok(_) => panic!("零导入模式不应注入能力函数"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "DISALLOWED_IMPORT");
}

#[test]
fn manifest_scope_validation_rejects_unknown_capability_and_bad_scope() {
    // scope 声明了未声明/非资源型能力。
    let bad_capability = json!({
        "name": "p", "capabilities": ["effect"], "effects": ["brightness"],
        "permissionScopes": { "export": ["clip:intro"] }
    })
    .to_string();
    assert_eq!(
        check_manifest(&["effect", "export"], &bad_capability)
            .error
            .as_deref(),
        Some("UNKNOWN_SCOPE_CAPABILITY")
    );

    // scope 格式非法（缺命名空间）。
    let bad_scope = json!({
        "name": "p", "capabilities": ["effect", SCOPE_CAPABILITY_MEDIA_READ],
        "effects": ["brightness"],
        "permissionScopes": { (SCOPE_CAPABILITY_MEDIA_READ): ["no-separator"] }
    })
    .to_string();
    assert_eq!(
        check_manifest(&["effect", SCOPE_CAPABILITY_MEDIA_READ], &bad_scope)
            .error
            .as_deref(),
        Some("INVALID_SCOPE")
    );
}

#[test]
fn manifest_without_scopes_stays_deny_by_default() {
    // 旧 manifest 无 permissionScopes：注册成功但 permission_scopes 为空。
    let manifest = json!({
        "name": "legacy", "capabilities": ["effect"], "effects": ["brightness"]
    })
    .to_string();
    let result = check_manifest(&["effect"], &manifest);
    assert!(result.ok);
    let registration = result.registration.expect("旧 manifest 应兼容");
    assert!(registration.permission_scopes.is_empty());
}
