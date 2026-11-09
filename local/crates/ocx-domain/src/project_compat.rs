//! 经典版项目 JSON 的**只读**兼容层（H11 前置，W-05 第四批）。
//!
//! 经典版 `CURRENT_PROJECT_VERSION = 31`，migrations 规定 **additive-only**：
//! 不删、不改名、不替换持久化数据。本模块严格只读：
//! - 用宽容的 `serde_json::Value` 遍历，未知字段原样忽略（**不写回**）；
//! - 缺失的非关键字段用默认值补齐并记录 `warnings`，不静默丢弃信息；
//! - 版本 > 31 明确拒绝（避免误读未来格式），而不是「尽力解析」；
//! - 输出归一化视图 `ProjectView` 供 Web/core 消费，字段只增不删。

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 经典版当前项目版本号。
pub const CLASSIC_PROJECT_VERSION: u32 = 31;
/// 缺省帧率与画布尺寸（仅在字段缺失时使用，并写入 warnings）。
pub const DEFAULT_FPS_NUMERATOR: u32 = 30;
pub const DEFAULT_FPS_DENOMINATOR: u32 = 1;
pub const DEFAULT_CANVAS_WIDTH: u32 = 1920;
pub const DEFAULT_CANVAS_HEIGHT: u32 = 1080;

/// 稳定错误码（跨语言契约的一部分）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompatError {
    InvalidJson,
    MissingVersion,
    UnsupportedVersion,
    MissingMetadata,
    MissingScenes,
}

impl CompatError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            CompatError::InvalidJson => "INVALID_JSON",
            CompatError::MissingVersion => "MISSING_VERSION",
            CompatError::UnsupportedVersion => "UNSUPPORTED_VERSION",
            CompatError::MissingMetadata => "MISSING_METADATA",
            CompatError::MissingScenes => "MISSING_SCENES",
        }
    }
}

impl fmt::Display for CompatError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            CompatError::InvalidJson => "项目文件不是合法 JSON，请检查文件是否完整",
            CompatError::MissingVersion => "项目缺少 version 字段，无法判断存储格式",
            CompatError::UnsupportedVersion => "项目版本高于当前支持的最高版本，请升级后再打开",
            CompatError::MissingMetadata => "项目缺少 metadata 字段",
            CompatError::MissingScenes => "项目缺少 scenes 数组",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

/// 帧率视图。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FpsView {
    pub numerator: u32,
    pub denominator: u32,
}

/// 画布视图。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasView {
    pub width: u32,
    pub height: u32,
}

/// 元素视图：只读取兼容所需的最小字段。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementView {
    pub id: String,
    pub element_type: String,
    pub start_time: i64,
    pub duration: i64,
}

/// 轨道视图：`overlay → main → audio` 顺序，与经典版一致。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackView {
    pub id: String,
    pub track_type: String,
    pub element_count: usize,
    pub elements: Vec<ElementView>,
}

/// 场景视图。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneView {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub tracks: Vec<TrackView>,
}

/// 归一化只读视图。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub version: u32,
    pub project_id: String,
    pub name: String,
    pub duration_ticks: i64,
    pub fps: FpsView,
    pub canvas: CanvasView,
    pub current_scene_id: String,
    pub scene_count: usize,
    pub scenes: Vec<SceneView>,
    /// 字段缺失/降级读取的提示，便于上层决定是否提醒用户。
    pub warnings: Vec<String>,
}

/// 从 JSON 值读取字符串，缺失时记录 warning。
fn string_field(value: &Value, field: &str, fallback: &str, warnings: &mut Vec<String>) -> String {
    match value[field].as_str() {
        Some(text) => text.to_owned(),
        None => {
            warnings.push(format!("字段 {field} 缺失或不是字符串，使用默认值"));
            fallback.to_owned()
        }
    }
}

/// 从 JSON 值读取 i64（ticks），缺失时记录 warning。
fn ticks_field(value: &Value, field: &str, warnings: &mut Vec<String>) -> i64 {
    match value[field].as_i64() {
        Some(ticks) => ticks,
        None => {
            warnings.push(format!("字段 {field} 缺失或不是整数，按 0 处理"));
            0
        }
    }
}

