//! 单后端注册器（I-05）与内置参考后端：无平台依赖，可作为扩展点与回归基线。

use std::sync::{Mutex, OnceLock};

use ocx_time::MediaTime;
use serde_json::{Value, json};

use crate::command::command_from;
use crate::model::{
    API_VERSION, ApiError, BACKEND_IN_MEMORY, CAPABILITIES, Command, CommandEnvelope,
    CommandOutcome, DiscoverResult, EditorApi, Event, SCHEMA_VERSION, SceneSnapshot, SceneState,
    default_schema_version,
};
use crate::negotiation::supported_versions;

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
            supported_schema_versions: supported_versions(),
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
            schema_version: default_schema_version(),
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
            schema_version: default_schema_version(),
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
            events: vec![Event::new("undone", json!({}))],
            snapshot_id,
            schema_version: default_schema_version(),
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
            schema_version: default_schema_version(),
        })
    }
}
