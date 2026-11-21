//! H01 / H05 spike：CPU 合成帧 → GPUI 显示的最小验证切片（W-14）。
//!
//! 背景：GPUI 0.2.2 走 blade 图形栈，不直接提供 wgpu 纹理；重写版 core 尚无 wgpu
//! 合成器，只有 `ocx_render::render_frame` 产出的确定性 CPU RGBA8 `Vec<u8>`。
//! 本模块不伪造「wgpu 纹理 readback」——它验证的是**等价的前半段**：同一份 CPU 帧
//! 能否无损转成 GPUI 可消费的纹理数据（BGRA），并记录 1080p 单帧耗时与 FNV checksum。
//! 真正从 wgpu 纹理读出像素的后半段，因仓库无 wgpu 合成路径暂不可测，按 ADR-04 记录。
//!
//! 所有像素来源与 CLI / WASM core 共用 `render_frame`，因此 checksum 可跨栈对齐。

use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::RenderImage;
use image::{Frame, ImageBuffer, Rgba};
use ocx_render::{
    Codec, Container, ExportProfile, FrameParams, FrameRateSpec, RenderFrame, render_frame,
};

/// spike 帧宽（1080p）。
pub(crate) const SPIKE_WIDTH: u32 = 1920;
/// spike 帧高（1080p）。
pub(crate) const SPIKE_HEIGHT: u32 = 1080;
/// spike 帧索引：前景 tint 取该值 mod 256，便于跨端对同一帧校验。
pub(crate) const SPIKE_FRAME_INDEX: u64 = 7;
/// spike 帧时间戳（ticks）。
pub(crate) const SPIKE_TIME_TICKS: i64 = 0;
/// spike 单帧时长（ticks，1600 ticks ≈ 30fps）。
pub(crate) const SPIKE_DURATION_TICKS: i64 = 1600;
/// spike 帧率分子。
const SPIKE_FPS_NUMERATOR: u32 = 30;
/// spike 帧率分母。
const SPIKE_FPS_DENOMINATOR: u32 = 1;
/// spike 视频码率（bps）。
const SPIKE_VIDEO_BITRATE_BPS: u32 = 6_000_000;
/// spike 音频采样率（Hz）。
const SPIKE_AUDIO_SAMPLE_RATE_HZ: u32 = 48_000;
/// spike 音频声道数。
const SPIKE_AUDIO_CHANNELS: u16 = 2;
/// 背景 RGBA（深灰，便于肉眼区分前景矩形）。
const SPIKE_BACKGROUND_RGBA: [u8; 4] = [24, 24, 30, 255];
/// 前景 RGBA（青绿）。
const SPIKE_ACCENT_RGBA: [u8; 4] = [64, 200, 180, 255];
/// 前景矩形透明度。
const SPIKE_OPACITY: f64 = 0.75;
/// 前景矩形归一化中心 x。
const SPIKE_POSITION_X: f64 = 0.5;
/// 前景矩形归一化中心 y。
const SPIKE_POSITION_Y: f64 = 0.5;

/// spike 执行错误：统一给 UI 友好中文提示，不 panic。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SpikeError {
    /// `render_frame` 返回的错误（配置 / 参数非法）。
    Render(String),
    /// RGBA→BGRA 转换或纹理构造失败。
    Texture(String),
}

impl fmt::Display for SpikeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SpikeError::Render(detail) => write!(formatter, "CPU 帧生成失败：{detail}"),
            SpikeError::Texture(detail) => write!(formatter, "帧转 GPUI 纹理失败：{detail}"),
        }
    }
}

/// spike 实测结果：帧本体、生成耗时、跨栈校验和、GPUI 可直接显示的纹理数据。
pub(crate) struct SpikeResult {
    /// `render_frame` 产出的 CPU RGBA8 帧。
    pub(crate) frame: RenderFrame,
    /// 单帧生成耗时（仅 `render_frame`，不含纹理上传）。
    pub(crate) elapsed: Duration,
    /// FNV 校验和（0x 前缀十六进制，与 CLI 输出同格式）。
    pub(crate) checksum: String,
    /// 已转成 BGRA 的 GPUI 纹理数据。
    pub(crate) texture: Arc<RenderImage>,
}

/// 构造 spike 用的导出配置（1080p / 30fps / H.264）。
fn spike_profile() -> ExportProfile {
    ExportProfile {
        container: Container::Mp4,
        codec: Codec::Avc,
        width: SPIKE_WIDTH,
        height: SPIKE_HEIGHT,
        frame_rate: FrameRateSpec {
            numerator: SPIKE_FPS_NUMERATOR,
            denominator: SPIKE_FPS_DENOMINATOR,
        },
        video_bitrate_bps: SPIKE_VIDEO_BITRATE_BPS,
        include_audio: true,
        audio_sample_rate_hz: SPIKE_AUDIO_SAMPLE_RATE_HZ,
        audio_channels: SPIKE_AUDIO_CHANNELS,
    }
}

