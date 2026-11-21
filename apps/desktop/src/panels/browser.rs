use gpui::{prelude::*, App, Context, Entity, SharedString, Window, div};

use crate::project::ProjectState;
use crate::theme::ActiveTheme;

/// 素材浏览器：展示项目名、轨道与片段，点击片段更新共享选中状态。
pub(crate) struct Browser {
    project: Entity<ProjectState>,
}

impl Browser {
    /// 绑定到共享项目状态。
    pub(crate) fn new(project: Entity<ProjectState>) -> Self {
        Self { project }
    }
}

impl Render for Browser {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;
        let snapshot = self.project.read(cx);
        let project_entity = self.project.clone();

        div()
            .flex()
            .flex_col()
            .w_1_4()
            .h_full()
            .border_r_1()
            .border_color(colors.sidebar_border)
            .bg(colors.sidebar)
            .text_color(colors.sidebar_foreground)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_sm()
                            .child(format!("Browser · {}", snapshot.view.name)),
                    )
                    .child(
                        div()
                            .text_xs()
                            .child(format!("来源：{}", snapshot.source_label)),
                    )
                    .children(snapshot.load_error.iter().map(|error| {
                        div().text_xs().child(format!("⚠ {error}"))
                    })),
            )
            .children(snapshot.view.scenes.iter().flat_map(|scene| &scene.tracks).map(|track| {
                div()
                    .flex()
                    .flex_col()
                    .child(div().text_xs().child(format!("{} · {}", track.track_type, track.id)))
                    .children(track.elements.iter().map(|element| {
                        let id = element.id.clone();
                        let entity = project_entity.clone();
                        div()
                            .id(SharedString::from(format!("browser-{}", id)))
                            .on_click(move |_, _, app: &mut App| {
                                entity.update(app, |state, _| state.select(Some(id.clone())));
                            })
                            .child(element.name.clone().unwrap_or_else(|| element.id.clone()))
                    }))
            }))
    }
}
