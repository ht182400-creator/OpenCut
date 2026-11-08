//! ocx-domain ripple 的 golden master：与 `ripple-alignment.test.mjs` 共用同一份 JSON 期望值。
//! Rust 实现、经典版 TS 的 JS 参考实现、文档 ID 三者一一对应。

use std::collections::HashSet;
use std::fs;

use ocx_domain::{
    RippleAdjustment, SceneTracks, TICKS_PER_SECOND, TimedElement, apply_ripple_adjustments,
    compute_ripple_adjustments, ripple_shift_elements,
};
use ocx_time::MediaTime;
use serde::Deserialize;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/ripple_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/CASES.md");
const JS_REFERENCE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/ripple-reference.mjs");
const KIND_COMPUTE: &str = "compute";
const KIND_SHIFT: &str = "shift";
const KIND_APPLY: &str = "apply";
const KIND_COMPUTE_THEN_APPLY: &str = "computeThenApply";
const REQUIRED_CATEGORIES: [&str; 3] = ["正常", "边界", "异常"];

/// 单个数据驱动用例。
#[derive(Deserialize)]
struct Case {
    id: String,
    category: String,
    kind: String,
    input: Value,
    expected: Value,
}

/// 用例集合。
#[derive(Deserialize)]
struct Suite {
    version: u32,
    #[serde(rename = "ticksPerSecond")]
    ticks_per_second: i64,
    cases: Vec<Case>,
}

/// 读取并解析 JSON 用例；失败时给出路径与详细错误。
fn load_suite() -> Suite {
    let text = fs::read_to_string(FIXTURE_PATH)
        .unwrap_or_else(|error| panic!("读取用例文件失败 {FIXTURE_PATH}: {error}"));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("解析用例文件失败 {FIXTURE_PATH}: {error}"))
}

/// 从 JSON 解析场景轨道集合。
fn parse_tracks(value: &Value) -> SceneTracks {
    serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("解析 SceneTracks 失败: {error}"))
}

/// 从 JSON 解析元素列表。
fn parse_elements(value: &Value) -> Vec<TimedElement> {
    serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("解析元素列表失败: {error}"))
}

/// 从 JSON 解析调整列表。
fn parse_adjustments(value: &Value) -> Vec<RippleAdjustment> {
    serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("解析调整列表失败: {error}"))
}

/// 执行单个用例并返回可与 `expected` 逐字段比对的结果对象。
fn run_case(case: &Case) -> Value {
    let input = &case.input;
    match case.kind.as_str() {
        KIND_COMPUTE => {
            let before = parse_tracks(&input["before"]);
            let after = parse_tracks(&input["after"]);
            json!({ "adjustments": compute_ripple_adjustments(&before, &after) })
        }
        KIND_SHIFT => {
            let elements = parse_elements(&input["elements"]);
            let after_time = input["afterTime"].as_i64().unwrap_or(0);
            let shift_amount = input["shiftAmount"].as_i64().unwrap_or(0);
            json!({
                "elements": ripple_shift_elements(
                    &elements,
                    MediaTime::from_ticks(after_time),
                    shift_amount,
                )
            })
        }
        KIND_APPLY => {
            let tracks = parse_tracks(&input["tracks"]);
            let adjustments = parse_adjustments(&input["adjustments"]);
            json!({ "tracks": apply_ripple_adjustments(&tracks, &adjustments) })
        }
        KIND_COMPUTE_THEN_APPLY => {
            let before = parse_tracks(&input["before"]);
            let after = parse_tracks(&input["after"]);
            let target = parse_tracks(&input["target"]);
            let adjustments = compute_ripple_adjustments(&before, &after);
            json!({
                "adjustments": adjustments,
                "applied": apply_ripple_adjustments(&target, &adjustments),
            })
        }
        other => panic!("未知用例类型：{other}"),
    }
}

/// 主回归：逐字段比对期望值，并校验用例/文档/JS 参考实现三者一致。
#[test]
fn golden_master_cases() {
    let suite = load_suite();
    assert_eq!(suite.version, 1, "用例文件版本不匹配");
    assert_eq!(
        suite.ticks_per_second, TICKS_PER_SECOND,
        "用例的时间单位必须与 ocx-time 一致"
    );
    assert!(!suite.cases.is_empty(), "用例集合不能为空");

    let doc = fs::read_to_string(CASES_DOC_PATH)
        .unwrap_or_else(|error| panic!("读取测试案例文档失败 {CASES_DOC_PATH}: {error}"));
    assert!(
        fs::metadata(JS_REFERENCE_PATH).is_ok(),
        "缺少经典版 TS 的 JS 参考实现"
    );

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
                "用例 {}（{} / {}）字段 {} 失败：实际 {}，期望 {}",
                case.id, case.category, case.kind, key, actual_value, expected_value
            );
        }
    }

    for required in REQUIRED_CATEGORIES {
        assert!(categories.contains(required), "缺少测试分类：{}", required);
    }
    assert!(doc.contains("测试结果"), "测试案例文档缺少测试结果章节");
}
