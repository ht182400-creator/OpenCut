//! native-only 受控 I/O 的字符串层安全校验（W-12 第八、九批）。
//!
//! 本模块只做**纯字符串校验**（不触碰文件系统与网络），因此 wasm32 也能编译，
//! 供 WASM glue 复用同一套规则。真实 I/O 在 `runtime.rs` 的
//! `#[cfg(not(target_arch = "wasm32"))]` 块内执行，二者共用这里的判定函数。
//!
//! 设计原则（capability-based security）：
//! - 路径：只接受相对 POSIX 风格键 `相对/路径`，拒绝绝对路径、`..` 段、`.` 段、NUL、反斜杠；
//!   真实根目录下的 symlink 逃逸由 runtime 的 `canonicalize` + `strip_prefix` 兜底。
//! - URL：只接受 `http` / `https`，必须有主机，拒绝内嵌用户名密码、fragment；
//!   安全上下文由 host 的 scope 白名单（deny-by-default）保证。

use std::path::Path;

use crate::model::{
    MAX_FILE_KEY_LEN, MAX_NETWORK_BYTES, MAX_SCOPE_LEN, PluginError, SCOPE_WILDCARD,
};

/// 判定字符是否属于 URL/路径的非法控制字符（含 NUL 与其余 C0 控制字符）。
fn has_control_char(value: &str) -> bool {
    value.chars().any(|ch| ch.is_control())
}

/**
 * 校验文件读取 scope 的命名空间与相对路径段（字符串层，不访问文件系统）。
 * 允许 `assets:*` 通配整段，或 `assets:images/logo.png` 精确相对路径。
 * @param scope 形如 `namespace:relative/path` 的 scope 字符串
 * @returns {Result<(), PluginError>} 合法通过，非法返回 `INVALID_SCOPE`
 */
