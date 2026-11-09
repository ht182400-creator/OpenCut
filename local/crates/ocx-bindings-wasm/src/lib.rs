//! OpenCut Web 端的 WASM 绑定薄层（W-06）。
//!
//! 设计约束（见 `roadmap/COMPAT.md`）：
//! - **I-01**：前端所有调用只能经 `apps/web/src/local/editor-adapter.ts` 适配层访问 core，
//!   本 crate 只暴露少量稳定入口，不把内部类型泄漏到 JS。
//! - 跨边界数据一律 JSON 字符串（camelCase，版本化信封），便于上游 API 落地时替换实现。
//! - 错误统一转成 `JsValue` 并带中文友好提示，由适配层 catch 后展示。
//!
//! `wasm-bindgen` CLI 版本必须与本 crate 依赖严格一致（见 `H03-toolchain-bootstrap.md`）。

use ocx_domain::{
    AnimationChannel, ParamValue, PlacementResult, PlacementStrategy, PlacementSubject,
    PlacementTimeSpan, ScalarChannel, SceneTracks, apply_ripple_adjustments,
    compute_ripple_adjustments, get_scalar_channel_value_at_time, resolve_track_placement,
};
use ocx_editor_api::{API_VERSION, CommandEnvelope, EditorApi, InMemoryBackend, SCHEMA_VERSION};
use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

const KIND_RIPPLE_ADJUSTMENTS: &str = "rippleAdjustments";
const KIND_RIPPLE_APPLY: &str = "rippleApply";
const KIND_PLACEMENT_RESOLVE: &str = "placementResolve";
const KIND_ANIMATION_SCALAR: &str = "animationScalar";
const KIND_EDITOR_EXECUTE: &str = "editorExecute";

/// 把内部错误转为带上下文与友好提示的 JS 异常值。
fn js_error(context: &str, error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&format!(
        "{context}失败：{error}。请检查请求格式后重试；若持续出现请联系开发者。"
    ))
}

/// 序列化结果为 JSON 字符串。
fn to_json<T: Serialize>(value: &T) -> Result<String, JsValue> {
    serde_json::to_string(value).map_err(|error| js_error("序列化 core 结果", error))
}

/// 从请求对象解析强类型字段。
fn parse_field<T: serde::de::DeserializeOwned>(request: &Value, field: &str) -> Result<T, JsValue> {
    serde_json::from_value(request[field].clone())
        .map_err(|error| js_error(&format!("解析字段 {field}"), error))
}

/// core 的接口版本（供前端展示与能力协商）。
#[wasm_bindgen]
pub fn api_version() -> String {
    API_VERSION.to_owned()
}

/// core 的 schema 版本。
#[wasm_bindgen]
pub fn schema_version() -> String {
    SCHEMA_VERSION.to_owned()
}

/// 能力发现结果（对齐 MCP `server/discover` 思路）。
#[wasm_bindgen]
pub fn discover() -> Result<String, JsValue> {
    let backend = InMemoryBackend::new();
    to_json(&backend.discover())
}

/// 统一领域求值入口：前端只传 `kind` + 各字段，避免暴露多个内部函数。
///
/// 支持的 kind：`rippleAdjustments` / `rippleApply` / `placementResolve` /
/// `animationScalar` / `editorExecute`。
#[wasm_bindgen]
pub fn domain_eval(request_json: &str) -> Result<String, JsValue> {
    let request: Value =
        serde_json::from_str(request_json).map_err(|error| js_error("解析请求 JSON", error))?;
    let kind = request["kind"]
        .as_str()
        .ok_or_else(|| js_error("解析请求", "缺少字符串字段 kind"))?;

    match kind {
        KIND_RIPPLE_ADJUSTMENTS => {
            let before: SceneTracks = parse_field(&request, "before")?;
            let after: SceneTracks = parse_field(&request, "after")?;
            to_json(&json!({ "adjustments": compute_ripple_adjustments(&before, &after) }))
        }
        KIND_RIPPLE_APPLY => {
            let tracks: SceneTracks = parse_field(&request, "tracks")?;
            let adjustments =
                parse_field::<Vec<ocx_domain::RippleAdjustment>>(&request, "adjustments")?;
            to_json(&json!({ "tracks": apply_ripple_adjustments(&tracks, &adjustments) }))
        }
        KIND_PLACEMENT_RESOLVE => {
            let tracks: SceneTracks = parse_field(&request, "tracks")?;
            let subject: PlacementSubject = parse_field(&request, "subject")?;
            let spans: Vec<PlacementTimeSpan> = parse_field(&request, "timeSpans")?;
            let strategy: PlacementStrategy = parse_field(&request, "strategy")?;
            let result: Option<PlacementResult> =
                resolve_track_placement(&tracks, subject, &spans, &strategy);
            to_json(&json!({ "result": result }))
        }
        KIND_ANIMATION_SCALAR => {
            let channel: ScalarChannel = parse_field(&request, "channel")?;
            let time = request["time"]
                .as_i64()
                .ok_or_else(|| js_error("解析字段 time", "必须是整数 ticks"))?;
            let fallback = request["fallbackValue"]
                .as_f64()
                .ok_or_else(|| js_error("解析字段 fallbackValue", "必须是数值"))?;
            let value = get_scalar_channel_value_at_time(&channel, time, fallback);
            to_json(&json!({ "value": value }))
        }
        KIND_EDITOR_EXECUTE => {
            let command: CommandEnvelope = parse_field(&request, "command")?;
            let backend = InMemoryBackend::new();
            let outcome = backend
                .execute(command)
                .map_err(|error| js_error("执行命令", error))?;
            to_json(&outcome)
        }
        other => {
            // 显式拒绝未知 kind，避免静默返回错误结果
            Err(js_error("分派请求", format!("不支持的 kind：{other}")))
        }
    }
}

/// 通道类型探测（供前端在提交请求前校验 fallback 类型，避免无谓的 WASM 调用）。
#[wasm_bindgen]
pub fn channel_kind(channel_json: &str) -> Result<String, JsValue> {
    let channel: AnimationChannel =
        serde_json::from_str(channel_json).map_err(|error| js_error("解析通道 JSON", error))?;
    Ok(if channel.is_scalar() {
        "scalar"
    } else {
        "discrete"
    }
    .to_owned())
}

/// 参数值类型探测（number / boolean / string）。
#[wasm_bindgen]
pub fn param_kind(value_json: &str) -> Result<String, JsValue> {
    let value: ParamValue =
        serde_json::from_str(value_json).map_err(|error| js_error("解析参数值 JSON", error))?;
    Ok(match value {
        ParamValue::Number(_) => "number",
        ParamValue::Bool(_) => "boolean",
        ParamValue::Text(_) => "string",
    }
    .to_owned())
}
