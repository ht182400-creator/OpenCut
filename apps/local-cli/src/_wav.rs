//! 手写 WAV 编码（W-13 C 批）：planar f32 PCM → 16-bit PCM RIFF/WAVE，零第三方音频库。
//!
//! 输入沿用浏览器 `PcmAudio` 的 planar 布局（每个声道一个 Vec<f32>，采样已归一到 [-1,1]），
//! 输出为交错 i16 PCM 的标准 WAV（fmt PCM=1），可供任意播放器/校验工具读取。
//! 这样 headless 侧能导出与 Web 侧 `buildTimelineAudio` 同布局的音频，做跨栈对齐。

/// RIFF/WAVE 固定标识常量。
const RIFF: &[u8; 4] = b"RIFF";
const WAVE: &[u8; 4] = b"WAVE";
const FMT: &[u8; 4] = b"fmt ";
const DATA: &[u8; 4] = b"data";
/// fmt 子块长度（PCM）。
const FMT_CHUNK_LEN: u32 = 16;
/// 音频格式 1 = PCM（未压缩）。
const AUDIO_FORMAT_PCM: u16 = 1;
/// f32 → i16 的对称缩放（-1.0 → -32767，1.0 → 32767；避免非对称多一位）。
const I16_SCALE: f32 = 32767.0;
/// WAV 输入允许的最大声道数（防止畸形输入造成超大交错缓冲）。
const MAX_CHANNELS: usize = 8;

/// 把单个 f32 采样饱和映射到 i16（非有限值按 0）。
fn sample_to_i16(sample: f32) -> i16 {
    if !sample.is_finite() {
        return 0;
    }
    let clamped = sample.clamp(-1.0, 1.0);
    (clamped * I16_SCALE).round() as i16
}

/**
 * 把 planar f32 PCM 编码为标准 WAV（16-bit PCM，交错声道）字节。
 * @param channels 每个声道的采样数组（planar，长度应相同）
 * @param sample_rate_hz 采样率（如 48000）
 * @returns {Result<Vec<u8>, String>} WAV 文件字节；参数非法给中文错误
 */
pub fn pcm_to_wav(channels: &[Vec<f32>], sample_rate_hz: u32) -> Result<Vec<u8>, String> {
    if channels.is_empty() || channels.len() > MAX_CHANNELS {
        return Err(format!(
            "声道数必须在 1..={MAX_CHANNELS} 之间，实际 {}",
            channels.len()
        ));
    }
    if sample_rate_hz == 0 {
        return Err("采样率必须大于 0".to_owned());
    }
    let frames = channels[0].len();
    if channels.iter().any(|channel| channel.len() != frames) {
        return Err("各声道采样数必须一致".to_owned());
    }
    let channels_count = channels.len() as u16;
    let bytes_per_sample = 2u16;
    let block_align = channels_count * bytes_per_sample;
    let byte_rate = sample_rate_hz * u32::from(block_align);
    let data_len = (frames as u64)
        .checked_mul(u64::from(block_align))
        .ok_or_else(|| "音频数据长度溢出".to_owned())?;
    let data_len_u32 = u32::try_from(data_len).map_err(|_| "音频数据超过 4GB".to_owned())?;

    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(RIFF);
    out.extend_from_slice(&(36u64 + data_len).to_le_bytes()[..4]); // RIFF size = 文件长 - 8
    out.extend_from_slice(WAVE);

    out.extend_from_slice(FMT);
    out.extend_from_slice(&FMT_CHUNK_LEN.to_le_bytes());
    out.extend_from_slice(&AUDIO_FORMAT_PCM.to_le_bytes());
    out.extend_from_slice(&channels_count.to_le_bytes());
    out.extend_from_slice(&sample_rate_hz.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bytes_per_sample.to_le_bytes());

    out.extend_from_slice(DATA);
    out.extend_from_slice(&data_len_u32.to_le_bytes());
    for frame in 0..frames {
        for channel in channels {
            out.extend_from_slice(&sample_to_i16(channel[frame]).to_le_bytes());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_is_valid_for_mono_silence() {
        let wav = pcm_to_wav(&[vec![0.0; 4]], 48000).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8); // 4 帧 × i16
        assert_eq!(wav.len(), 44 + 8);
    }

    #[test]
    fn wav_interleaves_stereo_and_clamps() {
        let wav = pcm_to_wav(&[vec![1.0, -1.0], vec![0.5, 2.0]], 44100).unwrap();
        let pcm = &wav[44..];
        assert_eq!(i16::from_le_bytes(pcm[0..2].try_into().unwrap()), 32767);
        assert_eq!(i16::from_le_bytes(pcm[2..4].try_into().unwrap()), 16384);
        assert_eq!(i16::from_le_bytes(pcm[4..6].try_into().unwrap()), -32767);
        assert_eq!(i16::from_le_bytes(pcm[6..8].try_into().unwrap()), 32767); // 2.0 饱和
    }

    #[test]
    fn wav_rejects_bad_input() {
        assert!(pcm_to_wav(&[], 48000).is_err());
        assert!(pcm_to_wav(&[vec![0.0]], 0).is_err());
        assert!(pcm_to_wav(&[vec![0.0, 0.1], vec![0.0]], 48000).is_err());
    }
}
