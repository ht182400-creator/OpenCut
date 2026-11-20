use gpui::{div, img, prelude::*, Context, Window};

use crate::spike::{SpikeResult, generate_spike_frame};
use crate::theme::ActiveTheme;

/// 预览面板：H01 spike 阶段显示 core 合成的 1080p CPU 帧与实测数据。
pub(crate) struct Preview {
    /// spike 结果（失败时保存可展示的中文错误，不 panic）。
    spike: Result<SpikeResult, String>,
}

impl Preview {
    /// 构造预览面板并同步生成一帧 spike 帧（启动时一次性完成）。
    pub(crate) fn new() -> Self {
        Self {
            spike: generate_spike_frame().map_err(|error| error.to_string()),
        }
    }
}

impl Render for Preview {
    fn render(&mut self, window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;

        let content = match &self.spike {
            Ok(result) => div()
                .flex()
                .flex_col()
                .size_full()
                .child(
                    div()
                        .flex_1()
                        .w_full()
                        .child(img(result.texture.clone()).w_full().h_full()),
                )
                .child(
                    div()
                        .w_full()
                        .text_sm()
                        .text_color(colors.foreground)
                        .child(format!(
                            "H01 spike · {}×{} 单帧 {:?} · checksum {}",
                            result.frame.width, result.frame.height, result.elapsed, result.checksum
                        )),
                ),
            Err(message) => div()
                .flex()
                .size_full()
                .items_center()
                .justify_center()
                .text_color(colors.foreground)
                .child(format!("H01 spike 失败：{message}")),
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
