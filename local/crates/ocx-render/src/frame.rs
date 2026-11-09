//! 无状态帧 `RenderFrame` 与确定性合成帧源（W-07）。
//!
//! 这一层不依赖 GPU/H01 的原生渲染路径：帧由时间轴参数（透明度、位置）与帧索引
//! 纯函数式生成，预览与导出共用同一份像素，因此可做 golden master 逐像素校验。
//! 后续接入真实合成器时，只需替换 `render_frame` 内部实现，`RenderFrame` 契约不变。

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::profile::{ExportProfile, ProfileError, validate_export_profile};

/// 单帧最大像素数（防止 WASM 内存被超大帧耗尽）。
pub const MAX_FRAME_PIXELS: u32 = 4096 * 2160;
/// 矩形相对画面的缩小倍数（越大矩形越小）。
pub const DEFAULT_RECT_DIVISOR: u32 = 4;

/// 帧生成错误码。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrameError {
    InvalidProfile,
    FrameTooLarge,
    InvalidOpacity,
    InvalidBaseFrame,
}

impl FrameError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            FrameError::InvalidProfile => "INVALID_PROFILE",
            FrameError::FrameTooLarge => "FRAME_TOO_LARGE",
            FrameError::InvalidOpacity => "INVALID_OPACITY",
            FrameError::InvalidBaseFrame => "INVALID_BASE_FRAME",
        }
    }
}

impl fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            FrameError::InvalidProfile => "导出配置校验未通过",
            FrameError::FrameTooLarge => "帧像素数超出上限；请减小分辨率",
            FrameError::InvalidOpacity => "透明度必须是 0~1 的有限数值",
            FrameError::InvalidBaseFrame => "底图像素长度必须等于宽 × 高 × 4；请检查解码结果",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

impl From<ProfileError> for FrameError {
    fn from(_: ProfileError) -> Self {
        FrameError::InvalidProfile
    }
}

/// 帧参数：通常来自 `ocx-domain` 的动画通道在时间 t 的求值结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameParams {
    /// 背景 RGBA。
    pub background_rgba: [u8; 4],
    /// 前景矩形 RGBA。
    pub accent_rgba: [u8; 4],
    /// 0~1 的透明度（作用于整帧 alpha）。
    pub opacity: f64,
    /// 0~1 的归一化矩形中心坐标。
    pub position_x: f64,
    pub position_y: f64,
}

/// 无状态帧：预览与导出共用的稳定契约。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderFrame {
    pub frame_index: u64,
    pub time_ticks: i64,
    pub duration_ticks: i64,
    pub width: u32,
    pub height: u32,
    /// RGBA8，行优先，长度恒为 `width * height * 4`。
    pub pixels_rgba: Vec<u8>,
}

impl RenderFrame {
    /// 取指定坐标的 RGBA；越界返回 None。
    pub fn pixel(&self, x: u32, y: u32) -> Option<[u8; 4]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let offset = ((y as usize) * (self.width as usize) + (x as usize)) * 4;
        let slice = self.pixels_rgba.get(offset..offset + 4)?;
        Some([slice[0], slice[1], slice[2], slice[3]])
    }

    /// 全帧字节校验和（FNV-1a 变体），供 golden master 与跨端像素对比。
    pub fn checksum(&self) -> u64 {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in &self.pixels_rgba {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash
    }
}

/// 把 0~1 参数映射到画面像素坐标，并夹到合法范围。
fn rect_bounds(width: u32, height: u32, params: &FrameParams) -> (u32, u32, u32, u32) {
    let rect_w = (width / DEFAULT_RECT_DIVISOR).max(1);
    let rect_h = (height / DEFAULT_RECT_DIVISOR).max(1);
    let center_x = (params.position_x.clamp(0.0, 1.0) * width as f64) as u32;
    let center_y = (params.position_y.clamp(0.0, 1.0) * height as f64) as u32;
    let x0 = center_x
        .saturating_sub(rect_w / 2)
        .min(width.saturating_sub(1));
    let y0 = center_y
        .saturating_sub(rect_h / 2)
        .min(height.saturating_sub(1));
    let x1 = (x0 + rect_w).min(width);
    let y1 = (y0 + rect_h).min(height);
    (x0, y0, x1, y1)
}

