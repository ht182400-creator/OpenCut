//! `ocx-io`：OpenTimelineIO 子集导入导出与 additive-only 版本化 schema（W-10 第一批）。
//!
//! 本 crate 对应 `PRIORITY.md` W-10 与 `HOTSPOTS.md` Q05 的「双轨」倾向：
//! OTIO 只作交换格式，内部时间轴 `EditTimeline` 使用整数 ticks，不引入 C++ FFI 依赖。
//! 本批覆盖 `Timeline / Stack / Track / Clip / Gap / TimeRange / RationalTime / ExternalReference`
//! 八种核心类型；Transition / Marker / Effect / nested Stack 留待后续批次。

pub mod otio;
pub mod schema;

pub use ocx_time::TICKS_PER_SECOND;
pub use otio::{
    EditClip, EditTimeline, EditTrack, decision_key, export_otio, import_otio, rational_to_ticks,
    ticks_to_rational_value,
};
pub use schema::{
    CLIP_SCHEMA, EXTERNAL_REFERENCE_SCHEMA, GAP_SCHEMA, IO_SCHEMA_VERSION, IoError, OTIO_GENERATOR,
    RATIONAL_TIME_SCHEMA, STACK_SCHEMA, SUPPORTED_OTIO_SCHEMAS, TIME_RANGE_SCHEMA, TIMELINE_SCHEMA,
    TRACK_SCHEMA, is_supported_otio_schema, read_schema_version,
};
