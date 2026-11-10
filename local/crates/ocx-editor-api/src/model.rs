//! 编辑器 API 的数据模型：常量、稳定错误码、跨边界类型与两个核心 trait。
//!
//! 字段名与 TS 侧保持一致（camelCase）；新增字段只增不改（I-03）。

use std::fmt;

use ocx_time::MediaTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const API_VERSION: &str = "0.1.0";
pub const SCHEMA_VERSION: &str = "1";
/** 当前实现可接受的跨边界 schema 版本（additive-only，旧版本字段仍可读）。 */
pub const SUPPORTED_SCHEMA_VERSIONS: &[&str] = &["1"];
pub const BACKEND_IN_MEMORY: &str = "ocx-in-memory";
pub const COMMAND_ADD_CLIP: &str = "addClip";
pub const COMMAND_SET_PLAYHEAD: &str = "setPlayhead";
pub const COMMAND_CLEAR: &str = "clear";
pub const MAX_LABEL_CHARS: usize = 256;
pub const CAPABILITIES: [&str; 4] = ["command", "undo-redo", "snapshot", "discover"];

/// 稳定错误码，供 TS / MCP / 插件跨语言映射。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    UnsupportedCommand(String),
    InvalidPayload(String),
    VersionMismatch { expected: String, got: String },
    BackendAlreadyRegistered(String),
    HistoryEmpty,
    StateLocked,
}

impl ApiError {
    /// 返回稳定的机器可读错误码。
    pub fn code(&self) -> &'static str {
        match self {
            ApiError::UnsupportedCommand(_) => "UNSUPPORTED_COMMAND",
            ApiError::InvalidPayload(_) => "INVALID_PAYLOAD",
            ApiError::VersionMismatch { .. } => "VERSION_MISMATCH",
            ApiError::BackendAlreadyRegistered(_) => "BACKEND_ALREADY_REGISTERED",
            ApiError::HistoryEmpty => "HISTORY_EMPTY",
            ApiError::StateLocked => "STATE_LOCKED",
        }
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::UnsupportedCommand(kind) => write!(f, "不支持的命令：{kind}"),
            ApiError::InvalidPayload(reason) => write!(f, "命令参数无效：{reason}"),
            ApiError::VersionMismatch { expected, got } => {
                write!(f, "接口版本不匹配：需要 {expected}，收到 {got}")
            }
            ApiError::BackendAlreadyRegistered(id) => {
                write!(f, "core 后端已注册：{id}，禁止重复注册")
            }
            ApiError::HistoryEmpty => write!(f, "没有可撤销/重做的命令"),
            ApiError::StateLocked => write!(f, "编辑器状态暂时不可用，请稍后重试"),
        }
    }
}

impl std::error::Error for ApiError {}

/** 旧版 JSON 缺少 schemaVersion 时按 v1 处理（向后兼容，I-03）。 */
pub fn default_schema_version() -> String {
    SCHEMA_VERSION.to_owned()
}

/// 跨边界的命令信封；字段名与 TS 侧保持一致（camelCase）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    pub api_version: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
    pub command_id: String,
    pub kind: String,
    pub payload: Value,
}

/// 命令产生的事件，供 UI 订阅、脚本回放与协同映射。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub kind: String,
    pub payload: Value,
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
}

impl Event {
    /// 构造带当前 schema 版本的事件，避免每个命令重复填写。
    pub fn new(kind: impl Into<String>, payload: Value) -> Self {
        Self {
            kind: kind.into(),
            payload,
            schema_version: default_schema_version(),
        }
    }
}

/// 命令执行结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutcome {
    pub events: Vec<Event>,
    pub snapshot_id: u64,
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
}

/// 最小场景状态；W-05 会替换为完整的 `domain` 模型。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneState {
    pub ticks: i64,
    pub clip_count: u32,
    pub label: String,
}

/// 不可变场景快照，供 UI / 脚本 / MCP 消费。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneSnapshot {
    pub at_ticks: i64,
    pub state_ticks: i64,
    pub clip_count: u32,
    pub label: String,
    pub snapshot_id: u64,
    #[serde(default = "default_schema_version")]
    pub schema_version: String,
}

/// 能力发现结果，对齐 MCP `server/discover` 的思路。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub api_version: String,
    pub schema_version: String,
    pub backend_id: String,
    pub capabilities: Vec<String>,
    /// 供客户端做能力协商：本实现支持的全部 schema 版本。
    #[serde(default)]
    pub supported_schema_versions: Vec<String>,
}

/// 命令 trait：所有编辑操作都必须走这里，天然支持 undo、脚本与回放。
pub trait Command: Send + Sync {
    /// 命令类型标识，用于跨语言映射与上游 API 对照。
    fn kind(&self) -> &'static str;
    /// 执行并返回事件流。
    fn execute(&self, state: &mut SceneState) -> Result<Vec<Event>, ApiError>;
    /// 撤销：由事件流逆变换，不依赖对象身份。
    fn undo(&self, state: &mut SceneState, events: &[Event]) -> Result<(), ApiError>;
}

/// 编辑器核心唯一入口；切换上游 core 时只需替换实现。
pub trait EditorApi: Send + Sync {
    /// 能力发现。
    fn discover(&self) -> DiscoverResult;
    /// 执行命令并产生事件。
    fn execute(&self, command: CommandEnvelope) -> Result<CommandOutcome, ApiError>;
    /// 获取某时刻的不可变快照。
    fn snapshot(&self, at: MediaTime) -> Result<SceneSnapshot, ApiError>;
    /// 撤销最近一次命令。
    fn undo(&self) -> Result<CommandOutcome, ApiError>;
    /// 重做最近一次撤销的命令。
    fn redo(&self) -> Result<CommandOutcome, ApiError>;
}
