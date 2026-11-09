//! ocx-render 补充单测：并发安全、极值、像素契约与音画同步不变量。

use std::sync::Arc;
use std::thread;

use ocx_render::{
    Codec, Container, ExportProfile, FrameParams, FrameRateSpec, build_frame_plan, render_frame,
};

/// 构造一份标准测试配置。
fn profile() -> ExportProfile {
    ExportProfile {
        container: Container::Mp4,
        codec: Codec::Avc,
        width: 8,
        height: 4,
        frame_rate: FrameRateSpec {
            numerator: 30,
            denominator: 1,
        },
        video_bitrate_bps: 1_000_000,
        include_audio: true,
        audio_sample_rate_hz: 48_000,
        audio_channels: 2,
    }
}

/// 构造一份标准帧参数。
fn params() -> FrameParams {
    FrameParams {
        background_rgba: [10, 20, 30, 255],
        accent_rgba: [100, 150, 200, 255],
        opacity: 1.0,
        position_x: 0.5,
        position_y: 0.5,
    }
}

/// 并发构建帧计划与合成帧不应出现状态串扰。
#[test]
fn concurrent_render_is_deterministic() {
    let profile = Arc::new(profile());
    let params = Arc::new(params());
    let expected_plan = build_frame_plan(120_000, &profile).expect("计划应成功");
    let expected_frame = render_frame(3, 12_000, 4_000, &profile, &params).expect("帧应成功");

    let mut handles = Vec::new();
    for _ in 0..8 {
        let profile = Arc::clone(&profile);
        let params = Arc::clone(&params);
        handles.push(thread::spawn(move || {
            let plan = build_frame_plan(120_000, &profile).expect("计划应成功");
            let frame = render_frame(3, 12_000, 4_000, &profile, &params).expect("帧应成功");
            (plan, frame)
        }));
    }
    for handle in handles {
        let (plan, frame) = handle.join().expect("线程不应 panic");
        assert_eq!(plan, expected_plan);
        assert_eq!(frame, expected_frame);
    }
}

/// i64 极值与超大分辨率不得 panic，应返回稳定错误。
#[test]
fn extreme_values_do_not_panic() {
    assert!(build_frame_plan(i64::MAX, &profile()).is_err());
    let huge = ExportProfile {
        width: 8192,
        height: 8192,
        ..profile()
    };
    assert_eq!(
        render_frame(0, 0, 4_000, &huge, &params())
            .unwrap_err()
            .code(),
        "FRAME_TOO_LARGE"
    );
}

/// 相同输入校验和相同、不同帧索引校验和不同。
#[test]
fn checksum_is_deterministic_and_frame_sensitive() {
    let first = render_frame(0, 0, 4_000, &profile(), &params()).expect("帧应成功");
    let same = render_frame(0, 0, 4_000, &profile(), &params()).expect("帧应成功");
    let next = render_frame(1, 4_000, 4_000, &profile(), &params()).expect("帧应成功");
    assert_eq!(first.checksum(), same.checksum());
    assert_ne!(first.checksum(), next.checksum());
}

/// 像素访问边界与 RGBA 长度契约。
#[test]
fn pixel_access_and_buffer_length() {
    let frame = render_frame(0, 0, 4_000, &profile(), &params()).expect("帧应成功");
    assert_eq!(frame.pixels_rgba.len(), (8 * 4 * 4) as usize);
    assert!(frame.pixel(0, 0).is_some());
    assert!(frame.pixel(7, 3).is_some());
    assert!(frame.pixel(8, 0).is_none());
    assert!(frame.pixel(0, 4).is_none());
}

/// 非整数帧率下累积采样数不漂移：总和等于最后一帧边界的精确值。
#[test]
fn audio_samples_never_drift() {
    let ntsc = ExportProfile {
        frame_rate: FrameRateSpec {
            numerator: 30_000,
            denominator: 1001,
        },
        ..profile()
    };
    let plan = build_frame_plan(120_000, &ntsc).expect("计划应成功");
    assert_eq!(plan.frame_count, 30);
    assert_eq!(plan.audio_samples_per_frame[0], 1601);
    assert_eq!(plan.audio_samples_per_frame[1], 1602);
    let sum: u64 = plan
        .audio_samples_per_frame
        .iter()
        .map(|value| u64::from(*value))
        .sum();
    assert_eq!(sum, plan.total_audio_samples);
    assert_eq!(sum, 48_048);
}
