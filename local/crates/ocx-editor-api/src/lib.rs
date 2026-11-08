//! OpenCut 本地 core 的编辑器唯一入口（W-03 基石）。
//!
//! 设计约束见 `roadmap/COMPAT.md`：
//! - I-01 所有端/插件只通过本 crate 的 `EditorApi` 访问 core；
//! - I-03 跨边界数据版本化且字段只增不改；
//! - I-05 同一时刻只允许一个 core 后端被注册（`BackendRegistry`）。
//!
//! 本 crate 不含任何浏览器/平台依赖，Web 绑定与 TS 适配层在 W-06 接入。

use std::fmt;
use std::sync::{Mutex, OnceLock};

use ocx_time::MediaTime;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const API_VERSION: &str = "0.1.0";
pub const SCHEMA_VERSION: &str = "1";
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

/// 跨边界的命令信封；字段名与 TS 侧保持一致（camelCase）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    pub api_version: String,
    pub schema_version: String,
    pub command_id: String,
    pub kind: String,
    pub payload: Value,
}

/// 命令产生的事件，供 UI 订阅、脚本回放与协同映射。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub kind: String,
    pub payload: Value,
}

/// 命令执行结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutcome {
    pub events: Vec<Event>,
    pub snapshot_id: u64,
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
}

/// 能力发现结果，对齐 MCP `server/discover` 的思路。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub api_version: String,
    pub schema_version: String,
    pub backend_id: String,
    pub capabilities: Vec<String>,
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

/// 单后端注册器（I-05）：重复注册返回错误，测试可创建独立实例。
#[derive(Default)]
pub struct BackendRegistry {
    backend: OnceLock<String>,
}

impl BackendRegistry {
    /// 创建空注册器。
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册 core 后端标识；只允许一次，错误信息返回**已注册**的标识。
    pub fn register(&self, id: &str) -> Result<(), ApiError> {
        // OnceLock::set 的 Err 携带的是本次尝试写入的值，需读回已有值才能给出准确提示
        match self.backend.set(id.to_owned()) {
            Ok(()) => Ok(()),
            Err(_) => Err(ApiError::BackendAlreadyRegistered(
                self.backend.get().cloned().unwrap_or_default(),
            )),
        }
    }

    /// 当前已注册的后端标识。
    pub fn current(&self) -> Option<&str> {
        self.backend.get().map(String::as_str)
    }
}

/// 根据信封构造具体命令；未知 kind 或非法参数一律返回可映射的错误。
fn command_from(envelope: &CommandEnvelope) -> Result<Box<dyn Command>, ApiError> {
    if envelope.command_id.trim().is_empty() {
        return Err(ApiError::InvalidPayload("commandId 不能为空".to_owned()));
    }
    match envelope.kind.as_str() {
        COMMAND_ADD_CLIP => {
            let label = envelope
                .payload
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            if label.chars().count() > MAX_LABEL_CHARS {
                return Err(ApiError::InvalidPayload("label 超过长度上限".to_owned()));
            }
            let duration_ticks = envelope
                .payload
                .get("durationTicks")
                .and_then(Value::as_i64)
                .ok_or_else(|| ApiError::InvalidPayload("缺少 durationTicks".to_owned()))?;
            Ok(Box::new(AddClipCommand {
                label,
                duration_ticks,
            }))
        }
        COMMAND_SET_PLAYHEAD => {
            let ticks = envelope
                .payload
                .get("ticks")
                .and_then(Value::as_i64)
                .ok_or_else(|| ApiError::InvalidPayload("缺少 ticks".to_owned()))?;
            Ok(Box::new(SetPlayheadCommand { ticks }))
        }
        COMMAND_CLEAR => Ok(Box::new(ClearCommand)),
        other => Err(ApiError::UnsupportedCommand(other.to_owned())),
    }
}

/// 内置参考命令：新增片段。
struct AddClipCommand {
    label: String,
    duration_ticks: i64,
}

