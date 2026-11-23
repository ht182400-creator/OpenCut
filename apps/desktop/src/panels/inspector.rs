use gpui::{Context, Entity, Window, div, prelude::*};
use ocx_time::TICKS_PER_SECOND;

use crate::_project_edit::EditableField;
use crate::project::ProjectState;
use crate::theme::ActiveTheme;

/// 属性检查器：展示并编辑选中元素字段（F2~F6 编辑，Enter 提交并保存，Esc 取消）。
pub(crate) struct Inspector {
    project: Entity<ProjectState>,
}

/// 编辑器操作提示（常量集中，避免硬编码散落）。
const EDIT_HINT: &str = "F2 名称 · F3 起点 · F4 时长 · F5 修剪入 · F6 修剪出 · Enter 保存 · Esc 取消 · Del 删除 · S 分割 · I/O 入出点 · Ctrl+S 保存 · Ctrl+Shift+S 另存为 · Ctrl+E 导出 OTIO · Ctrl+Z 撤销 · Ctrl+Shift+Z 重做";

impl Inspector {
    /// 绑定到共享项目状态。
    pub(crate) fn new(project: Entity<ProjectState>) -> Self {
        Self { project }
    }

    /**
     * 按字段生成显示文本：编辑中的字段用 `[draft_` 标示，数值字段统一显示秒。
     *
     * @param label 字段名
     * @param value 当前值文本
     * @param field 该字段对应的可编辑枚举
     * @param snapshot 项目状态
     * @returns {String} 单行显示文本
     */
    fn field_line(label: &str, value: String, field: EditableField, snapshot: &ProjectState) -> String {
        if snapshot.editing_field == Some(field) {
            format!("{label}: [{}_", snapshot.draft)
        } else {
            format!("{label}: {value}")
        }
    }
}

impl Render for Inspector {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;
        let snapshot = self.project.read(cx);

        let save_as_line = snapshot.save_as_draft.as_ref().map(|draft| {
            format!("另存为路径: [{}_", draft)
        });

        let content = match snapshot.selected_element() {
            Some(element) => {
                let to_seconds = |ticks: i64| format!("{:.3}s", ticks as f64 / TICKS_PER_SECOND as f64);
                div()
                    .flex()
                    .flex_col()
                    .text_xs()
                    .child(div().text_sm().child("Inspector · 选中元素"))
                    .child(format!("id: {}", element.id))
                    .child(Self::field_line(
                        "name",
                        element.name.clone().unwrap_or_else(|| "-".to_owned()),
                        EditableField::Name,
                        &snapshot,
                    ))
                    .child(format!("type: {}", element.element_type))
                    .child(Self::field_line(
                        "start",
                        to_seconds(element.start_time),
                        EditableField::StartTime,
                        &snapshot,
                    ))
                    .child(Self::field_line(
                        "duration",
                        to_seconds(element.duration),
                        EditableField::Duration,
                        &snapshot,
                    ))
                    .child(Self::field_line(
                        "trimIn",
                        to_seconds(element.trim_start),
                        EditableField::TrimStart,
                        &snapshot,
                    ))
                    .child(Self::field_line(
                        "trimOut",
                        to_seconds(element.trim_end),
                        EditableField::TrimEnd,
                        &snapshot,
                    ))
                    .child(format!("media: {}", element.media_id.as_deref().unwrap_or("-")))
                    .child(div().child(EDIT_HINT))
            }
            None => div()
                .text_sm()
                .child("Inspector · 未选中元素（点击左侧片段）"),
        };

        div()
            .flex()
            .w_1_4()
            .h_full()
            .border_l_1()
            .border_color(colors.border)
            .bg(colors.card)
            .text_color(colors.card_foreground)
            .child(content)
            .child(div().text_xs().child(snapshot.history_label()))
            .children(save_as_line.into_iter().map(|line| div().text_xs().child(line)))
            .children(snapshot.edit_error.iter().map(|error| {
                div().text_xs().child(format!("⚠ {error}"))
            }))
            .children(snapshot.save_status.iter().map(|status| {
                div().text_xs().child(format!("💾 {status}"))
            }))
    }
}
