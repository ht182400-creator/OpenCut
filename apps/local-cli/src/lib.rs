//! OpenCut Headless CLI 的库层（W-13 第二批）。
//!
//! 无浏览器渲染：`ocx-render` 的确定性合成帧 → PPM（P6）文件 + FNV 指纹摘要，
//! 供批处理、golden master 与跨栈像素对比（与 WASM core 同一份 `render_frame`）。
//! 项目检查复用 `ocx-domain` 的经典版只读兼容层。

use std::fs;
use std::path::{Path, PathBuf};

use ocx_domain::read_classic_project;
use ocx_render::{ExportProfile, FrameParams, RenderFrame, render_frame};
use serde::Serialize;
use serde_json::{Value, json};

mod _png;
mod _wav;

use _png::rgba_to_png;
pub use _wav::pcm_to_wav;

/// 单帧产物摘要（stdout JSON 的元素）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSummary {
    pub frame_index: u64,
    pub file: String,
    pub size: u64,
    /// `RenderFrame::checksum()` 的 FNV-1a 十六进制（与 WASM core 同函数）。
    pub checksum: String,
}

/**
 * 把 RenderFrame 编码为 PPM（P6）字节：RGB8，无 alpha，无压缩。
 * @param frame 已合成的帧
 * @returns {Vec<u8>} PPM 文件字节
 */
pub fn frame_to_ppm(frame: &RenderFrame) -> Vec<u8> {
    let mut out = format!("P6\n{} {}\n255\n", frame.width, frame.height).into_bytes();
    for pixel in frame.pixels_rgba.chunks_exact(4) {
        out.extend_from_slice(&pixel[..3]);
    }
    out
}

/**
 * 渲染单帧并写入 `dir/base-<frame_index>.ppm`。
 * @param frame_index 帧序号
 * @param time_ticks 帧起始时间（ticks）
 * @param duration_ticks 单帧时长（ticks）
 * @param profile 导出配置（宽高/帧率等）
 * @param params 帧参数（背景/前景/透明度/位置）
 * @param dir 输出目录（不存在则创建）
 * @param base 文件名前缀
 * @returns {Result<FrameSummary, String>} 摘要；渲染或写盘失败给中文错误
 */
pub fn render_one_to_ppm(
    frame_index: u64,
    time_ticks: i64,
    duration_ticks: i64,
    profile: &ExportProfile,
    params: &FrameParams,
    dir: &Path,
    base: &str,
) -> Result<FrameSummary, String> {
    let frame = render_frame(frame_index, time_ticks, duration_ticks, profile, params)
        .map_err(|error| error.to_string())?;
    write_frame(&frame, dir, base).map_err(|error| format!("写帧文件失败：{error}"))
}

/**
 * 批量渲染 `count` 帧：帧 i 的时间为 `i * duration_ticks`。
 * @param count 帧数
 * @param duration_ticks 单帧时长（ticks）
 * @param profile 导出配置
 * @param params 帧参数
 * @param dir 输出目录
 * @param base 文件名前缀
 * @returns {Result<Vec<FrameSummary>, String>} 逐帧摘要
 */
pub fn render_batch_to_ppm(
    count: u64,
    duration_ticks: i64,
    profile: &ExportProfile,
    params: &FrameParams,
    dir: &Path,
    base: &str,
) -> Result<Vec<FrameSummary>, String> {
    (0..count)
        .map(|index| {
            render_one_to_ppm(
                index,
                index as i64 * duration_ticks,
                duration_ticks,
                profile,
                params,
                dir,
                base,
            )
        })
        .collect()
}

/** 把帧写入磁盘并生成摘要。 */
fn write_frame(frame: &RenderFrame, dir: &Path, base: &str) -> std::io::Result<FrameSummary> {
    fs::create_dir_all(dir)?;
    let file: PathBuf = dir.join(format!("{base}-{:06}.ppm", frame.frame_index));
    fs::write(&file, frame_to_ppm(frame))?;
    let size = fs::metadata(&file)?.len();
    Ok(FrameSummary {
        frame_index: frame.frame_index,
        file: file.to_string_lossy().to_string(),
        size,
        checksum: format!("0x{:016x}", frame.checksum()),
    })
}

/**
 * 渲染单帧并写入 `dir/base-<frame_index>.png`（RGBA8，保留 alpha）。
 * @param frame_index 帧序号
 * @param time_ticks 帧起始时间（ticks）
 * @param duration_ticks 单帧时长（ticks）
 * @param profile 导出配置
 * @param params 帧参数
 * @param dir 输出目录（不存在则创建）
 * @param base 文件名前缀
 * @returns {Result<FrameSummary, String>} 摘要；渲染/编码/写盘失败给中文错误
 */
pub fn render_one_to_png(
    frame_index: u64,
    time_ticks: i64,
    duration_ticks: i64,
    profile: &ExportProfile,
    params: &FrameParams,
    dir: &Path,
    base: &str,
) -> Result<FrameSummary, String> {
    let frame = render_frame(frame_index, time_ticks, duration_ticks, profile, params)
        .map_err(|error| error.to_string())?;
    write_frame_png(&frame, dir, base).map_err(|error| format!("写 PNG 帧失败：{error}"))
}

/**
 * 批量渲染 `count` 帧为 PNG：帧 i 的时间为 `i * duration_ticks`。
 * @param count 帧数
 * @param duration_ticks 单帧时长（ticks）
 * @param profile 导出配置
 * @param params 帧参数
 * @param dir 输出目录
 * @param base 文件名前缀
 * @returns {Result<Vec<FrameSummary>, String>} 逐帧摘要
 */