impl Command for AddClipCommand {
    fn kind(&self) -> &'static str {
        COMMAND_ADD_CLIP
    }

    fn execute(&self, state: &mut SceneState) -> Result<Vec<Event>, ApiError> {
        let previous_label = state.label.clone();
        state.clip_count = state.clip_count.saturating_add(1);
        state.ticks = state.ticks.saturating_add(self.duration_ticks);
        state.label = self.label.clone();
        Ok(vec![Event {
            kind: "clipAdded".to_owned(),
            payload: json!({
                "clipCount": state.clip_count,
                "ticks": state.ticks,
                "previousLabel": previous_label,
            }),
        }])
    }

    fn undo(&self, state: &mut SceneState, events: &[Event]) -> Result<(), ApiError> {
        state.clip_count = state.clip_count.saturating_sub(1);
        state.ticks = state.ticks.saturating_sub(self.duration_ticks);
        // 由事件流恢复旧标签，落实「事件即日志」而非依赖对象身份
        state.label = events
            .first()
            .and_then(|event| event.payload.get("previousLabel"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        Ok(())
    }
}

/// 内置参考命令：移动播放头。
struct SetPlayheadCommand {
    ticks: i64,
}

impl Command for SetPlayheadCommand {
    fn kind(&self) -> &'static str {
        COMMAND_SET_PLAYHEAD
    }

    fn execute(&self, state: &mut SceneState) -> Result<Vec<Event>, ApiError> {
        let previous = state.ticks;
        state.ticks = self.ticks;
        Ok(vec![Event {
            kind: "playheadMoved".to_owned(),
            payload: json!({ "ticks": state.ticks, "previousTicks": previous }),
        }])
    }

    fn undo(&self, state: &mut SceneState, events: &[Event]) -> Result<(), ApiError> {
        // 从事件流还原旧播放头，演示「事件即日志」的可回放性
        let previous = events
            .first()
            .and_then(|event| event.payload.get("previousTicks"))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        state.ticks = previous;
        Ok(())
    }
}

/// 内置参考命令：清空场景。
struct ClearCommand;

impl Command for ClearCommand {
    fn kind(&self) -> &'static str {
        COMMAND_CLEAR
    }

    fn execute(&self, state: &mut SceneState) -> Result<Vec<Event>, ApiError> {
        *state = SceneState::default();
        Ok(vec![Event {
            kind: "sceneCleared".to_owned(),
            payload: json!({ "clipCount": 0 }),
        }])
    }

    fn undo(&self, _state: &mut SceneState, _events: &[Event]) -> Result<(), ApiError> {
        // 清空命令的完整逆变换需要 W-05 的 domain 快照，此处显式返回错误而非静默成功
        Err(ApiError::InvalidPayload(
            "clear 暂不支持撤销，需 domain 快照".to_owned(),
        ))
    }
}

/// 历史条目：保存命令对象与其事件流，支持 undo/redo。
struct HistoryEntry {
    command: Box<dyn Command>,
    events: Vec<Event>,
}

/// 后端内部可变状态。
struct BackendInner {
    state: SceneState,
    undo_stack: Vec<HistoryEntry>,
    redo_stack: Vec<HistoryEntry>,
    snapshot_counter: u64,
}

/// 内置参考后端：无平台依赖，可作为扩展点与回归基线。
pub struct InMemoryBackend {
    inner: Mutex<BackendInner>,
}

impl InMemoryBackend {
    /// 创建初始状态的后端。
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(BackendInner {
                state: SceneState::default(),
                undo_stack: Vec::new(),
                redo_stack: Vec::new(),
                snapshot_counter: 0,
            }),
        }
    }

    /// 构造一个合法的命令信封，供 TS / 测试复用。
    pub fn envelope(kind: &str, command_id: &str, payload: Value) -> CommandEnvelope {
        CommandEnvelope {
            api_version: API_VERSION.to_owned(),
            schema_version: SCHEMA_VERSION.to_owned(),
            command_id: command_id.to_owned(),
            kind: kind.to_owned(),
            payload,
        }
    }

    /// 递增快照序号并返回新值。
    fn next_snapshot_id(inner: &mut BackendInner) -> u64 {
        inner.snapshot_counter = inner.snapshot_counter.saturating_add(1);
        inner.snapshot_counter
    }
}

