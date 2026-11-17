//! 帧缩略图下采样（批 7.4）。
//!
//! 把已解码的 RGBA 代理帧按 box filter（区域平均）缩小到缩略图尺寸，
//! 供素材卡与时间轴视频片段显示真实画面，替代此前的占位图标/纯色块。
//! 纯函数、零外部依赖、确定性，可由 golden 用例逐像素校验。

use std::fmt;

use serde::{Deserialize, Serialize};

/// 缩略图目标最大像素数（防止异常尺寸耗尽 WASM 内存）。
pub const MAX_THUMBNAIL_PIXELS: u32 = 512 * 512;

/// 缩略图错误码（稳定，供跨语言契约断言）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThumbnailError {
    InvalidSize,
    InvalidInput,
    ThumbnailTooLarge,
}

impl ThumbnailError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            ThumbnailError::InvalidSize => "INVALID_THUMBNAIL_SIZE",
            ThumbnailError::InvalidInput => "INVALID_THUMBNAIL_INPUT",
            ThumbnailError::ThumbnailTooLarge => "THUMBNAIL_TOO_LARGE",
        }
    }
}

impl fmt::Display for ThumbnailError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            ThumbnailError::InvalidSize => "缩略图与源帧的宽高都必须是正整数",
            ThumbnailError::InvalidInput => "源帧像素长度必须等于宽 × 高 × 4",
            ThumbnailError::ThumbnailTooLarge => "缩略图像素数超出上限；请减小缩略图尺寸",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

/**
 * 把 RGBA 源帧按 box filter 缩小到目标尺寸。
 *
 * 目标每个像素覆盖源帧的一个矩形区域 `[x0,x1) × [y0,y1)`，
 * 区域边界用整数除法 `floor(i*src/dst)` 计算（与波形分桶同风格、无浮点漂移），
 * 四个通道分别取区域平均（含 alpha）。
 *
 * @param input 源帧 RGBA8，行优先，长度必须等于 `src_width * src_height * 4`
 * @param src_width 源帧宽
 * @param src_height 源帧高
 * @param dst_width 缩略图宽（1~由 MAX_THUMBNAIL_PIXELS 约束）
 * @param dst_height 缩略图高
 * @returns 缩略图 RGBA8（长度 `dst_width * dst_height * 4`）或稳定错误码
 */
pub fn thumbnail_rgba(
    input: &[u8],
    src_width: u32,
    src_height: u32,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u8>, ThumbnailError> {
    if src_width == 0 || src_height == 0 || dst_width == 0 || dst_height == 0 {
        return Err(ThumbnailError::InvalidSize);
    }
    if (dst_width as u64) * (dst_height as u64) > MAX_THUMBNAIL_PIXELS as u64 {
        return Err(ThumbnailError::ThumbnailTooLarge);
    }
    let expected = (src_width as usize)
        .checked_mul(src_height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or(ThumbnailError::InvalidInput)?;
    if input.len() != expected {
        return Err(ThumbnailError::InvalidInput);
    }

    let sw = src_width as usize;
    let sh = src_height as usize;
    let dw = dst_width as usize;
    let dh = dst_height as usize;
    let mut out = vec![0u8; dw * dh * 4];
    for dy in 0..dh {
        let y0 = (dy * sh) / dh;
        let y1 = ((dy + 1) * sh) / dh;
        for dx in 0..dw {
            let x0 = (dx * sw) / dw;
            let x1 = ((dx + 1) * sw) / dw;
            let mut sum = [0u32; 4];
            let mut count = 0u32;
            for y in y0..y1 {
                for x in x0..x1 {
                    let offset = (y * sw + x) * 4;
                    for channel in 0..4 {
                        sum[channel] += input[offset + channel] as u32;
                    }
                    count += 1;
                }
            }
            let out_offset = (dy * dw + dx) * 4;
            // 空桶（放大时 x1<=x0 或 y1<=y0）时 checked_div 返回 None，
            // 回退到 clamp 后的最近源像素，避免输出透明黑点。
            let averaged = sum.map(|value| value.checked_div(count));
            if averaged[0].is_some() {
                for channel in 0..4 {
                    out[out_offset + channel] = averaged[channel].unwrap_or(0) as u8;
                }
            } else {
                let nx = x0.min(sw - 1);
                let ny = y0.min(sh - 1);
                let offset = (ny * sw + nx) * 4;
                out[out_offset..out_offset + 4].copy_from_slice(&input[offset..offset + 4]);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 构造纯色帧，便于断言区域平均结果。 */
    fn solid_frame(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.copy_from_slice(&rgba);
        }
        pixels
    }

    #[test]
    fn 二乘二缩到一乘一取四像素平均() {
        let frame = vec![
            0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 255, 255, 255, 255,
        ];
        let thumb = thumbnail_rgba(&frame, 2, 2, 1, 1).unwrap();
        assert_eq!(thumb.len(), 4);
        assert_eq!(thumb, vec![138, 138, 138, 255]); // (0+100+200+255)/4=138
    }

    #[test]
    fn 四乘四缩到二乘二每个块取平均() {
        let frame = solid_frame(4, 4, [40, 80, 120, 255]);
        let thumb = thumbnail_rgba(&frame, 4, 4, 2, 2).unwrap();
        assert_eq!(thumb.len(), 2 * 2 * 4);
        assert!(thumb.chunks_exact(4).all(|c| c == [40, 80, 120, 255]));
    }

    #[test]
    fn 源等于目标时原样返回() {
        let frame = solid_frame(3, 2, [12, 34, 56, 200]);
        let thumb = thumbnail_rgba(&frame, 3, 2, 3, 2).unwrap();
        assert_eq!(thumb, frame);
    }

    #[test]
    fn 放大也按区域重复填充() {
        let frame = solid_frame(1, 1, [9, 8, 7, 255]);
        let thumb = thumbnail_rgba(&frame, 1, 1, 2, 2).unwrap();
        assert_eq!(thumb.len(), 2 * 2 * 4);
        assert!(thumb.chunks_exact(4).all(|c| c == [9, 8, 7, 255]));
    }

    #[test]
    fn 奇数尺寸边界按整数除法分桶不越界() {
        let frame = solid_frame(5, 3, [10, 20, 30, 255]);
        let thumb = thumbnail_rgba(&frame, 5, 3, 2, 2).unwrap();
        assert_eq!(thumb.len(), 16);
        assert!(thumb.chunks_exact(4).all(|c| c == [10, 20, 30, 255]));
    }

    #[test]
    fn 宽或高为零被拒绝() {
        assert_eq!(
            thumbnail_rgba(&[0u8; 16], 0, 4, 2, 2).unwrap_err().code(),
            "INVALID_THUMBNAIL_SIZE",
        );
        assert_eq!(
            thumbnail_rgba(&[0u8; 16], 4, 4, 2, 0).unwrap_err().code(),
            "INVALID_THUMBNAIL_SIZE",
        );
    }

    #[test]
    fn 源帧长度不符被拒绝() {
        assert_eq!(
            thumbnail_rgba(&[0u8; 3], 2, 2, 1, 1).unwrap_err().code(),
            "INVALID_THUMBNAIL_INPUT",
        );
    }

    #[test]
    fn 超出目标像素上限被拒绝() {
        let frame = solid_frame(2, 2, [1, 2, 3, 255]);
        let err = thumbnail_rgba(&frame, 2, 2, 1024, 1024).unwrap_err();
        assert_eq!(err.code(), "THUMBNAIL_TOO_LARGE");
    }
}
