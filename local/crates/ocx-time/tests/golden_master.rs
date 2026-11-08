//! ocx-time 的 golden master 回归测试：JSON 数据驱动，与 `tests/CASES.md` 一一对应。
//! 覆盖正常值、边界值（空/极值/负时间）与异常值（非法帧率、非有限秒数、非法时间码）。

use std::collections::HashSet;
use std::fs;

use ocx_time::{
    FormatTimecodeOptions, FrameRate, GuessTimecodeFormatOptions, MediaTime, TimeCodeFormat,
    format_timecode, guess_timecode_format,
};
use serde::Deserialize;
use serde_json::{Value, json};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/media_time_cases.json"
);
const CASES_DOC_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/CASES.md");
const KIND_FROM_SECONDS: &str = "from_seconds";
const KIND_FROM_SECONDS_NON_FINITE: &str = "from_seconds_non_finite";
const KIND_TICKS_PER_FRAME: &str = "ticks_per_frame";
const KIND_ROUND_TO_FRAME: &str = "round_to_frame";
const KIND_IS_FRAME_ALIGNED: &str = "is_frame_aligned";
const KIND_CLAMP: &str = "clamp";
const KIND_GUESS_FORMAT: &str = "guess_timecode_format";
const KIND_FORMAT_TIMECODE: &str = "format_timecode";
const REQUIRED_CATEGORIES: [&str; 3] = ["正常", "边界", "异常"];

/// 单个数据驱动用例。
#[derive(Deserialize)]
struct Case {
    id: String,
    kind: String,
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

/// 读取并解析 JSON 用例；解析失败时给出文件路径与详细错误。
fn load_suite() -> Suite {
    let text = fs::read_to_string(FIXTURE_PATH)
        .unwrap_or_else(|error| panic!("读取用例文件失败 {FIXTURE_PATH}: {error}"));
    serde_json::from_str(&text)
        .unwrap_or_else(|error| panic!("解析用例文件失败 {FIXTURE_PATH}: {error}"))
}

/// 从用例输入中读取帧率。
fn rate_of(input: &Value) -> FrameRate {
    FrameRate::new(
        input["numerator"].as_u64().unwrap_or(0) as u32,
        input["denominator"].as_u64().unwrap_or(0) as u32,
    )
}

/// 把 Option&lt;i64&gt; 转成可与 JSON 期望值比较的 Value。
fn optional_i64(value: Option<i64>) -> Value {
    match value {
        Some(ticks) => json!(ticks),
        None => Value::Null,
    }
}

/// 把 Option&lt;bool&gt; 转成可与 JSON 期望值比较的 Value。
fn optional_bool(value: Option<bool>) -> Value {
    match value {
        Some(flag) => json!(flag),
        None => Value::Null,
    }
}

/// 把 Option&lt;String&gt; 转成可与 JSON 期望值比较的 Value。
fn optional_string(value: Option<String>) -> Value {
    match value {
        Some(text) => json!(text),
        None => Value::Null,
    }
}

/// 时间码格式的稳定字符串标签，用于与 JSON 期望值比较。
fn format_label(format: TimeCodeFormat) -> &'static str {
    match format {
        TimeCodeFormat::MmSs => "MM:SS",
        TimeCodeFormat::HhMmSs => "HH:MM:SS",
        TimeCodeFormat::HhMmSsCs => "HH:MM:SS:CS",
        TimeCodeFormat::HhMmSsFf => "HH:MM:SS:FF",
    }
}

/// 把 JSON 中的格式标签转成枚举；未指定时返回 None（由实现使用默认格式）。
fn parse_format(value: Option<&str>) -> Option<TimeCodeFormat> {
    match value {
        Some("MM:SS") => Some(TimeCodeFormat::MmSs),
        Some("HH:MM:SS") => Some(TimeCodeFormat::HhMmSs),
        Some("HH:MM:SS:CS") => Some(TimeCodeFormat::HhMmSsCs),
        Some("HH:MM:SS:FF") => Some(TimeCodeFormat::HhMmSsFf),
        _ => None,
    }
}

/// 执行单个用例并返回实际值；未知 kind 立即失败，禁止静默跳过。
fn run_case(case: &Case) -> Value {
    let input = &case.input;
    match case.kind.as_str() {
        KIND_FROM_SECONDS => {
            let seconds = input["seconds"].as_f64().unwrap_or(0.0);
            optional_i64(MediaTime::from_seconds_f64(seconds).map(|time| time.as_ticks()))
        }
        KIND_FROM_SECONDS_NON_FINITE => {
            // JSON 无法表达 NaN/Infinity，用 variant 指定三种非有限输入
            let seconds = match input["variant"].as_str().unwrap_or("") {
                "nan" => f64::NAN,
                "inf" => f64::INFINITY,
                "neg_inf" => f64::NEG_INFINITY,
                other => panic!("用例 {} 的非有限 variant 未知：{}", case.id, other),
            };
            optional_i64(MediaTime::from_seconds_f64(seconds).map(|time| time.as_ticks()))
        }
        KIND_TICKS_PER_FRAME => optional_i64(rate_of(input).ticks_per_frame()),
        KIND_ROUND_TO_FRAME => {
            let time = MediaTime::from_ticks(input["ticks"].as_i64().unwrap_or(0));
            optional_i64(
                time.round_to_frame(rate_of(input))
                    .map(|snapped| snapped.as_ticks()),
            )
        }
        KIND_IS_FRAME_ALIGNED => {
            let time = MediaTime::from_ticks(input["ticks"].as_i64().unwrap_or(0));
            optional_bool(time.is_frame_aligned(rate_of(input)))
        }
        KIND_CLAMP => {
            let time = MediaTime::from_ticks(input["ticks"].as_i64().unwrap_or(0));
            let min = MediaTime::from_ticks(input["min"].as_i64().unwrap_or(0));
            let max = MediaTime::from_ticks(input["max"].as_i64().unwrap_or(0));
            json!(time.clamp(min, max).as_ticks())
        }
        KIND_GUESS_FORMAT => {
            let options = GuessTimecodeFormatOptions {
                time_code: input["timeCode"].as_str().unwrap_or("").to_owned(),
            };
            match guess_timecode_format(options) {
                Some(format) => json!(format_label(format)),
                None => Value::Null,
            }
        }
        KIND_FORMAT_TIMECODE => {
            let options = FormatTimecodeOptions {
                time: MediaTime::from_ticks(input["ticks"].as_i64().unwrap_or(0)),
                format: parse_format(input["format"].as_str()),
                rate: None,
            };
            optional_string(format_timecode(options))
        }
        other => panic!("用例 {} 的 kind 未实现：{}", case.id, other),
    }
}

/// 主回归：逐条比对 JSON 期望值，并校验用例与文档一一对应、分类覆盖完整。
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
        assert_eq!(
            actual, case.expected,
            "用例 {}（{} / {}）失败：实际 {}，期望 {}",
            case.id, case.kind, case.category, actual, case.expected
        );
    }

    for required in REQUIRED_CATEGORIES {
        assert!(categories.contains(required), "缺少测试分类：{}", required);
    }
    assert!(doc.contains("测试结果"), "测试案例文档缺少测试结果章节");
}
