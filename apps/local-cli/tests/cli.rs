//! W-13 第二批回归（1/2）：Headless CLI 的 frame / batch 子命令。
//! 跨栈像素对比见 `apps/local-mcp/server.test.mjs`；项目摘要见 `cli_project.rs`。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

const PROFILE: &str = r#"{"container":"mp4","codec":"avc","width":8,"height":4,"frameRate":{"numerator":30,"denominator":1},"videoBitrateBps":1000000,"includeAudio":true,"audioSampleRateHz":48000,"audioChannels":2}"#;
const PARAMS: &str = r#"{"backgroundRgba":[10,20,30,255],"accentRgba":[100,150,200,255],"opacity":1,"positionX":0.5,"positionY":0.5}"#;
const PPM_HEADER: &[u8] = b"P6\n8 4\n255\n";
const PPM_BODY: usize = 8 * 4 * 3;

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
fn frame_command_writes_ppm_and_prints_summary() {
    let dir = temp_dir("frame");
    let profile = write_fixture(&dir, "profile.json", PROFILE);
    let params = write_fixture(&dir, "params.json", PARAMS);
    let out = dir.join("out");
    let summary = json_stdout(
        &cli()
            .args([
                "frame",
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
                out.to_str().unwrap(),
                "--name",
                "clip",
            ])
            .output()
            .expect("CLI 应可启动"),
    );
    assert_eq!(summary["frameIndex"], 3);
    let ppm = fs::read(summary["file"].as_str().unwrap()).expect("PPM 应已写出");
    assert!(ppm.starts_with(PPM_HEADER));
    assert_eq!(ppm.len(), PPM_HEADER.len() + PPM_BODY);
}

#[test]
fn batch_command_writes_all_frames_with_stable_checksums() {
    let dir = temp_dir("batch");
    let profile = write_fixture(&dir, "profile.json", PROFILE);
    let params = write_fixture(&dir, "params.json", PARAMS);
    let out = dir.join("out");
    let summaries: Vec<Value> = serde_json::from_value(json_stdout(
        &cli()
            .args([
                "batch",
                "--profile",
                &profile,
                "--params",
                &params,
                "--count",
                "3",
                "--duration-ticks",
                "4000",
                "--out",
                out.to_str().unwrap(),
            ])
            .output()
            .expect("CLI 应可启动"),
    ))
    .expect("stdout 应为 JSON 数组");
    assert_eq!(summaries.len(), 3);
    assert_eq!(summaries[0]["frameIndex"], 0);
    assert_eq!(summaries[2]["frameIndex"], 2);
    let single = json_stdout(
        &cli()
            .args([
                "frame",
                "--profile",
                &profile,
                "--params",
                &params,
                "--frame-index",
                "2",
                "--time-ticks",
                "8000",
                "--duration-ticks",
                "4000",
                "--out",
                dir.join("single").to_str().unwrap(),
            ])
            .output()
            .expect("CLI 应可启动"),
    );
    assert_eq!(summaries[2]["checksum"], single["checksum"]);
}
