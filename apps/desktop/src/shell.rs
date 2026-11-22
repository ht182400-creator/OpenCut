use std::path::Path;
use std::time::Duration;

use gpui::{App, Context, Entity, FocusHandle, KeyDownEvent, Window, div, prelude::*};

use crate::panels::{Browser, Inspector, Preview, Timeline};
use crate::project::{KeyOutcome, ProjectState};
use crate::theme::ActiveTheme;

/// 播放帧推进间隔：每 100ms 前进一帧（10fps 过渡预览）。
const PLAYBACK_INTERVAL: Duration = Duration::from_millis(100);
/// 启动即播放的环境变量开关（演示/自动化验收用；未设置时保持暂停）。
const AUTOPLAY_ENV_VAR: &str = "OPENCUT_AUTOPLAY";

// Panels are entities created once in `new`, not via `cx.new` inline in
// `render`, so each keeps its own state across renders instead of being
// torn down and rebuilt on every frame.
// 四个面板与 Shell 共用同一个 `Entity<ProjectState>`，播放/选中状态一处更新、全面板可见。
pub(crate) struct Shell {
    project: Entity<ProjectState>,
    focus_handle: FocusHandle,
    /// 是否已把焦点落到根元素（元素首次布局后才能生效，只做一次避免刷新循环）。
    focus_set: bool,
    browser: Entity<Browser>,
    preview: Entity<Preview>,
    inspector: Entity<Inspector>,
    timeline: Entity<Timeline>,
}

impl Shell {
    pub(crate) fn new(cx: &mut Context<Self>) -> Self {
        // 优先打开 `--project` / `OPENCUT_PROJECT` 指定的项目；失败回退内嵌演示项目并把错误展示给用户。
        // 内嵌 fixture 由 project.rs 单测锁定，解析失败属于编译期资产损坏，才会 panic。
        let (mut initial, load_error) = match ProjectState::resolve_project_path() {
            Some(path) => match ProjectState::load_from_path(Path::new(&path)) {
                Ok(state) => (state, None),
                Err(error) => {
                    let fallback = ProjectState::load_demo().expect("内嵌演示项目应可解析");
                    (fallback, Some(format!("打开 {path} 失败：{error}（已加载演示项目）")))
                }
            },
            None => (
                ProjectState::load_demo().expect("内嵌演示项目应可解析"),
                None,
            ),
        };
        initial.load_error = load_error;
        if std::env::var_os(AUTOPLAY_ENV_VAR).is_some() {
            initial.toggle_play();
        }
        let project = cx.new(|_| initial);
        let focus_handle = cx.focus_handle();

        // 周期播放任务：GPUI 官方模式——timer 等待后更新实体并 `cx.notify()` 触发重绘。
        let timer_project = project.clone();
        cx.spawn(async move |_this, cx| loop {
            cx.background_executor().timer(PLAYBACK_INTERVAL).await;
            let _ = timer_project.update(cx, |state, cx| {
                state.advance_playback();
                cx.notify();
            });
        })
        .detach();

        let shared = project.clone();
        Self {
            browser: cx.new(|_| Browser::new(shared.clone())),
            preview: cx.new(|_| Preview::new(shared.clone())),
            inspector: cx.new(|_| Inspector::new(shared.clone())),
            timeline: cx.new(|_| Timeline::new(shared)),
            project,
            focus_handle,
            focus_set: false,
        }
    }

    /// 供窗口创建时聚焦根元素，使键盘快捷键可接收。
    pub(crate) fn focus_handle(&self) -> FocusHandle {
        self.focus_handle.clone()
    }

    /**
     * 处理键盘输入：编辑态进草稿/提交，普通态 F2 进入编辑、其余走播放快捷键；提交后自动保存。
     *
     * @param key `Keystroke.key` 字符串
     * @param save_now 是否为 Ctrl+S 手动保存
     * @param app GPUI 应用上下文，用于更新共享项目实体
     */
    fn handle_key(&mut self, key: &str, save_now: bool, app: &mut App) {
        let outcome = self.project.update(app, |state, _| {
            if save_now && !state.editing {
                return KeyOutcome::Ignored;
            }
            state.handle_key(key)
        });
        let should_save = save_now
            || matches!(outcome, KeyOutcome::CommitChanged);
        if should_save {
            self.save_project(app);
        }
    }

    /// 保存项目并把结果（成功/友好错误）写入共享状态供 UI 展示。
    fn save_project(&mut self, app: &mut App) {
        let result = self.project.update(app, |state, _| state.save_to_file());
        let message = match result {
            Ok(()) => "项目已保存到原文件".to_owned(),
            Err(error) => error.to_string(),
        };
        self.project
            .update(app, |state, _| state.save_status = Some(message));
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = window.theme().colors;
        // 窗口创建时元素尚未布局，首次 render 后补一次焦点（只做一次，避免刷新循环）。
        if !self.focus_set {
            window.focus(&self.focus_handle);
            self.focus_set = true;
        }

        div()
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                let key = event.keystroke.key.clone();
                let save_now = event.keystroke.modifiers.control && key == "s";
                this.handle_key(&key, save_now, cx);
                cx.stop_propagation();
            }))
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
