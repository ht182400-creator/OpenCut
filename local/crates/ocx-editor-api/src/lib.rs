//! OpenCut 本地 core 的编辑器唯一入口（W-03 基石）。
//!
//! 设计约束见 `roadmap/COMPAT.md`：
//! - I-01 所有端/插件只通过本 crate 的 `EditorApi` 访问 core；
//! - I-03 跨边界数据版本化且字段只增不改；
//! - I-05 同一时刻只允许一个 core 后端被注册（`BackendRegistry`）。
//!
//! 本 crate 不含任何浏览器/平台依赖，Web 绑定与 TS 适配层在 W-06 接入。
//! 模块划分：`model`（数据模型与 trait）/ `command`（内置命令与分派，私有）/
//! `backend`（注册器与参考后端）。

pub mod backend;
mod command;
pub mod model;
pub mod negotiation;

pub use backend::{BackendRegistry, InMemoryBackend};
pub use model::{
    API_VERSION, ApiError, BACKEND_IN_MEMORY, CAPABILITIES, COMMAND_ADD_CLIP, COMMAND_CLEAR,
    COMMAND_SET_PLAYHEAD, Command, CommandEnvelope, CommandOutcome, DiscoverResult, EditorApi,
    Event, MAX_LABEL_CHARS, SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, SceneSnapshot, SceneState,
    default_schema_version,
};
pub use negotiation::{
    CapabilitiesRequest, NEGOTIATE_API_MISMATCH, NEGOTIATE_MISSING_CAPABILITIES,
    NEGOTIATE_NO_COMMON_SCHEMA, NEGOTIATE_OK, NegotiationResult, negotiate, supported_versions,
};

#[cfg(test)]
mod tests {
    use super::*;
    use ocx_time::MediaTime;
    use serde_json::json;

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
