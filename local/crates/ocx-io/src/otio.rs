//! OTIO 核心子集的导入 / 导出（W-10 第一批）。
//!
//! 设计取舍（对应 `HOTSPOTS.md` Q05「双轨」倾向）：OTIO 只作**交换格式**，
//! 内部保留自有时间轴模型 `EditTimeline`（时间单位统一为整数 ticks）。
//! - 导入：宽容遍历 `serde_json::Value`，未知字段忽略但不写回；缺失非关键字段补默认值并记 warnings。
//! - 导出：只写本实现支持的类型白名单，保证生成的是合法 OTIO 子集。
//! - 时间精度：导入时保留原始 `RationalTime`（value/rate），导出时原样写回，
//!   因此 23.976 / 29.97 等非整数帧率往返**无浮点漂移**；新建片段才用 ticks 换算。
//! - 片段在时间轴上的位置由 children 顺序累加 duration 得到（OTIO 没有显式 timeline start）。

use ocx_time::TICKS_PER_SECOND;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::schema::{
    CLIP_SCHEMA, EXTERNAL_REFERENCE_SCHEMA, GAP_SCHEMA, IoError, OTIO_GENERATOR,
    RATIONAL_TIME_SCHEMA, STACK_SCHEMA, TIME_RANGE_SCHEMA, TIMELINE_SCHEMA, TRACK_SCHEMA,
    is_supported_otio_schema, read_schema_version,
};

/// 归一化后的内部时间轴（字段只增不删，additive-only）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditTimeline {
    pub name: String,
    pub schema_version: u32,
    /// 时间轴帧率（来自第一个 RationalTime 的 rate）。
    pub rate: f64,
    pub tracks: Vec<EditTrack>,
    pub warnings: Vec<String>,
}

/// 一条轨道（Video / Audio）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditTrack {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub clips: Vec<EditClip>,
}

/// 一个片段；`is_gap` 区分 OTIO 的 Gap 与 Clip。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditClip {
    pub id: String,
    pub name: String,
    pub is_gap: bool,
    /// 在时间轴上的起始位置（由前序片段 duration 累加）。
    pub start_ticks: i64,
    pub duration_ticks: i64,
    /// 素材内入点（source_range.start_time 换算）。
    pub source_start_ticks: i64,
    #[serde(default)]
    pub media_url: Option<String>,
    /// 原始 RationalTime，保证往返无损；新建片段为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_value: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_value: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_rate: Option<f64>,
}

/**
 * 把 OTIO RationalTime 的 value 换算成内部 ticks。
 * @param value 帧数（本子集要求整数）
 * @param rate 帧率
 * @returns {Result<i64, IoError>} ticks
 */
pub fn rational_to_ticks(value: i64, rate: f64) -> Result<i64, IoError> {
    if !rate.is_finite() || rate <= 0.0 {
        return Err(IoError::InvalidTimeRange);
    }
    Ok(((value as f64) * (TICKS_PER_SECOND as f64) / rate).round() as i64)
}

/**
 * 把内部 ticks 换算回 RationalTime 的 value（仅用于新建片段）。
 * @param ticks 内部 ticks
 * @param rate 帧率
 * @returns {Result<i64, IoError>} 帧数
 */
pub fn ticks_to_rational_value(ticks: i64, rate: f64) -> Result<i64, IoError> {
    if !rate.is_finite() || rate <= 0.0 {
        return Err(IoError::InvalidTimeRange);
    }
    Ok(((ticks as f64) * rate / (TICKS_PER_SECOND as f64)).round() as i64)
}

/**
 * 生成「剪辑决策」指纹，用于往返不变量校验。
 * 只含会影响剪辑结果的字段；warnings 属于元数据，不参与比较。
 * @param timeline 内部时间轴
 * @returns {String} 指纹
 */
pub fn decision_key(timeline: &EditTimeline) -> String {
    let mut key = format!(
        "{}|{}|{}",
        timeline.name,
        timeline.schema_version,
        timeline.rate.to_bits()
    );
    for track in &timeline.tracks {
        key.push_str(&format!("|{}:{}:{}", track.id, track.name, track.kind));
        for clip in &track.clips {
            key.push_str(&format!(
                "|{}:{}:{}:{}:{}:{}:{}",
                clip.id,
                clip.name,
                clip.is_gap,
                clip.start_ticks,
                clip.duration_ticks,
                clip.source_start_ticks,
                clip.media_url.as_deref().unwrap_or("")
            ));
        }
    }
    key
}