impl Default for InMemoryBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl EditorApi for InMemoryBackend {
    fn discover(&self) -> DiscoverResult {
        DiscoverResult {
            api_version: API_VERSION.to_owned(),
            schema_version: SCHEMA_VERSION.to_owned(),
            backend_id: BACKEND_IN_MEMORY.to_owned(),
            capabilities: CAPABILITIES.iter().map(|item| (*item).to_owned()).collect(),
        }
    }

    fn execute(&self, command: CommandEnvelope) -> Result<CommandOutcome, ApiError> {
        if command.api_version != API_VERSION {
            return Err(ApiError::VersionMismatch {
                expected: API_VERSION.to_owned(),
                got: command.api_version,
            });
        }
        if command.schema_version != SCHEMA_VERSION {
            return Err(ApiError::VersionMismatch {
                expected: SCHEMA_VERSION.to_owned(),
                got: command.schema_version,
            });
        }
        let concrete = command_from(&command)?;
        let mut inner = self.inner.lock().map_err(|_| ApiError::StateLocked)?;
        let events = concrete.execute(&mut inner.state)?;
        inner.redo_stack.clear();
        let snapshot_id = Self::next_snapshot_id(&mut inner);
        inner.undo_stack.push(HistoryEntry {
            command: concrete,
            events: events.clone(),
        });
        Ok(CommandOutcome {
            events,
            snapshot_id,
        })
    }

    fn snapshot(&self, at: MediaTime) -> Result<SceneSnapshot, ApiError> {
        let inner = self.inner.lock().map_err(|_| ApiError::StateLocked)?;
        Ok(SceneSnapshot {
            at_ticks: at.as_ticks(),
            state_ticks: inner.state.ticks,
            clip_count: inner.state.clip_count,
            label: inner.state.label.clone(),
            snapshot_id: inner.snapshot_counter,
        })
    }

    fn undo(&self) -> Result<CommandOutcome, ApiError> {
        let mut inner = self.inner.lock().map_err(|_| ApiError::StateLocked)?;
        let entry = inner.undo_stack.pop().ok_or(ApiError::HistoryEmpty)?;
        // 撤销失败时把条目放回，避免历史被吞掉
        if let Err(error) = entry.command.undo(&mut inner.state, &entry.events) {
            inner.undo_stack.push(entry);
            return Err(error);
        }
        let snapshot_id = Self::next_snapshot_id(&mut inner);
        inner.redo_stack.push(entry);
        Ok(CommandOutcome {
            events: vec![Event {
                kind: "undone".to_owned(),
                payload: json!({}),
            }],
            snapshot_id,
        })
    }

