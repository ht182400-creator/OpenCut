//! ocx-domain animation 的 golden master：与 `animation-alignment.test.mjs` 共用同一份 JSON 期望值。
//! 浮点结果按 `VALUE_EPSILON` 容差递归比较，避免跨语言最短小数表示差异。

use std::collections::HashSet;
use std::fs;

use ocx_domain::{
    AnimationChannel, DiscreteChannel, DiscreteValue, ParamValue, ScalarChannel, ScalarKey,
    ScalarSegmentType, TICKS_PER_SECOND, VALUE_EPSILON, get_bezier_point,
    get_channel_value_at_time, get_default_left_handle, get_default_right_handle,
    get_discrete_channel_value_at_time, get_scalar_channel_value_at_time,
    get_scalar_segment_interpolation, normalize_discrete_channel, normalize_scalar_channel,
    solve_bezier_progress_for_time,
};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/animation_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/ANIMATION_CASES.md");
const JS_REFERENCE_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/animation-reference.mjs");
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

/// 读取并解析 JSON 用例。
fn load_suite() -> Suite {
    let text = fs::read_to_string(FIXTURE_PATH)
        .unwrap_or_else(|error| panic!("读取用例文件失败 {FIXTURE_PATH}: {error}"));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("解析用例文件失败 {FIXTURE_PATH}: {error}"))
}

/// 从 JSON 值解析强类型。
fn parse<T: DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("解析 JSON 失败: {error}"))
}

/// 递归容差比较：数值用绝对误差，其余类型严格相等。
fn assert_value_close(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        (Value::Number(left), Value::Number(right)) => {
            let left = left.as_f64().expect("数值应可转 f64");
            let right = right.as_f64().expect("数值应可转 f64");
            assert!(
                (left - right).abs() <= VALUE_EPSILON,
                "{path} 数值不一致：实际 {left}，期望 {right}"
            );
        }
        (Value::Array(left), Value::Array(right)) => {
            assert_eq!(left.len(), right.len(), "{path} 数组长度不一致");
            for (index, (left_item, right_item)) in left.iter().zip(right.iter()).enumerate() {
                assert_value_close(left_item, right_item, &format!("{path}[{index}]"));
            }
        }
        (Value::Object(left), Value::Object(right)) => {
            assert_eq!(left.len(), right.len(), "{path} 对象字段数不一致");
            for (key, right_item) in right {
                let left_item = left.get(key).unwrap_or_else(|| panic!("{path}.{key} 缺失"));
                assert_value_close(left_item, right_item, &format!("{path}.{key}"));
            }
        }
        _ => assert_eq!(actual, expected, "{path} 不一致"),
    }
}

/// 执行单个用例并返回可与 `expected` 逐字段比对的结果。
fn run_case(case: &Case) -> Value {
    let input = &case.input;
    match case.kind.as_str() {
        "bezierPoint" => {
            let progress = input["progress"].as_f64().unwrap_or(0.0);
            let p0 = input["p0"].as_f64().unwrap_or(0.0);
            let p1 = input["p1"].as_f64().unwrap_or(0.0);
            let p2 = input["p2"].as_f64().unwrap_or(0.0);
            let p3 = input["p3"].as_f64().unwrap_or(0.0);
            json!({ "value": get_bezier_point(progress, p0, p1, p2, p3) })
        }
        "defaultHandles" => {
            let left: ScalarKey = parse(&input["leftKey"]);
            let right: ScalarKey = parse(&input["rightKey"]);
            json!({
                "right": get_default_right_handle(&left, &right),
                "left": get_default_left_handle(&left, &right),
            })
        }
        "solveProgress" => {
            let time = input["time"].as_i64().unwrap_or(0);
            let left: ScalarKey = parse(&input["leftKey"]);
            let right: ScalarKey = parse(&input["rightKey"]);
            json!({ "progress": solve_bezier_progress_for_time(time, &left, &right) })
        }
        "segmentInterpolationAll" => json!({
            "step": get_scalar_segment_interpolation(ScalarSegmentType::Step),
            "linear": get_scalar_segment_interpolation(ScalarSegmentType::Linear),
            "bezier": get_scalar_segment_interpolation(ScalarSegmentType::Bezier),
        }),
        "normalizeScalar" => {
            let channel: ScalarChannel = parse(&input["channel"]);
            json!({ "channel": normalize_scalar_channel(&channel) })
        }
        "normalizeDiscrete" => {
            let channel: DiscreteChannel = parse(&input["channel"]);
            json!({ "channel": normalize_discrete_channel(&channel) })
        }
        "scalarValue" => {
            let channel: ScalarChannel = parse(&input["channel"]);
            let time = input["time"].as_i64().unwrap_or(0);
            let fallback = input["fallbackValue"].as_f64().unwrap_or(0.0);
            json!({ "value": get_scalar_channel_value_at_time(&channel, time, fallback) })
        }
        "discreteValue" => {
            let channel: DiscreteChannel = parse(&input["channel"]);
            let time = input["time"].as_i64().unwrap_or(0);
            let fallback: DiscreteValue = parse(&input["fallbackValue"]);
            json!({ "value": get_discrete_channel_value_at_time(&channel, time, &fallback) })
        }
        "channelValue" => {
            let channel: AnimationChannel = parse(&input["channel"]);
            let time = input["time"].as_i64().unwrap_or(0);
            let fallback: ParamValue = parse(&input["fallbackValue"]);
            json!({ "value": get_channel_value_at_time(Some(&channel), time, &fallback) })
        }
        other => panic!("未知用例类型：{other}"),
    }
}

/// 主回归：逐字段容差比对，并校验用例/文档/JS 参考实现三者一致。
#[test]
fn animation_golden_master_cases() {
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
            assert_value_close(
                actual_value,
                expected_value,
                &format!(
                    "用例 {}（{} / {}）字段 {}",
                    case.id, case.category, case.kind, key
                ),
            );
        }
    }

    for required in REQUIRED_CATEGORIES {
        assert!(categories.contains(required), "缺少测试分类：{}", required);
    }
    assert!(doc.contains("测试结果"), "测试案例文档缺少测试结果章节");
}
