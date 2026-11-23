use gpui::{AnyElement, Context, Entity, SharedString, Window, div, prelude::*, px, relative};
use ocx_time::TICKS_PER_SECOND;

use crate::project::ProjectState;
use crate::theme::ActiveTheme;

/// 时间轴：播放头控制 + 秒刻度 + 比例片段条，与预览/检查器共享状态。
pub(crate) struct Timeline {
    project: Entity<ProjectState>,
}

/// 单个片段条的固定高度（像素）。
const CLIP_ROW_HEIGHT_PX: f32 = 16.0;
/// 播放头进度条高度（像素）。
const PLAYHEAD_BAR_HEIGHT_PX: f32 = 3.0;

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
        let clip_entity = self.project.clone();
        let delete_entity = self.project.clone();
        let split_entity = self.project.clone();
        let trim_in_entity = self.project.clone();
        let trim_out_entity = self.project.clone();
        let otio_entity = self.project.clone();
        let ticks = snapshot.playhead_ticks;
        let total = snapshot.view.duration_ticks.max(1);
        let play_ratio = (ticks as f32 / total as f32).clamp(0.0, 1.0);
        let last_key = snapshot.last_shortcut.clone();
        let selected_id = snapshot.selected_element_id.clone();
        let visible = snapshot.visible_element_at(ticks).map(|element| element.id.clone());
        let playing = snapshot.playing;
        let seconds = (total / TICKS_PER_SECOND).max(1);

        div()
            .flex()
            .flex_col()
            .h_1_3()
            .border_t_1()
            .border_color(colors.border)
            .bg(colors.card)
            .text_color(colors.card_foreground)
            // 信息条 + 逐帧按钮
            .child(
                div()
                    .flex()
                    .text_sm()
                    .child(format!(
                        "Timeline · {:.2}s / {:.2}s · 帧 {} · {} · 可见 {} · 按键 {} · 空格播放/暂停",
                        ticks as f64 / TICKS_PER_SECOND as f64,
                        total as f64 / TICKS_PER_SECOND as f64,
                        snapshot.frame_index(),
                        if playing { "播放中" } else { "已暂停" },
                        visible.as_deref().unwrap_or("-"),
                        if last_key.is_empty() { "-" } else { &last_key }
                    ))
                    .child(
                        div()
                            .id("timeline-back")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                back_entity.update(app, |state, _| {
                                    let step = state.ticks_per_frame();
                                    state.seek(state.playhead_ticks - step);
                                });
                            })
                            .child(" ◀ "),
                    )
                    .child(
                        div()
                            .id("timeline-play")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                forward_entity.update(app, |state, _| state.toggle_play());
                            })
                            .child(if playing { " ⏸ " } else { " ▶ " }),
                    )
                    .child(
                        div()
                            .id("timeline-forward")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                project_entity.update(app, |state, _| {
                                    let step = state.ticks_per_frame();
                                    state.seek(state.playhead_ticks + step);
                                });
                            })
                            .child(" ▶| "),
                    )
                    // 时间轴编辑按钮：与 Delete / S / I / O 快捷键共用同一纯逻辑入口。
                    .child(
                        div()
                            .id("timeline-delete")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                delete_entity.update(app, |state, _| {
                                    crate::_timeline_edit::apply_to_state(state, crate::_timeline_edit::TimelineEdit::Delete);
                                });
                            })
                            .child(" 删 "),
                    )
                    .child(
                        div()
                            .id("timeline-split")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                split_entity.update(app, |state, _| {
                                    crate::_timeline_edit::apply_to_state(state, crate::_timeline_edit::TimelineEdit::Split);
                                });
                            })
                            .child(" 分 "),
                    )
                    .child(
                        div()
                            .id("timeline-trim-in")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                trim_in_entity.update(app, |state, _| {
                                    crate::_timeline_edit::apply_to_state(state, crate::_timeline_edit::TimelineEdit::TrimIn);
                                });
                            })
                            .child(" 入 "),
                    )
                    .child(
                        div()
                            .id("timeline-trim-out")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                trim_out_entity.update(app, |state, _| {
                                    crate::_timeline_edit::apply_to_state(state, crate::_timeline_edit::TimelineEdit::TrimOut);
                                });
                            })
                            .child(" 出 "),
                    )
                    .child(
                        div()
                            .id("timeline-otio-export")
                            .on_click(move |_, _, app: &mut gpui::App| {
                                otio_entity.update(app, |state, _| {
                                    crate::_otio_io::export_to_status(state);
                                });
                            })
                            .child(" OTIO "),
                    ),
            )
            // 秒刻度：按整秒等分，末段可能不足 1 秒但仍占一格
            .child(
                div()
                    .flex()
                    .w_full()
                    .text_xs()
                    .children((0..=seconds).map(|second| {
                        div()
                            .flex_1()
                            .child(format!("{second}s"))
                    })),
            )
            // 播放头进度条：已播部分用主色，剩余用边框色
            .child(
                div()
                    .flex()
                    .w_full()
                    .h(px(PLAYHEAD_BAR_HEIGHT_PX))
                    .child(
                        div()
                            .w(relative(play_ratio))
                            .h_full()
                            .bg(colors.primary),
                    )
                    .child(div().flex_1().h_full().bg(colors.border)),
            )
            // 每条轨道一行：片段按 start/duration 比例定位，空白用 spacer 填充
            .children(snapshot.view.scenes.iter().flat_map(|scene| &scene.tracks).map(|track| {
                let mut cursor = 0_i64;
                let mut pieces: Vec<AnyElement> = Vec::new();
                for element in &track.elements {
                    let gap = (element.start_time - cursor).max(0);
                    cursor = element.start_time + element.duration;
                    pieces.push(
                        div()
                            .w(relative(gap as f32 / total as f32))
                            .h(px(CLIP_ROW_HEIGHT_PX))
                            .into_any_element(),
                    );
                    let id = element.id.clone();
                    let label = element.name.clone().unwrap_or_else(|| element.id.clone());
                    let start = element.start_time;
                    let entity = clip_entity.clone();
                    let is_selected = selected_id.as_deref() == Some(id.as_str());
                    pieces.push(
                        div()
                            .id(SharedString::from(format!("timeline-{}", id)))
                            .on_click(move |_, _, app: &mut gpui::App| {
                                entity.update(app, |state, _| {
                                    state.seek(start);
                                    state.select(Some(id.clone()));
                                });
                            })
                            .w(relative(element.duration as f32 / total as f32))
                            .h(px(CLIP_ROW_HEIGHT_PX))
                            .bg(if is_selected { colors.accent } else { colors.secondary })
                            .child(format!(" {} ", label))
                            .into_any_element(),
                    );
                }
                let tail = (total - cursor).max(0);
                pieces.push(
                    div()
                        .w(relative(tail as f32 / total as f32))
                        .h(px(CLIP_ROW_HEIGHT_PX))
                        .into_any_element(),
                );
                div().flex().w_full().children(pieces)
            }))
    }
}