/// 构造演示合成帧参数（H01 spike 与桌面项目预览共用，保证跨端可复现）。
pub(crate) fn demo_frame_params() -> FrameParams {
    FrameParams {
        background_rgba: SPIKE_BACKGROUND_RGBA,
        accent_rgba: SPIKE_ACCENT_RGBA,
        opacity: SPIKE_OPACITY,
        position_x: SPIKE_POSITION_X,
        position_y: SPIKE_POSITION_Y,
    }
}

/**
 * 把 CPU RGBA8 帧转成 GPUI 可消费的 BGRA `RenderImage`。
 *
 * GPUI 的 `RenderImage` 注释明确要求 BGRA（`assets.rs:41`），其内置图片解码器
 * 也会把 `image` crate 解码出的 RGBA 逐像素 `swap(0, 2)`。这里做完全相同的变换，
 * 避免颜色通道错位；checksum 仍由原始 RGBA 计算，二者互不干扰。
 *
 * @param frame `render_frame` 产出的 CPU 帧
 * @returns {Result<Arc<RenderImage>, SpikeError>} GPUI 纹理数据
 */
pub(crate) fn frame_to_render_image(frame: &RenderFrame) -> Result<Arc<RenderImage>, SpikeError> {
    let mut bgra = frame.pixels_rgba.clone();
    // 每像素交换 R 与 B：RGBA → BGRA，与 GPUI 内置解码路径保持一致。
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let buffer = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(frame.width, frame.height, bgra)
        .ok_or_else(|| SpikeError::Texture("像素长度与宽高不匹配".to_owned()))?;
    // `RenderImage::new` 接受 `Into<SmallVec<[Frame;1]>>`，单帧数组即可满足。
    Ok(Arc::new(RenderImage::new([Frame::new(buffer)])))
}

/**
 * 执行 H01 spike：生成一帧 1080p 帧，记录耗时/checksum，并转为 GPUI 纹理。
 *
 * @returns {Result<SpikeResult, SpikeError>} 实测结果；失败时给可展示的中文错误
 */
pub(crate) fn generate_spike_frame() -> Result<SpikeResult, SpikeError> {
    let profile = spike_profile();
    let params = demo_frame_params();
    let started = Instant::now();
    let frame = render_frame(
        SPIKE_FRAME_INDEX,
        SPIKE_TIME_TICKS,
        SPIKE_DURATION_TICKS,
        &profile,
        &params,
    )
    .map_err(|error| SpikeError::Render(error.to_string()))?;
    let elapsed = started.elapsed();
    let checksum = format!("0x{:016x}", frame.checksum());
    let texture = frame_to_render_image(&frame)?;
    Ok(SpikeResult {
        frame,
        elapsed,
        checksum,
        texture,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 正常值：spike 帧必须是 1080p、RGBA 长度正确、checksum 稳定可复现。
    #[test]
    fn spike_frame_is_1080p_and_deterministic() {
        let first = generate_spike_frame().expect("生成 spike 帧应成功");
        let second = generate_spike_frame().expect("生成 spike 帧应成功");
        assert_eq!(first.frame.width, SPIKE_WIDTH);
        assert_eq!(first.frame.height, SPIKE_HEIGHT);
        assert_eq!(
            first.frame.pixels_rgba.len(),
            (SPIKE_WIDTH * SPIKE_HEIGHT * 4) as usize
        );
        assert_eq!(first.checksum, second.checksum);
        assert!(first.checksum.starts_with("0x"));
        assert_eq!(first.checksum.len(), 18);
    }

    /// 边界值：1080p 单帧耗时应可测（>0），并输出实测数据供 spike 报告引用。
    #[test]
    fn spike_reports_elapsed_and_checksum() {
        let result = generate_spike_frame().expect("生成 spike 帧应成功");
        println!(
            "[H01 spike] 1080p 单帧耗时={:?} checksum={}",
            result.elapsed, result.checksum
        );
        assert!(result.elapsed > Duration::ZERO);
        assert_eq!(result.frame.frame_index, SPIKE_FRAME_INDEX);
    }

    /// 像素正确性：BGRA 转换只交换 R/B，A 通道与原 RGBA 完全一致。
    #[test]
    fn bgra_conversion_preserves_alpha() {
        let result = generate_spike_frame().expect("生成 spike 帧应成功");
        let bytes = result
            .texture
            .as_bytes(0)
            .expect("RenderImage 应含首帧字节");
        assert_eq!(bytes.len(), result.frame.pixels_rgba.len());
        // 背景像素（左上角）RGBA=[24,24,30,255] → BGRA=[30,24,24,255]。
        let rgba = result.frame.pixel(0, 0).expect("左上角像素应存在");
        assert_eq!([bytes[0], bytes[1], bytes[2], bytes[3]], [rgba[2], rgba[1], rgba[0], rgba[3]]);
    }

    /// 异常分支：非法 profile 参数应返回错误而非 panic。
    #[test]
    fn invalid_frame_params_return_error() {
        let mut params = demo_frame_params();
        params.opacity = f64::NAN;
        let result = render_frame(
            SPIKE_FRAME_INDEX,
            SPIKE_TIME_TICKS,
            SPIKE_DURATION_TICKS,
            &spike_profile(),
            &params,
        );
        assert!(result.is_err());
    }
}
