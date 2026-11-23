//! W-12 native I/O 上层入口回归：`ocx-cli plugin-io` 子命令。
//!
//! 用 `wat` 在测试期生成最小 wasm 插件（写文件 key、调用 `ocx.file_read`、原样输出），
//! 通过真实 CLI 进程验证：绑定目录可读出文件、越权被拒、参数缺失给中文错误。
//! 本测试整体在 wasm32 下不编译（真实文件 I/O 仅 native 存在）。

#![cfg(not(target_arch = "wasm32"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// 临时目录基名（进程内唯一）。
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ocx-cli-io-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("临时目录应可创建");
    dir
}

/**
 * 生成把 key 写死到线性内存、调用 `ocx.file_read` 并把结果原样输出的最小插件 WAT。
 * @param key 形如 `assets:probe.txt` 的文件键
 * @returns {String} 可编译 WAT
 */
fn wat_for_file_read(key: &str) -> String {
    let bytes = key.as_bytes();
    let mut stores = String::new();
    let mut offset = 1024usize;
    let mut index = 0usize;
    while index < bytes.len() {
        let mut word = 0u32;
        for byte_index in 0..4 {
            if index + byte_index < bytes.len() {
                word |= (bytes[index + byte_index] as u32) << (byte_index * 8);
            }
        }
        stores.push_str(&format!(
            "    i32.const {offset}  i32.const {word}  i32.store\n"
        ));
        offset += 4;
        index += 4;
    }
    format!(
        r#"
(module
  (import "ocx" "file_read" (func $read (param i32 i32 i32 i32) (result i64)))
  (memory (export "memory") 2)
  (func (export "ocx_alloc") (param $n i32) (result i32) i32.const 65536)
  (func (export "ocx_dealloc") (param $ptr i32) (param $n i32))
  (func (export "effect_brightness") (param $ptr i32) (param $n i32) (result i64)
{stores}    i32.const 1024  i32.const {key_len}  i32.const 2048  i32.const 262144
    call $read
    i64.const 2048  i64.const 32  i64.shl
    i64.or)
)
"#,
        stores = stores,
        key_len = bytes.len()
    )
}

/** 构造声明 file-read scope 的 manifest。 */
fn manifest(scope: &str) -> String {
    format!(
        r#"{{
  "name": "cli-io-probe",
  "version": "1.0.0",
  "apiVersion": "0.1.0",
  "schemaVersion": "1",
  "capabilities": ["file-read", "effect"],
  "effects": ["brightness"],
  "commands": [],
  "permissionScopes": {{ "file-read": ["{scope}"] }}
}}"#
    )
}

/** 构造 manifest，但 host 授予清单不含 file-read（用 capabilities 缺省 effect 模拟收紧）。 */
fn manifest_without_grant() -> String {
    r#"{
  "name": "cli-io-probe",
  "version": "1.0.0",
  "apiVersion": "0.1.0",
  "schemaVersion": "1",
  "capabilities": ["file-read", "effect"],
  "effects": ["brightness"],
  "commands": [],
  "permissionScopes": { "file-read": ["assets:*"] }
}"#
    .to_owned()
}

fn cli() -> Command {
    Command::new(env!("CARGO_BIN_EXE_ocx-cli"))
}

/** 写 fixture 文件并返回路径。 */
fn write_file(dir: &Path, name: &str, content: &[u8]) -> String {
    let path = dir.join(name);
    fs::write(&path, content).expect("fixture 应可写");
    path.to_string_lossy().to_string()
}

