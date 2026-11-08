//! ripple 编辑：经典版 `apps/web/src/ripple/{diff,shift,apply}.ts` 的 Rust 翻译。
//!
//! 对应关系：
//! - `computeRippleAdjustments` → [`compute_ripple_adjustments`]
//! - `rippleShiftElements` → [`ripple_shift_elements`]
//! - `applyRippleAdjustments` → [`apply_ripple_adjustments`]
//!
//! 唯一语义差异：经典版用浮点秒，本 crate 用整数 ticks（线性换算）；
//! 且加减法使用 [`crate::types::add_ticks`] / [`crate::types::sub_ticks`] 做饱和运算，
//! 避免 i64 极值在 debug 构建中 panic。所有边界行为由 `tests/CASES.md` 固定。

use std::collections::{HashMap, HashSet};

use ocx_time::MediaTime;

use crate::types::{
    RippleAdjustment, SceneTracks, TimedElement, TimelineTrack, add_ticks, sub_ticks,
};

/// 半开区间 `[start, end)`，单位为 ticks。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Interval {
    start: i64,
    end: i64,
}

/// 元素区间集合：`order` 保留插入顺序，`by_id` 提供按 id 查找。
/// 重复 id 时「值覆盖、顺序保持首次出现」，与 JS `new Map(...)` 语义一致。
struct ElementSpans {
    order: Vec<(String, Interval)>,
    by_id: HashMap<String, Interval>,
}

impl ElementSpans {
    /// 从元素列表构建区间集合。
    fn new(elements: &[TimedElement]) -> Self {
        let mut order: Vec<(String, Interval)> = Vec::new();
        let mut by_id: HashMap<String, Interval> = HashMap::new();
        for element in elements {
            let span = Interval {
                start: element.start_time.as_ticks(),
                end: element.end_time().as_ticks(),
            };
            if by_id.insert(element.id.clone(), span).is_none() {
                order.push((element.id.clone(), span));
            } else if let Some(entry) = order.iter_mut().find(|(id, _)| id == &element.id) {
                entry.1 = span;
            }
        }
        Self { order, by_id }
    }

    /// 按 id 取区间。
    fn get(&self, id: &str) -> Option<&Interval> {
        self.by_id.get(id)
    }

    /// 是否包含该 id。
    fn contains(&self, id: &str) -> bool {
        self.by_id.contains_key(id)
    }
}

/// 仅在 `end > start` 时追加区间（对应经典版 `pushInterval`）。
fn push_interval(intervals: &mut Vec<Interval>, start: i64, end: i64) {
    if end <= start {
        return;
    }
    intervals.push(Interval { start, end });
}

/// 过滤非法区间、按起点稳定排序、合并重叠或相邻的区间。
fn normalize_intervals(intervals: Vec<Interval>) -> Vec<Interval> {
    let mut valid: Vec<Interval> = Vec::new();
    for interval in intervals {
        push_interval(&mut valid, interval.start, interval.end);
    }
    valid.sort_by_key(|interval| interval.start);

    let mut merged: Vec<Interval> = Vec::new();
    for interval in valid {
        if let Some(previous) = merged.last_mut()
            && interval.start <= previous.end
        {
            previous.end = previous.end.max(interval.end);
            continue;
        }
        merged.push(interval);
    }
    merged
}

/// 用一组重叠区间切掉单个源区间，返回剩余片段。
fn subtract_single_interval(source: Interval, overlapping: &[Interval]) -> Vec<Interval> {
    let mut remaining = vec![source];
    for overlap in overlapping {
        let mut next: Vec<Interval> = Vec::new();
        for part in remaining {
            if overlap.end <= part.start || overlap.start >= part.end {
                next.push(part);
                continue;
            }
            push_interval(&mut next, part.start, overlap.start);
            push_interval(&mut next, overlap.end, part.end);
        }
        remaining = next;
        if remaining.is_empty() {
            return Vec::new();
        }
    }
    remaining
}

/// 集合差：`source` 中扣除 `overlapping` 覆盖的部分。
fn subtract_interval_sets(source: Vec<Interval>, overlapping: Vec<Interval>) -> Vec<Interval> {
    let normalized_source = normalize_intervals(source);
    let normalized_overlapping = normalize_intervals(overlapping);
    normalized_source
        .iter()
        .flat_map(|source| subtract_single_interval(*source, &normalized_overlapping))
        .collect()
}

/// 收集「腾空区间」与「新占区间」并归一化。
fn collect_track_intervals(
    before: &ElementSpans,
    after: &ElementSpans,
    all_after_element_ids: &HashSet<String>,
) -> (Vec<Interval>, Vec<Interval>) {
    let mut vacated: Vec<Interval> = Vec::new();
    let mut joined: Vec<Interval> = Vec::new();

    for (id, span) in &before.order {
        match after.get(id) {
            None => {
                // 元素若被移动到其它轨道，不算腾空
                if !all_after_element_ids.contains(id) {
                    push_interval(&mut vacated, span.start, span.end);
                }
            }
            Some(after_span) => {
                if span.end > after_span.end {
                    push_interval(&mut vacated, after_span.end, span.end);
                }
            }
        }
    }

    for (id, span) in &after.order {
        if before.contains(id) {
            continue;
        }
        push_interval(&mut joined, span.start, span.end);
    }

    (normalize_intervals(vacated), normalize_intervals(joined))
}