/// 生成确定性合成帧；相同输入恒定得到相同像素。
pub fn render_frame(
    frame_index: u64,
    time_ticks: i64,
    duration_ticks: i64,
    profile: &ExportProfile,
    params: &FrameParams,
) -> Result<RenderFrame, FrameError> {
    validate_export_profile(profile)?;
    if !params.opacity.is_finite() || !(0.0..=1.0).contains(&params.opacity) {
        return Err(FrameError::InvalidOpacity);
    }
    let width = profile.width;
    let height = profile.height;
    if width.saturating_mul(height) > MAX_FRAME_PIXELS {
        return Err(FrameError::FrameTooLarge);
    }

    let (x0, y0, x1, y1) = rect_bounds(width, height, params);
    let alpha = (params.opacity * 255.0).round() as u8;
    // 帧索引只影响前景的一个通道，保证「时间推进 → 像素变化」且完全可推导
    let frame_tint = (frame_index % 256) as u8;
    let accent = [
        params.accent_rgba[0].wrapping_add(frame_tint),
        params.accent_rgba[1],
        params.accent_rgba[2],
        alpha,
    ];
    let background = [
        params.background_rgba[0],
        params.background_rgba[1],
        params.background_rgba[2],
        alpha,
    ];

    let mut pixels_rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        for x in 0..width {
            let inside = x >= x0 && x < x1 && y >= y0 && y < y1;
            pixels_rgba.extend_from_slice(if inside { &accent } else { &background });
        }
    }

    Ok(RenderFrame {
        frame_index,
        time_ticks,
        duration_ticks,
        width,
        height,
        pixels_rgba,
    })
}

/// 把浏览器解码的底图与 core 的程序化图层合成，产出最终 `RenderFrame`（W-08）。
///
/// 真实素材的解码由浏览器完成（WebCodecs / `<video>`），core 只负责确定性的合成与帧契约；
/// 预览与导出共用这个函数，因此导出画面与预览逐像素一致。
/// 前景矩形按 `opacity` 与底图混合，矩形之外原样保留真实画面；输出 alpha 恒为 255。
pub fn composite_frame(
    base_rgba: &[u8],
    width: u32,
    height: u32,
    frame_index: u64,
    time_ticks: i64,
    duration_ticks: i64,
    params: &FrameParams,
) -> Result<RenderFrame, FrameError> {
    if !params.opacity.is_finite() || !(0.0..=1.0).contains(&params.opacity) {
        return Err(FrameError::InvalidOpacity);
    }
    if width == 0 || height == 0 || width.saturating_mul(height) > MAX_FRAME_PIXELS {
        return Err(FrameError::FrameTooLarge);
    }
    let expected = width as usize * height as usize * 4;
    if base_rgba.len() != expected {
        return Err(FrameError::InvalidBaseFrame);
    }

    let (x0, y0, x1, y1) = rect_bounds(width, height, params);
    let frame_tint = (frame_index % 256) as u8;
    let accent = [
        params.accent_rgba[0].wrapping_add(frame_tint),
        params.accent_rgba[1],
        params.accent_rgba[2],
    ];
    let mix = params.opacity;

    let mut pixels_rgba = base_rgba.to_vec();
    for y in y0..y1 {
        for x in x0..x1 {
            let offset = ((y as usize) * (width as usize) + (x as usize)) * 4;
            for channel in 0..3 {
                let base = f64::from(pixels_rgba[offset + channel]);
                let overlay = f64::from(accent[channel]);
                pixels_rgba[offset + channel] = (overlay * mix + base * (1.0 - mix)).round() as u8;
            }
            pixels_rgba[offset + 3] = 255;
        }
    }

    Ok(RenderFrame {
        frame_index,
        time_ticks,
        duration_ticks,
        width,
        height,
        pixels_rgba,
    })
}
