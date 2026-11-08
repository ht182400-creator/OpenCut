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

/// 一条轨道。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineTrack {
    pub id: String,
    pub elements: Vec<TimedElement>,
}

impl TimelineTrack {
    /// 构造轨道。
    pub fn new(id: impl Into<String>, elements: Vec<TimedElement>) -> Self {
        Self {
            id: id.into(),
            elements,
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
