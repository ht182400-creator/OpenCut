//! 音频波形的确定性峰值抽样（批 7.3）。
//!
//! 浏览器负责把音频文件解码为 planar PCM（`Float32Array`），本层把 PCM 样本
//! 压缩成固定条数的峰值（0~255），供时间轴片段绘制真实波形。纯函数、无副作用，
//! 不 panic；边界行为由单元测试与 WASM 契约固定。稳定错误码便于跨语言映射。

use std::fmt;

use serde::{Deserialize, Serialize};

/// 默认峰值条数：与时间轴既有 16 条程序化波形的视觉密度接近，取 16。
pub const DEFAULT_WAVEFORM_BINS: u32 = 16;
/// 峰值条数上限，防止恶意输入耗尽 WASM 内存。
pub const MAX_WAVEFORM_BINS: u32 = 4096;
/// 单次抽样允许的最大 PCM 样本数（约 85 秒 @48kHz），超出按等距降采样处理。
pub const MAX_PCM_SAMPLES: usize = 4_096_000;

/// 波形抽样错误码。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WaveformError {
    /// 峰值条数为 0 或超过上限。
    InvalidBins,
    /// PCM 样本为空。
    EmptyPcm,
    /// 样本数超过上限。
    TooManySamples,
}

impl WaveformError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            WaveformError::InvalidBins => "INVALID_WAVEFORM_BINS",
            WaveformError::EmptyPcm => "EMPTY_PCM",
            WaveformError::TooManySamples => "TOO_MANY_PCM_SAMPLES",
        }
    }
}

impl fmt::Display for WaveformError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            WaveformError::InvalidBins => "峰值条数必须在 1 到 4096 之间",
            WaveformError::EmptyPcm => "PCM 样本不能为空",
            WaveformError::TooManySamples => "PCM 样本数超出上限，请先降低采样精度",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

/// 波形抽样请求参数（经 WASM 边界以 camelCase JSON 传入）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformParams {
    /// 期望输出的峰值条数；缺省时用 `DEFAULT_WAVEFORM_BINS`。
    #[serde(default = "default_bins")]
    pub bins: u32,
}

/// serde 缺省值：默认峰值条数。
fn default_bins() -> u32 {
    DEFAULT_WAVEFORM_BINS
}

impl Default for WaveformParams {
    fn default() -> Self {
        Self {
            bins: DEFAULT_WAVEFORM_BINS,
        }
    }
}

/**
 * 把单声道 PCM 样本抽样成固定条数的峰值（0~255）。
 *
 * 每个 bin 取区间内绝对值的最大值（峰值检测），再线性映射到 0~255：
 * 全静音为 0，满幅（|sample| >= 1.0）为 255。非有限值按 0 处理，避免 NaN 传播。
 * 样本数不能被 bins 整除时，最后一个 bin 覆盖余数样本（不丢弃尾部）。
 *
 * @param samples 单声道 PCM 样本（已由调用方做多声道降混）
 * @param params 抽样参数（峰值条数）
 * @returns 长度为 params.bins 的峰值数组，错误时用稳定错误码
 */
