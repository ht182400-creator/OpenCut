//! 内置参考命令与信封分派：`addClip` / `setPlayhead` / `clear`。

use serde_json::{Value, json};

use crate::model::{
    ApiError, COMMAND_ADD_CLIP, COMMAND_CLEAR, COMMAND_SET_PLAYHEAD, Command, CommandEnvelope,
    Event, MAX_LABEL_CHARS, SceneState,
};

/// 根据信封构造具体命令；未知 kind 或非法参数一律返回可映射的错误。
pub(crate) fn command_from(envelope: &CommandEnvelope) -> Result<Box<dyn Command>, ApiError> {
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
