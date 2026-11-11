//! 经典版项目 JSON 的兼容层（H11 前置，W-05 第四批；W-05 第五批加入写回）。
//!
//! 经典版 `CURRENT_PROJECT_VERSION = 31`，migrations 规定 **additive-only**：
//! 不删、不改名、不替换持久化数据。
//! - 读取：用宽容的 `serde_json::Value` 遍历，未知字段原样忽略；缺失的非关键字段
//!   用默认值补齐并记录 `warnings`；版本 > 31 明确拒绝；输出归一化视图 `ProjectView`。
//! - 写回：`write_classic_project` 把编辑后的视图**按 id 合并回原始文档**，只更新
//!   已知字段，未知字段原样保留，不新增/删除场景/轨道/元素；派生字段
//!   （`version` / `sceneCount` / `warnings`）不写回。形成「读 → 改 → 写 → 再读」闭环。

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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
    /// 写回时视图版本与原始文档版本不一致。
    VersionMismatch,
    /// 写回时视图里的场景/轨道/元素 id 在原始文档中找不到（不擅自新增实体）。
    EntityNotFound,
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
            CompatError::VersionMismatch => "VERSION_MISMATCH",
            CompatError::EntityNotFound => "ENTITY_NOT_FOUND",
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
            CompatError::VersionMismatch => "写回视图的版本与原始项目不一致，已拒绝",
            CompatError::EntityNotFound => "写回视图含原始项目中不存在的实体，已拒绝（不擅自新增）",
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
    /// 素材内起始时间（ticks）。经典版为可选字段，缺失按 0 处理，不记 warning。
    #[serde(default)]
    pub trim_start: i64,
    /// 素材内结束时间（ticks）。
    #[serde(default)]
    pub trim_end: i64,
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
                    trim_start: element["trimStart"].as_i64().unwrap_or(0),
                    trim_end: element["trimEnd"].as_i64().unwrap_or(0),
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

/**
 * 把单条轨道视图的已知字段合并回原始轨道；元素按 id 匹配，未知字段原样保留。
 * @param target 原始轨道 JSON（可变）
 * @param view 归一化轨道视图
 * @returns {Result<(), CompatError>} 找不到元素时返回 ENTITY_NOT_FOUND
 */
fn merge_track(target: &mut Value, view: &TrackView) -> Result<(), CompatError> {
    let object = target.as_object_mut().ok_or(CompatError::EntityNotFound)?;
    object.insert("type".to_owned(), json!(view.track_type));
    let elements = object.entry("elements").or_insert_with(|| json!([]));
    let list = elements.as_array_mut().ok_or(CompatError::EntityNotFound)?;
    for element_view in &view.elements {
        let item = list
            .iter_mut()
            .find(|item| item["id"].as_str() == Some(element_view.id.as_str()))
            .ok_or(CompatError::EntityNotFound)?;
        let entry = item.as_object_mut().ok_or(CompatError::EntityNotFound)?;
        entry.insert("type".to_owned(), json!(element_view.element_type));
        entry.insert("startTime".to_owned(), json!(element_view.start_time));
        entry.insert("duration".to_owned(), json!(element_view.duration));
        entry.insert("trimStart".to_owned(), json!(element_view.trim_start));
        entry.insert("trimEnd".to_owned(), json!(element_view.trim_end));
    }
    Ok(())
}

/**
 * 把编辑后的 `ProjectView` 写回经典版项目 JSON。
 *
 * 只按 id 更新原始文档中已存在的实体的已知字段；不新增/删除场景、轨道、元素，
 * 未知字段（含 `metadata` 扩展、`timelineViewState`、元素自定义字段）原样保留。
 * 派生字段 `version` / `sceneCount` / `warnings` 不写回。
 * @param original_json 原始经典版项目 JSON（v31 或更低）
 * @param view 编辑后的归一化视图
 * @returns {Result<String, CompatError>} 写回后的 JSON 文本
 */
pub fn write_classic_project(
    original_json: &str,
    view: &ProjectView,
) -> Result<String, CompatError> {
    let mut root: Value =
        serde_json::from_str(original_json).map_err(|_| CompatError::InvalidJson)?;
    if !root.is_object() {
        return Err(CompatError::InvalidJson);
    }
    let version = root["version"]
        .as_u64()
        .ok_or(CompatError::MissingVersion)? as u32;
    if version == 0 || version > CLASSIC_PROJECT_VERSION {
        return Err(CompatError::UnsupportedVersion);
    }
    if root["metadata"].is_null() {
        return Err(CompatError::MissingMetadata);
    }
    if !root["scenes"].is_array() {
        return Err(CompatError::MissingScenes);
    }
    if view.version != version {
        return Err(CompatError::VersionMismatch);
    }

    let object = root.as_object_mut().ok_or(CompatError::InvalidJson)?;
    object.insert("currentSceneId".to_owned(), json!(view.current_scene_id));
    {
        let metadata = object.entry("metadata").or_insert_with(|| json!({}));
        if let Some(fields) = metadata.as_object_mut() {
            fields.insert("id".to_owned(), json!(view.project_id));
            fields.insert("name".to_owned(), json!(view.name));
            fields.insert("duration".to_owned(), json!(view.duration_ticks));
        }
    }
    {
        let settings = object.entry("settings").or_insert_with(|| json!({}));
        if let Some(fields) = settings.as_object_mut() {
            let fps = fields.entry("fps").or_insert_with(|| json!({}));
            if let Some(f) = fps.as_object_mut() {
                f.insert("numerator".to_owned(), json!(view.fps.numerator));
                f.insert("denominator".to_owned(), json!(view.fps.denominator));
            }
            let canvas = fields.entry("canvasSize").or_insert_with(|| json!({}));
            if let Some(c) = canvas.as_object_mut() {
                c.insert("width".to_owned(), json!(view.canvas.width));
                c.insert("height".to_owned(), json!(view.canvas.height));
            }
        }
    }

    let scenes = object
        .get_mut("scenes")
        .and_then(Value::as_array_mut)
        .ok_or(CompatError::MissingScenes)?;
    for scene_view in &view.scenes {
        let scene = scenes
            .iter_mut()
            .find(|item| item["id"].as_str() == Some(scene_view.id.as_str()))
            .ok_or(CompatError::EntityNotFound)?;
        let scene_object = scene.as_object_mut().ok_or(CompatError::EntityNotFound)?;
        scene_object.insert("name".to_owned(), json!(scene_view.name));
        scene_object.insert("isMain".to_owned(), json!(scene_view.is_main));
        let tracks = scene_object
            .get_mut("tracks")
            .and_then(Value::as_object_mut)
            .ok_or(CompatError::EntityNotFound)?;
        for track_view in &scene_view.tracks {
            let mut found = false;
            for key in ["overlay", "audio"] {
                if let Some(list) = tracks.get_mut(key).and_then(Value::as_array_mut)
                    && let Some(target) = list
                        .iter_mut()
                        .find(|item| item["id"].as_str() == Some(track_view.id.as_str()))
                {
                    merge_track(target, track_view)?;
                    found = true;
                    break;
                }
                if found {
                    break;
                }
            }
            if !found
                && let Some(main) = tracks.get_mut("main")
                && main["id"].as_str() == Some(track_view.id.as_str())
            {
                merge_track(main, track_view)?;
                found = true;
            }
            if !found {
                return Err(CompatError::EntityNotFound);
            }
        }
    }
    serde_json::to_string_pretty(&root).map_err(|_| CompatError::InvalidJson)
}
