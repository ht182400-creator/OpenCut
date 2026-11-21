use gpui::{Context, Entity, Window, div, prelude::*};

use crate::project::ProjectState;
use crate::theme::ActiveTheme;

/// 属性检查器：展示共享状态里当前选中元素的字段（只读过渡态）。
pub(crate) struct Inspector {
    project: Entity<ProjectState>,
}

impl Inspector {
    /// 绑定到共享项目状态。
    pub(crate) fn new(project: Entity<ProjectState>) -> Self {
        Self { project }
    }
}

impl Render for Inspector {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;
        let snapshot = self.project.read(cx);

        let content = match snapshot.selected_element() {
            Some(element) => div()
                .flex()
                .flex_col()
                .text_xs()
                .child(div().text_sm().child("Inspector · 选中元素"))
                .child(format!("id: {}", element.id))
                .child(format!(
                    "name: {}",
                    element.name.as_deref().unwrap_or("-")
                ))
                .child(format!("type: {}", element.element_type))
                .child(format!("start: {} ticks", element.start_time))
                .child(format!("duration: {} ticks", element.duration))
                .child(format!(
                    "trim: {} ~ {}",
                    element.trim_start, element.trim_end
                ))
                .child(format!(
                    "media: {}",
                    element.media_id.as_deref().unwrap_or("-")
                )),
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
    }
}