/// 解析单条轨道；`default_type` 用于 main 轨缺省时补 `video`。
fn parse_track(raw: &Value, default_type: &str, warnings: &mut Vec<String>) -> TrackView {
    let id = string_field(raw, "id", "", warnings);
    let track_type = match raw["type"].as_str() {
        Some(text) => text.to_owned(),
        None if !default_type.is_empty() => default_type.to_owned(),
        None => {
            warnings.push(format!("轨道 {id} 缺少 type，按 video 处理"));
            "video".to_owned()
        }
    };
    let elements: Vec<ElementView> = raw["elements"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|element| ElementView {
                    id: string_field(element, "id", "", warnings),
                    element_type: string_field(element, "type", "unknown", warnings),
                    start_time: ticks_field(element, "startTime", warnings),
                    duration: ticks_field(element, "duration", warnings),
                })
                .collect()
        })
        .unwrap_or_default();
    TrackView {
        id,
        track_type,
        element_count: elements.len(),
        elements,
    }
}

/// 解析场景：轨道顺序固定 `overlay → main → audio`。
fn parse_scene(raw: &Value, warnings: &mut Vec<String>) -> SceneView {
    let id = string_field(raw, "id", "", warnings);
    let name = string_field(raw, "name", "", warnings);
    let is_main = raw["isMain"].as_bool().unwrap_or(false);
    let tracks = &raw["tracks"];
    let mut result = Vec::new();
    if let Some(overlay) = tracks["overlay"].as_array() {
        for track in overlay {
            result.push(parse_track(track, "", warnings));
        }
    }
    if let Some(main) = tracks["main"].as_object() {
        result.push(parse_track(&Value::Object(main.clone()), "video", warnings));
    } else if tracks["main"].is_null() {
        warnings.push(format!("场景 {id} 缺少 main 主轨"));
    }
    if let Some(audio) = tracks["audio"].as_array() {
        for track in audio {
            result.push(parse_track(track, "audio", warnings));
        }
    }
    SceneView {
        id,
        name,
        is_main,
        tracks: result,
    }
}

/// 读取经典版项目 JSON，返回归一化只读视图；不修改输入、不写回。
pub fn read_classic_project(project_json: &str) -> Result<ProjectView, CompatError> {
    let raw: Value = serde_json::from_str(project_json).map_err(|_| CompatError::InvalidJson)?;
    if !raw.is_object() {
        return Err(CompatError::InvalidJson);
    }

    let version = raw["version"].as_u64().ok_or(CompatError::MissingVersion)? as u32;
    if version == 0 || version > CLASSIC_PROJECT_VERSION {
        return Err(CompatError::UnsupportedVersion);
    }
    if raw["metadata"].is_null() {
        return Err(CompatError::MissingMetadata);
    }
    let scenes_raw = raw["scenes"].as_array().ok_or(CompatError::MissingScenes)?;

    let mut warnings = Vec::new();
    let metadata = &raw["metadata"];
    let project_id = string_field(metadata, "id", "", &mut warnings);
    let name = string_field(metadata, "name", "", &mut warnings);
    let duration_ticks = ticks_field(metadata, "duration", &mut warnings);
    let current_scene_id = string_field(&raw, "currentSceneId", "", &mut warnings);

    let settings = &raw["settings"];
    let fps_value = &settings["fps"];
    let fps = FpsView {
        numerator: fps_value["numerator"].as_u64().unwrap_or_else(|| {
            warnings.push("settings.fps 缺失或不是有理数，使用默认 30/1".to_owned());
            u64::from(DEFAULT_FPS_NUMERATOR)
        }) as u32,
        denominator: fps_value["denominator"]
            .as_u64()
            .unwrap_or_else(|| u64::from(DEFAULT_FPS_DENOMINATOR)) as u32,
    };
    let canvas_value = &settings["canvasSize"];
    let canvas = CanvasView {
        width: canvas_value["width"].as_u64().unwrap_or_else(|| {
            warnings.push("settings.canvasSize 缺失，使用默认 1920×1080".to_owned());
            u64::from(DEFAULT_CANVAS_WIDTH)
        }) as u32,
        height: canvas_value["height"]
            .as_u64()
            .unwrap_or(u64::from(DEFAULT_CANVAS_HEIGHT)) as u32,
    };
    if fps.denominator == 0 {
        warnings.push("帧率分母为 0，已按 30/1 处理".to_owned());
    }

    let scenes: Vec<SceneView> = scenes_raw
        .iter()
        .map(|scene| parse_scene(scene, &mut warnings))
        .collect();
    let scene_count = scenes.len();

    Ok(ProjectView {
        version,
        project_id,
        name,
        duration_ticks,
        fps: if fps.denominator == 0 {
            FpsView {
                numerator: DEFAULT_FPS_NUMERATOR,
                denominator: DEFAULT_FPS_DENOMINATOR,
            }
        } else {
            fps
        },
        canvas,
        current_scene_id,
        scene_count,
        scenes,
        warnings,
    })
}
