//! ocx-domain 补充单测：并发安全、极值与换算辅助函数。

use std::sync::Arc;
use std::thread;

use ocx_domain::{
    RippleAdjustment, SceneTracks, TICKS_PER_SECOND, TimedElement, TimelineTrack,
    apply_ripple_adjustments, compute_ripple_adjustments, seconds_to_ticks, ticks_to_seconds,
};
use ocx_time::MediaTime;

/// 构造一条只有主轨的场景。
fn scene(elements: Vec<TimedElement>) -> SceneTracks {
    SceneTracks::new(Vec::new(), TimelineTrack::new("main", elements), Vec::new())
}

/// 并发调用纯函数不应出现状态串扰。
#[test]
fn concurrent_compute_is_deterministic() {
    let before = Arc::new(scene(vec![
        TimedElement::new("a", 0, 240_000),
        TimedElement::new("b", 240_000, 120_000),
    ]));
    let after = Arc::new(scene(vec![TimedElement::new("b", 240_000, 120_000)]));
    let expected = compute_ripple_adjustments(&before, &after);

    let mut handles = Vec::new();
    for _ in 0..8 {
        let before = Arc::clone(&before);
        let after = Arc::clone(&after);
        handles.push(thread::spawn(move || {
            compute_ripple_adjustments(&before, &after)
        }));
    }
    for handle in handles {
        assert_eq!(handle.join().expect("线程不应 panic"), expected);
    }
}

/// i64 极值下加减法不得 panic（饱和运算）。
#[test]
fn extreme_ticks_do_not_panic() {
    let element = TimedElement::new("extreme", i64::MAX - 10, 100);
    assert_eq!(element.end_time().as_ticks(), i64::MAX);

    let shifted = ocx_domain::ripple_shift_elements(
        &[TimedElement::new("min", i64::MIN + 10, 0)],
        MediaTime::from_ticks(i64::MIN),
        100,
    );
    assert_eq!(shifted[0].start_time.as_ticks(), i64::MIN);
}

/// 秒与 ticks 的往返换算。
#[test]
fn seconds_ticks_conversion_roundtrip() {
    assert_eq!(seconds_to_ticks(1.0), TICKS_PER_SECOND);
    assert_eq!(seconds_to_ticks(0.5), TICKS_PER_SECOND / 2);
    assert_eq!(seconds_to_ticks(f64::NAN), 0);
    assert_eq!(seconds_to_ticks(f64::INFINITY), 0);
    assert!((ticks_to_seconds(TICKS_PER_SECOND) - 1.0).abs() < f64::EPSILON);
}

/// 空调整与未知轨道均保持原场景不变。
#[test]
fn no_op_adjustments_keep_tracks_unchanged() {
    let tracks = scene(vec![TimedElement::new("a", 120_000, 60_000)]);
    assert_eq!(apply_ripple_adjustments(&tracks, &[]), tracks);
    let ghost = vec![RippleAdjustment {
        track_id: "ghost".to_owned(),
        after_time: MediaTime::from_ticks(0),
        shift_amount: 60_000,
    }];
    assert_eq!(apply_ripple_adjustments(&tracks, &ghost), tracks);
}

/// 端到端不变量：删除元素后应用调整，后续元素起点应刚好前移一个片段长度。
#[test]
fn compute_then_apply_closes_the_gap() {
    let before = scene(vec![
        TimedElement::new("a", 0, 240_000),
        TimedElement::new("b", 240_000, 120_000),
    ]);
    let after = scene(vec![TimedElement::new("b", 240_000, 120_000)]);
    let adjustments = compute_ripple_adjustments(&before, &after);
    assert_eq!(adjustments.len(), 1);
    let applied = apply_ripple_adjustments(&before, &adjustments);
    assert_eq!(applied.main.elements[1].start_time.as_ticks(), 0);
}
