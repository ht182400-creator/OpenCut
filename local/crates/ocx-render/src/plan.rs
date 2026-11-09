//! 帧计划：由时长与 `ExportProfile` 推导帧数、时间戳序列与音画同步采样数（W-07）。
//!
//! 音画同步采用**累积采样数**而非「每帧固定采样数」：
//! `cum(i) = floor(i * denominator * sampleRate / numerator)`，
//! 第 i 帧采样数为 `cum(i+1) - cum(i)`，避免 29.97/23.976 等非整数帧率下的累计漂移。

use std::fmt;

use ocx_time::TICKS_PER_SECOND;
use serde::{Deserialize, Serialize};

use crate::profile::{ExportProfile, ProfileError, validate_export_profile};

/// 单次计划允许的最大帧数（防止超长工程一次性分配巨量数组）。
pub const MAX_FRAME_COUNT: u64 = 10_000;

/// 帧计划错误码。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanError {
    InvalidProfile,
    TooManyFrames,
    InvalidDuration,
}

impl PlanError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            PlanError::InvalidProfile => "INVALID_PROFILE",
            PlanError::TooManyFrames => "TOO_MANY_FRAMES",
            PlanError::InvalidDuration => "INVALID_DURATION",
        }
    }
}

impl fmt::Display for PlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            PlanError::InvalidProfile => "导出配置校验未通过",
            PlanError::TooManyFrames => "帧数超出单次计划上限；请缩短时长或降低帧率",
            PlanError::InvalidDuration => "时长不能为负数；请检查 durationTicks",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

impl From<ProfileError> for PlanError {
    fn from(_: ProfileError) -> Self {
        PlanError::InvalidProfile
    }
}

/// 确定性的导出/预览帧计划。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePlan {
    pub frame_count: u64,
    pub duration_ticks: i64,
    pub ticks_per_frame: i64,
    pub frame_times_ticks: Vec<i64>,
    /// 每帧音频采样数；`includeAudio=false` 时为空。
    pub audio_samples_per_frame: Vec<u32>,
    pub total_audio_samples: u64,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub sample_rate_hz: u32,
}

/// 计算第 i 帧边界处的累积音频采样数（i128 中间值防溢出）。
fn cumulative_audio_samples(frame_index: u64, profile: &ExportProfile) -> u64 {
    let numerator = i128::from(profile.frame_rate.numerator);
    let denominator = i128::from(profile.frame_rate.denominator);
    let sample_rate = i128::from(profile.audio_sample_rate_hz);
    (i128::from(frame_index) * denominator * sample_rate / numerator) as u64
}

/// 根据时长与导出配置构建帧计划。
pub fn build_frame_plan(
    duration_ticks: i64,
    profile: &ExportProfile,
) -> Result<FramePlan, PlanError> {
    validate_export_profile(profile)?;
    if duration_ticks < 0 {
        return Err(PlanError::InvalidDuration);
    }

    let ticks_per_frame = profile
        .frame_rate
        .ticks_per_frame()
        .ok_or(PlanError::InvalidProfile)?;

    // 向上取整：最后一帧即使不足一帧时长也需要输出
    let frame_count = if duration_ticks == 0 {
        0
    } else {
        ((i128::from(duration_ticks) + i128::from(ticks_per_frame) - 1)
            / i128::from(ticks_per_frame)) as u64
    };
    if frame_count > MAX_FRAME_COUNT {
        return Err(PlanError::TooManyFrames);
    }

    let mut frame_times_ticks = Vec::with_capacity(frame_count as usize);
    for index in 0..frame_count {
        frame_times_ticks
            .push(i64::try_from(index as i128 * i128::from(ticks_per_frame)).unwrap_or(i64::MAX));
    }

    let mut audio_samples_per_frame = Vec::new();
    let mut total_audio_samples = 0u64;
    if profile.include_audio {
        let mut previous = 0u64;
        audio_samples_per_frame.reserve(frame_count as usize);
        for index in 0..frame_count {
            let current = cumulative_audio_samples(index + 1, profile);
            audio_samples_per_frame.push((current - previous) as u32);
            previous = current;
        }
        total_audio_samples = previous;
    }

    Ok(FramePlan {
        frame_count,
        duration_ticks,
        ticks_per_frame,
        frame_times_ticks,
        audio_samples_per_frame,
        total_audio_samples,
        duration_seconds: duration_ticks as f64 / TICKS_PER_SECOND as f64,
        width: profile.width,
        height: profile.height,
        sample_rate_hz: profile.audio_sample_rate_hz,
    })
}

/// 给定时间落在第几帧（向下取整），用于预览定位。
pub fn frame_index_at_time(time_ticks: i64, ticks_per_frame: i64) -> Option<u64> {
    if time_ticks < 0 || ticks_per_frame <= 0 {
        return None;
    }
    Some((time_ticks / ticks_per_frame) as u64)
}
