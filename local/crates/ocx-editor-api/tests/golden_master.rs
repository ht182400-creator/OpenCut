//! ocx-editor-api 的 golden master：JSON 命令序列驱动，与 `tests/CASES.md` 一一对应。
//! 覆盖正常值、边界值（空输入/极值/超长字符串/负时间）与异常值（版本不匹配、未知命令、重复注册）。

use std::collections::HashSet;
use std::fs;

use ocx_editor_api::{
    API_VERSION, ApiError, BackendRegistry, DiscoverResult, EditorApi, InMemoryBackend,
    SCHEMA_VERSION,
};
use ocx_time::MediaTime;
use serde::Deserialize;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/editor_api_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/CASES.md");
const OP_EXECUTE: &str = "execute";
const OP_UNDO: &str = "undo";
const OP_REDO: &str = "redo";
const OP_DISCOVER: &str = "discover";
const OP_SNAPSHOT: &str = "snapshot";
const OP_REGISTER: &str = "register";
const REQUIRED_CATEGORIES: [&str; 3] = ["正常", "边界", "异常"];

/// 单个数据驱动用例。
#[derive(Deserialize)]
struct Case {
    id: String,
    category: String,
    input: Value,
    expected: Value,
}

/// 用例集合。
#[derive(Deserialize)]
struct Suite {
    version: u32,
    cases: Vec<Case>,
}

/// 读取并解析 JSON 用例；失败时给出路径与详细错误。
fn load_suite() -> Suite {
    let text = fs::read_to_string(FIXTURE_PATH)
        .unwrap_or_else(|error| panic!("读取用例文件失败 {FIXTURE_PATH}: {error}"));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("解析用例文件失败 {FIXTURE_PATH}: {error}"))
}

/// 把 JSON 里的长度描述展开为真实的超长字符串，避免用例文件膨胀。
fn normalize_payload(payload: &Value) -> Value {
    let mut map = payload.as_object().cloned().unwrap_or_default();
    if let Some(length) = map.get("labelLength").and_then(Value::as_u64) {
        map.insert("label".to_owned(), json!("x".repeat(length as usize)));
        map.remove("labelLength");
    }
    Value::Object(map)
}

/// 执行单步操作；返回 Some(错误码) 表示该步失败并应终止序列。
fn run_step(
    step: &Value,
    backend: &InMemoryBackend,
    registry: &BackendRegistry,
    discovered: &mut Option<DiscoverResult>,
    snapshot_at: &mut Option<i64>,
) -> Option<String> {
    match step["op"].as_str().unwrap_or("") {
        OP_EXECUTE => {
            let mut envelope = InMemoryBackend::envelope(
                step["kind"].as_str().unwrap_or(""),
                step["commandId"].as_str().unwrap_or(""),
                normalize_payload(&step["payload"]),
            );
            if let Some(version) = step["apiVersion"].as_str() {
                envelope.api_version = version.to_owned();
            }
            if let Some(version) = step["schemaVersion"].as_str() {
                envelope.schema_version = version.to_owned();
            }
            backend
                .execute(envelope)
                .err()
                .map(|error| error.code().to_owned())
        }
        OP_UNDO => backend.undo().err().map(|error| error.code().to_owned()),
        OP_REDO => backend.redo().err().map(|error| error.code().to_owned()),
        OP_DISCOVER => {
            *discovered = Some(backend.discover());
            None
        }
        OP_SNAPSHOT => {
            let ticks = step["ticks"].as_i64().unwrap_or(0);
            *snapshot_at = Some(ticks);
            backend
                .snapshot(MediaTime::from_ticks(ticks))
                .err()
                .map(|error| error.code().to_owned())
        }
        OP_REGISTER => registry
            .register(step["backendId"].as_str().unwrap_or(""))
            .err()
            .map(|error| error.code().to_owned()),
        other => panic!("未知操作：{other}"),
    }
}

/// 执行完整序列，返回可与 JSON `expected` 逐字段比对的结果对象。
fn run_case(case: &Case) -> Value {
    let backend = InMemoryBackend::new();
    let registry = BackendRegistry::new();
    let mut discovered: Option<DiscoverResult> = None;
    let mut snapshot_at: Option<i64> = None;
    let mut last_error: Option<String> = None;

    let steps = case.input["steps"]
        .as_array()
        .unwrap_or_else(|| panic!("用例 {} 缺少 steps 数组", case.id));
    for step in steps {
        if let Some(code) = run_step(step, &backend, &registry, &mut discovered, &mut snapshot_at) {
            last_error = Some(code);
            break; // 首个错误即终止序列，与实现行为一致
        }
    }

    let snap = backend
        .snapshot(MediaTime::from_ticks(0))
        .unwrap_or_else(|error| panic!("用例 {} 获取快照失败：{}", case.id, error));
    json!({
        "error": last_error,
        "clipCount": snap.clip_count,
        "ticks": snap.state_ticks,
        "label": snap.label,
        "snapshotId": snap.snapshot_id,
        "backendId": discovered.map(|info| info.backend_id),
        "atTicks": snapshot_at,
    })
}

/// 主回归：逐字段比对期望值，并校验用例与文档一一对应、分类覆盖完整。
#[test]
fn golden_master_cases() {
    let suite = load_suite();
    assert_eq!(suite.version, 1, "用例文件版本不匹配");
    assert!(!suite.cases.is_empty(), "用例集合不能为空");

    let doc = fs::read_to_string(CASES_DOC_PATH)
        .unwrap_or_else(|error| panic!("读取测试案例文档失败 {CASES_DOC_PATH}: {error}"));
    let mut seen_ids: HashSet<&str> = HashSet::new();
    let mut categories: HashSet<&str> = HashSet::new();

    for case in &suite.cases {
        assert!(
            seen_ids.insert(case.id.as_str()),
            "用例 ID 重复：{}",
            case.id
        );
        assert!(doc.contains(&case.id), "测试案例文档缺少用例 {}", case.id);
        categories.insert(case.category.as_str());

        let actual = run_case(case);
        let expected = case
            .expected
            .as_object()
            .unwrap_or_else(|| panic!("用例 {} 的 expected 必须是对象", case.id));
        for (key, expected_value) in expected {
            let actual_value = actual.get(key).unwrap_or(&Value::Null);
            assert_eq!(
                actual_value, expected_value,
                "用例 {}（{}）字段 {} 失败：实际 {}，期望 {}",
                case.id, case.category, key, actual_value, expected_value
            );
        }
    }

    for required in REQUIRED_CATEGORIES {
        assert!(categories.contains(required), "缺少测试分类：{}", required);
    }
    assert!(doc.contains("测试结果"), "测试案例文档缺少测试结果章节");
    // 契约常量也必须被用例覆盖到，避免版本漂移
    assert_eq!(API_VERSION, "0.1.0");
    assert_eq!(SCHEMA_VERSION, "1");
    assert_eq!(ApiError::HistoryEmpty.code(), "HISTORY_EMPTY");
}
