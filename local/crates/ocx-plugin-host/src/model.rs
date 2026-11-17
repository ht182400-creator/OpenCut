//! 插件 manifest 与稳定错误码（W-12 第一批）。
//!
//! additive-only：字段只增不改，未知字段忽略；旧 manifest 缺字段按当前 v1 兼容。
//! 本批只做「契约 + 权限 + 注册」，不加载真实 WASM 插件运行时（Extism / WIT 后置）。

use std::fmt;

use serde::{Deserialize, Serialize};

/// host 可授予的插件权限：core 能力 + 插件专有权限。
pub const PLUGIN_PERMISSIONS: &[&str] = &[
    "command",
    "undo-redo",
    "snapshot",
    "discover",
    "effect",
    "media-read",
    "export",
];
/// 注册 effect 必需声明的能力。
pub const PERMISSION_EFFECT: &str = "effect";
/// 注册 command 必需声明的能力。
pub const PERMISSION_COMMAND: &str = "command";
/// manifest 契约版本。
pub const PLUGIN_MANIFEST_VERSION: u32 = 1;

// ---- W-12 第三批：wasmi 运行时的细粒度权限与资源上限 ----
/// 单次插件调用的默认 fuel 上限（防死循环/算力 DoS）。
pub const DEFAULT_FUEL_LIMIT: u64 = 10_000_000;
/// 插件返回 JSON 的最大字节数（防恶意巨型输出 OOM）。
pub const MAX_OUTPUT_BYTES: usize = 1_048_576;
/// 插件输入 JSON 的最大字节数。
pub const MAX_INPUT_BYTES: usize = 1_048_576;
/// 指针为 0 视为空指针（宿主不读取/解引用）。
pub const NULL_POINTER: i64 = 0;

/// 插件清单；camelCase 与 WASM / TS 侧一致。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub api_version: String,
    #[serde(default)]
    pub schema_version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub effects: Vec<String>,
    #[serde(default)]
    pub commands: Vec<String>,
}

/// 稳定错误码：跨语言映射用 `code()`，越权项用 `denied()` 携带。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginError {
    InvalidManifest,
    MissingName,
    EmptyRegistration,
    ApiVersionMismatch,
    SchemaVersionMismatch,
    UnknownPermission(Vec<String>),
    PermissionDenied(Vec<String>),
    CapabilityNotGranted(Vec<String>),
    DuplicatePlugin,
    UnknownPlugin,
    UnknownEffect,
    UnknownCommand,
    HandlerFailed,
    // ---- 运行时细粒度权限错误 ----
    /// 插件 WASM 模块无法解析/校验。
    InvalidWasm,
    /// 模块含宿主未提供的导入（沙箱要求零导入）。
    DisallowedImport,
    /// 调用超出 manifest 声明的 effect/command 白名单。
    ExportNotDeclared(String),
    /// fuel 耗尽（死循环或超算力）。
    FuelExhausted,
    /// 插件输出指针/长度越界或超过上限。
    InvalidOutput,
    /// 插件输入超过上限。
    InputTooLarge,
    /// 线性内存访问越界。
    MemoryOutOfBounds,
}

impl PluginError {
    /// 稳定错误码字符串。
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidManifest => "INVALID_MANIFEST",
            Self::MissingName => "MISSING_NAME",
            Self::EmptyRegistration => "EMPTY_REGISTRATION",
            Self::ApiVersionMismatch => "API_VERSION_MISMATCH",
            Self::SchemaVersionMismatch => "SCHEMA_VERSION_MISMATCH",
            Self::UnknownPermission(_) => "UNKNOWN_PERMISSION",
            Self::PermissionDenied(_) => "PERMISSION_DENIED",
            Self::CapabilityNotGranted(_) => "CAPABILITY_NOT_GRANTED",
            Self::DuplicatePlugin => "DUPLICATE_PLUGIN",
            Self::UnknownPlugin => "UNKNOWN_PLUGIN",
            Self::UnknownEffect => "UNKNOWN_EFFECT",
            Self::UnknownCommand => "UNKNOWN_COMMAND",
            Self::HandlerFailed => "HANDLER_FAILED",
            Self::InvalidWasm => "INVALID_WASM",
            Self::DisallowedImport => "DISALLOWED_IMPORT",
            Self::ExportNotDeclared(_) => "EXPORT_NOT_DECLARED",
            Self::FuelExhausted => "FUEL_EXHAUSTED",
            Self::InvalidOutput => "INVALID_OUTPUT",
            Self::InputTooLarge => "INPUT_TOO_LARGE",
            Self::MemoryOutOfBounds => "MEMORY_OUT_OF_BOUNDS",
        }
    }

    /// 与错误相关的能力/权限清单（用于诊断）。
    pub fn denied(&self) -> &[String] {
        match self {
            Self::UnknownPermission(items)
            | Self::PermissionDenied(items)
            | Self::CapabilityNotGranted(items) => items,
            _ => &[],
        }
    }
}

impl fmt::Display for PluginError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            Self::InvalidManifest => "插件清单不是合法 JSON",
            Self::MissingName => "插件清单缺少 name",
            Self::EmptyRegistration => "插件未注册任何 effect 或 command",
            Self::ApiVersionMismatch => "插件 API 版本与 core 不匹配",
            Self::SchemaVersionMismatch => "插件 schema 版本与 core 不匹配",
            Self::UnknownPermission(_) => "插件声明了 host 不认识的权限",
            Self::PermissionDenied(_) => "插件声明了 host 未授予的权限",
            Self::CapabilityNotGranted(_) => "注册项缺少必需能力声明",
            Self::DuplicatePlugin => "同名插件已注册",
            Self::UnknownPlugin => "插件尚未注册",
            Self::UnknownEffect => "未注册的 effect",
            Self::UnknownCommand => "未注册的 command",
            Self::HandlerFailed => "插件处理器执行失败",
            Self::InvalidWasm => "WASM 模块无法解析或校验",
            Self::DisallowedImport => "插件声明了宿主未提供的导入（沙箱要求零导入）",
            Self::ExportNotDeclared(name) => {
                return write!(formatter, "{}：导出 {name} 未在 manifest 声明", self.code());
            }
            Self::FuelExhausted => "插件执行 fuel 耗尽（疑似死循环或超算力）",
            Self::InvalidOutput => "插件输出指针/长度非法或超过上限",
            Self::InputTooLarge => "插件输入超过上限",
            Self::MemoryOutOfBounds => "插件线性内存访问越界",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

/// 注册成功后 host 保存的视图。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub name: String,
    pub version: String,
    pub schema_version: String,
    pub capabilities: Vec<String>,
    pub effects: Vec<String>,
    pub commands: Vec<String>,
}

/// 注册结果信封：成功给 registration，失败给 error + denied。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registration: Option<Registration>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub denied: Vec<String>,
}

impl RegisterResult {
    /// 成功结果。
    pub fn success(registration: Registration) -> Self {
        Self {
            ok: true,
            registration: Some(registration),
            error: None,
            denied: Vec::new(),
        }
    }

    /// 失败结果。
    pub fn failure(error: &PluginError) -> Self {
        Self {
            ok: false,
            registration: None,
            error: Some(error.code().to_owned()),
            denied: error.denied().to_vec(),
        }
    }
}
