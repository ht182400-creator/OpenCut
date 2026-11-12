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
    CLIP_SCHEMA, EXTERNAL_REFERENCE_SCHEMA, GAP_SCHEMA, IoError, MARKER_SCHEMA, OTIO_GENERATOR,
    RATIONAL_TIME_SCHEMA, STACK_SCHEMA, TIME_RANGE_SCHEMA, TIMELINE_SCHEMA, TRACK_SCHEMA,
    TRANSITION_SCHEMA, is_supported_otio_schema, read_schema_version,
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
    /// 时间轴级标记（W-10 第四批）；Track/Clip 级标记暂不解析，导入时记 warning。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub markers: Vec<EditMarker>,
    /// W-10 第五批：Stack children 里的嵌套 Stack，保留原始节点与其位置。
    /// 内部不展开为可编辑轨道，但原样写回保证剪辑决策不丢。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nested_stacks: Vec<EditNestedStack>,
    pub warnings: Vec<String>,
}

/// 一个嵌套 Stack：`index` 是它在父 Stack children 中的原始位置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditNestedStack {
    pub index: usize,
    pub node: Value,
}

/// 一个时间轴级标记（OTIO `Marker.1` 的归一化视图）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditMarker {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub start_ticks: i64,
    pub duration_ticks: i64,
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
    /// W-10 第四批：OTIO `Transition.1` 归一化为转场条目（无媒体引用）。
    #[serde(default)]
    pub is_transition: bool,
    /// 转场的 in_offset / out_offset（ticks）；普通片段为 0。
    #[serde(default)]
    pub in_offset_ticks: i64,
    #[serde(default)]
    pub out_offset_ticks: i64,
    /// 转场类型（OTIO `transition_type`），属于剪辑决策；普通片段为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_type: Option<String>,
    /// W-10 第五批：Clip 上的 effects 原始节点（如 `LinearTimeWarp.1`）。
    /// 保留完整 JSON、不解释语义，导出时原样写回。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<Value>,
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
                "|{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
                clip.id,
                clip.name,
                clip.is_gap,
                clip.start_ticks,
                clip.duration_ticks,
                clip.source_start_ticks,
                clip.media_url.as_deref().unwrap_or(""),
                clip.is_transition,
                clip.in_offset_ticks,
                clip.out_offset_ticks,
                clip.transition_type.as_deref().unwrap_or("")
            ));
            if !clip.effects.is_empty() {
                key.push_str(&format!(
                    "|e:{}",
                    serde_json::to_string(&clip.effects).unwrap_or_default()
                ));
            }
        }
    }
    for marker in &timeline.markers {
        key.push_str(&format!(
            "|m:{}:{}:{}:{}",
            marker.name,
            marker.color.as_deref().unwrap_or(""),
            marker.start_ticks,
            marker.duration_ticks
        ));
    }
    for nested in &timeline.nested_stacks {
        key.push_str(&format!(
            "|s:{}:{}",
            nested.index,
            serde_json::to_string(&nested.node).unwrap_or_default()
        ));
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

/** 兼容 OTIO 的三代媒体引用写法：单字段 / 数组 / 官方 0.18 的字典。 */
fn read_media_url(clip: &Value) -> Option<String> {
    if let Some(url) = clip["media_reference"]["target_url"].as_str() {
        return Some(url.to_string());
    }
    let references = &clip["media_references"];
    let active = clip["active_media_reference_key"].as_str();
    // 官方 0.15+：字典 key → MediaReference，按 active_media_reference_key 选取
    if let Some(map) = references.as_object() {
        if let Some(key) = active
            && let Some(url) = map.get(key).and_then(|item| item["target_url"].as_str())
        {
            return Some(url.to_string());
        }
        return map
            .values()
            .find_map(|item| item["target_url"].as_str())
            .map(str::to_string);
    }
    // 早期实验格式：数组，按 name 匹配 active key
    let list = references.as_array()?;
    if let Some(key) = active {
        for reference in list {
            if reference["name"].as_str() == Some(key) {
                return reference["target_url"].as_str().map(str::to_string);
            }
        }
    }
    list.first()
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
    let mut nested_stacks: Vec<EditNestedStack> = Vec::new();
    let mut rate: Option<f64> = None;

    // W-10 第四批：解析 Timeline 顶层与 Stack（官方 markers 挂在 Composition 上）级标记；
    // Track/Clip 级标记记 warning
    let mut markers = Vec::new();
    let mut marker_values: Vec<&Value> = Vec::new();
    if let Some(items) = root["markers"].as_array() {
        marker_values.extend(items.iter());
    }
    if let Some(items) = stack["markers"].as_array() {
        marker_values.extend(items.iter());
    }
    for marker_value in marker_values {
        let marker_schema = marker_value["OTIO_SCHEMA"].as_str().unwrap_or("");
        if !marker_schema.is_empty() && !is_supported_otio_schema(marker_schema) {
            return Err(IoError::UnsupportedOtioSchema);
        }
        let (start_value, marker_rate) =
            read_rational(&marker_value["marked_range"]["start_time"])?;
        let (duration_value, _) = read_rational(&marker_value["marked_range"]["duration"])?;
        markers.push(EditMarker {
            name: marker_value["name"].as_str().unwrap_or("").to_string(),
            color: marker_value["color"].as_str().map(str::to_string),
            start_ticks: rational_to_ticks(start_value, marker_rate)?,
            duration_ticks: rational_to_ticks(duration_value, marker_rate)?,
        });
    }
    let has_nested_markers = track_values.iter().any(|track| {
        track["markers"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    }) || track_values.iter().any(|track| {
        track["children"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["markers"]
                    .as_array()
                    .is_some_and(|inner| !inner.is_empty())
            })
        })
    });
    if has_nested_markers {
        warnings.push("Track/Clip 级 Marker 暂不解析，仅导入 Timeline/Stack 级".to_string());
    }

    for (track_index, track_value) in track_values.iter().enumerate() {
        let track_schema = track_value["OTIO_SCHEMA"].as_str().unwrap_or("");
        if track_schema.starts_with("Stack") && is_supported_otio_schema(track_schema) {
            // W-10 第五批：嵌套 Stack 保留原始节点与位置，不展开为可编辑轨道
            nested_stacks.push(EditNestedStack {
                index: track_index,
                node: track_value.clone(),
            });
            warnings.push(format!(
                "嵌套 Stack 第 {track_index} 项保留原始节点，不展开为可编辑轨道"
            ));
            continue;
        }
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
            let is_transition = clip_schema.starts_with("Transition");
            let (source_value, source_rate, duration_value, in_offset_ticks, out_offset_ticks) =
                if is_transition {
                    // OTIO Transition 没有 source_range，时长 = in_offset + out_offset
                    let (in_value, in_rate) = read_rational(&clip_value["in_offset"])?;
                    let (out_value, out_rate) = read_rational(&clip_value["out_offset"])?;
                    if rate.is_none() {
                        rate = Some(in_rate);
                    }
                    let in_ticks = rational_to_ticks(in_value, in_rate)?;
                    let out_ticks = rational_to_ticks(out_value, out_rate)?;
                    (0, in_rate, in_value + out_value, in_ticks, out_ticks)
                } else {
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
                    (source_value, source_rate, duration_value, 0, 0)
                };
            let source_start_ticks = rational_to_ticks(source_value, source_rate)?;
            let duration_ticks = rational_to_ticks(duration_value, source_rate)?;
            let clip_name = clip_value["name"].as_str().unwrap_or("").to_string();
            let id = if clip_name.is_empty() {
                format!("clip-{track_index}-{clip_index}")
            } else {
                clip_name.clone()
            };
            // W-10 第五批：effects 保留原始节点，白名单外的效果明确拒绝
            let effects = clip_value["effects"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            for effect in &effects {
                let effect_schema = effect["OTIO_SCHEMA"].as_str().unwrap_or("");
                if !effect_schema.is_empty() && !is_supported_otio_schema(effect_schema) {
                    return Err(IoError::UnsupportedOtioSchema);
                }
            }
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
                is_transition,
                in_offset_ticks,
                out_offset_ticks,
                transition_type: clip_value["transition_type"].as_str().map(str::to_string),
                effects,
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
        markers,
        nested_stacks,
        warnings,
    })
}

