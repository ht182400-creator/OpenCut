//! 导出配置 `ExportProfile` 与校验（W-07 契约层）。
//!
//! 契约原则：字段只增不删、camelCase、错误码稳定；预览与导出共用同一份 profile，
//! 避免「预览一套参数、导出另一套参数」造成时长/帧数漂移。

use std::fmt;

use ocx_time::FrameRate;
use serde::{Deserialize, Serialize};

/// 单边最大尺寸（超过则拒绝，避免 WASM 内存被超大帧耗尽）。
pub const MAX_FRAME_DIMENSION: u32 = 8192;
/// 视频码率下限 / 上限（bps）。
pub const MIN_VIDEO_BITRATE_BPS: u32 = 100_000;
pub const MAX_VIDEO_BITRATE_BPS: u32 = 200_000_000;
/// 支持的音频采样率。
pub const SUPPORTED_AUDIO_SAMPLE_RATES: [u32; 3] = [44_100, 48_000, 96_000];
/// 最大声道数。
pub const MAX_AUDIO_CHANNELS: u16 = 8;

/// 容器格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Container {
    Mp4,
    WebM,
}

/// 视频编码。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    Avc,
    Vp9,
    Av1,
}

impl Codec {
    /// 该编码在指定容器中是否受支持（WebCodecs 实际能力范围内）。
    pub fn supports_container(self, container: Container) -> bool {
        match container {
            Container::Mp4 => matches!(self, Codec::Avc | Codec::Av1),
            Container::WebM => matches!(self, Codec::Vp9 | Codec::Av1),
        }
    }
}

/// 有理数帧率（如 30000/1001 表示 29.97 fps）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameRateSpec {
    pub numerator: u32,
    pub denominator: u32,
}

impl FrameRateSpec {
    /// 转成 `ocx-time` 的帧率；非法（0 分子/分母）返回 None。
    pub fn to_frame_rate(self) -> Option<FrameRate> {
        let rate = FrameRate::new(self.numerator, self.denominator);
        rate.is_valid().then_some(rate)
    }

    /// 每帧的 ticks 数。
    pub fn ticks_per_frame(self) -> Option<i64> {
        self.to_frame_rate()?.ticks_per_frame()
    }
}

/// 导出配置：预览与导出共用。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProfile {
    pub container: Container,
    pub codec: Codec,
    pub width: u32,
    pub height: u32,
    pub frame_rate: FrameRateSpec,
    pub video_bitrate_bps: u32,
    pub include_audio: bool,
    pub audio_sample_rate_hz: u32,
    pub audio_channels: u16,
}

/// 稳定的校验错误码（跨语言契约的一部分）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProfileError {
    InvalidDimension,
    InvalidFrameRate,
    InvalidBitrate,
    IncompatibleCodec,
    InvalidAudio,
}

impl ProfileError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            ProfileError::InvalidDimension => "INVALID_DIMENSION",
            ProfileError::InvalidFrameRate => "INVALID_FRAME_RATE",
            ProfileError::InvalidBitrate => "INVALID_BITRATE",
            ProfileError::IncompatibleCodec => "INCOMPATIBLE_CODEC",
            ProfileError::InvalidAudio => "INVALID_AUDIO",
        }
    }
}

impl fmt::Display for ProfileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            ProfileError::InvalidDimension => {
                "宽高必须为正偶数且不超过上限；请检查 width / height 后重试"
            }
            ProfileError::InvalidFrameRate => {
                "帧率分子分母必须为正且可换算为 ticks；请检查 frameRate 后重试"
            }
            ProfileError::InvalidBitrate => "视频码率超出允许范围；请检查 videoBitrateBps 后重试",
            ProfileError::IncompatibleCodec => {
                "编码与容器组合不受支持（MP4 用 avc/av1，WebM 用 vp9/av1）"
            }
            ProfileError::InvalidAudio => {
                "音频采样率或声道数不合法；请检查 includeAudio 相关字段后重试"
            }
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

/// 校验导出配置；任何非法输入都返回稳定错误码，不 panic。
pub fn validate_export_profile(profile: &ExportProfile) -> Result<(), ProfileError> {
    let dimensions_ok = profile.width > 0
        && profile.height > 0
        && profile.width <= MAX_FRAME_DIMENSION
        && profile.height <= MAX_FRAME_DIMENSION
        && profile.width.is_multiple_of(2)
        && profile.height.is_multiple_of(2);
    if !dimensions_ok {
        return Err(ProfileError::InvalidDimension);
    }

    if profile.frame_rate.ticks_per_frame().is_none() {
        return Err(ProfileError::InvalidFrameRate);
    }

    if !(MIN_VIDEO_BITRATE_BPS..=MAX_VIDEO_BITRATE_BPS).contains(&profile.video_bitrate_bps) {
        return Err(ProfileError::InvalidBitrate);
    }

    if !profile.codec.supports_container(profile.container) {
        return Err(ProfileError::IncompatibleCodec);
    }

    if profile.include_audio {
        let audio_ok = SUPPORTED_AUDIO_SAMPLE_RATES.contains(&profile.audio_sample_rate_hz)
            && profile.audio_channels > 0
            && profile.audio_channels <= MAX_AUDIO_CHANNELS;
        if !audio_ok {
            return Err(ProfileError::InvalidAudio);
        }
    }

    Ok(())
}
