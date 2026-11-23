//! W-12 第九批回归：`ocx.net_fetch` 受控网络抓取（native-only）。
//!
//! 用本地 TcpListener 起最小 HTTP 服务（零外部网络依赖），配合 `wat` 生成的最小插件
//! 验证：授予主机可抓取 / 越权主机拒绝 / 非法 URL / 未开启能力 / HTTP 错误状态码。
//! 本测试文件整体在 wasm32 下不编译（真实网络 I/O 仅 native 存在）。

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;

use ocx_plugin_host::{
    PluginError, check_manifest,
    runtime::{HostState, load_plugin_with_resources},
};
use serde_json::json;

/**
 * 生成把指定 URL 写死到线性内存、调用 `ocx.net_fetch` 并把结果原样输出的最小插件 WAT。
 * @param url 形如 `http://127.0.0.1:PORT/path` 的 URL
 * @returns {String} 可编译的 WAT 文本
 */
fn wat_for_net_fetch(url: &str) -> String {
    let bytes = url.as_bytes();
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
  (import "ocx" "net_fetch" (func $fetch (param i32 i32 i32 i32) (result i64)))
  (memory (export "memory") 2)
  (func (export "ocx_alloc") (param $n i32) (result i32) i32.const 65536)
  (func (export "ocx_dealloc") (param $ptr i32) (param $n i32))
  (func (export "effect_brightness") (param $ptr i32) (param $n i32) (result i64)
{stores}    i32.const 1024  i32.const {url_len}  i32.const 2048  i32.const 262144
    call $fetch
    i64.const 2048  i64.const 32  i64.shl
    i64.or)
)
"#,
        stores = stores,
        url_len = bytes.len()
    )
}

/**
 * 构造声明 network-fetch scope 的 manifest。
 * @param scopes scope 列表（如 `http:127.0.0.1`）
 * @returns {String} manifest JSON
 */
fn manifest_with_scopes(scopes: &[&str]) -> String {
    let scope_items = scopes
        .iter()
        .map(|scope| format!("\"{scope}\""))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"{{
  "name": "net-probe",
  "version": "1.0.0",
  "apiVersion": "0.1.0",
  "schemaVersion": "1",
  "capabilities": ["network-fetch", "effect"],
  "effects": ["brightness"],
  "commands": [],
  "permissionScopes": {{ "network-fetch": [{scope_items}] }}
}}"#
    )
}

/**
 * 构造授予 network-fetch scope 的宿主状态。
 * @param scopes 授予的 scope 列表
 * @param network 是否显式开启真实网络
 * @returns {HostState} 宿主状态
 */
fn host_state(scopes: &[&str], network: bool) -> HostState {
    let mut granted = BTreeMap::new();
    granted.insert(
        "network-fetch".to_owned(),
        scopes.iter().map(|scope| (*scope).to_owned()).collect(),
    );
    let state = HostState::new(granted, BTreeMap::new());
    if network {
        state.with_network()
    } else {
        state
    }
}

/**
 * 加载网络探测插件。
 * @param url 插件请求的 URL
 * @param state 宿主状态
 * @returns {ocx_plugin_host::runtime::LoadedPlugin} 已加载实例
 */
fn load_probe(url: &str, state: HostState) -> ocx_plugin_host::runtime::LoadedPlugin {
    let wasm = wat::parse_str(wat_for_net_fetch(url)).expect("测试 WAT 应可编译");
    let checked = check_manifest(
        &["network-fetch", "effect"],
        &manifest_with_scopes(&["http:*"]),
    );
    assert!(checked.ok, "manifest 应注册成功: {:?}", checked.error);
    load_plugin_with_resources(
        &wasm,
        checked.registration.unwrap(),
        &["network-fetch".to_owned(), "effect".to_owned()],
        state,
    )
    .expect("探测插件应加载成功")
}

/**
 * 在 127.0.0.1 的随机端口起一个只处理一次GET 的最小 HTTP 服务。
 * @param status_line 响应状态行（如 `HTTP/1.1 200 OK`）
 * @param body 响应体
 * @returns {(String, std::thread::JoinHandle<()>)} URL 与服务线程
 */