/// 把腾空区间转换成 ripple 调整。
fn build_adjustments(track_id: &str, intervals: Vec<Interval>) -> Vec<RippleAdjustment> {
    intervals
        .into_iter()
        .filter_map(|interval| {
            let shift_amount = sub_ticks(interval.end, interval.start);
            if shift_amount <= 0 {
                return None;
            }
            Some(RippleAdjustment {
                track_id: track_id.to_owned(),
                after_time: MediaTime::from_ticks(interval.end),
                shift_amount,
            })
        })
        .collect()
}

/// 单条轨道的 ripple 计算。
fn compute_track_ripple_adjustments(
    track_id: &str,
    before_elements: &[TimedElement],
    after_elements: &[TimedElement],
    all_after_element_ids: &HashSet<String>,
) -> Vec<RippleAdjustment> {
    let before = ElementSpans::new(before_elements);
    let after = ElementSpans::new(after_elements);
    let (vacated, joined) = collect_track_intervals(&before, &after, all_after_element_ids);
    let freed = subtract_interval_sets(vacated, joined);
    build_adjustments(track_id, freed)
}

/// 计算从 `before` 变到 `after` 后需要执行的 ripple 调整。
///
/// 轨道遍历顺序固定为 `overlay` → `main` → `audio`，与经典版一致。
pub fn compute_ripple_adjustments(
    before_tracks: &SceneTracks,
    after_tracks: &SceneTracks,
) -> Vec<RippleAdjustment> {
    let before_list = before_tracks.track_list();
    let after_list = after_tracks.track_list();

    let after_by_id: HashMap<&str, &TimelineTrack> = after_list
        .iter()
        .map(|track| (track.id.as_str(), *track))
        .collect();
    let all_after_element_ids: HashSet<String> = after_list
        .iter()
        .flat_map(|track| track.elements.iter().map(|element| element.id.clone()))
        .collect();

    let mut adjustments = Vec::new();
    for before_track in before_list {
        let empty: Vec<TimedElement> = Vec::new();
        let after_elements = after_by_id
            .get(before_track.id.as_str())
            .map(|track| &track.elements)
            .unwrap_or(&empty);
        adjustments.extend(compute_track_ripple_adjustments(
            &before_track.id,
            &before_track.elements,
            after_elements,
            &all_after_element_ids,
        ));
    }
    adjustments
}

/// 把 `after_time` 及之后开始的元素整体前移 `shift_amount` ticks。
pub fn ripple_shift_elements(
    elements: &[TimedElement],
    after_time: MediaTime,
    shift_amount: i64,
) -> Vec<TimedElement> {
    let threshold = after_time.as_ticks();
    elements
        .iter()
        .map(|element| {
            if element.start_time.as_ticks() >= threshold {
                TimedElement {
                    start_time: MediaTime::from_ticks(sub_ticks(
                        element.start_time.as_ticks(),
                        shift_amount,
                    )),
                    ..element.clone()
                }
            } else {
                element.clone()
            }
        })
        .collect()
}

/// 对单条轨道按 `after_time` **降序**依次应用调整（与经典版一致）。
fn apply_track_ripple_adjustments(
    track: &TimelineTrack,
    adjustments: &[&RippleAdjustment],
) -> TimelineTrack {
    if adjustments.is_empty() {
        return track.clone();
    }
    let mut sorted = adjustments.to_vec();
    sorted.sort_by_key(|adjustment| std::cmp::Reverse(adjustment.after_time));

    let mut elements = track.elements.clone();
    for adjustment in sorted {
        elements = ripple_shift_elements(&elements, adjustment.after_time, adjustment.shift_amount);
    }
    TimelineTrack {
        id: track.id.clone(),
        elements,
    }
}

/// 把调整应用到场景轨道集合；无调整时原样返回。
pub fn apply_ripple_adjustments(
    tracks: &SceneTracks,
    adjustments: &[RippleAdjustment],
) -> SceneTracks {
    if adjustments.is_empty() {
        return tracks.clone();
    }

    let mut by_track: HashMap<&str, Vec<&RippleAdjustment>> = HashMap::new();
    for adjustment in adjustments {
        by_track
            .entry(adjustment.track_id.as_str())
            .or_default()
            .push(adjustment);
    }
    let empty: Vec<&RippleAdjustment> = Vec::new();

    SceneTracks {
        overlay: tracks
            .overlay
            .iter()
            .map(|track| {
                apply_track_ripple_adjustments(
                    track,
                    by_track.get(track.id.as_str()).unwrap_or(&empty),
                )
            })
            .collect(),
        main: apply_track_ripple_adjustments(
            &tracks.main,
            by_track.get(tracks.main.id.as_str()).unwrap_or(&empty),
        ),
        audio: tracks
            .audio
            .iter()
            .map(|track| {
                apply_track_ripple_adjustments(
                    track,
                    by_track.get(track.id.as_str()).unwrap_or(&empty),
                )
            })
            .collect(),
    }
}

/// 从秒构造元素的便捷函数（供交换格式与测试使用）。
pub fn element_from_seconds(id: impl Into<String>, start: f64, duration: f64) -> TimedElement {
    TimedElement::new(
        id,
        crate::seconds_to_ticks(start),
        crate::seconds_to_ticks(duration),
    )
}

/// 把 ticks 位移量换算为秒（供 UI 展示）。
pub fn shift_to_seconds(shift_amount: i64) -> f64 {
    crate::ticks_to_seconds(add_ticks(0, shift_amount))
}
