//! W-13 C 批回归：Headless CLI 的 frame-png / batch-png / audio-export 子命令。
//! PNG 由本仓库手写编码器生成（stored DEFLATE + CRC32），WAV 为 16-bit PCM。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

const PROFILE: &str = r#"{"container":"mp4","codec":"avc","width":8,"height":4,"frameRate":{"numerator":30,"denominator":1},"videoBitrateBps":1000000,"includeAudio":true,"audioSampleRateHz":48000,"audioChannels":2}"#;
const PARAMS: &str = r#"{"backgroundRgba":[10,20,30,255],"accentRgba":[100,150,200,255],"opacity":1,"positionX":0.5,"positionY":0.5}"#;
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ocx-cli-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("临时目录应可创建");
    dir
}

fn write_fixture(dir: &Path, name: &str, content: &str) -> String {
    let path = dir.join(name);
    fs::write(&path, content).expect("fixture 应可写");
    path.to_string_lossy().to_string()
}

fn cli() -> Command {
    Command::new(env!("CARGO_BIN_EXE_ocx-cli"))
}

fn json_stdout(run: &std::process::Output) -> Value {
    assert!(
        run.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&run.stdout),
        String::from_utf8_lossy(&run.stderr)
    );
    serde_json::from_slice(&run.stdout).expect("stdout 应为 JSON")
}

#[test]
fn frame_png_writes_valid_png_and_summary() {
    let dir = temp_dir("frame-png");
    let profile = write_fixture(&dir, "profile.json", PROFILE);
    let params = write_fixture(&dir, "params.json", PARAMS);
    let out = dir.join("out");
    let summary = json_stdout(
        &cli()
            .args([
                "frame-png",
                "--profile",
                &profile,
                "--params",
                &params,
                "--frame-index",
                "3",
                "--time-ticks",
                "12000",
                "--duration-ticks",
                "4000",
                "--out",
                &out.to_string_lossy(),
            ])
            .output()
            .expect("CLI 应可执行"),
    );
    assert_eq!(summary["frameIndex"], 3);
    let file = summary["file"].as_str().expect("file 应为字符串");
    assert!(file.ends_with("frame-000003.png"));
    let bytes = fs::read(file).expect("PNG 文件应可读");
    assert_eq!(&bytes[..8], &PNG_SIGNATURE, "PNG 签名应正确");
    assert_eq!(&bytes[12..16], b"IHDR", "首个 chunk 应为 IHDR");
    assert_eq!(&bytes[bytes.len() - 8..bytes.len() - 4], b"IEND");
    // 摘要 checksum 仍为 FNV-1a 十六进制（跨格式与 PPM/WASM 一致）。
    assert!(summary["checksum"].as_str().unwrap().starts_with("0x"));
}

#[test]
fn batch_png_writes_multiple_files_with_matching_checksum() {
    let dir = temp_dir("batch-png");
    let profile = write_fixture(&dir, "profile.json", PROFILE);
    let params = write_fixture(&dir, "params.json", PARAMS);
    let out = dir.join("out");
    let summaries = json_stdout(
        &cli()
            .args([
                "batch-png",
                "--profile",
                &profile,
                "--params",
                &params,
                "--count",
                "3",
                "--duration-ticks",
                "4000",
                "--out",
                &out.to_string_lossy(),
            ])
            .output()
            .expect("CLI 应可执行"),
    );
    let array = summaries.as_array().expect("应为数组");
    assert_eq!(array.len(), 3);
    for (index, item) in array.iter().enumerate() {
        assert_eq!(item["frameIndex"], index as u64);
        let file = item["file"].as_str().unwrap();
        let bytes = fs::read(file).expect("PNG 文件应可读");
        assert_eq!(&bytes[..8], &PNG_SIGNATURE);
    }
    // 同帧的 PNG 与 PPM checksum 应一致（都取 RGBA 全字节）。
    let ppm_out = dir.join("ppm");
    let ppm_summaries = json_stdout(
        &cli()
            .args([
                "batch",
                "--profile",
                &profile,
                "--params",
                &params,
                "--count",
                "1",
                "--duration-ticks",
                "4000",
                "--out",
                &ppm_out.to_string_lossy(),
            ])
            .output()
            .expect("CLI 应可执行"),
    );
    assert_eq!(
        ppm_summaries[0]["checksum"], array[0]["checksum"],
        "PNG 与 PPM 的帧 checksum 应一致"
    );
}

#[test]
fn audio_export_writes_valid_wav() {
    let dir = temp_dir("audio-export");
    let pcm = write_fixture(
        &dir,
        "pcm.json",
        r#"{"sampleRateHz":48000,"channels":[[0.0,0.5,-1.0]]}"#,
    );
    let out = dir.join("out.wav");
    let summary = json_stdout(
        &cli()
            .args([
                "audio-export",
                "--pcm",
                &pcm,
                "--out",
                &out.to_string_lossy(),
            ])
            .output()
            .expect("CLI 应可执行"),
    );
    assert_eq!(summary["frames"], 3);
    assert_eq!(summary["channels"], 1);
    assert_eq!(summary["sampleRateHz"], 48000);
    let bytes = fs::read(&out).expect("WAV 文件应可读");
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    assert_eq!(&bytes[12..16], b"fmt ");
    assert_eq!(&bytes[36..40], b"data");
    assert_eq!(bytes.len(), 44 + 3 * 2); // 3 帧 × i16
    // 0.5 → 16384（对称缩放 32767），-1.0 → -32767。
    assert_eq!(
        i16::from_le_bytes(bytes[44 + 2..44 + 4].try_into().unwrap()),
        16384
    );
    assert_eq!(
        i16::from_le_bytes(bytes[44 + 4..44 + 6].try_into().unwrap()),
        -32767
    );
}

#[test]
fn audio_export_rejects_bad_pcm() {
    let dir = temp_dir("audio-bad");
    let pcm = write_fixture(&dir, "pcm.json", r#"{"sampleRateHz":0,"channels":[[0.0]]}"#);
    let run = cli()
        .args([
            "audio-export",
            "--pcm",
            &pcm,
            "--out",
            &dir.join("bad.wav").to_string_lossy(),
        ])
        .output()
        .expect("CLI 应可执行");
    assert!(!run.status.success(), "采样率 0 应失败");
    assert!(String::from_utf8_lossy(&run.stderr).contains("采样率"));
}