/** 读取 RationalTime，兼容 JSON 整数与浮点两种写法。 */
fn read_rational(value: &Value) -> Result<(i64, f64), IoError> {
    let schema = value["OTIO_SCHEMA"].as_str().unwrap_or("");
    if !schema.is_empty() && !is_supported_otio_schema(schema) {
        return Err(IoError::UnsupportedOtioSchema);
    }
    let raw = value["value"].as_f64().ok_or(IoError::InvalidTimeRange)?;
    let rate = value["rate"].as_f64().ok_or(IoError::InvalidTimeRange)?;
    if !raw.is_finite() || raw < 0.0 || raw.fract().abs() > 1e-9 || !rate.is_finite() || rate <= 0.0
    {
        return Err(IoError::InvalidTimeRange);
    }
    Ok((raw as i64, rate))
}

/** 兼容 OTIO 新旧两种媒体引用写法。 */
fn read_media_url(clip: &Value) -> Option<String> {
    if let Some(url) = clip["media_reference"]["target_url"].as_str() {
        return Some(url.to_string());
    }
    let references = clip["media_references"].as_array()?;
    let active = clip["active_media_reference_key"].as_str();
    if let Some(key) = active {
        for reference in references {
            if reference["name"].as_str() == Some(key) {
                return reference["target_url"].as_str().map(str::to_string);
            }
        }
    }
    references
        .first()
        .and_then(|reference| reference["target_url"].as_str())
        .map(str::to_string)
}

/**
 * 导入 OTIO JSON 为内部时间轴。
 * @param json_text OTIO 文档
 * @returns {Result<EditTimeline, IoError>} 归一化视图
 */
pub fn import_otio(json_text: &str) -> Result<EditTimeline, IoError> {
    let root: Value = serde_json::from_str(json_text).map_err(|_| IoError::InvalidJson)?;
    let schema = root["OTIO_SCHEMA"].as_str().unwrap_or("");
    if !schema.starts_with("Timeline") {
        return Err(IoError::MissingTimeline);
    }
    if !is_supported_otio_schema(schema) {
        return Err(IoError::UnsupportedOtioSchema);
    }
    let (schema_version, declared) = read_schema_version(&root)?;
    let mut warnings = Vec::new();
    if !declared {
        warnings.push("未声明 opencut.schemaVersion，按 v1 解析".to_string());
    }

    let name = root["name"].as_str().unwrap_or("").to_string();
    if name.is_empty() {
        warnings.push("Timeline 缺少 name".to_string());
    }
    let stack = &root["tracks"];
    if !stack.is_object() {
        return Err(IoError::MissingTracks);
    }
    let stack_schema = stack["OTIO_SCHEMA"].as_str().unwrap_or("");
    if !stack_schema.is_empty() && !is_supported_otio_schema(stack_schema) {
        return Err(IoError::UnsupportedOtioSchema);
    }
    let track_values = stack["children"].as_array().ok_or(IoError::MissingTracks)?;

    let mut tracks = Vec::new();
    let mut rate: Option<f64> = None;
    for (track_index, track_value) in track_values.iter().enumerate() {
        let track_schema = track_value["OTIO_SCHEMA"].as_str().unwrap_or("");
        if !track_schema.starts_with("Track") || !is_supported_otio_schema(track_schema) {
            return Err(IoError::UnsupportedOtioSchema);
        }
        let track_name = track_value["name"].as_str().unwrap_or("").to_string();
        let track_id = if track_name.is_empty() {
            format!("track-{track_index}")
        } else {
            track_name.clone()
        };
        let mut kind = track_value["kind"].as_str().unwrap_or("").to_string();
        if kind.is_empty() {
            warnings.push(format!("轨道 {track_id} 缺少 kind，默认 Video"));
            kind = "Video".to_string();
        }
        let clip_values = track_value["children"]
            .as_array()
            .ok_or(IoError::MissingTracks)?;
        let mut clips = Vec::new();
        let mut cursor = 0_i64;
        for (clip_index, clip_value) in clip_values.iter().enumerate() {
            let clip_schema = clip_value["OTIO_SCHEMA"].as_str().unwrap_or("");
            if !is_supported_otio_schema(clip_schema) {
                return Err(IoError::UnsupportedOtioSchema);
            }
            let is_gap = clip_schema.starts_with("Gap");
            let source_range = &clip_value["source_range"];
            let (source_value, source_rate) = read_rational(&source_range["start_time"])?;
            let (duration_value, duration_rate) = read_rational(&source_range["duration"])?;
            if rate.is_none() {
                rate = Some(source_rate);
            }
            if (source_rate - duration_rate).abs() > 1e-9 {
                warnings.push(format!(
                    "轨道 {track_id} 第 {clip_index} 段 start/duration rate 不一致，按 start_time 处理"
                ));
            }
            let source_start_ticks = rational_to_ticks(source_value, source_rate)?;
            let duration_ticks = rational_to_ticks(duration_value, source_rate)?;
            let clip_name = clip_value["name"].as_str().unwrap_or("").to_string();
            let id = if clip_name.is_empty() {
                format!("clip-{track_index}-{clip_index}")
            } else {
                clip_name.clone()
            };
            clips.push(EditClip {
                id,
                name: clip_name,
                is_gap,
                start_ticks: cursor,
                duration_ticks,
                source_start_ticks,
                media_url: read_media_url(clip_value),
                source_value: Some(source_value),
                duration_value: Some(duration_value),
                source_rate: Some(source_rate),
            });
            cursor = cursor.saturating_add(duration_ticks);
        }
        tracks.push(EditTrack {
            id: track_id,
            name: track_name,
            kind,
            clips,
        });
    }
    if tracks.is_empty() {
        return Err(IoError::MissingTracks);
    }
    Ok(EditTimeline {
        name,
        schema_version,
        rate: rate.unwrap_or(30.0),
        tracks,
        warnings,
    })
}

