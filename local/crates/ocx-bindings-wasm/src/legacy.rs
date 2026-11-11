//! W-05 第四批的 WASM 分派：经典版项目只读兼容与关键帧查询。
//!
//! 与 `domain_eval` 的其它分支一样，跨边界只用 camelCase JSON；项目 JSON 本身是原始文本，
//! 因此单独走 `read_classic_project_wasm`，避免先解析成对象再序列化回去的信息损失。

use ocx_domain::{
    ElementAnimations, ProjectView, format_linear_rgba, get_element_keyframes,
    get_keyframe_at_time, get_keyframe_by_id, has_keyframes_for_path, is_animation_path,
    is_animation_storage_key, read_classic_project, write_classic_project,
};
use serde_json::{Value, json};
use wasm_bindgen::JsValue;

/// 把内部错误转成带中文提示的 JS 异常值。
fn js_error(context: &str, detail: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&format!(
        "{context}失败：{detail}。请检查请求格式后重试；若持续出现请联系开发者。"
    ))
}

/// 读取字符串字段。
fn string_field(request: &Value, field: &str) -> Result<String, JsValue> {
    request[field]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| js_error("解析字段", format!("{field} 必须是字符串")))
}

/// 读取动画集合；缺失时返回空集合（部分 op 不需要该字段）。
fn parse_animations(request: &Value) -> Result<ElementAnimations, JsValue> {
    if !request["animations"].is_object() {
        return Ok(ElementAnimations::new());
    }
    serde_json::from_value(request["animations"].clone())
        .map_err(|error| js_error("解析字段 animations", error))
}

/// 分派关键帧查询的 op，返回可与前端适配层对齐的 JSON 值。
pub fn keyframe_query_eval(request: &Value) -> Result<Value, JsValue> {
    let op = request["op"]
        .as_str()
        .ok_or_else(|| js_error("解析字段 op", "缺少字符串字段 op"))?;
    match op {
        "isAnimationPath" => {
            Ok(json!({ "result": is_animation_path(&string_field(request, "path")?) }))
        }
        "isAnimationStorageKey" => {
            Ok(json!({ "result": is_animation_storage_key(&string_field(request, "path")?) }))
        }
        "formatLinearRgba" => {
            let color: [f64; 4] = serde_json::from_value(request["color"].clone())
                .map_err(|error| js_error("解析字段 color", error))?;
            Ok(json!({ "result": format_linear_rgba(color[0], color[1], color[2], color[3]) }))
        }
        "getElementKeyframes" => {
            let animations = parse_animations(request)?;
            Ok(json!({ "result": get_element_keyframes(&animations) }))
        }
        "hasKeyframesForPath" => {
            let animations = parse_animations(request)?;
            let path = string_field(request, "path")?;
            Ok(json!({ "result": has_keyframes_for_path(&animations, &path) }))
        }
        "getKeyframeAtTime" => {
            let animations = parse_animations(request)?;
            let path = string_field(request, "path")?;
            let time = request["time"]
                .as_i64()
                .ok_or_else(|| js_error("解析字段 time", "必须是整数 ticks"))?;
            Ok(json!({ "result": get_keyframe_at_time(&animations, &path, time) }))
        }
        "getKeyframeById" => {
            let animations = parse_animations(request)?;
            let path = string_field(request, "path")?;
            let keyframe_id = string_field(request, "keyframeId")?;
            Ok(json!({ "result": get_keyframe_by_id(&animations, &path, &keyframe_id) }))
        }
        other => Err(js_error("分派关键帧查询", format!("不支持的 op：{other}"))),
    }
}

/// 读取经典版项目 JSON；错误以 `{ "error": <稳定码> }` 返回，不抛异常。
pub fn read_classic_project_wasm(project_json: &str) -> Result<String, JsValue> {
    let value = match read_classic_project(project_json) {
        Ok(view) => {
            serde_json::to_value(&view).map_err(|error| js_error("序列化项目视图", error))?
        }
        Err(error) => json!({ "error": error.code() }),
    };
    serde_json::to_string(&value).map_err(|error| js_error("序列化项目结果", error))
}

/// W-05 第五批：把编辑后的归一化视图按 id 合并回原始项目 JSON。
/// 请求 `{ "original": "<项目 JSON>", "view": ProjectView }`，
/// 返回 `{"ok":true,"project":"<JSON>"}` 或 `{"ok":false,"error":"CODE"}`。
pub fn write_classic_project_wasm(request_json: &str) -> Result<String, JsValue> {
    let request: Value =
        serde_json::from_str(request_json).map_err(|error| js_error("解析项目写回请求", error))?;
    let original = request["original"]
        .as_str()
        .ok_or_else(|| js_error("解析字段 original", "缺少字符串"))?;
    let view: ProjectView = serde_json::from_value(request["view"].clone())
        .map_err(|error| js_error("解析字段 view", error))?;
    let value = match write_classic_project(original, &view) {
        Ok(project) => json!({ "ok": true, "project": project }),
        Err(error) => json!({ "ok": false, "error": error.code() }),
    };
    serde_json::to_string(&value).map_err(|error| js_error("序列化写回结果", error))
}
