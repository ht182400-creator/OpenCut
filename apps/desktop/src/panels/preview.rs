use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{Context, Entity, RenderImage, Window, div, img, prelude::*};
use ocx_render::render_frame;

use crate::project::ProjectState;
use crate::spike::frame_to_render_image;
use crate::theme::ActiveTheme;

/// 预览面板：按共享播放头渲染 core 演示合成帧（ADR-04 过渡态），带帧缓存避免重复生成。
pub(crate) struct Preview {
    project: Entity<ProjectState>,
    /// 上次渲染的帧 key（帧号 + 画布尺寸），变化时才重算。
    cached_key: Option<(u64, u32, u32)>,
    /// 已转 BGRA 的 GPUI 纹理数据。
    texture: Option<Arc<RenderImage>>,
    /// FNV 校验和（0x 前缀十六进制）。
    checksum: String,
    /// 单帧生成耗时。
    elapsed: Duration,
    /// 可展示的错误信息。
    error: Option<String>,
}

impl Preview {
    /// 绑定到共享项目状态；首帧在首次 render 时按 key 生成。
    pub(crate) fn new(project: Entity<ProjectState>) -> Self {
        Self {
            project,
            cached_key: None,
            texture: None,
            checksum: String::new(),
            elapsed: Duration::ZERO,
            error: None,
        }
    }

    /**
     * 按项目当前播放头重建一帧。
     *
     * @param app GPUI 应用上下文，用于读取共享项目实体
     */
    fn rebuild(&mut self, app: &mut gpui::App) {
        // 先取出渲染所需数据并结束借用，避免与 `&mut self` 冲突。
        let (index, ticks, duration, profile, params) = {
            let state = self.project.read(app);
            (
                state.frame_index(),
                state.playhead_ticks,
                state.view.duration_ticks,
                state.profile(),
                state.frame_params(),
            )
        };
        let started = Instant::now();
        match render_frame(index, ticks, duration, &profile, &params) {
            Ok(frame) => {
                self.elapsed = started.elapsed();
                self.checksum = format!("0x{:016x}", frame.checksum());
                match frame_to_render_image(&frame) {
                    Ok(texture) => {
                        self.texture = Some(texture);
                        self.error = None;
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }
            Err(error) => self.error = Some(format!("帧生成失败：{error}")),
        }
    }
}

impl Render for Preview {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;
        // 读取状态并立即结束借用，再决定是否重建缓存。
        let (key, header) = {
            let state = self.project.read(cx);
            let key = (
                state.frame_index(),
                state.view.canvas.width,
                state.view.canvas.height,
            );
            let header = format!(
                "帧 {} · {} ticks",
                state.frame_index(),
                state.playhead_ticks
            );
            (key, header)
        };
        if self.cached_key != Some(key) {
            self.rebuild(cx);
            self.cached_key = Some(key);
        }

        let content = match &self.texture {
            Some(texture) => div()
                .flex()
                .flex_col()
                .size_full()
                .child(
                    div()
                        .flex_1()
                        .w_full()
                        .child(img(texture.clone()).w_full().h_full()),
                )
                .child(
                    div()
                        .w_full()
                        .text_sm()
                        .text_color(colors.foreground)
                        .child(format!(
                            "H01 过渡预览 · {}×{} · {} · {:?} · checksum {}（core 演示合成，非素材帧）",
                            key.1, key.2, header, self.elapsed, self.checksum
                        )),
                ),
            None => div()
                .flex()
                .size_full()
                .items_center()
                .justify_center()
                .text_color(colors.foreground)
                .child(
                    self.error
                        .clone()
                        .unwrap_or_else(|| "正在生成预览帧".to_owned()),
                ),
        };

        div()
            .flex()
            .w_1_2()
            .h_full()
            .items_center()
            .justify_center()
            .bg(colors.background)
            .child(content)
    }
}
