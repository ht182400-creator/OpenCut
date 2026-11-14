//! OpenCut 示例 WASM 插件（W-12 第二批）。
//!
//! ABI 约定（与 `apps/web/src/local/plugin-runtime.ts` 一致）：
//! - 宿主先调 `ocx_alloc(len)` 拿到输入缓冲指针，把 JSON 输入写入线性内存；
//! - 再调以 `effect_` / `command_` 为前缀的导出函数 `(ptr: i32, len: i32) -> i64`；
//! - 返回值 `i64 = (ptr << 32) | len`，指向插件内分配的 JSON 输出；
//! - 宿主读取后调 `ocx_dealloc(ptr, len)` 归还。
//!
//! 本插件只做纯计算，不导入任何宿主函数，因此天然运行在无网络、无文件系统的
//! 沙箱边界内。

use serde_json::{Value, json};
use std::alloc::{Layout, alloc, dealloc};

/** 为宿主分配一段线性内存。 */
#[unsafe(no_mangle)]
pub extern "C" fn ocx_alloc(len: i32) -> i32 {
    if len <= 0 {
        return 0;
    }
    let Ok(layout) = Layout::from_size_align(len as usize, 1) else {
        return 0;
    };
    unsafe { alloc(layout) as i32 }
}

/** 归还宿主读完后不再需要的插件内存。 */
#[unsafe(no_mangle)]
pub extern "C" fn ocx_dealloc(ptr: i32, len: i32) {
    if ptr == 0 || len <= 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len as usize, 1) {
        unsafe { dealloc(ptr as *mut u8, layout) };
    }
}

/** 从线性内存读出宿主写入的 JSON 输入。 */
fn read_input(ptr: i32, len: i32) -> Vec<u8> {
    if ptr == 0 || len <= 0 {
        return Vec::new();
    }
    unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize).to_vec() }
}

/** 把 JSON 输出写进新分配的内存，返回 `(ptr << 32) | len`。 */
fn write_output(bytes: &[u8]) -> i64 {
    let Ok(layout) = Layout::from_size_align(bytes.len().max(1), 1) else {
        return 0;
    };
    let ptr = unsafe { alloc(layout) } as i64;
    if ptr == 0 {
        return 0;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
    }
    (ptr << 32) | (bytes.len() as i64 & 0xFFFF_FFFF)
}

/** 解析输入 JSON，失败时返回错误信封。 */
fn parse_input(ptr: i32, len: i32) -> Result<Value, i64> {
    serde_json::from_slice(&read_input(ptr, len))
        .map_err(|error| write_output(json!({ "error": error.to_string() }).to_string().as_bytes()))
}

/** brightness effect：把输入的 amount 翻倍返回。 */
#[unsafe(no_mangle)]
pub extern "C" fn effect_brightness(ptr: i32, len: i32) -> i64 {
    let Ok(payload) = parse_input(ptr, len) else {
        return 0;
    };
    let Some(amount) = payload["amount"].as_f64() else {
        return write_output(json!({ "error": "缺少 amount" }).to_string().as_bytes());
    };
    write_output(json!({ "brightness": amount * 2.0 }).to_string().as_bytes())
}

/** ping command：原样回显输入的 value。 */
#[unsafe(no_mangle)]
pub extern "C" fn command_ping(ptr: i32, len: i32) -> i64 {
    let Ok(payload) = parse_input(ptr, len) else {
        return 0;
    };
    write_output(
        json!({ "pong": payload["value"].clone() })
            .to_string()
            .as_bytes(),
    )
}
