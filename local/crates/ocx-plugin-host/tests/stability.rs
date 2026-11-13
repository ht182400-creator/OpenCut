//! W-12 第一批回归：manifest 校验、越权拒绝、示例插件注册与真实分派。
//! 用例说明见 `tests/PLUGIN_CASES.md`。

use ocx_plugin_host::{
    PERMISSION_COMMAND, PERMISSION_EFFECT, PLUGIN_PERMISSIONS, PluginHost, check_manifest,
};
use serde_json::{Value, json};

const SAMPLE: &str = include_str!("fixtures/sample_plugin.json");
const GRANTED: &[&str] = &["effect", "command", "snapshot", "discover"];

/** 构造 manifest JSON，便于覆盖异常分支。 */
fn manifest(body: &str) -> String {
    body.to_owned()
}

#[test]
fn sample_plugin_registers_effects_and_commands() {
    let result = check_manifest(GRANTED, SAMPLE);
    assert!(result.ok, "示例插件应注册成功");
    let registration = result.registration.expect("成功应有 registration");
    assert_eq!(registration.name, "sample-effects");
    assert_eq!(registration.version, "1.0.0");
    assert_eq!(registration.schema_version, "1");
    assert_eq!(registration.effects, vec!["brightness"]);
    assert_eq!(registration.commands, vec!["ping"]);
    assert_eq!(registration.capabilities, vec!["effect", "command"]);
}

#[test]
fn ungranted_permission_is_rejected() {
    let result = check_manifest(&["command", "discover"], SAMPLE);
    assert_eq!(result.error.as_deref(), Some("PERMISSION_DENIED"));
    assert_eq!(result.denied, vec![PERMISSION_EFFECT]);
    assert!(result.registration.is_none());
}

#[test]
fn unknown_permission_is_rejected_before_grant_check() {
    let text = manifest(
        r#"{"name":"p","apiVersion":"0.1.0","schemaVersion":"1",
            "capabilities":["root-access"],"effects":["x"]}"#,
    );
    let result = check_manifest(GRANTED, &text);
    assert_eq!(result.error.as_deref(), Some("UNKNOWN_PERMISSION"));
    assert_eq!(result.denied, vec!["root-access"]);
    assert!(PLUGIN_PERMISSIONS.contains(&"effect"));
}

#[test]
fn missing_required_capability_for_registration_is_rejected() {
    let text = manifest(
        r#"{"name":"p","apiVersion":"0.1.0","schemaVersion":"1",
            "capabilities":["command"],"effects":["brightness"],"commands":["ping"]}"#,
    );
    let result = check_manifest(GRANTED, &text);
    assert_eq!(result.error.as_deref(), Some("CAPABILITY_NOT_GRANTED"));
    assert_eq!(result.denied, vec![PERMISSION_EFFECT]);
}

#[test]
fn api_and_schema_version_mismatch_are_rejected() {
    let bad_api = manifest(
        r#"{"name":"p","apiVersion":"9.9.9","schemaVersion":"1",
            "capabilities":["effect"],"effects":["x"]}"#,
    );
    assert_eq!(
        check_manifest(GRANTED, &bad_api).error.as_deref(),
        Some("API_VERSION_MISMATCH")
    );
    let bad_schema = manifest(
        r#"{"name":"p","apiVersion":"0.1.0","schemaVersion":"999",
            "capabilities":["effect"],"effects":["x"]}"#,
    );
    assert_eq!(
        check_manifest(GRANTED, &bad_schema).error.as_deref(),
        Some("SCHEMA_VERSION_MISMATCH")
    );
}