pub fn render_batch_to_png(
    count: u64,
    duration_ticks: i64,
    profile: &ExportProfile,
    params: &FrameParams,
    dir: &Path,
    base: &str,
) -> Result<Vec<FrameSummary>, String> {
    (0..count)
        .map(|index| {
            render_one_to_png(
                index,
                index as i64 * duration_ticks,
                duration_ticks,
                profile,
                params,
                dir,
                base,
            )
        })
        .collect()
}

/** 把帧编码为 PNG 写入磁盘并生成摘要（checksum 仍取 RGBA 全字节，跨格式一致）。 */
fn write_frame_png(frame: &RenderFrame, dir: &Path, base: &str) -> std::io::Result<FrameSummary> {
    fs::create_dir_all(dir)?;
    let file: PathBuf = dir.join(format!("{base}-{:06}.png", frame.frame_index));
    let bytes = rgba_to_png(&frame.pixels_rgba, frame.width, frame.height)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(&file, bytes)?;
    let size = fs::metadata(&file)?.len();
    Ok(FrameSummary {
        frame_index: frame.frame_index,
        file: file.to_string_lossy().to_string(),
        size,
        checksum: format!("0x{:016x}", frame.checksum()),
    })
}

/** 音频导出摘要（stdout JSON 的返回值）。 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSummary {
    pub file: String,
    pub size: u64,
    /// 采样帧数（每声道的采样点数量）。
    pub frames: u64,
    pub channels: usize,
    pub sample_rate_hz: u32,
}

/**
 * 把 planar f32 PCM 编码为 WAV 写入 `path`。
 * @param channels 每个声道的采样数组（planar，[-1,1]）
 * @param sample_rate_hz 采样率
 * @param path 输出文件路径（父目录不存在则创建）
 * @returns {Result<AudioSummary, String>} 摘要；编码/写盘失败给中文错误
 */
pub fn write_audio_wav(
    channels: &[Vec<f32>],
    sample_rate_hz: u32,
    path: &Path,
) -> Result<AudioSummary, String> {
    let bytes = pcm_to_wav(channels, sample_rate_hz)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建音频目录失败：{error}"))?;
    }
    fs::write(path, &bytes).map_err(|error| format!("写 WAV 文件失败：{error}"))?;
    Ok(AudioSummary {
        file: path.to_string_lossy().to_string(),
        size: bytes.len() as u64,
        frames: channels.first().map_or(0, |channel| channel.len() as u64),
        channels: channels.len(),
        sample_rate_hz,
    })
}

/**
 * 输出经典版项目的结构摘要（只读结构，不解析像素）。
 * @param project_json 经典版项目 JSON 文本
 * @returns {Result<Value, String>} 名称/版本/场景数/时长/帧率/画布
 */
pub fn project_info(project_json: &str) -> Result<Value, String> {
    let view = read_classic_project(project_json).map_err(|error| error.to_string())?;
    Ok(json!({
        "name": view.name,
        "version": view.version,
        "sceneCount": view.scene_count,
        "durationTicks": view.duration_ticks,
        "fps": {
            "numerator": view.fps.numerator,
            "denominator": view.fps.denominator,
        },
        "canvas": {
            "width": view.canvas.width,
            "height": view.canvas.height,
        },
    }))
}

/** 从 JSON 文本解析导出配置。 */
pub fn parse_profile(text: &str) -> Result<ExportProfile, String> {
    serde_json::from_str(text).map_err(|error| format!("解析导出配置失败：{error}"))
}

/** 从 JSON 文本解析帧参数。 */
pub fn parse_params(text: &str) -> Result<FrameParams, String> {
    serde_json::from_str(text).map_err(|error| format!("解析帧参数失败：{error}"))
}

/** 把 JSON 文本解析为任意值（供 main 透传）。 */
pub fn parse_json(text: &str) -> Result<Value, String> {
    serde_json::from_str(text).map_err(|error| format!("解析 JSON 失败：{error}"))
}

/**
 * 从 JSON 解析 planar PCM：`{"sampleRateHz":48000,"channels":[[0.0,...],...]}`。
 * @param text JSON 文本
 * @returns {Result<(Vec<Vec<f32>>, u32), String>} (planar 采样, 采样率)；格式非法给中文错误
 */
pub fn parse_pcm_json(text: &str) -> Result<(Vec<Vec<f32>>, u32), String> {
    let value: Value =
        serde_json::from_str(text).map_err(|error| format!("解析 PCM JSON 失败：{error}"))?;
    let sample_rate_hz = value
        .get("sampleRateHz")
        .and_then(Value::as_u64)
        .ok_or_else(|| "PCM 缺少 sampleRateHz（正整数）".to_owned())?;
    let sample_rate_hz =
        u32::try_from(sample_rate_hz).map_err(|_| "sampleRateHz 超出 u32 范围".to_owned())?;
    let channel_values = value
        .get("channels")
        .and_then(Value::as_array)
        .ok_or_else(|| "PCM 缺少 channels（数组的数组）".to_owned())?;

    // 显式循环解析每个声道的采样，避免闭包里 `?` 与错误类型推断歧义。
    let mut channels: Vec<Vec<f32>> = Vec::with_capacity(channel_values.len());
    for (index, channel) in channel_values.iter().enumerate() {
        let samples = channel
            .as_array()
            .ok_or_else(|| format!("第 {index} 个声道必须是采样数组"))?;
        let mut parsed = Vec::with_capacity(samples.len());
        for (sample_index, sample) in samples.iter().enumerate() {
            let number = sample
                .as_f64()
                .ok_or_else(|| format!("第 {index} 声道第 {sample_index} 个采样必须是数字"))?;
            parsed.push(number as f32);
        }
        channels.push(parsed);
    }
    Ok((channels, sample_rate_hz))
}
