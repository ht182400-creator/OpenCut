//! W-11 接口冻结回归：能力协商与向后兼容（旧 JSON 缺 schemaVersion 仍可读）。

use ocx_editor_api::{
    API_VERSION, CAPABILITIES, CapabilitiesRequest, CommandEnvelope, CommandOutcome,
    DiscoverResult, EditorApi, Event, InMemoryBackend, NEGOTIATE_API_MISMATCH,
    NEGOTIATE_MISSING_CAPABILITIES, NEGOTIATE_NO_COMMON_SCHEMA, NEGOTIATE_OK, SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS, SceneSnapshot, negotiate, supported_versions,
};
use serde_json::{Value, json};

/** 构造一份合法的能力协商请求。 */
fn request() -> CapabilitiesRequest {
    CapabilitiesRequest {
        api_version: API_VERSION.to_owned(),
        schema_versions: vec![SCHEMA_VERSION.to_owned()],
        required_capabilities: vec!["command".to_owned(), "snapshot".to_owned()],
    }
}

#[test]
fn negotiate_accepts_matching_client() {
    let result = negotiate(&request());
    assert!(result.compatible);
    assert_eq!(result.schema_version.as_deref(), Some(SCHEMA_VERSION));
    assert_eq!(result.reason, NEGOTIATE_OK);
    assert!(result.missing_capabilities.is_empty());
}

#[test]
fn negotiate_treats_legacy_request_as_v1() {
    let legacy: CapabilitiesRequest = serde_json::from_value(json!({})).unwrap();
    assert_eq!(legacy.api_version, "");
    assert!(legacy.schema_versions.is_empty());
    let result = negotiate(&legacy);
    assert!(result.compatible, "旧客户端未声明版本时按 v1 兼容");
    assert_eq!(result.schema_version.as_deref(), Some(SCHEMA_VERSION));
}

#[test]
fn negotiate_rejects_api_version_mismatch() {
    let result = negotiate(&CapabilitiesRequest {
        api_version: "9.9.9".to_owned(),
        ..request()
    });
    assert!(!result.compatible);
    assert_eq!(result.reason, NEGOTIATE_API_MISMATCH);
    assert!(result.schema_version.is_none());
}

#[test]
fn negotiate_rejects_no_common_schema() {
    let result = negotiate(&CapabilitiesRequest {
        schema_versions: vec!["999".to_owned()],
        ..request()
    });
    assert!(!result.compatible);
    assert_eq!(result.reason, NEGOTIATE_NO_COMMON_SCHEMA);
}

#[test]
fn negotiate_picks_highest_common_schema() {
    let result = negotiate(&CapabilitiesRequest {
        schema_versions: vec!["999".to_owned(), SCHEMA_VERSION.to_owned()],
        ..request()
    });
    assert!(result.compatible);
    assert_eq!(result.schema_version.as_deref(), Some(SCHEMA_VERSION));
}

#[test]
fn negotiate_lists_missing_capabilities() {
    let result = negotiate(&CapabilitiesRequest {
        required_capabilities: vec![
            "command".to_owned(),
            "gpu-render".to_owned(),
            "ai".to_owned(),
        ],
        ..request()
    });
    assert!(!result.compatible);
    assert_eq!(result.reason, NEGOTIATE_MISSING_CAPABILITIES);
    assert_eq!(result.missing_capabilities, vec!["gpu-render", "ai"]);
    assert_eq!(result.schema_version.as_deref(), Some(SCHEMA_VERSION));
}

#[test]
fn supported_versions_match_constants() {
    let versions = supported_versions();
    assert_eq!(versions.len(), SUPPORTED_SCHEMA_VERSIONS.len());
    assert!(versions.contains(&SCHEMA_VERSION.to_owned()));
    assert_eq!(CAPABILITIES.len(), 4);
}

#[test]
fn negotiation_result_serializes_to_camel_case() {
    let text = serde_json::to_string(&negotiate(&request())).unwrap();
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["compatible"], true);
    assert_eq!(value["schemaVersion"], SCHEMA_VERSION);
    assert!(value["missingCapabilities"].is_array());
    assert_eq!(value["reason"], NEGOTIATE_OK);
}

