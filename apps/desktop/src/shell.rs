use std::path::Path;
use std::time::Duration;

use gpui::{App, Context, Entity, FocusHandle, KeyDownEvent, Window, div, prelude::*};

use crate::panels::{Browser, Inspector, Preview, Timeline};
use crate::_project_edit::KeyOutcome;
use crate::project::ProjectState;
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
        // OTIO 启动导入：`--otio` / `OPENCUT_OTIO` 指定文件时替换主轨（失败保留原项目）。
        if let Some(otio_path) = crate::_otio_io::resolve_otio_path() {
            match std::fs::read_to_string(&otio_path) {
                Ok(text) => {
                    if !crate::_otio_io::apply_import(&mut initial, &text) {
                        initial.load_error = Some(format!("OTIO 文件 {otio_path} 导入失败，已保留原项目"));
                    }
                }
                Err(error) => {
                    initial.load_error = Some(crate::_otio_io::OtioDesktopError::ReadFile(
                        format!("{otio_path}：{error}"),
                    ).to_string());
                }
            }
        }
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
     * 处理键盘输入：另存为模式优先，编辑态进草稿/提交，普通态 F2~F6 进入字段编辑；提交后自动保存。
     *
     * @param key `Keystroke.key` 字符串
     * @param save_now 是否为 Ctrl+S 手动保存
     * @param save_as 是否为 Ctrl+Shift+S 另存为
     * @param undo 是否为 Ctrl+Z 撤销
     * @param redo 是否为 Ctrl+Shift+Z 重做
     * @param app GPUI 应用上下文，用于更新共享项目实体
     */
    fn handle_key(&mut self, key: &str, save_now: bool, save_as: bool, undo: bool, redo: bool, app: &mut App) {
        // 另存为模式：所有键进路径草稿，Enter 提交后落盘到新路径。
        let in_save_as = self.project.read(app).save_as_draft.is_some();
        if save_as && !in_save_as {
            self.project.update(app, |state, _| state.begin_save_as());
            return;
        }
        if in_save_as {
            let committed = self.project.update(app, |state, _| state.handle_save_as_key(key));
            if let Some(path) = committed {
                self.save_as_project(std::path::PathBuf::from(path), app);
            }
            return;
        }

        // 撤销/重做只在普通态响应；恢复成功后与编辑提交一致自动写回。
        if undo || redo {
            let changed = self.project.update(app, |state, _| {
                if state.editing_field.is_some() {
                    return false;
                }
                if undo { state.undo() } else { state.redo() }
            });
            if changed {
                self.save_project(app);
            }
            return;
        }

        let outcome = self.project.update(app, |state, _| {
            if save_now && state.editing_field.is_some() {
                return KeyOutcome::Ignored;
            }
            state.handle_key(key)
        });
        let should_save = save_now || matches!(outcome, KeyOutcome::CommitChanged);
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

    /// 另存为到新路径并把结果写入共享状态。
    fn save_as_project(&mut self, path: std::path::PathBuf, app: &mut App) {
        let result = self.project.update(app, |state, _| state.save_as_to_path(path));
        let message = match result {
            Ok(()) => "项目已另存为新文件并切换为当前项目".to_owned(),
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
                let save_now = event.keystroke.modifiers.control
                    && !event.keystroke.modifiers.shift
                    && key == "s";
                let save_as = event.keystroke.modifiers.control
                    && event.keystroke.modifiers.shift
                    && key == "s";
                let undo = event.keystroke.modifiers.control
                    && !event.keystroke.modifiers.shift
                    && key == "z";
                let redo = event.keystroke.modifiers.control
                    && event.keystroke.modifiers.shift
                    && key == "z";
                // Ctrl+E 导出 OTIO（与普通 S 分割、Ctrl+S 保存互不冲突）。
                let export_otio = event.keystroke.modifiers.control
                    && !event.keystroke.modifiers.shift
                    && key == "e";
                // 时间轴编辑快捷键：无修饰键时 Delete/S/I/O 走统一编辑入口。
                let edit = if event.keystroke.modifiers.control {
                    None
                } else {
                    match key.as_str() {
                        "delete" => Some(crate::_timeline_edit::TimelineEdit::Delete),
                        "s" => Some(crate::_timeline_edit::TimelineEdit::Split),
                        "i" => Some(crate::_timeline_edit::TimelineEdit::TrimIn),
                        "o" => Some(crate::_timeline_edit::TimelineEdit::TrimOut),
                        _ => None,
                    }
                };
                if export_otio {
                    this.project.update(cx, |state, _| {
                        crate::_otio_io::export_to_status(state);
                    });
                } else if let Some(edit) = edit {
                    this.project.update(cx, |state, _| {
                        crate::_timeline_edit::apply_to_state(state, edit);
                    });
                } else {
                    this.handle_key(&key, save_now, save_as, undo, redo, cx);
                }
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
