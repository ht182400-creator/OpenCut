//! W-13 第二批回归（2/2）：project-info 子命令与异常分支。

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

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
fn project_info_prints_classic_project_summary() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/web/public/fixtures/classic-project-v31.json");
    let info = json_stdout(
        &cli()
            .args(["project-info", "--project", fixture.to_str().unwrap()])
            .output()
            .expect("CLI 应可启动"),
    );
    assert_eq!(info["version"], 31);
    assert!(info["sceneCount"].as_u64().expect("sceneCount") >= 1);
    assert!(!info["name"].as_str().expect("name").is_empty());
}

#[test]
fn unknown_command_fails_with_chinese_message() {
    let run = cli().args(["nope"]).output().expect("CLI 应可启动");
    assert!(!run.status.success());
    assert!(String::from_utf8_lossy(&run.stderr).contains("未知子命令"));
}

#[test]
fn missing_required_flag_fails_with_usage_hint() {
    let run = cli().args(["frame"]).output().expect("CLI 应可启动");
    assert!(!run.status.success());
    assert!(String::from_utf8_lossy(&run.stderr).contains("缺少 --profile"));
}
