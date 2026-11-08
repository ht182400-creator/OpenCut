//! 领域模型：与经典版 `apps/web/src/timeline/types` 的最小可比子集对齐。
//! 经典版用 `number`（秒），本 crate 用 `MediaTime`（ticks）；字段名保持 camelCase。

use ocx_time::MediaTime;
use serde::{Deserialize, Serialize};

/// 用 i128 中间值做饱和加法，避免 debug 构建在 i64 极值时 panic。
pub(crate) fn add_ticks(left: i64, right: i64) -> i64 {
    let sum = left as i128 + right as i128;
    sum.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

/// 用 i128 中间值做饱和减法。
pub(crate) fn sub_ticks(left: i64, right: i64) -> i64 {
    let diff = left as i128 - right as i128;
    diff.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

/// 时间轴元素：只保留 ripple 规则所需的最小字段（additive-only，后续可加字段）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedElement {
    pub id: String,
    pub start_time: MediaTime,
    pub duration: MediaTime,
}

impl TimedElement {
    /// 以 ticks 构造元素。
    pub fn new(id: impl Into<String>, start_ticks: i64, duration_ticks: i64) -> Self {
        Self {
            id: id.into(),
            start_time: MediaTime::from_ticks(start_ticks),
            duration: MediaTime::from_ticks(duration_ticks),
        }
    }

    /// 结束时刻 = 起始 + 时长；与经典版 `startTime + duration` 对应。
    pub fn end_time(&self) -> MediaTime {
        MediaTime::from_ticks(add_ticks(
            self.start_time.as_ticks(),
            self.duration.as_ticks(),
        ))
    }
}

/// 一条轨道。`track_type` 为 additive-only 新增字段：缺省时按 `Video` 解析，
/// 使 W-05 第一批的 ripple JSON 用例无需改动即可继续复用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineTrack {
    pub id: String,
    pub elements: Vec<TimedElement>,
    #[serde(default, skip_serializing_if = "TrackType::is_default")]
    pub track_type: TrackType,
}

impl TimelineTrack {
    /// 构造轨道（默认 video 类型，供 ripple 用例使用）。
    pub fn new(id: impl Into<String>, elements: Vec<TimedElement>) -> Self {
        Self {
            id: id.into(),
            elements,
            track_type: TrackType::default(),
        }
    }

    /// 构造指定类型的轨道（供 placement 用例使用）。
    pub fn with_type(
        id: impl Into<String>,
        track_type: TrackType,
        elements: Vec<TimedElement>,
    ) -> Self {
        Self {
            id: id.into(),
            elements,
            track_type,
        }
    }
}

/// 场景轨道集合：叠加轨（多条）、主轨（单条）、音频轨（多条）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneTracks {
    pub overlay: Vec<TimelineTrack>,
    pub main: TimelineTrack,
    pub audio: Vec<TimelineTrack>,
}

impl SceneTracks {
    /// 构造场景轨道集合。
    pub fn new(
        overlay: Vec<TimelineTrack>,
        main: TimelineTrack,
        audio: Vec<TimelineTrack>,
    ) -> Self {
        Self {
            overlay,
            main,
            audio,
        }
    }

    /// 空场景，主轨 id 可指定（用于边界用例）。
    pub fn empty(main_id: &str) -> Self {
        Self::new(
            Vec::new(),
            TimelineTrack::new(main_id, Vec::new()),
            Vec::new(),
        )
    }

    /// 按经典版顺序返回全部轨道引用：`overlay` → `main` → `audio`。
    pub fn track_list(&self) -> Vec<&TimelineTrack> {
        let mut list: Vec<&TimelineTrack> = self.overlay.iter().collect();
        list.push(&self.main);
        list.extend(self.audio.iter());
        list
    }
}

/// 一次 ripple 调整：某轨道在 `after_time` 之后的元素统一前移 `shift_amount` ticks。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RippleAdjustment {
    pub track_id: String,
    pub after_time: MediaTime,
    pub shift_amount: i64,
}