    fn redo(&self) -> Result<CommandOutcome, ApiError> {
        let mut inner = self.inner.lock().map_err(|_| ApiError::StateLocked)?;
        let entry = inner.redo_stack.pop().ok_or(ApiError::HistoryEmpty)?;
        let events = entry.command.execute(&mut inner.state)?;
        let snapshot_id = Self::next_snapshot_id(&mut inner);
        inner.undo_stack.push(HistoryEntry {
            command: entry.command,
            events: events.clone(),
        });
        Ok(CommandOutcome {
            events,
            snapshot_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 能力发现返回版本、后端标识与能力清单。
    #[test]
    fn discover_reports_version_and_capabilities() {
        let backend = InMemoryBackend::new();
        let info = backend.discover();
        assert_eq!(info.api_version, API_VERSION);
        assert_eq!(info.backend_id, BACKEND_IN_MEMORY);
        assert!(info.capabilities.contains(&"undo-redo".to_owned()));
    }

    /// I-05：同一个注册器只允许注册一次。
    #[test]
    fn duplicate_registration_is_rejected() {
        let registry = BackendRegistry::new();
        assert!(registry.register("backend-a").is_ok());
        assert_eq!(registry.current(), Some("backend-a"));
        assert_eq!(
            registry.register("backend-b"),
            Err(ApiError::BackendAlreadyRegistered("backend-a".to_owned()))
        );
    }

    /// 命令执行后状态与事件流一致，undo/redo 可往返。
    #[test]
    fn execute_undo_redo_roundtrip() {
        let backend = InMemoryBackend::new();
        let envelope = InMemoryBackend::envelope(
            COMMAND_ADD_CLIP,
            "cmd-1",
            json!({ "label": "intro", "durationTicks": 120000 }),
        );
        let outcome = backend.execute(envelope).expect("执行应成功");
        assert_eq!(outcome.events.len(), 1);
        let snap = backend
            .snapshot(MediaTime::from_ticks(0))
            .expect("快照应成功");
        assert_eq!(snap.clip_count, 1);
        assert_eq!(snap.label, "intro");

        backend.undo().expect("撤销应成功");
        assert_eq!(
            backend
                .snapshot(MediaTime::from_ticks(0))
                .unwrap()
                .clip_count,
            0
        );
        backend.redo().expect("重做应成功");
        assert_eq!(
            backend
                .snapshot(MediaTime::from_ticks(0))
                .unwrap()
                .clip_count,
            1
        );
    }

    /// 异常分支：未知命令、版本不匹配、空 commandId、超长 label。
    #[test]
    fn invalid_commands_are_rejected_with_stable_codes() {
        let backend = InMemoryBackend::new();
        let unknown = InMemoryBackend::envelope("nope", "cmd-2", json!({}));
        assert_eq!(
            backend.execute(unknown).unwrap_err().code(),
            "UNSUPPORTED_COMMAND"
        );

        let mut wrong_version = InMemoryBackend::envelope(COMMAND_CLEAR, "cmd-3", json!({}));
        wrong_version.api_version = "9.9.9".to_owned();
        assert_eq!(
            backend.execute(wrong_version).unwrap_err().code(),
            "VERSION_MISMATCH"
        );

        let empty_id = InMemoryBackend::envelope(COMMAND_CLEAR, "  ", json!({}));
        assert_eq!(
            backend.execute(empty_id).unwrap_err().code(),
            "INVALID_PAYLOAD"
        );

        let long_label = "x".repeat(MAX_LABEL_CHARS + 1);
        let overlong = InMemoryBackend::envelope(
            COMMAND_ADD_CLIP,
            "cmd-4",
            json!({ "label": long_label, "durationTicks": 1 }),
        );
        assert_eq!(
            backend.execute(overlong).unwrap_err().code(),
            "INVALID_PAYLOAD"
        );
    }

    /// 边界分支：空历史、clear 不可撤销且不吞历史。
    #[test]
    fn empty_history_and_non_undoable_command() {
        let backend = InMemoryBackend::new();
        assert_eq!(backend.undo().unwrap_err(), ApiError::HistoryEmpty);
        assert_eq!(backend.redo().unwrap_err(), ApiError::HistoryEmpty);

        let clear = InMemoryBackend::envelope(COMMAND_CLEAR, "cmd-5", json!({}));
        backend.execute(clear).expect("清空应成功");
        assert_eq!(backend.undo().unwrap_err().code(), "INVALID_PAYLOAD");
        // 撤销失败不应丢掉历史条目
        assert_eq!(backend.undo().unwrap_err().code(), "INVALID_PAYLOAD");
    }

    /// 并发/竞态：多执行者共享同一后端，计数不丢失。
    #[test]
    fn concurrent_execution_keeps_state_consistent() {
        use std::sync::Arc;
        use std::thread;

        let backend = Arc::new(InMemoryBackend::new());
        let mut handles = Vec::new();
        for index in 0..8 {
            let shared = Arc::clone(&backend);
            handles.push(thread::spawn(move || {
                let envelope = InMemoryBackend::envelope(
                    COMMAND_ADD_CLIP,
                    &format!("cmd-{index}"),
                    json!({ "label": "clip", "durationTicks": 1 }),
                );
                shared.execute(envelope).expect("并发执行应成功");
            }));
        }
        for handle in handles {
            handle.join().expect("线程不应 panic");
        }
        let snap = backend
            .snapshot(MediaTime::from_ticks(0))
            .expect("快照应成功");
        assert_eq!(snap.clip_count, 8);
        assert_eq!(snap.state_ticks, 8);
    }
}
