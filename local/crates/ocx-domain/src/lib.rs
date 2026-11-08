//! OpenCut 本地 core 的领域层（W-05 第一批）。
//!
//! 本 crate 把经典版 `apps/web/src/ripple/` 的纯算法规则翻译成 Rust，
//! 时间单位由「浮点秒」改为 `MediaTime` 的整数 ticks（120,000 ticks/秒）。
//! 线性换算不改变算法语义，却消除了浮点比较带来的边界漂移。
//!
//! 对齐证据：`tests/fixtures/ripple_cases.json` 同时被
//! `tests/golden_master.rs`（Rust）与 `tests/ripple-alignment.test.mjs`（经典版 TS 的 JS 参考实现）消费，
//! 三者对同一份期望值比对；用例与文档见 `tests/CASES.md`。

pub mod animation;
pub mod placement;
pub mod ripple;
pub mod types;

pub use animation::{
    AnimationChannel, AnimationInterpolation, BEZIER_SOLVE_ITERATIONS, ChannelExtrapolation,
    CurveHandle, DiscreteChannel, DiscreteKey, DiscreteValue, ExtrapolationMode, ParamValue,
    ScalarChannel, ScalarKey, ScalarSegmentType, TangentMode, VALUE_EPSILON, get_bezier_point,
    get_channel_value_at_time, get_default_left_handle, get_default_right_handle,
    get_discrete_channel_value_at_time, get_scalar_channel_value_at_time,
    get_scalar_segment_interpolation, normalize_discrete_channel, normalize_scalar_channel,
    solve_bezier_progress_for_time,
};
pub use ocx_time::TICKS_PER_SECOND;
pub use placement::{
    can_element_go_on_track, can_place_time_spans_on_track, enforce_main_track_start,
    get_default_insert_index_for_track, get_earliest_main_track_element,
    get_highest_insert_index_for_track, get_track_type_for_element_type,
    resolve_preferred_new_track_placement, resolve_track_placement,
    validate_element_track_compatibility,
};
pub use ripple::{apply_ripple_adjustments, compute_ripple_adjustments, ripple_shift_elements};
pub use types::{
    CompatibilityResult, ElementType, InsertDirection, InsertPosition, PlacementResult,
    PlacementStrategy, PlacementSubject, PlacementTimeSpan, RippleAdjustment, SceneTracks,
    TimedElement, TimelineTrack, TrackType, VerticalDirection,
};

/// 把秒换算为 ticks（线性换算，四舍五入到最近 tick）。
pub fn seconds_to_ticks(seconds: f64) -> i64 {
    if !seconds.is_finite() {
        return 0;
    }
    let scaled = seconds * TICKS_PER_SECOND as f64;
    scaled.round().clamp(i64::MIN as f64, i64::MAX as f64) as i64
}

/// 把 ticks 换算为秒（供 UI / 交换格式使用）。
pub fn ticks_to_seconds(ticks: i64) -> f64 {
    ticks as f64 / TICKS_PER_SECOND as f64
}
