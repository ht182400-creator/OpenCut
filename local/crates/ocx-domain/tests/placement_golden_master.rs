//! ocx-domain placement 的 golden master：与 `placement-alignment.test.mjs` 共用同一份 JSON 期望值。

use std::collections::HashSet;
use std::fs;

use ocx_domain::{
    ElementType, InsertDirection, PlacementResult, PlacementStrategy, PlacementSubject,
    PlacementTimeSpan, SceneTracks, TICKS_PER_SECOND, TimelineTrack, TrackType,
    can_place_time_spans_on_track, enforce_main_track_start, get_default_insert_index_for_track,
    get_earliest_main_track_element, get_highest_insert_index_for_track,
    get_track_type_for_element_type, resolve_preferred_new_track_placement,
    resolve_track_placement, validate_element_track_compatibility,
};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/placement_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/PLACEMENT_CASES.md");
const JS_REFERENCE_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/placement-reference.mjs");
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

/// 从 JSON 值解析强类型，失败时给出详细错误。
fn parse<T: DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("解析 JSON 失败: {error}"))
}

/// 三种代表性轨道类型，用于插入位置批量用例。
const INDEX_TRACK_TYPES: [(&str, TrackType); 3] = [
    ("video", TrackType::Video),
    ("audio", TrackType::Audio),
    ("effect", TrackType::Effect),
];

/// 执行单个用例并返回可与 `expected` 逐字段比对的结果。
fn run_case(case: &Case) -> Value {
    let input = &case.input;
    match case.kind.as_str() {
        "mapAll" => {
            let element_types: Vec<String> = parse(&input["elementTypes"]);
            let track_types: Vec<String> = element_types
                .iter()
                .map(|name| {
                    let element_type: ElementType = parse(&json!(name));
                    get_track_type_for_element_type(element_type)
                        .as_str()
                        .to_owned()
                })
                .collect();
            json!({ "trackTypes": track_types })
        }
        "compatibility" => {
            let element_type: ElementType = parse(&input["elementType"]);
            let track_type: TrackType = parse(&input["trackType"]);
            json!({ "result": validate_element_track_compatibility(element_type, track_type) })
        }
        "overlap" => {
            let track: TimelineTrack = parse(&input["track"]);
            let spans: Vec<PlacementTimeSpan> = parse(&input["timeSpans"]);
            json!({ "canPlace": can_place_time_spans_on_track(&track, &spans) })
        }
        "earliest" => {
            let main_track: TimelineTrack = parse(&input["mainTrack"]);
            let exclude = input["excludeElementId"].as_str();
            let element_id = get_earliest_main_track_element(&main_track, exclude)
                .map(|element| element.id.clone());
            json!({ "elementId": element_id })
        }
        "mainTrack" => {
            let tracks: SceneTracks = parse(&input["tracks"]);
            let target = input["targetTrackId"].as_str().unwrap_or("");
            let requested = input["requestedStartTime"].as_i64().unwrap_or(0);
            let exclude = input["excludeElementId"].as_str();
            json!({ "startTime": enforce_main_track_start(&tracks, target, requested, exclude) })
        }
        "insertIndexAll" => {
            let tracks: SceneTracks = parse(&input["tracks"]);
            let mut default = serde_json::Map::new();
            let mut highest = serde_json::Map::new();
            for (label, track_type) in INDEX_TRACK_TYPES {
                default.insert(
                    label.to_owned(),
                    json!(get_default_insert_index_for_track(&tracks, track_type)),
                );
                highest.insert(
                    label.to_owned(),
                    json!(get_highest_insert_index_for_track(&tracks, track_type)),
                );
            }
            json!({ "default": Value::Object(default), "highest": Value::Object(highest) })
        }
        "preferred" => {
            let tracks: SceneTracks = parse(&input["tracks"]);
            let track_type: TrackType = parse(&input["trackType"]);
            let preferred_index = input["preferredIndex"].as_i64().unwrap_or(0);
            let direction: InsertDirection = parse(&input["direction"]);
            let (insert_index, insert_position) = resolve_preferred_new_track_placement(
                &tracks,
                track_type,
                preferred_index,
                direction,
            );
            json!({ "insertIndex": insert_index, "insertPosition": insert_position })
        }
        "resolve" => {
            let tracks: SceneTracks = parse(&input["tracks"]);
            let subject: PlacementSubject = parse(&input["subject"]);
            let spans: Vec<PlacementTimeSpan> = parse(&input["timeSpans"]);
            let strategy: PlacementStrategy = parse(&input["strategy"]);
            let result: Option<PlacementResult> =
                resolve_track_placement(&tracks, subject, &spans, &strategy);
            json!({ "result": result })
        }
        other => panic!("未知用例类型：{other}"),
    }
}

/// 主回归：逐字段比对期望值，并校验用例/文档/JS 参考实现三者一致。
#[test]
fn placement_golden_master_cases() {
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