fn spawn_once_http(status_line: &'static str, body: &'static str) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("本地端口应可绑定");
    let port = listener.local_addr().expect("本地地址应可读取").port();
    let handle = std::thread::spawn(move || {
        // 只接受一次连接，避免测试结束端口悬挂。
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "{status_line}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    (format!("http://127.0.0.1:{port}/probe"), handle)
}

/** 等待服务线程结束，确保端口释放。 */
fn wait_server(handle: std::thread::JoinHandle<()>) {
    let _ = handle.join();
}

/// NF01：授予 `http:127.0.0.1` + 开启网络 → 真抓取本地 HTTP 响应体。
#[test]
fn net_fetch_returns_granted_url_body() {
    let (url, server) = spawn_once_http("HTTP/1.1 200 OK", r#"{"from":"net"}"#);
    let state = host_state(&["http:127.0.0.1"], true);
    let mut plugin = load_probe(&url, state);
    let output = plugin
        .call("effect_brightness", &json!({}), true)
        .expect("授予主机应可抓取");
    assert_eq!(output["from"], "net");
    wait_server(server);
}

/// NF02：宿主授予 `http:example.com`，插件请求 127.0.0.1 → SCOPE_DENIED。
#[test]
fn net_fetch_denies_out_of_scope_host() {
    let (url, server) = spawn_once_http("HTTP/1.1 200 OK", r#"{"denied":false}"#);
    // 服务无人连接会阻塞在 accept；用短超时后丢弃线程（native 测试进程退出即回收）。
    let state = host_state(&["http:example.com"], true);
    let mut plugin = load_probe(&url, state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::ScopeDenied(String::new()).code());
    assert!(error.to_string().contains("127.0.0.1"));
    drop(server);
}

/// NF03：非 http(s) URL → INVALID_URL（字符串层拒绝，不发起请求）。
#[test]
fn net_fetch_rejects_invalid_url() {
    let state = host_state(&["http:*"], true);
    let mut plugin = load_probe("ftp://127.0.0.1/x", state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::InvalidUrl(String::new()).code());
}

/// NF04：宿主未开启网络 → 能力函数不注入 → DISALLOWED_IMPORT（加载即失败）。
#[test]
fn net_fetch_without_host_opt_in_is_disallowed() {
    let wasm = wat::parse_str(wat_for_net_fetch("http://127.0.0.1/x")).expect("WAT 应可编译");
    let checked = check_manifest(
        &["network-fetch", "effect"],
        &manifest_with_scopes(&["http:*"]),
    );
    let state = host_state(&["http:*"], false);
    let result = load_plugin_with_resources(
        &wasm,
        checked.registration.unwrap(),
        &["network-fetch".to_owned(), "effect".to_owned()],
        state,
    );
    let error = match result {
        Ok(_) => panic!("未开启网络时含 net_fetch 导入的插件应加载失败"),
        Err(error) => error,
    };
    assert_eq!(error.code(), PluginError::DisallowedImport.code());
}

/// NF05：HTTP 500 → NETWORK_FAILED（状态码非 2xx 映射稳定错误码）。
#[test]
fn net_fetch_maps_http_error_status() {
    let (url, server) = spawn_once_http("HTTP/1.1 500 Internal Server Error", "boom");
    let state = host_state(&["http:127.0.0.1"], true);
    let mut plugin = load_probe(&url, state);
    let error = plugin
        .call("effect_brightness", &json!({}), true)
        .unwrap_err();
    assert_eq!(error.code(), PluginError::NetworkFailed(String::new()).code());
    assert!(error.to_string().contains("HTTP 500"));
    wait_server(server);
}

/// NF06：manifest 声明 ftp scope → 注册阶段被专用校验拒绝。
#[test]
fn manifest_rejects_non_http_scope() {
    let checked = check_manifest(
        &["network-fetch", "effect"],
        &manifest_with_scopes(&["ftp:example.com"]),
    );
    assert!(!checked.ok);
    assert_eq!(checked.error.as_deref(), Some("INVALID_SCOPE"));
}
