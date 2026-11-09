//! W-08：真实底图合成的确定性与错误分支单测。

use ocx_render::{FrameError, FrameParams, composite_frame};

/// 构造测试用帧参数。
fn params(opacity: f64) -> FrameParams {
    FrameParams {
        background_rgba: [17, 24, 39, 255],
        accent_rgba: [100, 150, 200, 255],
        opacity,
        position_x: 0.5,
        position_y: 0.5,
    }
}

/// 构造纯色底图 RGBA。
fn base(width: u32, height: u32) -> Vec<u8> {
    vec![70; width as usize * height as usize * 4]
}

/// 矩形之外原样保留真实底图，矩形内被前景覆盖。
#[test]
fn preserves_base_frame_outside_overlay() {
    let frame = composite_frame(&base(8, 4), 8, 4, 0, 0, 4000, &params(1.0)).expect("合成应成功");
    assert_eq!(frame.pixels_rgba.len(), 128);
    assert_eq!(frame.pixel(0, 0), Some([70, 70, 70, 70]));
    assert_eq!(frame.pixel(3, 2), Some([100, 150, 200, 255]));
    assert_eq!(frame.pixel(7, 3), Some([70, 70, 70, 70]));
}

/// 半透明前景与底图按 opacity 混合。
#[test]
fn blends_overlay_with_opacity() {
    let frame = composite_frame(&base(8, 4), 8, 4, 0, 0, 4000, &params(0.5)).expect("合成应成功");
    let pixel = frame.pixel(3, 2).expect("坐标合法");
    assert_eq!(pixel[0], 85);
    assert_eq!(pixel[1], 110);
    assert_eq!(pixel[2], 135);
    assert_eq!(pixel[3], 255);
}

/// 相同输入确定性一致，帧索引驱动前景变化。
#[test]
fn is_deterministic_and_frame_sensitive() {
    let first = composite_frame(&base(8, 4), 8, 4, 0, 0, 4000, &params(1.0)).expect("合成应成功");
    let same = composite_frame(&base(8, 4), 8, 4, 0, 0, 4000, &params(1.0)).expect("合成应成功");
    let next =
        composite_frame(&base(8, 4), 8, 4, 5, 20000, 4000, &params(1.0)).expect("合成应成功");
    assert_eq!(first, same);
    assert_ne!(first, next);
    assert_eq!(next.pixel(3, 2).map(|pixel| pixel[0]), Some(105));
}

/// 底图长度、尺寸与 opacity 的异常分支返回稳定错误码。
#[test]
fn rejects_invalid_inputs() {
    let short = vec![70u8; 3];
    assert_eq!(
        composite_frame(&short, 8, 4, 0, 0, 4000, &params(1.0))
            .unwrap_err()
            .code(),
        "INVALID_BASE_FRAME"
    );
    assert_eq!(
        composite_frame(&base(8, 4), 0, 4, 0, 0, 4000, &params(1.0))
            .unwrap_err()
            .code(),
        "FRAME_TOO_LARGE"
    );
    assert_eq!(
        composite_frame(&base(8, 4), 8, 4, 0, 0, 4000, &params(1.5))
            .unwrap_err()
            .code(),
        "INVALID_OPACITY"
    );
    assert!(matches!(
        composite_frame(&short, 8, 4, 0, 0, 4000, &params(1.0)).unwrap_err(),
        FrameError::InvalidBaseFrame
    ));
}

/// 并发调用不共享可变状态。
#[test]
fn concurrent_composite_is_deterministic() {
    let expected =
        composite_frame(&base(8, 4), 8, 4, 3, 12000, 4000, &params(0.65)).expect("合成应成功");
    let mut handles = Vec::new();
    for _ in 0..8 {
        handles.push(std::thread::spawn(move || {
            composite_frame(&base(8, 4), 8, 4, 3, 12000, 4000, &params(0.65)).expect("合成应成功")
        }));
    }
    for handle in handles {
        assert_eq!(handle.join().expect("线程不应 panic"), expected);
    }
}