#[test]
fn malformed_manifest_and_missing_fields_are_rejected() {
    assert_eq!(
        check_manifest(GRANTED, "{ 非法").error.as_deref(),
        Some("INVALID_MANIFEST")
    );
    let no_name = manifest(r#"{"capabilities":["effect"],"effects":["x"]}"#);
    assert_eq!(
        check_manifest(GRANTED, &no_name).error.as_deref(),
        Some("MISSING_NAME")
    );
    let empty = manifest(r#"{"name":"p","capabilities":[]}"#);
    assert_eq!(
        check_manifest(GRANTED, &empty).error.as_deref(),
        Some("EMPTY_REGISTRATION")
    );
}

#[test]
fn legacy_manifest_without_versions_is_compatible() {
    let legacy = manifest(r#"{"name":"legacy","capabilities":["effect"],"effects":["x"]}"#);
    let result = check_manifest(GRANTED, &legacy);
    assert!(result.ok, "旧 manifest 缺版本字段应按 v1 兼容");
    assert_eq!(result.registration.unwrap().schema_version, "1");
}

#[test]
fn unknown_fields_are_ignored() {
    let text = manifest(
        r#"{"name":"p","futureField":{"a":1},"capabilities":["effect"],"effects":["x"],"apiVersion":"0.1.0"}"#,
    );
    assert!(check_manifest(GRANTED, &text).ok);
}

#[test]
fn duplicate_registration_is_rejected() {
    let mut host = PluginHost::new(GRANTED);
    assert!(host.register(SAMPLE).ok);
    let second = host.register(SAMPLE);
    assert_eq!(second.error.as_deref(), Some("DUPLICATE_PLUGIN"));
    assert_eq!(host.registrations().len(), 1);
}

#[test]
fn sample_plugin_handlers_are_really_invoked() {
    let mut host = PluginHost::new(GRANTED);
    assert!(host.register(SAMPLE).ok);
    let effects: Vec<(&str, ocx_plugin_host::Handler)> = vec![(
        "brightness",
        Box::new(|payload: &Value| {
            let amount = payload["amount"]
                .as_f64()
                .ok_or_else(|| "缺少 amount".to_owned())?;
            Ok(json!({ "brightness": amount * 2.0 }))
        }),
    )];
    let commands: Vec<(&str, ocx_plugin_host::Handler)> = vec![(
        "ping",
        Box::new(|payload: &Value| Ok(json!({ "pong": payload["value"].clone() }))),
    )];
    host.bind_handlers("sample-effects", effects, commands)
        .expect("示例插件应能绑定处理器");
    assert_eq!(host.effect_names(), vec!["brightness"]);
    assert_eq!(host.command_names(), vec!["ping"]);
    assert_eq!(
        host.run_effect("brightness", &json!({ "amount": 0.25 }))
            .unwrap(),
        json!({ "brightness": 0.5 })
    );
    assert_eq!(
        host.run_command("ping", &json!({ "value": 7 })).unwrap(),
        json!({ "pong": 7 })
    );
}

#[test]
fn unknown_handlers_and_unknown_plugin_are_rejected() {
    let mut host = PluginHost::new(GRANTED);
    assert_eq!(
        host.bind_handlers("not-registered", vec![], vec![]),
        Err(ocx_plugin_host::PluginError::UnknownPlugin)
    );
    assert!(host.register(SAMPLE).ok);
    assert_eq!(
        host.run_effect("missing", &json!({})),
        Err(ocx_plugin_host::PluginError::UnknownEffect)
    );
    assert_eq!(
        host.run_command("missing", &json!({})),
        Err(ocx_plugin_host::PluginError::UnknownCommand)
    );
}

#[test]
fn revoked_permission_blocks_even_bound_handlers() {
    let mut host = PluginHost::new(GRANTED);
    assert!(host.register(SAMPLE).ok);
    let effects: Vec<(&str, ocx_plugin_host::Handler)> =
        vec![("brightness", Box::new(|_| Ok(json!({ "ok": true }))))];
    host.bind_handlers("sample-effects", effects, vec![])
        .unwrap();
    let restricted = PluginHost::new(&["command"]);
    assert_eq!(restricted.granted(), vec![PERMISSION_COMMAND.to_owned()]);
    assert_eq!(
        restricted
            .run_effect("brightness", &json!({}))
            .unwrap_err()
            .denied(),
        &[PERMISSION_EFFECT.to_owned()]
    );
    // 原 host 仍可调用，证明权限是 host 实例级的
    assert!(host.run_effect("brightness", &json!({})).is_ok());
}

#[test]
fn handler_failure_is_mapped_to_stable_error() {
    let mut host = PluginHost::new(GRANTED);
    assert!(host.register(SAMPLE).ok);
    let effects: Vec<(&str, ocx_plugin_host::Handler)> =
        vec![("brightness", Box::new(|_| Err("素材不可用".to_owned())))];
    host.bind_handlers("sample-effects", effects, vec![])
        .unwrap();
    assert_eq!(
        host.run_effect("brightness", &json!({})),
        Err(ocx_plugin_host::PluginError::HandlerFailed)
    );
}