pub fn validate_file_scope(shape: &str) -> Result<(), PluginError> {
    if shape.is_empty() || shape.len() > MAX_SCOPE_LEN {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    if has_control_char(shape) {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    let (namespace, relative) = shape
        .split_once(':')
        .ok_or_else(|| PluginError::InvalidScope(shape.to_owned()))?;
    if namespace.is_empty() || namespace == SCOPE_WILDCARD || namespace.contains('/') {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    // 整段通配只允许资源段单独为 `*`。
    if relative == SCOPE_WILDCARD {
        return Ok(());
    }
    validate_relative_path(relative)?;
    Ok(())
}

/**
 * 校验相对路径段：非空、无绝对路径、无 `..` / `.` 段、无反斜杠、长度受限。
 * @param relative 相对路径字符串
 * @returns {Result<(), PluginError>} 合法通过，非法返回 `INVALID_SCOPE`
 */
pub fn validate_relative_path(relative: &str) -> Result<(), PluginError> {
    if relative.is_empty() || relative.len() > MAX_FILE_KEY_LEN || has_control_char(relative) {
        return Err(PluginError::InvalidScope(relative.to_owned()));
    }
    if relative.starts_with('/') || relative.contains('\\') || relative.contains(SCOPE_WILDCARD) {
        return Err(PluginError::InvalidScope(relative.to_owned()));
    }
    // 纯字符串层拒绝 `..` 段与显式 `.` 段（Rust Components 会归约 CurDir，故额外做字面判定）；
    // 真实 symlink 逃逸由 runtime 的 canonicalize 兜底。
    if relative.split('/').any(|segment| segment == "." || segment == "..") {
        return Err(PluginError::InvalidScope(relative.to_owned()));
    }
    if Path::new(relative)
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(PluginError::InvalidScope(relative.to_owned()));
    }
    Ok(())
}

/**
 * 校验网络 scope：形如 `https:example.com/path`，命名空间为协议，资源段为主机 + 路径。
 * `https:*` 表示允许该协议下全部主机；不支持 `https:exa*mple.com` 部分通配。
 * @param shape 形如 `scheme:host/path` 的 scope 字符串
 * @returns {Result<(), PluginError>} 合法通过，非法返回 `INVALID_SCOPE`
 */
pub fn validate_network_scope(shape: &str) -> Result<(), PluginError> {
    if shape.is_empty() || shape.len() > MAX_SCOPE_LEN || has_control_char(shape) {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    let (scheme, authority) = shape
        .split_once(':')
        .ok_or_else(|| PluginError::InvalidScope(shape.to_owned()))?;
    if scheme != "http" && scheme != "https" {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    if authority == SCOPE_WILDCARD {
        return Ok(());
    }
    if authority.is_empty() || authority.contains('*') {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    // 主机段必须存在且不含凭据（'@'）与空白。
    let host = authority.split('/').next().unwrap_or("");
    if host.is_empty() || host.contains('@') || host.chars().any(char::is_whitespace) {
        return Err(PluginError::InvalidScope(shape.to_owned()));
    }
    Ok(())
}

/**
 * 校验插件请求的网络 URL：仅 http/https、必须有主机、无内嵌凭据、无 fragment、长度受限。
 * 这是**字符串层**判定，不发起请求；真正请求前还会经 scope 白名单二次校验。
 * @param url 插件提供的 URL 字符串
 * @returns {Result<(String, String), PluginError>} 返回 (协议, 主机) 供 scope 匹配
 */
pub fn parse_request_url(url: &str) -> Result<(String, String), PluginError> {
    if url.is_empty() || url.len() > MAX_SCOPE_LEN || has_control_char(url) {
        return Err(PluginError::InvalidUrl(url.to_owned()));
    }
    if url.contains('#') {
        return Err(PluginError::InvalidUrl(url.to_owned()));
    }
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| PluginError::InvalidUrl(url.to_owned()))?;
    if scheme != "http" && scheme != "https" {
        return Err(PluginError::InvalidUrl(url.to_owned()));
    }
    let authority = rest.split('/').next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err(PluginError::InvalidUrl(url.to_owned()));
    }
    // 去掉可选端口，仅保留主机名用于 scope 匹配。
    let host = authority.split(':').next().unwrap_or("");
    if host.is_empty() {
        return Err(PluginError::InvalidUrl(url.to_owned()));
    }
    Ok((scheme.to_owned(), host.to_owned()))
}

/**
 * 校验待写入的输出缓冲参数：指针非零、容量在 (0, MAX_NETWORK_BYTES] 范围内。
 * @param out_ptr 线性内存输出指针
 * @param out_cap 输出缓冲容量
 * @returns {Result<(), PluginError>} 合法通过，非法返回 `INVALID_OUTPUT`
 */
pub fn validate_output_buffer(out_ptr: i32, out_cap: i32) -> Result<(), PluginError> {
    if out_ptr <= 0 || out_cap <= 0 || out_cap as usize > MAX_NETWORK_BYTES {
        return Err(PluginError::InvalidOutput);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 合法文件 scope：精确相对路径与整段通配。 */
    #[test]
    fn valid_file_scopes() {
        assert!(validate_file_scope("assets:images/logo.png").is_ok());
        assert!(validate_file_scope("assets:*").is_ok());
        assert!(validate_file_scope("docs:readme.txt").is_ok());
    }

    /** 非法文件 scope：绝对路径、.. 段、反斜杠、控制字符、缺分隔符、通配命名空间。 */
    #[test]
    fn invalid_file_scopes_rejected() {
        for bad in [
            "assets:../secret.txt",
            "assets:/etc/passwd",
            "assets:a\\b",
            "assets:a/./b",
            "assets:a\0b",
            "no-separator",
            "*:any",
            "assets:pre*fix",
        ] {
            assert_eq!(
                validate_file_scope(bad).unwrap_err().code(),
                "INVALID_SCOPE",
                "{bad} 应拒绝"
            );
        }
    }

    /** 合法网络 scope：http/https 精确主机与整段通配。 */
    #[test]
    fn valid_network_scopes() {
        assert!(validate_network_scope("https:example.com/api").is_ok());
        assert!(validate_network_scope("https:*").is_ok());
        assert!(validate_network_scope("http:localhost:8080/health").is_ok());
    }

    /** 非法网络 scope：非 http/https、凭据、部分通配、空主机。 */
    #[test]
    fn invalid_network_scopes_rejected() {
        for bad in ["ftp:example.com", "https:user@example.com", "https:exa*mple.com", "https:"] {
            assert_eq!(
                validate_network_scope(bad).unwrap_err().code(),
                "INVALID_SCOPE",
                "{bad} 应拒绝"
            );
        }
    }

    /** URL 解析：提取协议与主机（去端口），拒绝凭据/fragment/非 http。 */
    #[test]
    fn request_url_parsing() {
        assert_eq!(
            parse_request_url("https://example.com:8443/a/b").unwrap(),
            ("https".to_owned(), "example.com".to_owned())
        );
        for bad in ["ftp://x", "https://user@x", "https://x/#frag", "not-a-url"] {
            assert_eq!(
                parse_request_url(bad).unwrap_err().code(),
                "INVALID_URL",
                "{bad} 应拒绝"
            );
        }
    }

    /** 输出缓冲边界。 */
    #[test]
    fn output_buffer_bounds() {
        assert!(validate_output_buffer(1024, MAX_NETWORK_BYTES as i32).is_ok());
        for (ptr, cap) in [(0, 10), (1024, 0), (1024, -1), (1024, MAX_NETWORK_BYTES as i32 + 1)] {
            assert_eq!(validate_output_buffer(ptr, cap).unwrap_err().code(), "INVALID_OUTPUT");
        }
    }
}
