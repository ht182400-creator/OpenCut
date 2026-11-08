//! animation 补充单测：并发安全、极值、空通道与归一化稳定性。

use std::sync::Arc;
use std::thread;

use ocx_domain::{
    AnimationChannel, BEZIER_SOLVE_ITERATIONS, ParamValue, ScalarChannel, ScalarKey,
    ScalarSegmentType, TangentMode, get_channel_value_at_time, get_scalar_channel_value_at_time,
    normalize_scalar_channel, solve_bezier_progress_for_time,
};

/// 构造两帧线性通道。
fn channel() -> ScalarChannel {
    ScalarChannel {
        keys: vec![
            ScalarKey {
                id: "a".to_owned(),
                time: 0,
                value: 0.0,
                left_handle: None,
                right_handle: None,
                segment_to_next: Some(ScalarSegmentType::Linear),
                tangent_mode: None,
            },
            ScalarKey {
                id: "b".to_owned(),
                time: 120_000,
                value: 10.0,
                left_handle: None,
                right_handle: None,
                segment_to_next: Some(ScalarSegmentType::Linear),
                tangent_mode: None,
            },
        ],
        extrapolation: None,
    }
}

/// 并发求值纯函数不应出现状态串扰。
#[test]
fn concurrent_scalar_evaluation_is_deterministic() {
    let channel = Arc::new(channel());
    let expected = get_scalar_channel_value_at_time(&channel, 60_000, -1.0);
    let mut handles = Vec::new();
    for _ in 0..8 {
        let shared = Arc::clone(&channel);
        handles.push(thread::spawn(move || {
            get_scalar_channel_value_at_time(&shared, 60_000, -1.0)
        }));
    }
    for handle in handles {
        assert_eq!(handle.join().expect("线程不应 panic"), expected);
    }
}

/// i64 极值时间不得 panic。
#[test]
fn extreme_time_does_not_panic() {
    let mut channel = channel();
    channel.keys[1].time = i64::MAX - 10;
    let _ = get_scalar_channel_value_at_time(&channel, i64::MIN, -1.0);
    let _ = get_scalar_channel_value_at_time(&channel, i64::MAX, -1.0);
    let _ = solve_bezier_progress_for_time(i64::MAX, &channel.keys[0], &channel.keys[1]);
}

/// 空通道与类型不符的 fallback 都返回 fallback。
#[test]
fn empty_channel_and_mismatched_fallback() {
    let empty = ScalarChannel {
        keys: Vec::new(),
        extrapolation: None,
    };
    assert_eq!(get_scalar_channel_value_at_time(&empty, 0, 7.0), 7.0);
    let scalar = AnimationChannel::Scalar(channel());
    assert_eq!(
        get_channel_value_at_time(Some(&scalar), 60_000, &ParamValue::Text("x".to_owned())),
        ParamValue::Text("x".to_owned())
    );
}

/// 归一化补齐缺省字段、稳定排序并保留同时间帧的先后顺序。
#[test]
fn normalization_is_stable_and_fills_defaults() {
    let mut source = channel();
    source.keys.reverse();
    source.keys.push(ScalarKey {
        id: "c".to_owned(),
        time: 0,
        value: 1.0,
        left_handle: None,
        right_handle: None,
        segment_to_next: None,
        tangent_mode: None,
    });
    let normalized = normalize_scalar_channel(&source);
    assert_eq!(normalized.keys[0].id, "a");
    assert_eq!(normalized.keys[1].id, "c");
    assert_eq!(normalized.keys[2].id, "b");
    assert_eq!(normalized.keys[0].time, 0);
    assert_eq!(normalized.keys[2].time, 120_000);
    assert_eq!(normalized.keys[0].tangent_mode, Some(TangentMode::Flat));
    assert_eq!(
        normalized.keys[0].segment_to_next,
        Some(ScalarSegmentType::Linear)
    );
    assert_eq!(BEZIER_SOLVE_ITERATIONS, 20);
}