/**
 * 导出内部时间轴为 OTIO JSON（合法子集）。
 * @param timeline 内部时间轴
 * @returns {Result<String, IoError>} OTIO 文档
 */
pub fn export_otio(timeline: &EditTimeline) -> Result<String, IoError> {
    if timeline.tracks.is_empty() || !timeline.rate.is_finite() || timeline.rate <= 0.0 {
        return Err(IoError::InvalidExport);
    }
    let mut track_nodes = Vec::with_capacity(timeline.tracks.len());
    for track in &timeline.tracks {
        let mut clip_nodes = Vec::with_capacity(track.clips.len());
        for clip in &track.clips {
            let (source_value, duration_value, rate) =
                match (clip.source_value, clip.duration_value, clip.source_rate) {
                    (Some(source), Some(duration), Some(original_rate)) => {
                        (source, duration, original_rate)
                    }
                    _ => (
                        ticks_to_rational_value(clip.source_start_ticks, timeline.rate)?,
                        ticks_to_rational_value(clip.duration_ticks, timeline.rate)?,
                        timeline.rate,
                    ),
                };
            let mut node = json!({
                "OTIO_SCHEMA": if clip.is_gap { GAP_SCHEMA } else { CLIP_SCHEMA },
                "name": clip.name,
                "source_range": {
                    "OTIO_SCHEMA": TIME_RANGE_SCHEMA,
                    "start_time": {
                        "OTIO_SCHEMA": RATIONAL_TIME_SCHEMA,
                        "value": source_value,
                        "rate": rate
                    },
                    "duration": {
                        "OTIO_SCHEMA": RATIONAL_TIME_SCHEMA,
                        "value": duration_value,
                        "rate": rate
                    }
                }
            });
            if !clip.is_gap
                && let Some(url) = &clip.media_url
            {
                node["media_reference"] = json!({
                    "OTIO_SCHEMA": EXTERNAL_REFERENCE_SCHEMA,
                    "target_url": url
                });
            }
            clip_nodes.push(node);
        }
        track_nodes.push(json!({
            "OTIO_SCHEMA": TRACK_SCHEMA,
            "name": track.name,
            "kind": track.kind,
            "children": clip_nodes
        }));
    }
    let root = json!({
        "OTIO_SCHEMA": TIMELINE_SCHEMA,
        "name": timeline.name,
        "metadata": {
            "opencut": {
                "schemaVersion": timeline.schema_version,
                "generator": OTIO_GENERATOR
            }
        },
        "tracks": {
            "OTIO_SCHEMA": STACK_SCHEMA,
            "name": "tracks",
            "children": track_nodes
        }
    });
    serde_json::to_string(&root).map_err(|_| IoError::InvalidExport)
}
