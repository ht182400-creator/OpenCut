//! W-11：`discover` 式能力协商。
//!
//! 客户端声明自己支持的 api/schema 版本与必需能力，服务端返回是否兼容、
//! 选用版本、缺失能力与稳定 reason 码。纯函数、无平台依赖，便于 golden 用例回归。

use serde::{Deserialize, Serialize};

use crate::model::{API_VERSION, CAPABILITIES, SUPPORTED_SCHEMA_VERSIONS};

pub const NEGOTIATE_OK: &str = "OK";
pub const NEGOTIATE_API_MISMATCH: &str = "API_VERSION_MISMATCH";
pub const NEGOTIATE_NO_COMMON_SCHEMA: &str = "NO_COMMON_SCHEMA";
pub const NEGOTIATE_MISSING_CAPABILITIES: &str = "MISSING_CAPABILITIES";

/// 客户端的能力声明；缺失字段按最保守的 v1 处理（向后兼容）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitiesRequest {
    #[serde(default)]
    pub api_version: String,
    #[serde(default)]
    pub schema_versions: Vec<String>,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
}

/// 协商结果；`compatible=false` 时仍给出 `schemaVersion` 便于诊断。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NegotiationResult {
    pub compatible: bool,
    pub schema_version: Option<String>,
    #[serde(default)]
    pub missing_capabilities: Vec<String>,
    pub reason: String,
}

impl NegotiationResult {
    /// 构造一份协商结果。
    fn build(
        compatible: bool,
        schema_version: Option<String>,
        missing_capabilities: Vec<String>,
        reason: &str,
    ) -> Self {
        Self {
            compatible,
            schema_version,
            missing_capabilities,
            reason: reason.to_owned(),
        }
    }
}

/** 本实现支持的 schema 版本（字符串切片转为拥有权）。 */
pub fn supported_versions() -> Vec<String> {
    SUPPORTED_SCHEMA_VERSIONS
        .iter()
        .map(|item| (*item).to_owned())
        .collect()
}

/**
 * 与客户端协商能力：先校验 API 版本，再取双方都支持的最高 schema 版本，
 * 最后检查必需能力是否齐备。旧客户端未声明版本时按当前 v1 兼容。
 * @param request 客户端声明
 * @returns {NegotiationResult} 协商结果
 */
pub fn negotiate(request: &CapabilitiesRequest) -> NegotiationResult {
    if !request.api_version.is_empty() && request.api_version != API_VERSION {
        return NegotiationResult::build(false, None, Vec::new(), NEGOTIATE_API_MISMATCH);
    }
    let offered: Vec<String> = if request.schema_versions.is_empty() {
        supported_versions()
    } else {
        request.schema_versions.clone()
    };
    let common = SUPPORTED_SCHEMA_VERSIONS
        .iter()
        .filter(|version| offered.iter().any(|item| item.as_str() == **version))
        .map(|version| (*version).to_owned())
        .next_back();
    let Some(schema_version) = common else {
        return NegotiationResult::build(false, None, Vec::new(), NEGOTIATE_NO_COMMON_SCHEMA);
    };
    let missing: Vec<String> = request
        .required_capabilities
        .iter()
        .filter(|required| !CAPABILITIES.contains(&required.as_str()))
        .cloned()
        .collect();
    if !missing.is_empty() {
        return NegotiationResult::build(
            false,
            Some(schema_version),
            missing,
            NEGOTIATE_MISSING_CAPABILITIES,
        );
    }
    NegotiationResult::build(true, Some(schema_version), Vec::new(), NEGOTIATE_OK)
}
