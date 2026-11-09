//! W-05 第四批 golden master：经典版项目 JSON 只读兼容 + keyframe-query 翻译。
//! 与 `legacy-alignment.test.mjs` 共用同一份 JSON 期望值。

use std::collections::HashSet;
use std::fs;

use ocx_domain::{
    CLASSIC_PROJECT_VERSION, ElementAnimations, TICKS_PER_SECOND, format_linear_rgba,
    get_element_keyframes, get_keyframe_at_time, get_keyframe_by_id, has_keyframes_for_path,
    is_animation_path, is_animation_storage_key, read_classic_project,
};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/legacy_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/LEGACY_CASES.md");
const JS_REFERENCE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/legacy-reference.mjs");
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
    #[serde(rename = "classicProjectVersion")]
    classic_project_version: u32,
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
        "readClassicProject" => {
            let project_json = match input["projectJson"].as_str() {
                Some(text) => text.to_owned(),
                None => serde_json::to_string(&input["project"])
                    .unwrap_or_else(|error| panic!("序列化项目对象失败: {error}")),
            };
            match read_classic_project(&project_json) {
                Ok(view) => {
                    let tracks: Vec<&ocx_domain::TrackView> = view
                        .scenes
                        .iter()
                        .flat_map(|scene| scene.tracks.iter())
                        .collect();
                    let mut result = serde_json::to_value(&view)
                        .unwrap_or_else(|error| panic!("序列化项目视图失败: {error}"));
                    let object = result.as_object_mut().expect("项目视图应为对象");
                    object.insert("trackCount".to_owned(), json!(tracks.len()));
                    object.insert(
                        "totalElements".to_owned(),
                        json!(
                            tracks
                                .iter()
                                .map(|track| track.elements.len())
                                .sum::<usize>()
                        ),
                    );
                    object.insert(
                        "trackTypes".to_owned(),
                        json!(
                            tracks
                                .iter()
                                .map(|track| track.track_type.clone())
                                .collect::<Vec<String>>()
                        ),
                    );
                    object.insert("warningsCount".to_owned(), json!(view.warnings.len()));
                    result
                }
                Err(error) => json!({ "error": error.code() }),
            }
        }
        "keyframeQuery" => {
            let op = input["op"]
                .as_str()
                .unwrap_or_else(|| panic!("用例 {} 缺少 op", case.id));
            match op {
                "isAnimationPath" => {
                    json!({ "result": is_animation_path(input["path"].as_str().unwrap_or("")) })
                }
                "isAnimationStorageKey" => json!({
                    "result": is_animation_storage_key(input["path"].as_str().unwrap_or(""))
                }),
                "formatLinearRgba" => {
                    let color: [f64; 4] = parse(&input["color"]);
                    json!({ "result": format_linear_rgba(color[0], color[1], color[2], color[3]) })
                }
                "getElementKeyframes" => {
                    let animations: ElementAnimations = parse(&input["animations"]);
                    json!({ "result": get_element_keyframes(&animations) })
                }
                "hasKeyframesForPath" => {
                    let animations: ElementAnimations = parse(&input["animations"]);
                    json!({
                        "result": has_keyframes_for_path(
                            &animations,
                            input["path"].as_str().unwrap_or(""),
                        )
                    })
                }
                "getKeyframeAtTime" => {
                    let animations: ElementAnimations = parse(&input["animations"]);
                    json!({
                        "result": get_keyframe_at_time(
                            &animations,
                            input["path"].as_str().unwrap_or(""),
                            input["time"].as_i64().unwrap_or(0),
                        )
                    })
                }
                "getKeyframeById" => {
                    let animations: ElementAnimations = parse(&input["animations"]);
                    json!({
                        "result": get_keyframe_by_id(
                            &animations,
                            input["path"].as_str().unwrap_or(""),
                            input["keyframeId"].as_str().unwrap_or(""),
                        )
                    })
                }
                other => panic!("未知 op：{other}"),
            }
        }
        other => panic!("未知用例类型：{other}"),
    }
}

/// 主回归：逐字段容差比对，并校验用例/文档/JS 参考实现三者一致。
#[test]
fn legacy_golden_master_cases() {
    let suite = load_suite();
    assert_eq!(suite.version, 1, "用例文件版本不匹配");
    assert_eq!(
        suite.classic_project_version, CLASSIC_PROJECT_VERSION,
        "用例中的经典版项目版本必须与实现一致"
    );
    assert_eq!(TICKS_PER_SECOND, 120_000, "时间单位不变");
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
