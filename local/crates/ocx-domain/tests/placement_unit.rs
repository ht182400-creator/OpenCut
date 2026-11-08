//! placement 补充单测：并发安全、极值、空场景与错误文案。

use std::sync::Arc;
use std::thread;

use ocx_domain::{
    ElementType, PlacementStrategy, PlacementSubject, PlacementTimeSpan, SceneTracks, TimedElement,
    TimelineTrack, TrackType, can_place_time_spans_on_track, resolve_track_placement,
    validate_element_track_compatibility,
};

/// 构造含两条 overlay 轨道的场景。
fn scene() -> SceneTracks {
    SceneTracks::new(
        vec![
            TimelineTrack::with_type("o1", TrackType::Graphic, Vec::new()),
            TimelineTrack::with_type("o2", TrackType::Text, Vec::new()),
        ],
        TimelineTrack::with_type(
            "main",
            TrackType::Video,
            vec![TimedElement::new("m1", 0, 120_000)],
        ),
        vec![TimelineTrack::with_type("a1", TrackType::Audio, Vec::new())],
    )
}

/// 并发解析放置结果不应出现状态串扰。
#[test]
fn concurrent_resolve_is_deterministic() {
    let tracks = Arc::new(scene());
    let strategy = Arc::new(PlacementStrategy::Explicit {
        track_id: "main".to_owned(),
    });
    let spans = Arc::new(vec![PlacementTimeSpan {
        start_time: 240_000,
        duration: 60_000,
        exclude_element_id: None,
    }]);
    let expected = resolve_track_placement(
        &tracks,
        PlacementSubject::ByElementType {
            element_type: ElementType::Video,
        },
        &spans,
        &strategy,
    );

    let mut handles = Vec::new();
    for _ in 0..8 {
        let tracks = Arc::clone(&tracks);
        let strategy = Arc::clone(&strategy);
        let spans = Arc::clone(&spans);
        handles.push(thread::spawn(move || {
            resolve_track_placement(
                &tracks,
                PlacementSubject::ByElementType {
                    element_type: ElementType::Video,
                },
                &spans,
                &strategy,
            )
        }));
    }
    for handle in handles {
        assert_eq!(handle.join().expect("线程不应 panic"), expected);
    }
}

/// i64 极值下的重叠判断不得 panic。
#[test]
fn extreme_time_spans_do_not_panic() {
    let track = TimelineTrack::new("t", vec![TimedElement::new("m", i64::MAX - 100, 200)]);
    let spans = vec![PlacementTimeSpan {
        start_time: i64::MAX - 50,
        duration: 100,
        exclude_element_id: None,
    }];
    let _ = can_place_time_spans_on_track(&track, &spans);
    assert!(can_place_time_spans_on_track(&track, &[]));
}

/// 空场景与空时间段列表组合仍返回确定结果。
#[test]
fn empty_scene_has_deterministic_placement() {
    let tracks = SceneTracks::empty("main");
    let result = resolve_track_placement(
        &tracks,
        PlacementSubject::ByTrackType {
            track_type: TrackType::Video,
        },
        &[],
        &PlacementStrategy::FirstAvailable,
    );
    assert!(result.is_some());
    assert!(matches!(
        result,
        Some(ocx_domain::PlacementResult::ExistingTrack { .. })
    ));
}

/// 兼容性错误消息与经典版逐字一致。
#[test]
fn compatibility_error_message_matches_classic() {
    let result = validate_element_track_compatibility(ElementType::Sticker, TrackType::Effect);
    assert!(!result.is_valid);
    assert_eq!(
        result.error_message.as_deref(),
        Some("sticker elements cannot be placed on effect tracks")
    );
}