/** 旧版信封（没有 schemaVersion）仍可反序列化并成功执行。 */
#[test]
fn legacy_envelope_without_schema_version_still_executes() {
    let legacy = json!({
        "apiVersion": API_VERSION,
        "commandId": "legacy-1",
        "kind": "addClip",
        "payload": { "label": "old", "durationTicks": 120000 },
    });
    let envelope: CommandEnvelope = serde_json::from_value(legacy).unwrap();
    assert_eq!(envelope.schema_version, SCHEMA_VERSION);
    let backend = InMemoryBackend::new();
    let outcome = backend.execute(envelope).unwrap();
    assert_eq!(outcome.schema_version, SCHEMA_VERSION);
    assert_eq!(outcome.events[0].schema_version, SCHEMA_VERSION);
}

/** 旧版事件/响应/快照 JSON 缺版本字段时按 v1 补齐。 */
#[test]
fn legacy_outputs_deserialize_with_default_version() {
    let event: Event =
        serde_json::from_value(json!({ "kind": "clipAdded", "payload": {} })).unwrap();
    assert_eq!(event.schema_version, SCHEMA_VERSION);
    let outcome: CommandOutcome =
        serde_json::from_value(json!({ "events": [], "snapshotId": 3 })).unwrap();
    assert_eq!(outcome.schema_version, SCHEMA_VERSION);
    let snapshot: SceneSnapshot = serde_json::from_value(json!({
        "atTicks": 0, "stateTicks": 0, "clipCount": 0, "label": "", "snapshotId": 1,
    }))
    .unwrap();
    assert_eq!(snapshot.schema_version, SCHEMA_VERSION);
}

/** 新输出必须带版本字段，发现结果必须给出可协商版本清单。 */
#[test]
fn new_outputs_carry_schema_version() {
    let backend = InMemoryBackend::new();
    let discover = backend.discover();
    assert_eq!(discover.schema_version, SCHEMA_VERSION);
    assert_eq!(discover.supported_schema_versions, supported_versions());
    let discover_json = serde_json::to_value(&discover).unwrap();
    assert!(discover_json["supportedSchemaVersions"].is_array());

    let outcome = backend
        .execute(InMemoryBackend::envelope("clear", "c1", json!({})))
        .unwrap();
    let outcome_json = serde_json::to_value(&outcome).unwrap();
    assert_eq!(outcome_json["schemaVersion"], SCHEMA_VERSION);
    assert_eq!(outcome_json["events"][0]["schemaVersion"], SCHEMA_VERSION);

    let snapshot = backend
        .snapshot(ocx_time::MediaTime::from_ticks(0))
        .unwrap();
    let snapshot_json = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(snapshot_json["schemaVersion"], SCHEMA_VERSION);
}

/** 未知字段应被忽略（additive-only），未来 schema 仍被明确拒绝。 */
#[test]
fn unknown_fields_ignored_but_future_schema_rejected() {
    let future = json!({
        "apiVersion": API_VERSION,
        "schemaVersion": "999",
        "commandId": "c1",
        "kind": "clear",
        "payload": {},
        "futureField": "from-newer-client",
    });
    let envelope: CommandEnvelope = serde_json::from_value(future).unwrap();
    let backend = InMemoryBackend::new();
    assert_eq!(
        backend.execute(envelope).unwrap_err().code(),
        "VERSION_MISMATCH"
    );
}

/** discover 结果缺失 supportedSchemaVersions 时按空列表读取（旧服务端响应）。 */
#[test]
fn legacy_discover_result_deserializes() {
    let legacy: DiscoverResult = serde_json::from_value(json!({
        "apiVersion": API_VERSION,
        "schemaVersion": SCHEMA_VERSION,
        "backendId": "ocx-in-memory",
        "capabilities": ["command"],
    }))
    .unwrap();
    assert!(legacy.supported_schema_versions.is_empty());
}
