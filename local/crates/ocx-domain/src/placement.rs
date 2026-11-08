//! 轨道放置：经典版 `apps/web/src/timeline/placement/` 的 Rust 翻译。
//!
//! 对应关系：
//! - `compatibility.ts` → [`get_track_type_for_element_type`] / [`can_element_go_on_track`] / [`validate_element_track_compatibility`]
//! - `overlap.ts` → [`can_place_time_spans_on_track`]
//! - `main-track.ts` → [`get_earliest_main_track_element`] / [`enforce_main_track_start`]
//! - `insert-index.ts` → [`get_default_insert_index_for_track`] / [`get_highest_insert_index_for_track`] / [`resolve_preferred_new_track_placement`]
//! - `resolve.ts` → [`resolve_track_placement`]
//!
//! `apply.ts` 依赖随机 UUID 与轨道工厂，属于 IO 层，本批不翻译。
//! 时间单位沿用 `MediaTime` 的 ticks；所有边界行为由 `tests/PLACEMENT_CASES.md` 固定。

use crate::types::{
    CompatibilityResult, ElementType, InsertDirection, InsertPosition, PlacementResult,
    PlacementStrategy, PlacementSubject, PlacementTimeSpan, SceneTracks, TimedElement,
    TimelineTrack, TrackType, VerticalDirection, add_ticks,
};

/// 元素类型 → 目标轨道类型（经典版 `ELEMENT_TRACK_MAP`）。
pub fn get_track_type_for_element_type(element_type: ElementType) -> TrackType {
    match element_type {
        ElementType::Audio => TrackType::Audio,
        ElementType::Text => TrackType::Text,
        ElementType::Sticker | ElementType::Graphic => TrackType::Graphic,
        ElementType::Effect => TrackType::Effect,
        ElementType::Video | ElementType::Image => TrackType::Video,
    }
}

/// 元素能否放到指定类型的轨道。
pub fn can_element_go_on_track(element_type: ElementType, track_type: TrackType) -> bool {
    get_track_type_for_element_type(element_type) == track_type
}

/// 兼容性校验：失败时带经典版同文案的错误消息。
pub fn validate_element_track_compatibility(
    element_type: ElementType,
    track_type: TrackType,
) -> CompatibilityResult {
    if can_element_go_on_track(element_type, track_type) {
        return CompatibilityResult {
            is_valid: true,
            error_message: None,
        };
    }
    CompatibilityResult {
        is_valid: false,
        error_message: Some(format!(
            "{} elements cannot be placed on {} tracks",
            element_type.as_str(),
            track_type.as_str()
        )),
    }
}

/// 单个时间段是否与轨道上任一元素重叠；`exclude` 用于移动自身时忽略自身。
fn would_element_overlap(
    elements: &[TimedElement],
    start_time: i64,
    end_time: i64,
    exclude_element_id: Option<&str>,
) -> bool {
    elements.iter().any(|element| {
        if exclude_element_id == Some(element.id.as_str()) {
            return false;
        }
        let element_end = add_ticks(element.start_time.as_ticks(), element.duration.as_ticks());
        start_time < element_end && end_time > element.start_time.as_ticks()
    })
}

/// 所有时间段都能放到该轨道时返回 true（空时间段列表恒为 true）。
pub fn can_place_time_spans_on_track(
    track: &TimelineTrack,
    time_spans: &[PlacementTimeSpan],
) -> bool {
    time_spans.iter().all(|span| {
        !would_element_overlap(
            &track.elements,
            span.start_time,
            add_ticks(span.start_time, span.duration),
            span.exclude_element_id.as_deref(),
        )
    })
}

/// 主轨上起始最早的元素；相同起点时保留先出现者（与经典版 `reduce` 一致）。
pub fn get_earliest_main_track_element<'a>(
    main_track: &'a TimelineTrack,
    exclude_element_id: Option<&str>,
) -> Option<&'a TimedElement> {
    main_track
        .elements
        .iter()
        .filter(|element| exclude_element_id != Some(element.id.as_str()))
        .min_by_key(|element| element.start_time)
}