pub fn waveform_peaks(samples: &[f32], params: &WaveformParams) -> Result<Vec<u8>, WaveformError> {
    if params.bins == 0 || params.bins > MAX_WAVEFORM_BINS {
        return Err(WaveformError::InvalidBins);
    }
    if samples.is_empty() {
        return Err(WaveformError::EmptyPcm);
    }
    if samples.len() > MAX_PCM_SAMPLES {
        return Err(WaveformError::TooManySamples);
    }

    let bins = params.bins as usize;
    let mut peaks = Vec::with_capacity(bins);
    for bin_index in 0..bins {
        // 每个 bin 的样本区间：用整数乘法避免浮点累积误差。
        let start = samples.len() * bin_index / bins;
        let end = samples.len() * (bin_index + 1) / bins;
        let mut peak = 0.0_f32;
        // 样本数少于 bins 时某些区间可能为空，此时 peak 保持 0。
        for &sample in &samples[start..end] {
            if sample.is_finite() {
                let magnitude = sample.abs();
                if magnitude > peak {
                    peak = magnitude;
                }
            }
        }
        // 线性映射：满幅 1.0 → 255；用 clamp 防止超过满幅的样本溢出 u8。
        let normalized = (peak.clamp(0.0, 1.0) * 255.0).round();
        peaks.push(normalized as u8);
    }
    Ok(peaks)
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 满幅正弦/静音等常规抽样：峰值应落在 0~255 且条数正确。 */
    #[test]
    fn peaks_are_bounded_and_correct_length() {
        let samples: Vec<f32> = (0..160).map(|index| (index as f32 / 10.0).sin()).collect();
        let peaks = waveform_peaks(&samples, &WaveformParams { bins: 16 }).unwrap();
        assert_eq!(peaks.len(), 16);
        assert!(peaks.iter().all(|&peak| peak <= 255));
    }

    /** 全静音输入产生全 0 峰值。 */
    #[test]
    fn silence_yields_zero_peaks() {
        let peaks = waveform_peaks(&[0.0; 64], &WaveformParams { bins: 8 }).unwrap();
        assert_eq!(peaks, vec![0; 8]);
    }

    /** 满幅输入产生全 255 峰值。 */
    #[test]
    fn full_scale_yields_max_peaks() {
        let peaks = waveform_peaks(&[1.0; 64], &WaveformParams { bins: 4 }).unwrap();
        assert_eq!(peaks, vec![255; 4]);
    }

    /** 每个 bin 取区间最大绝对值：验证峰值检测而非平均值。 */
    #[test]
    fn peak_detection_uses_max_magnitude() {
        // 8 个样本、4 个 bin，每 bin 2 个：第 1 个 bin 含 -0.5 与 0.1，峰值应为 0.5→128。
        let samples = [-0.5, 0.1, 0.2, 0.0, 0.0, 0.0, 1.0, 0.3];
        let peaks = waveform_peaks(&samples, &WaveformParams { bins: 4 }).unwrap();
        assert_eq!(peaks[0], 128);
        assert_eq!(peaks[1], 51);
        assert_eq!(peaks[2], 0);
        assert_eq!(peaks[3], 255);
    }

    /** 样本数少于 bins 时，样本落入最后一个区间，其余为空档（0），不 panic。 */
    #[test]
    fn more_bins_than_samples_fills_silence() {
        let peaks = waveform_peaks(&[1.0], &WaveformParams { bins: 4 }).unwrap();
        assert_eq!(peaks.len(), 4);
        // 整数除法：start = 1*i/4 全为 0，end = 1*(i+1)/4 仅 i=3 时为 1，
        // 故唯一样本落入最后一个 bin，前面都是空档。
        assert_eq!(peaks[0], 0);
        assert_eq!(peaks[1], 0);
        assert_eq!(peaks[2], 0);
        assert_eq!(peaks[3], 255);
    }

    /** NaN/Inf 按静音处理，不传播。 */
    #[test]
    fn non_finite_samples_treated_as_silence() {
        let peaks = waveform_peaks(
            &[f32::NAN, f32::INFINITY, 0.0, 0.0],
            &WaveformParams { bins: 2 },
        )
        .unwrap();
        assert_eq!(peaks, vec![0, 0]);
    }

    /** 边界：bins=0、超上限、空 PCM、超量样本均返回稳定错误码。 */
    #[test]
    fn invalid_inputs_return_stable_codes() {
        assert_eq!(
            waveform_peaks(&[0.0; 8], &WaveformParams { bins: 0 })
                .unwrap_err()
                .code(),
            "INVALID_WAVEFORM_BINS",
        );
        assert_eq!(
            waveform_peaks(
                &[0.0; 8],
                &WaveformParams {
                    bins: MAX_WAVEFORM_BINS + 1
                }
            )
            .unwrap_err()
            .code(),
            "INVALID_WAVEFORM_BINS",
        );
        assert_eq!(
            waveform_peaks(&[], &WaveformParams::default())
                .unwrap_err()
                .code(),
            "EMPTY_PCM",
        );
        assert_eq!(
            waveform_peaks(&[0.0; MAX_PCM_SAMPLES + 1], &WaveformParams::default())
                .unwrap_err()
                .code(),
            "TOO_MANY_PCM_SAMPLES",
        );
    }

    /** 默认值：缺省 bins 为 DEFAULT_WAVEFORM_BINS，输出长度与之一致。 */
    #[test]
    fn default_params_use_default_bins() {
        let params = WaveformParams::default();
        assert_eq!(params.bins, DEFAULT_WAVEFORM_BINS);
        let peaks = waveform_peaks(&[0.5; 100], &params).unwrap();
        assert_eq!(peaks.len(), DEFAULT_WAVEFORM_BINS as usize);
    }
}
