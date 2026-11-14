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
