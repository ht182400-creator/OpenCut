use gpui::{Context, Entity, SharedString, Window, div, prelude::*};
use ocx_time::TICKS_PER_SECOND;

use crate::project::ProjectState;
use crate::theme::ActiveTheme;

/// 时间轴：逐帧播放头控制 + 片段条点击定位，与预览/检查器共享状态。
pub(crate) struct Timeline {
    project: Entity<ProjectState>,
}

impl Timeline {
    /// 绑定到共享项目状态。
    pub(crate) fn new(project: Entity<ProjectState>) -> Self {
        Self { project }
    }
}

impl Render for Timeline {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;
        let snapshot = self.project.read(cx);
        let project_entity = self.project.clone();
        let back_entity = self.project.clone();
        let forward_entity = self.project.clone();
        let play_entity = self.project.clone();
        let ticks = snapshot.playhead_ticks;
        let playing = snapshot.playing;
        let last_key = snapshot.last_shortcut.clone();
        let visible = snapshot.visible_element_at(ticks).map(|element| element.id.clone());

        div()
            .flex()
            .flex_col()
            .h_1_3()
            .border_t_1()
            .border_color(colors.border)
            .bg(colors.card)
            .text_color(colors.card_foreground)
            .child(
                div()
                    .flex()
                    .text_sm()
                    .child(format!(
                        "Timeline · {:.2}s / {:.2}s · 帧 {} · {} · 可见 {} · 按键 {} · 空格播放/暂停",
                        ticks as f64 / TICKS_PER_SECOND as f64,
                        snapshot.view.duration_ticks as f64 / TICKS_PER_SECOND as f64,
                        snapshot.frame_index(),
                        if playing { "播放中" } else { "已暂停" },
                        visible.as_deref().unwrap_or("-"),
                        if last_key.is_empty() { "-" } else { &last_key }
                    ))
                    .child(
                        div()
                            .id("timeline-back")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                back_entity.update(app, |state, _| state.step_frame(-1));
                            })
                            .child(" ◀ "),
                    )
                    .child(
                        div()
                            .id("timeline-play")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                play_entity.update(app, |state, _| state.toggle_play());
                            })
                            .child(if playing { " ⏸ " } else { " ▶ " }),
                    )
                    .child(
                        div()
                            .id("timeline-forward")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                forward_entity.update(app, |state, _| state.step_frame(1));
                            })
                            .child(" ▶| "),
                    ),
            )
            .children(snapshot.view.scenes.iter().flat_map(|scene| &scene.tracks).flat_map(|track| &track.elements).map(|element| {
                let start = element.start_time;
                let id = element.id.clone();
                let entity = project_entity.clone();
                let label = element.name.clone().unwrap_or_else(|| element.id.clone());
                div()
                    .id(SharedString::from(format!("timeline-{}", id)))
                    .on_click(move |_, _, app: &mut gpui::App| {
                        entity.update(app, |state, _| {
                            state.seek(start);
                            state.select(Some(id.clone()));
                        });
                    })
                    .child(format!(
                        "  {} [{:.2}s ~ {:.2}s]",
                        label,
                        start as f64 / TICKS_PER_SECOND as f64,
                        (start + element.duration) as f64 / TICKS_PER_SECOND as f64
                    ))
            }))
    }
}