/// 主轨放置规则：目标不是主轨则原样返回；主轨为空或请求起点不晚于最早元素则归零。
pub fn enforce_main_track_start(
    tracks: &SceneTracks,
    target_track_id: &str,
    requested_start_time: i64,
    exclude_element_id: Option<&str>,
) -> i64 {
    if tracks.main.id != target_track_id {
        return requested_start_time;
    }
    let earliest = get_earliest_main_track_element(&tracks.main, exclude_element_id);
    match earliest {
        None => 0,
        Some(element) if requested_start_time <= element.start_time.as_ticks() => 0,
        Some(_) => requested_start_time,
    }
}

/// 默认插入位置（音频追加到末尾、效果插到最前、其余在主轨前）。
pub fn get_default_insert_index_for_track(tracks: &SceneTracks, track_type: TrackType) -> i64 {
    match track_type {
        TrackType::Audio => (tracks.overlay.len() + 1 + tracks.audio.len()) as i64,
        TrackType::Effect => 0,
        _ => tracks.overlay.len() as i64,
    }
}

/// 最高插入位置（音频紧接主轨之后，其余为 0）。
pub fn get_highest_insert_index_for_track(tracks: &SceneTracks, track_type: TrackType) -> i64 {
    if track_type == TrackType::Audio {
        (tracks.overlay.len() + 1) as i64
    } else {
        0
    }
}

/// 按「首选索引 + 方向」解析新轨道插入位置。
pub fn resolve_preferred_new_track_placement(
    tracks: &SceneTracks,
    track_type: TrackType,
    preferred_index: i64,
    direction: InsertDirection,
) -> (i64, Option<InsertDirection>) {
    let track_count = (tracks.overlay.len() + 1 + tracks.audio.len()) as i64;
    if track_count == 0 {
        // 经典版保留的不可达分支（主轨恒存在），按同语义保留
        return (
            0,
            if track_type == TrackType::Audio {
                Some(InsertDirection::Below)
            } else {
                None
            },
        );
    }

    let safe_preferred_index = preferred_index.clamp(0, track_count - 1);
    let main_track_index = tracks.overlay.len() as i64;

    if track_type == TrackType::Audio {
        if safe_preferred_index <= main_track_index {
            return (main_track_index + 1, Some(InsertDirection::Below));
        }
        let insert_index = if direction == InsertDirection::Above {
            safe_preferred_index
        } else {
            safe_preferred_index + 1
        };
        return (insert_index, Some(direction));
    }

    let insert_index = if direction == InsertDirection::Above {
        safe_preferred_index
    } else {
        safe_preferred_index + 1
    };
    if main_track_index >= 0 && insert_index > main_track_index {
        return (main_track_index, Some(InsertDirection::Above));
    }
    (insert_index, Some(direction))
}

/// 构造「使用已有轨道」结果；主轨起点被调整时才带上 `adjustedStartTime`。
fn build_existing_track_result(
    track: &TimelineTrack,
    track_index: i64,
    tracks: &SceneTracks,
    time_spans: &[PlacementTimeSpan],
) -> PlacementResult {
    let first_span = time_spans.first();
    let requested = first_span.map(|span| span.start_time).unwrap_or(0);
    let adjusted = enforce_main_track_start(
        tracks,
        &track.id,
        requested,
        first_span.and_then(|span| span.exclude_element_id.as_deref()),
    );
    PlacementResult::ExistingTrack {
        track_id: track.id.clone(),
        track_index,
        track_type: track.track_type,
        adjusted_start_time: (adjusted != requested).then_some(adjusted),
    }
}

/// 构造「新建轨道」结果。
fn build_new_track_result(
    track_type: TrackType,
    insert_index: i64,
    insert_position: Option<InsertDirection>,
) -> PlacementResult {
    PlacementResult::NewTrack {
        insert_index,
        insert_position,
        track_type,
    }
}

/// 找第一条类型匹配且无冲突的轨道；无结果返回 -1（与经典版 `findIndex` 一致）。
fn find_first_available_track_index(
    ordered_tracks: &[&TimelineTrack],
    track_type: TrackType,
    time_spans: &[PlacementTimeSpan],
) -> i64 {
    ordered_tracks
        .iter()
        .position(|track| {
            track.track_type == track_type && can_place_time_spans_on_track(track, time_spans)
        })
        .map(|index| index as i64)
        .unwrap_or(-1)
}

