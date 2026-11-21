use gpui::{App, Context, Entity, Window, div, prelude::*};

use crate::panels::{Browser, Inspector, Preview, Timeline};
use crate::project::ProjectState;
use crate::theme::ActiveTheme;

// Panels are entities created once in `new`, not via `cx.new` inline in
// `render`, so each keeps its own state across renders instead of being
// torn down and rebuilt on every frame.
// 四个面板共用同一个 `Entity<ProjectState>`，播放头/选中状态一处更新、全面板可见。
pub(crate) struct Shell {
    browser: Entity<Browser>,
    preview: Entity<Preview>,
    inspector: Entity<Inspector>,
    timeline: Entity<Timeline>,
}

impl Shell {
    pub(crate) fn new(cx: &mut App) -> Self {
        // 内嵌 fixture 由 project.rs 单测锁定，解析失败属于编译期资产损坏。
        let project = cx.new(|_| ProjectState::load_demo().expect("内嵌演示项目应可解析"));
        Self {
            browser: cx.new(|_| Browser::new(project.clone())),
            preview: cx.new(|_| Preview::new(project.clone())),
            inspector: cx.new(|_| Inspector::new(project.clone())),
            timeline: cx.new(|_| Timeline::new(project.clone())),
        }
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;

        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(colors.background)
            .text_color(colors.foreground)
            .child(
                div()
                    .flex()
                    .h_2_3()
                    .border_b_1()
                    .border_color(colors.border)
                    .child(self.browser.clone())
                    .child(self.inspector.clone())
                    .child(self.preview.clone()),
            )
            .child(self.timeline.clone())
    }
}