/// 轨道类型（与经典版 `TrackType` 一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackType {
    #[default]
    Video,
    Text,
    Graphic,
    Effect,
    Audio,
}

impl TrackType {
    /// 是否为默认类型（用于序列化时省略 additive-only 的默认字段）。
    pub(crate) fn is_default(&self) -> bool {
        *self == TrackType::Video
    }

    /// 转成经典版字符串，用于错误消息与跨语言对齐。
    pub fn as_str(self) -> &'static str {
        match self {
            TrackType::Video => "video",
            TrackType::Text => "text",
            TrackType::Graphic => "graphic",
            TrackType::Effect => "effect",
            TrackType::Audio => "audio",
        }
    }
}

/// 元素类型（与经典版 `ElementType` 一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ElementType {
    Audio,
    Text,
    Sticker,
    Graphic,
    Effect,
    Video,
    Image,
}

impl ElementType {
    /// 转成经典版字符串，用于错误消息与跨语言对齐。
    pub fn as_str(self) -> &'static str {
        match self {
            ElementType::Audio => "audio",
            ElementType::Text => "text",
            ElementType::Sticker => "sticker",
            ElementType::Graphic => "graphic",
            ElementType::Effect => "effect",
            ElementType::Video => "video",
            ElementType::Image => "image",
        }
    }
}

/// 放置主体：按元素类型或按轨道类型（JSON 二选一）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum PlacementSubject {
    ByElementType {
        #[serde(rename = "elementType")]
        element_type: ElementType,
    },
    ByTrackType {
        #[serde(rename = "trackType")]
        track_type: TrackType,
    },
}

impl PlacementSubject {
    /// 归一化为目标轨道类型。
    pub fn target_track_type(self) -> TrackType {
        match self {
            PlacementSubject::ByElementType { element_type } => {
                crate::placement::get_track_type_for_element_type(element_type)
            }
            PlacementSubject::ByTrackType { track_type } => track_type,
        }
    }
}

/// 放置时间段：`exclude_element_id` 用于「移动自身时忽略自身占位」。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementTimeSpan {
    pub start_time: i64,
    pub duration: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude_element_id: Option<String>,
}

/// 插入方向。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InsertDirection {
    Above,
    Below,
}

/// 垂直拖拽方向（优先于悬停方向）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerticalDirection {
    Up,
    Down,
}

/// 新轨道插入位置策略。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InsertPosition {
    Highest,
    Default,
}

/// 放置策略（tagged union，字段与经典版 camelCase 一致）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlacementStrategy {
    Explicit {
        #[serde(rename = "trackId")]
        track_id: String,
    },
    FirstAvailable,
    PreferIndex {
        #[serde(rename = "trackIndex")]
        track_index: i64,
        #[serde(rename = "hoverDirection")]
        hover_direction: InsertDirection,
        #[serde(rename = "verticalDragDirection", default)]
        vertical_drag_direction: Option<VerticalDirection>,
        #[serde(rename = "createNewTrackOnly", default)]
        create_new_track_only: bool,
    },
    AboveSource {
        #[serde(rename = "sourceTrackIndex")]
        source_track_index: i64,
    },
    AlwaysNew {
        position: InsertPosition,
    },
}

/// 放置结果（tagged union）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlacementResult {
    ExistingTrack {
        #[serde(rename = "trackId")]
        track_id: String,
        #[serde(rename = "trackIndex")]
        track_index: i64,
        #[serde(rename = "trackType")]
        track_type: TrackType,
        /// 仅当主轨起点被强制调整时出现（与经典版条件展开一致）。
        #[serde(rename = "adjustedStartTime", skip_serializing_if = "Option::is_none")]
        adjusted_start_time: Option<i64>,
    },
    NewTrack {
        #[serde(rename = "insertIndex")]
        insert_index: i64,
        /// 经典版此字段可能为 null，故保留序列化。
        #[serde(rename = "insertPosition")]
        insert_position: Option<InsertDirection>,
        #[serde(rename = "trackType")]
        track_type: TrackType,
    },
}

/// 元素与轨道的类型兼容性校验结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityResult {
    pub is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}
