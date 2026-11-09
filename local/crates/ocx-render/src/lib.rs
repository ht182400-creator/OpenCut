//! OpenCut 本地 core 的帧契约层（W-07 第一批）。
//!
//! `RenderFrame`（无状态帧描述）与 `ExportProfile`（导出参数）是预览与导出共用的稳定契约，
//! 见 `roadmap/PRIORITY.md` §4。本批**不做真实 MP4/WebM 编码**：那需要浏览器
//! `VideoEncoder` + muxer 与端到端自动化，且 H01/H05 的原生渲染路径尚未验证。
//! 本 crate 提供的是可完全确定性验证的部分：配置校验、帧计划（含音画同步）、合成帧源。
//!
//! 所有错误都返回稳定错误码（不 panic），边界行为由 `tests/RENDER_CASES.md` 固定。

pub mod frame;
pub mod plan;
pub mod profile;

/// 跨语言浮点比较容差（秒）；帧时长由整数 ticks 推导，误差仅来自 f64 表示。
pub const TOLERANCE_SECONDS: f64 = 1e-9;

pub use frame::{
    DEFAULT_RECT_DIVISOR, FrameError, FrameParams, MAX_FRAME_PIXELS, RenderFrame, render_frame,
};
pub use ocx_time::TICKS_PER_SECOND;
pub use plan::{FramePlan, MAX_FRAME_COUNT, PlanError, build_frame_plan, frame_index_at_time};
pub use profile::{
    Codec, Container, ExportProfile, FrameRateSpec, MAX_AUDIO_CHANNELS, MAX_FRAME_DIMENSION,
    MAX_VIDEO_BITRATE_BPS, MIN_VIDEO_BITRATE_BPS, ProfileError, SUPPORTED_AUDIO_SAMPLE_RATES,
    validate_export_profile,
};