/** 运行 plugin-io 并解析 stdout JSON（断言成功）。 */
fn json_stdout(output: &std::process::Output) -> Value {
    assert!(
        output.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("stdout 应为 JSON")
}

/// PI01：绑定目录 + 授予 file-read → CLI 真读出文件内容并输出 JSON 摘要。
#[test]
fn plugin_io_reads_file_through_cli() {
    let dir = temp_dir("ok");
    let wasm = wat::parse_str(wat_for_file_read("assets:probe.txt"))
        .expect("测试 WAT 应可编译");
    let wasm_path = write_file(&dir, "probe.wasm", &wasm);
    let manifest_path = write_file(&dir, "manifest.json", manifest("assets:*").as_bytes());
    let payload_path = write_file(&dir, "payload.json", br#"{}"#);
    write_file(&dir, "probe.txt", br#"{"from":"cli-file"}"#);
    let output = cli()
        .args([
            "plugin-io",
            "--wasm",
            &wasm_path,
            "--manifest",
            &manifest_path,
            "--payload",
            &payload_path,
            "--file-root",
            &format!("assets={}", dir.to_string_lossy()),
            "--effect",
            "effect_brightness",
        ])
        .output()
        .expect("CLI 应可启动");
    let summary = json_stdout(&output);
    assert_eq!(summary["plugin"], "cli-io-probe");
    assert_eq!(summary["effect"], "effect_brightness");
    assert_eq!(summary["result"]["from"], "cli-file");
}

/// PI02：未绑定目录命名空间 → CLI 非零退出且 stderr 含稳定错误码 PATH_TRAVERSAL。
#[test]
fn plugin_io_reports_path_traversal_without_binding() {
    let dir = temp_dir("deny");
    let wasm = wat::parse_str(wat_for_file_read("assets:probe.txt"))
        .expect("测试 WAT 应可编译");
    let wasm_path = write_file(&dir, "probe.wasm", &wasm);
    let manifest_path = write_file(&dir, "manifest.json", manifest_without_grant().as_bytes());
    let payload_path = write_file(&dir, "payload.json", br#"{}"#);
    let output = cli()
        .args([
            "plugin-io",
            "--wasm",
            &wasm_path,
            "--manifest",
            &manifest_path,
            "--payload",
            &payload_path,
        ])
        .output()
        .expect("CLI 应可启动");
    assert!(!output.status.success(), "未绑定目录应失败");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("PATH_TRAVERSAL"),
        "应给出稳定错误码：{stderr}"
    );
}

/// PI03：缺少 --wasm → CLI 非零退出并给中文参数提示。
#[test]
fn plugin_io_requires_wasm_argument() {
    let dir = temp_dir("missing-arg");
    let manifest_path = write_file(&dir, "manifest.json", manifest("assets:*").as_bytes());
    let payload_path = write_file(&dir, "payload.json", br#"{}"#);
    let output = cli()
        .args([
            "plugin-io",
            "--manifest",
            &manifest_path,
            "--payload",
            &payload_path,
        ])
        .output()
        .expect("CLI 应可启动");
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("缺少 --wasm"), "{stderr}");
}

/// PI04：manifest 声明路径穿越 scope → 注册阶段拒绝，CLI 给 INVALID_SCOPE。
#[test]
fn plugin_io_rejects_traversal_scope() {
    let dir = temp_dir("bad-scope");
    let wasm = wat::parse_str(wat_for_file_read("assets:probe.txt"))
        .expect("测试 WAT 应可编译");
    let wasm_path = write_file(&dir, "probe.wasm", &wasm);
    let manifest_path = write_file(&dir, "manifest.json", manifest("assets:../secret").as_bytes());
    let payload_path = write_file(&dir, "payload.json", br#"{}"#);
    let output = cli()
        .args([
            "plugin-io",
            "--wasm",
            &wasm_path,
            "--manifest",
            &manifest_path,
            "--payload",
            &payload_path,
        ])
        .output()
        .expect("CLI 应可启动");
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("INVALID_SCOPE"), "{stderr}");
}

/// PI05：库层纯函数解析目录绑定（覆盖正常/异常，无需起进程）。
#[test]
fn parse_file_roots_through_public_api() {
    let parsed = ocx_cli::parse_file_roots(&["assets=/tmp/a".to_owned()]).unwrap();
    assert_eq!(parsed[0].namespace, "assets");
    assert_eq!(parsed[0].path, "/tmp/a");
    assert!(ocx_cli::parse_file_roots(&["bad".to_owned()]).is_err());
    // granted_from_manifest 为公开 API：缺 capabilities 时给中文错误。
    assert!(ocx_cli::granted_from_manifest(r#"{"name":"p"}"#).is_err());
}