/// 强制新建轨道。
fn resolve_always_new_track(
    tracks: &SceneTracks,
    track_type: TrackType,
    position: InsertPosition,
) -> PlacementResult {
    let insert_index = match position {
        InsertPosition::Highest => get_highest_insert_index_for_track(tracks, track_type),
        InsertPosition::Default => get_default_insert_index_for_track(tracks, track_type),
    };
    build_new_track_result(track_type, insert_index, None)
}

/// 垂直拖拽方向优先于悬停方向。
fn get_insert_direction(
    hover_direction: InsertDirection,
    vertical_drag_direction: Option<VerticalDirection>,
) -> InsertDirection {
    match vertical_drag_direction {
        Some(VerticalDirection::Up) => InsertDirection::Above,
        Some(VerticalDirection::Down) => InsertDirection::Below,
        None => hover_direction,
    }
}

/// 负索引或越界索引按经典版 `undefined` 语义返回 None。
fn track_at<'a>(ordered_tracks: &[&'a TimelineTrack], index: i64) -> Option<&'a TimelineTrack> {
    if index < 0 {
        return None;
    }
    ordered_tracks.get(index as usize).copied()
}

/// 解析轨道放置：五种策略的完整分支。
pub fn resolve_track_placement(
    tracks: &SceneTracks,
    subject: PlacementSubject,
    time_spans: &[PlacementTimeSpan],
    strategy: &PlacementStrategy,
) -> Option<PlacementResult> {
    let ordered_tracks: Vec<&TimelineTrack> = tracks.track_list();
    let track_type = subject.target_track_type();

    match strategy {
        PlacementStrategy::Explicit { track_id } => {
            let index = ordered_tracks
                .iter()
                .position(|track| track.id == *track_id)? as i64;
            let track = ordered_tracks[index as usize];
            if track.track_type != track_type {
                return None;
            }
            Some(build_existing_track_result(
                track, index, tracks, time_spans,
            ))
        }
        PlacementStrategy::FirstAvailable => {
            let index = find_first_available_track_index(&ordered_tracks, track_type, time_spans);
            if index >= 0 {
                return Some(build_existing_track_result(
                    ordered_tracks[index as usize],
                    index,
                    tracks,
                    time_spans,
                ));
            }
            Some(resolve_always_new_track(
                tracks,
                track_type,
                InsertPosition::Highest,
            ))
        }
        PlacementStrategy::PreferIndex {
            track_index,
            hover_direction,
            vertical_drag_direction,
            create_new_track_only,
        } => {
            let preferred = track_at(&ordered_tracks, *track_index);
            let is_compatible = preferred.is_some_and(|track| track.track_type == track_type);
            let can_use_existing = !*create_new_track_only
                && is_compatible
                && preferred.is_some_and(|track| can_place_time_spans_on_track(track, time_spans));
            if can_use_existing {
                return Some(build_existing_track_result(
                    preferred.expect("已确认存在"),
                    *track_index,
                    tracks,
                    time_spans,
                ));
            }
            let vertical = if is_compatible {
                None
            } else {
                *vertical_drag_direction
            };
            let direction = get_insert_direction(*hover_direction, vertical);
            let (insert_index, insert_position) =
                resolve_preferred_new_track_placement(tracks, track_type, *track_index, direction);
            Some(build_new_track_result(
                track_type,
                insert_index,
                insert_position,
            ))
        }
        PlacementStrategy::AboveSource { source_track_index } => {
            let above_index = source_track_index - 1;
            if let Some(above) = track_at(&ordered_tracks, above_index)
                && above.track_type == track_type
                && can_place_time_spans_on_track(above, time_spans)
            {
                return Some(build_existing_track_result(
                    above,
                    above_index,
                    tracks,
                    time_spans,
                ));
            }
            let available =
                find_first_available_track_index(&ordered_tracks, track_type, time_spans);
            if available >= 0 {
                return Some(build_existing_track_result(
                    ordered_tracks[available as usize],
                    available,
                    tracks,
                    time_spans,
                ));
            }
            let insert_index = get_highest_insert_index_for_track(tracks, track_type);
            Some(build_new_track_result(track_type, insert_index, None))
        }
        PlacementStrategy::AlwaysNew { position } => {
            Some(resolve_always_new_track(tracks, track_type, *position))
        }
    }
}
