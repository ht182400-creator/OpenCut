//! ocx-render 帧契约的 golden master：JSON 数据驱动，校验用例/文档 ID 一一对应。

use std::collections::HashSet;
use std::fs;

use ocx_render::{
    ExportProfile, FrameParams, TICKS_PER_SECOND, TOLERANCE_SECONDS, build_frame_plan,
    frame_index_at_time, render_frame, validate_export_profile,
};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/render_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/RENDER_CASES.md");
const REQUIRED_CATEGORIES: [&str; 3] = ["正常", "边界", "异常"];
const VALUE_EPSILON: f64 = 1e-9;

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
fn parse<T: DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
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
        "validateProfile" => {
            let profile: Result<ExportProfile, String> = parse(&input["profile"]);
            match profile.and_then(|item| {
                validate_export_profile(&item).map_err(|error| error.code().to_owned())
            }) {
                Ok(()) => json!({ "ok": true }),
                Err(code) => json!({ "ok": false, "code": code }),
            }
        }
        "framePlan" => {
            let duration_ticks = input["durationTicks"].as_i64().unwrap_or(0);
            let profile: ExportProfile = parse(&input["profile"])
                .unwrap_or_else(|error| panic!("用例 {} 的 profile 无法解析：{error}", case.id));
            match build_frame_plan(duration_ticks, &profile) {
                Ok(plan) => {
                    let first = plan.frame_times_ticks.first().copied();
                    let last = plan.frame_times_ticks.last().copied();
                    let head: Vec<u32> = plan
                        .audio_samples_per_frame
                        .iter()
                        .take(3)
                        .copied()
                        .collect();
                    let mut result = serde_json::to_value(&plan)
                        .unwrap_or_else(|error| panic!("序列化帧计划失败：{error}"));
                    let object = result.as_object_mut().expect("帧计划应为对象");
                    object.insert("firstFrameTimeTicks".to_owned(), json!(first));
                    object.insert("lastFrameTimeTicks".to_owned(), json!(last));
                    object.insert(
                        "audioSampleCount".to_owned(),
                        json!(plan.audio_samples_per_frame.len()),
                    );
                    object.insert("audioSamplesHead".to_owned(), json!(head));
                    result
                }
                Err(error) => json!({ "error": error.code() }),
            }
        }
        "frameAt" => {
            let time_ticks = input["timeTicks"].as_i64().unwrap_or(0);
            let ticks_per_frame = input["ticksPerFrame"].as_i64().unwrap_or(0);
            json!({ "frameIndex": frame_index_at_time(time_ticks, ticks_per_frame) })
        }
        "renderFrame" => {
            let frame_index = input["frameIndex"].as_u64().unwrap_or(0);
            let time_ticks = input["timeTicks"].as_i64().unwrap_or(0);
            let duration_ticks = input["durationTicks"].as_i64().unwrap_or(0);
            let profile: ExportProfile = parse(&input["profile"])
                .unwrap_or_else(|error| panic!("用例 {} 的 profile 无法解析：{error}", case.id));
            let params: FrameParams = parse(&input["params"])
                .unwrap_or_else(|error| panic!("用例 {} 的 params 无法解析：{error}", case.id));
            match render_frame(frame_index, time_ticks, duration_ticks, &profile, &params) {
                Ok(frame) => {
                    // 期望值只指定「检查哪些坐标」，像素值始终取自实现
                    let samples: Vec<Value> = case.expected["pixelSamples"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                        .iter()
                        .map(|sample| {
                            let x = sample["x"].as_u64().unwrap_or(0) as u32;
                            let y = sample["y"].as_u64().unwrap_or(0) as u32;
                            json!({ "x": x, "y": y, "rgba": frame.pixel(x, y) })
                        })
                        .collect();
                    json!({
                        "width": frame.width,
                        "height": frame.height,
                        "length": frame.pixels_rgba.len(),
                        "pixelSamples": samples,
                    })
                }
                Err(error) => json!({ "error": error.code() }),
            }
        }
        other => panic!("未知用例类型：{other}"),
    }
}

/// 主回归：逐字段容差比对，并校验用例与文档一致。
#[test]
fn render_golden_master_cases() {
    let suite = load_suite();
    assert_eq!(suite.version, 1, "用例文件版本不匹配");
    assert_eq!(
        suite.ticks_per_second, TICKS_PER_SECOND,
        "用例的时间单位必须与 ocx-time 一致"
    );
    assert_eq!(VALUE_EPSILON, TOLERANCE_SECONDS, "容差常量应一致");
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