/**
 * 按嵌套 Stack 的原始位置，把 Track 节点与保留的嵌套节点合并回 Stack children。
 * 嵌套节点不展开为可编辑轨道，但位置与内容原样保留，往返不丢决策。
 * @param track_nodes 已导出的 Track 节点（按内部 tracks 顺序）
 * @param nested_stacks 导入时保留的嵌套 Stack
 * @returns {Vec<Value>} 还原顺序后的 children
 */
fn merge_nested_children(track_nodes: Vec<Value>, nested_stacks: &[EditNestedStack]) -> Vec<Value> {
    let mut nested: Vec<&EditNestedStack> = nested_stacks.iter().collect();
    nested.sort_by_key(|item| item.index);
    let total = track_nodes.len() + nested.len();
    let mut children = Vec::with_capacity(total);
    let mut tracks = track_nodes.into_iter();
    let mut nested_iter = nested.into_iter().peekable();
    for position in 0..total {
        if nested_iter
            .peek()
            .is_some_and(|item| item.index <= position)
        {
            children.push(nested_iter.next().expect("peek 已确认存在").node.clone());
        } else if let Some(node) = tracks.next() {
            children.push(node);
        }
    }
    for item in nested_iter {
        children.push(item.node.clone());
    }
    children
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
            let node = if clip.is_transition {
                // Transition 没有 source_range，时长 = in_offset + out_offset
                let in_value = ticks_to_rational_value(clip.in_offset_ticks, timeline.rate)?;
                let out_value = ticks_to_rational_value(clip.out_offset_ticks, timeline.rate)?;
                json!({
                    "OTIO_SCHEMA": TRANSITION_SCHEMA,
                    "name": clip.name,
                    // 官方 OTIO 要求 Transition 必带 transition_type
                    "transition_type": clip.transition_type.as_deref().unwrap_or("CrossDissolve"),
                    "in_offset": {
                        "OTIO_SCHEMA": RATIONAL_TIME_SCHEMA,
                        "value": in_value,
                        "rate": timeline.rate
                    },
                    "out_offset": {
                        "OTIO_SCHEMA": RATIONAL_TIME_SCHEMA,
                        "value": out_value,
                        "rate": timeline.rate
                    }
                })
            } else {
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
                // W-10 第五批：effects 原样写回，官方工具可读
                if !clip.effects.is_empty() {
                    node["effects"] = json!(clip.effects);
                }
                node
            };
            clip_nodes.push(node);
        }
        track_nodes.push(json!({
            "OTIO_SCHEMA": TRACK_SCHEMA,
            "name": track.name,
            "kind": track.kind,
            "children": clip_nodes
        }));
    }
    let children = merge_nested_children(track_nodes, &timeline.nested_stacks);
    let mut marker_nodes = Vec::with_capacity(timeline.markers.len());
    for marker in &timeline.markers {
        let start_value = ticks_to_rational_value(marker.start_ticks, timeline.rate)?;
        let duration_value = ticks_to_rational_value(marker.duration_ticks, timeline.rate)?;
        marker_nodes.push(json!({
            "OTIO_SCHEMA": MARKER_SCHEMA,
            "name": marker.name,
            "color": marker.color,
            "marked_range": {
                "OTIO_SCHEMA": TIME_RANGE_SCHEMA,
                "start_time": {
                    "OTIO_SCHEMA": RATIONAL_TIME_SCHEMA,
                    "value": start_value,
                    "rate": timeline.rate
                },
                "duration": {
                    "OTIO_SCHEMA": RATIONAL_TIME_SCHEMA,
                    "value": duration_value,
                    "rate": timeline.rate
                }
            }
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
            // 官方 OTIO 的 markers 挂在 Composition（Stack）上，不是 Timeline 顶层
            "markers": marker_nodes,
            "children": children
        }
    });
    serde_json::to_string(&root).map_err(|_| IoError::InvalidExport)
}
