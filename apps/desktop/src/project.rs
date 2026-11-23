//! W-14 桌面项目状态：加载 v31 项目、维护播放头与选中、派生帧参数。
//!
//! 过渡边界（ADR-04）：预览帧仍由 `ocx_render::render_frame` 演示合成，与 Web/CLI/WASM
//! core 指纹一致；fixture 的元素 `params` 为空，不编造颜色/位置映射。真实素材解码与
//! 本地像素合成（Web 正式模式所用管线）属于后续独立工作。

use std::fmt;
use std::path::Path;

use ocx_domain::{ElementView, ProjectView, read_classic_project, write_classic_project};
use ocx_render::{
    Codec, Container, ExportProfile, FrameRateSpec, frame_index_at_time,
};
use ocx_time::TICKS_PER_SECOND;

use crate::spike::demo_frame_params;

/// 桌面启动默认加载的 v31 演示项目（与 Web fixture 同一份资产）。
pub(crate) const DEMO_PROJECT_JSON: &str =
    include_str!("../../web/public/fixtures/classic-project-v31.json");

/// 过渡演示固定容器。
const DEMO_CONTAINER: Container = Container::Mp4;
/// 过渡演示固定编码。
const DEMO_CODEC: Codec = Codec::Avc;
/// 过渡演示视频码率（bps）。
const DEMO_VIDEO_BITRATE_BPS: u32 = 6_000_000;
/// 过渡演示音频采样率（Hz）。
const DEMO_AUDIO_SAMPLE_RATE_HZ: u32 = 48_000;
/// 过渡演示音频声道数。
const DEMO_AUDIO_CHANNELS: u16 = 2;
/// 主轨 id（经典版固定为 `main`；`track_type` 取 JSON 的 type，可能是 `video`）。
const MAIN_TRACK_ID: &str = "main";
/// 项目路径环境变量（命令行 `--project` 的备选入口）。
const PROJECT_ENV_VAR: &str = "OPENCUT_PROJECT";
/// 命令行项目路径参数名。
const PROJECT_ARG: &str = "--project";

use crate::_project_edit::{
    EditableField, KeyOutcome, input_allowed, parse_seconds_to_ticks, save_as_key, validate_edit,
};
use crate::_project_history::ProjectHistory;

/// 项目加载错误：统一给 UI 中文提示，不 panic。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProjectError {
    /// 项目文件读取失败（不存在/权限/编码）。
    ReadFile(String),
    /// 项目文件写回失败（权限/磁盘/写后往返校验失败）。
    WriteFile(String),
    /// core 兼容层拒绝该 JSON。
    Parse(String),
    /// 项目没有场景。
    EmptyScene,
    /// 项目时长非正。
    InvalidDuration(i64),
}

impl fmt::Display for ProjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProjectError::ReadFile(detail) => write!(formatter, "项目文件读取失败：{detail}"),
            ProjectError::WriteFile(detail) => write!(formatter, "项目保存失败：{detail}"),
            ProjectError::Parse(detail) => write!(formatter, "项目解析失败：{detail}"),
            ProjectError::EmptyScene => write!(formatter, "项目缺少场景，无法预览"),
            ProjectError::InvalidDuration(value) => {
                write!(formatter, "项目时长非法（{value} ticks），无法预览")
            }
        }
    }
}

/// 桌面项目状态：core 只读视图 + 播放头 + 选中元素 id。
pub(crate) struct ProjectState {
    /// core 解析出的归一化项目视图。
    pub(crate) view: ProjectView,
    /// 当前播放头（ticks）。
    pub(crate) playhead_ticks: i64,
    /// 当前选中元素 id（仅引用，不拷贝元素本身）。
    pub(crate) selected_element_id: Option<String>,
    /// 播放状态（由播放定时器与快捷键共同驱动）。
    pub(crate) playing: bool,
    /// 最近一次键盘快捷键（用于 UI 反馈）。
    pub(crate) last_shortcut: String,
    /// 当前项目来源标签（文件名或「内嵌演示项目」），用于 UI 展示。
    pub(crate) source_label: String,
    /// 打开项目失败时的友好提示（回退演示项目后仍展示）。
    pub(crate) load_error: Option<String>,
    /// 原始 JSON 文本（写回时按 id 合并，保住 view 未覆盖的字段）。
    original_json: String,
    /// 项目文件路径（None 表示内嵌演示项目，不落盘）。
    pub(crate) file_path: Option<std::path::PathBuf>,
    /// 当前编辑的字段（None 表示不在编辑模式）。
    pub(crate) editing_field: Option<EditableField>,
    /// 编辑中的草稿（文本或数值字符串）。
    pub(crate) draft: String,
    /// 数值字段校验失败的友好提示。
    pub(crate) edit_error: Option<String>,
    /// 保存结果提示（成功/失败都展示给用户）。
    pub(crate) save_status: Option<String>,
    /// 另存为草稿路径（Some 表示正在输入另存为路径）。
    pub(crate) save_as_draft: Option<String>,
    /// 编辑历史快照栈（撤销/重做）。
    pub(crate) history: ProjectHistory,
}

impl ProjectState {
    /**
     * 从 v31 项目 JSON 加载桌面状态。
     *
     * @param json 经典版项目 JSON 文本
     * @returns {Result<ProjectState, ProjectError>} 状态；失败给友好错误
     */
    pub(crate) fn load(json: &str) -> Result<Self, ProjectError> {
        let view = read_classic_project(json).map_err(|error| ProjectError::Parse(error.to_string()))?;
        if view.scenes.is_empty() {
            return Err(ProjectError::EmptyScene);
        }
        if view.duration_ticks <= 0 {
            return Err(ProjectError::InvalidDuration(view.duration_ticks));
        }
        let history = ProjectHistory::new(&view, 0, None);
        Ok(Self {
            view,
            playhead_ticks: 0,
            selected_element_id: None,
            playing: false,
            last_shortcut: String::new(),
            source_label: "内嵌演示项目".to_owned(),
            load_error: None,
            original_json: json.to_owned(),
            file_path: None,
            editing_field: None,
            draft: String::new(),
            edit_error: None,
            save_status: None,
            save_as_draft: None,
            history,
        })
    }

    /// 加载默认演示项目。
    pub(crate) fn load_demo() -> Result<Self, ProjectError> {
        Self::load(DEMO_PROJECT_JSON)
    }

    /**
     * 从文件路径加载项目：读取文本后走与内嵌 fixture 相同的 core 兼容层。
     *
     * @param path 项目 JSON 路径
     * @returns {Result<ProjectState, ProjectError>} 状态；文件不存在/解析失败给友好错误
     */
    pub(crate) fn load_from_path(path: &Path) -> Result<Self, ProjectError> {
        let json = std::fs::read_to_string(path)
            .map_err(|error| ProjectError::ReadFile(format!("{}：{error}", path.display())))?;
        let mut state = Self::load(&json)?;
        state.source_label = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        state.file_path = Some(path.to_path_buf());
        Ok(state)
    }

    /**
     * 按「命令行 `--project` → 环境变量 `OPENCUT_PROJECT`」顺序解析项目路径。
     *
     * @returns {Option<String>} 路径（存在且非空时）
     */
    pub(crate) fn resolve_project_path() -> Option<String> {
        let args: Vec<String> = std::env::args().collect();
        if let Some(path) = Self::project_path_from_args(&args) {
            return Some(path);
        }
        std::env::var(PROJECT_ENV_VAR)
            .ok()
            .filter(|path| !path.trim().is_empty())
    }

    /**
     * 从参数列表解析 `--project <path>` 或 `--project=<path>`（纯函数便于单测）。
     *
     * @param args 程序参数（含 argv[0]）
     * @returns {Option<String>} 路径；缺值/空值返回 None
     */
    pub(crate) fn project_path_from_args(args: &[String]) -> Option<String> {
        for (index, argument) in args.iter().enumerate() {
            if argument == PROJECT_ARG {
                return args
                    .get(index + 1)
                    .cloned()
                    .filter(|path| !path.trim().is_empty());
            }
            if let Some(path) = argument.strip_prefix(&format!("{PROJECT_ARG}=")) {
                if !path.trim().is_empty() {
                    return Some(path.to_owned());
                }
            }
        }
        None
    }

    /// 导出配置：画布尺寸与帧率取自项目 settings，其余用过渡演示常量。
    pub(crate) fn profile(&self) -> ExportProfile {
        ExportProfile {
            container: DEMO_CONTAINER,
            codec: DEMO_CODEC,
            width: self.view.canvas.width,
            height: self.view.canvas.height,
            frame_rate: FrameRateSpec {
                numerator: self.view.fps.numerator,
                denominator: self.view.fps.denominator,
            },
            video_bitrate_bps: DEMO_VIDEO_BITRATE_BPS,
            include_audio: true,
            audio_sample_rate_hz: DEMO_AUDIO_SAMPLE_RATE_HZ,
            audio_channels: DEMO_AUDIO_CHANNELS,
        }
    }

    /// 过渡演示帧参数（与 H01 spike 相同，不从空 `params` 编造映射）。
    pub(crate) fn frame_params(&self) -> ocx_render::FrameParams {
        demo_frame_params()
    }

    /// 每帧 tick 数（帧率来自项目）。
    pub(crate) fn ticks_per_frame(&self) -> i64 {
        TICKS_PER_SECOND
            * i64::from(self.view.fps.denominator)
            / i64::from(self.view.fps.numerator)
    }

    /// 当前播放头对应的帧号（非法时回落 0）。
    pub(crate) fn frame_index(&self) -> u64 {
        frame_index_at_time(self.playhead_ticks, self.ticks_per_frame()).unwrap_or(0)
    }

    /// 拖动播放头，夹逼到 `[0, duration_ticks]`。
    pub(crate) fn seek(&mut self, ticks: i64) {
        self.playhead_ticks = clamp_ticks(ticks, self.view.duration_ticks);
    }

    /// 切换播放/暂停（空格键与播放按钮共用）。
    pub(crate) fn toggle_play(&mut self) {
        self.playing = !self.playing;
    }

    /// 按帧步进：正数前进、负数后退，同时暂停播放。
    pub(crate) fn step_frame(&mut self, delta: i64) {
        self.playing = false;
        let step = self.ticks_per_frame().saturating_mul(delta);
        self.seek(self.playhead_ticks.saturating_add(step));
    }

    /// 跳到开头并暂停。
    pub(crate) fn seek_start(&mut self) {
        self.playing = false;
        self.seek(0);
    }

    /// 跳到结尾并暂停。
    pub(crate) fn seek_end(&mut self) {
        self.playing = false;
        self.seek(self.view.duration_ticks);
    }

    /// 应用键盘快捷键并更新最近按键反馈；返回该键是否被识别。
    pub(crate) fn apply_shortcut(&mut self, key: &str) -> bool {
        self.last_shortcut = key.to_owned();
        match key {
            "space" => self.toggle_play(),
            "left" => self.step_frame(-1),
            "right" => self.step_frame(1),
            "home" => self.seek_start(),
            "end" => self.seek_end(),
            _ => return false,
        }
        true
    }

    /// 播放定时器推进一帧；到达结尾时自动停止，返回本帧是否真正推进。
    pub(crate) fn advance_playback(&mut self) -> bool {
        if !self.playing || self.playhead_ticks >= self.view.duration_ticks {
            self.playing = false;
            return false;
        }
        let step = self.ticks_per_frame();
        self.seek(self.playhead_ticks.saturating_add(step));
        if self.playhead_ticks >= self.view.duration_ticks {
            self.playing = false;
        }
        true
    }

    /// 选中元素；id 不存在时清空选择（不保留幽灵 id）。
    pub(crate) fn select(&mut self, id: Option<String>) {
        self.selected_element_id = id.filter(|candidate| self.find_element(candidate).is_some());
    }

    /// 按 id 查元素（跨全部场景/轨道）。
    pub(crate) fn find_element(&self, id: &str) -> Option<&ElementView> {
        self.view.scenes.iter().flat_map(|scene| &scene.tracks).flat_map(|track| &track.elements).find(|element| element.id == id)
    }

    /// 当前选中元素引用。
    pub(crate) fn selected_element(&self) -> Option<&ElementView> {
        self.selected_element_id.as_deref().and_then(|id| self.find_element(id))
    }

    /**
     * 进入指定字段的编辑模式：草稿初始化为该字段当前值，未选中元素时不进入。
     *
     * @param field 目标字段
     * @returns {bool} 是否成功进入编辑
     */
    pub(crate) fn begin_edit(&mut self, field: EditableField) -> bool {
        let initial = self.selected_element().map(|element| match field {
            EditableField::Name => element.name.clone().unwrap_or_default(),
            EditableField::StartTime => format!("{}", element.start_time as f64 / TICKS_PER_SECOND as f64),
            EditableField::Duration => format!("{}", element.duration as f64 / TICKS_PER_SECOND as f64),
            EditableField::TrimStart => format!("{}", element.trim_start as f64 / TICKS_PER_SECOND as f64),
            EditableField::TrimEnd => format!("{}", element.trim_end as f64 / TICKS_PER_SECOND as f64),
        });
        match initial {
            Some(value) => {
                self.draft = value;
                self.editing_field = Some(field);
                self.edit_error = None;
                true
            }
            None => false,
        }
    }

    /// 取消编辑，丢弃草稿与错误提示。
    pub(crate) fn cancel_edit(&mut self) {
        self.editing_field = None;
        self.draft.clear();
        self.edit_error = None;
    }

    /**
     * 统一键盘路由（纯函数，便于单测全分支）：编辑态键入进草稿，普通态 F2~F6 进入字段编辑。
     *
     * @param key `Keystroke.key` 字符串
     * @returns {KeyOutcome} 路由结果，UI 据此决定是否触发保存
     */
    pub(crate) fn handle_key(&mut self, key: &str) -> KeyOutcome {
        if let Some(field) = self.editing_field {
            return match key {
                "enter" => {
                    if self.commit_edit() {
                        KeyOutcome::CommitChanged
                    } else {
                        KeyOutcome::CommitUnchanged
                    }
                }
                "escape" => {
                    self.cancel_edit();
                    KeyOutcome::Cancel
                }
                "backspace" => {
                    self.draft.pop();
                    KeyOutcome::Draft
                }
                single if input_allowed(field, single) => {
                    self.draft.push_str(single);
                    KeyOutcome::Draft
                }
                _ => KeyOutcome::Ignored,
            };
        }
        if let Some(field) = EditableField::from_key(key) {
            return if self.begin_edit(field) {
                KeyOutcome::BeginEdit
            } else {
                KeyOutcome::Ignored
            };
        }
        if self.apply_shortcut(key) {
            KeyOutcome::Shortcut
        } else {
            KeyOutcome::Ignored
        }
    }

    /**
     * 提交当前草稿到选中元素（纯内存修改，不落盘）；数值非法时保留草稿并给 edit_error。
     *
     * @returns {bool} 是否有实际修改
     */
    pub(crate) fn commit_edit(&mut self) -> bool {
        let field = match self.editing_field {
            Some(field) => field,
            None => return false,
        };
        let edit_label = format!("编辑 {}", field.label());
        if self.draft.is_empty() {
            self.cancel_edit();
            return false;
        }

        // 提前确认元素存在，避免后续嵌套可变借用。
        if self.selected_element().is_none() {
            self.cancel_edit();
            return false;
        }

        let new_value = if field.is_numeric() {
            let ticks = match parse_seconds_to_ticks(&self.draft) {
                Some(ticks) => ticks,
                None => {
                    self.edit_error = Some("请输入 0 ~ 36000 之间的秒数".to_owned());
                    return false;
                }
            };
            // 交叉校验需要完整元素视图，这里用临时引用完成。
            let error = self.selected_element().and_then(|element| validate_edit(field, ticks, element));
            if let Some(message) = error {
                self.edit_error = Some(message);
                return false;
            }
            Some(ticks)
        } else {
            None
        };

        let id = match self.selected_element_id.as_deref() {
            Some(id) => id.to_owned(),
            None => {
                self.cancel_edit();
                return false;
            }
        };
        let changed = match self.view.scenes.iter_mut().flat_map(|scene| &mut scene.tracks).flat_map(|track| &mut track.elements).find(|element| element.id == id) {
            Some(element) => {
                match field {
                    EditableField::Name => {
                        let name = self.draft.clone();
                        if element.name.as_deref() == Some(name.as_str()) {
                            false
                        } else {
                            element.name = Some(name);
                            true
                        }
                    }
                    EditableField::StartTime => {
                        let ticks = new_value.unwrap();
                        if element.start_time == ticks { false } else { element.start_time = ticks; true }
                    }
                    EditableField::Duration => {
                        let ticks = new_value.unwrap();
                        if element.duration == ticks { false } else { element.duration = ticks; true }
                    }
                    EditableField::TrimStart => {
                        let ticks = new_value.unwrap();
                        if element.trim_start == ticks { false } else { element.trim_start = ticks; true }
                    }
                    EditableField::TrimEnd => {
                        let ticks = new_value.unwrap();
                        if element.trim_end == ticks { false } else { element.trim_end = ticks; true }
                    }
                }
            }
            None => false,
        };
        self.cancel_edit();
        if changed {
            self.history.push(
                &self.view,
                self.playhead_ticks,
                self.selected_element_id.as_deref(),
                &edit_label,
            );
        }
        changed
    }

    /**
     * 撤销一步：把历史前一快照恢复为当前项目状态。
     *
     * @returns {bool} 是否实际发生恢复
     */
    pub(crate) fn undo(&mut self) -> bool {
        let Some(snapshot) = self.history.travel(-1) else {
            return false;
        };
        self.apply_snapshot(snapshot);
        true
    }

    /**
     * 重做一步：把历史后一快照恢复为当前项目状态。
     *
     * @returns {bool} 是否实际发生恢复
     */
    pub(crate) fn redo(&mut self) -> bool {
        let Some(snapshot) = self.history.travel(1) else {
            return false;
        };
        self.apply_snapshot(snapshot);
        true
    }

    /**
     * 恢复快照到当前状态（项目视图 + 播放头 + 选中元素），并退出编辑态。
     *
     * @param snapshot 目标快照
     */
    fn apply_snapshot(&mut self, snapshot: crate::_project_history::HistorySnapshot) {
        self.view = snapshot.view;
        self.playhead_ticks = snapshot.playhead_ticks;
        self.selected_element_id = snapshot.selected_element_id;
        self.editing_field = None;
        self.draft.clear();
        self.edit_error = None;
    }

    /// 历史摘要（供 UI 显示）。
    pub(crate) fn history_label(&self) -> String {
        self.history.label()
    }

    /**
     * 把当前 view 写回原 JSON 并落盘：复用 core 的原文合并，保住未覆盖字段；写后再读校验。
     *
     * @returns {Result<(), ProjectError>} 成功或友好错误（内嵌演示项目无文件路径，拒绝保存）
     */
    pub(crate) fn save_to_file(&self) -> Result<(), ProjectError> {
        let path = self.file_path.as_ref().ok_or_else(|| {
            ProjectError::WriteFile("内嵌演示项目没有文件路径，请按 Ctrl+Shift+S 另存为".to_owned())
        })?;
        self.write_to_path(path)
    }

    /**
     * 把当前 view 写到指定路径（写回→往返校验→落盘），供另存为复用。
     *
     * @param path 目标文件路径
     * @returns {Result<(), ProjectError>} 成功或友好错误
     */
    pub(crate) fn write_to_path(&self, path: &std::path::Path) -> Result<(), ProjectError> {
        let written = write_classic_project(&self.original_json, &self.view)
            .map_err(|error| ProjectError::WriteFile(format!("生成项目 JSON 失败：{error}")))?;
        // 写后往返自检：确保产物可被 core 再次解析，避免落盘坏文件。
        read_classic_project(&written)
            .map_err(|error| ProjectError::WriteFile(format!("写后校验失败：{error}")))?;
        std::fs::write(path, written)
            .map_err(|error| ProjectError::WriteFile(format!("{}：{error}", path.display())))?;
        Ok(())
    }

    /// 进入另存为模式：草稿初始化为空路径。
    pub(crate) fn begin_save_as(&mut self) {
        self.save_as_draft = Some(String::new());
        self.edit_error = None;
    }

    /// 处理另存为草稿键；返回 Some(路径) 表示提交，None 表示未提交（取消/继续输入/不在模式）。
    pub(crate) fn handle_save_as_key(&mut self, key: &str) -> Option<String> {
        let draft = self.save_as_draft.clone();
        match save_as_key(draft.as_deref(), key) {
            Some((next, commit)) => {
                self.save_as_draft = if commit { None } else { Some(next.clone()) };
                if commit { Some(next) } else { None }
            }
            None => {
                self.save_as_draft = None;
                None
            }
        }
    }

    /**
     * 另存为到指定路径并切换当前项目路径/来源标签。
     *
     * @param path 目标路径
     * @returns {Result<(), ProjectError>} 成功或友好错误
     */
    pub(crate) fn save_as_to_path(&mut self, path: std::path::PathBuf) -> Result<(), ProjectError> {
        self.write_to_path(&path)?;
        self.source_label = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        self.file_path = Some(path);
        Ok(())
    }

    /// 时刻 `ticks` 的可见元素：主轨优先，其次 overlay，其余轨忽略。
    pub(crate) fn visible_element_at(&self, ticks: i64) -> Option<&ElementView> {
        let mut fallback = None;
        for track in self.view.scenes.iter().flat_map(|scene| &scene.tracks) {
            for element in &track.elements {
                if element_visible_at(element, ticks) {
                    if track.id == MAIN_TRACK_ID {
                        return Some(element);
                    }
                    if fallback.is_none() {
                        fallback = Some(element);
                    }
                }
            }
        }
        fallback
    }
}

/**
 * 元素在时刻 `ticks` 是否可见（左闭右开区间 `[start, start+duration)`）。
 *
 * @param element 元素视图
 * @param ticks 播放头 ticks
 * @returns {bool} 可见返回 true
 */
pub(crate) fn element_visible_at(element: &ElementView, ticks: i64) -> bool {
    ticks >= element.start_time && ticks < element.start_time + element.duration
}

/**
 * 把 tick 夹逼到 `[0, duration]`。
 *
 * @param ticks 输入 tick
 * @param duration 项目时长
 * @returns {i64} 夹逼后的 tick
 */
pub(crate) fn clamp_ticks(ticks: i64, duration: i64) -> i64 {
    ticks.clamp(0, duration.max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 正常值：演示项目应解析成功，且画布/帧率/时长与 fixture 一致。
    #[test]
    fn load_demo_reads_project_settings() {
        let state = ProjectState::load_demo().expect("演示项目应可加载");
        assert_eq!(state.view.canvas.width, 1920);
        assert_eq!(state.view.canvas.height, 1080);
        assert_eq!(state.view.fps.numerator, 30);
        assert_eq!(state.view.fps.denominator, 1);
        assert_eq!(state.view.duration_ticks, 360_000);
        assert_eq!(state.playhead_ticks, 0);
        assert_eq!(state.profile().width, 1920);
        assert_eq!(state.profile().height, 1080);
        assert_eq!(state.ticks_per_frame(), TICKS_PER_SECOND / 30);
    }

    /// 边界值：可见性判定左闭右开，首尾不越界。
    #[test]
    fn element_visible_at_is_half_open() {
        let state = ProjectState::load_demo().expect("演示项目应可加载");
        let intro = state.find_element("clip-intro").expect("intro 片段应存在");
        assert!(element_visible_at(intro, 0));
        assert!(element_visible_at(intro, 119_999));
        assert!(!element_visible_at(intro, 120_000));
        assert!(!element_visible_at(intro, -1));
    }

    /// 正常值：主轨可见元素随播放头切换，超出时长后为空。
    #[test]
    fn visible_element_follows_playhead() {
        let state = ProjectState::load_demo().expect("演示项目应可加载");
        assert_eq!(state.visible_element_at(0).map(|e| e.id.as_str()), Some("clip-intro"));
        assert_eq!(state.visible_element_at(150_000).map(|e| e.id.as_str()), Some("clip-body"));
        assert!(state.visible_element_at(400_000).is_none());
    }

    /// 边界值：seek 夹逼到项目时长范围；未知 id 选择被清空。
    #[test]
    fn seek_and_select_clamp_invalid_input() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        state.seek(-10);
        assert_eq!(state.playhead_ticks, 0);
        state.seek(999_999);
        assert_eq!(state.playhead_ticks, 360_000);
        state.select(Some("not-exist".to_owned()));
        assert_eq!(state.selected_element_id, None);
        state.select(Some("clip-body".to_owned()));
        assert_eq!(state.selected_element().map(|e| e.id.as_str()), Some("clip-body"));
    }

    /// 异常值：非法 JSON / 空场景 / 零时长均返回错误而非 panic。
    #[test]
    fn invalid_project_returns_error() {
        assert!(matches!(ProjectState::load("{}"), Err(ProjectError::Parse(_))));
        let empty = r#"{"version":31,"metadata":{"id":"p","name":"p","duration":0},"scenes":[],"currentSceneId":"","settings":{"fps":{"numerator":30,"denominator":1},"canvasSize":{"width":1920,"height":1080}}}"#;
        assert!(matches!(
            ProjectState::load(empty),
            Err(ProjectError::EmptyScene)
        ));
    }

    /// 正常值 + 异常值：另存为落盘到新路径并切换当前项目，内嵌项目也可另存。
    #[test]
    fn save_as_writes_new_path_and_switches_source() {
        let temp_dir = std::env::temp_dir().join(format!("opencut-save-as-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("临时目录应可创建");

        // 内嵌演示项目没有路径，原样保存失败，但另存为到新路径应成功。
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        assert!(state.save_to_file().is_err());
        state.begin_save_as();
        assert_eq!(state.save_as_draft.as_deref(), Some(""));
        assert_eq!(state.handle_save_as_key("x"), None);
        assert_eq!(state.save_as_draft.as_deref(), Some("x"));
        assert_eq!(state.handle_save_as_key("backspace"), None);
        assert_eq!(state.save_as_draft.as_deref(), Some(""));

        for ch in "saved-as-v31.json".chars() {
            assert_eq!(state.handle_save_as_key(&ch.to_string()), None);
        }
        let committed = state.handle_save_as_key("enter").expect("Enter 应提交路径");
        assert_eq!(committed, "saved-as-v31.json");
        assert!(state.save_as_draft.is_none());
        let write_path = temp_dir.join(committed);
        state.save_as_to_path(write_path.clone()).expect("另存为应成功");
        assert_eq!(state.source_label, "saved-as-v31.json");
        let saved = std::fs::read_to_string(&write_path).expect("另存文件应可读");
        assert!(saved.contains("\"version\": 31") || saved.contains("\"version\":31"));
        assert!(saved.contains("timelineViewState"), "未知字段必须保留");

        // 切换后 Ctrl+S 应写到新路径。
        state.save_to_file().expect("切换后保存应成功");
        assert_eq!(std::fs::read_to_string(&write_path).expect("文件应可读"), saved);

        // Esc 取消另存为不留草稿。
        state.begin_save_as();
        assert_eq!(state.handle_save_as_key("escape"), None);
        assert!(state.save_as_draft.is_none());
        std::fs::remove_dir_all(&temp_dir).expect("临时目录应可清理");
    }

    /// 边界值：clamp_ticks 在负时长下不产生负 tick。
    #[test]
    fn clamp_ticks_handles_negative_duration() {
        assert_eq!(clamp_ticks(5, -1), 0);
        assert_eq!(clamp_ticks(5, 10), 5);
    }

    /// 正常值 + 边界值：name 编辑全键盘路由（F2 进入、键入/退格、Enter 提交、Esc 取消）。
    #[test]
    fn name_edit_keyboard_route_covers_all_branches() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        state.select(Some("clip-intro".to_owned()));

        assert_eq!(state.handle_key("f2"), KeyOutcome::BeginEdit);
        assert_eq!(state.editing_field, Some(EditableField::Name));
        assert_eq!(state.draft, "Intro");
        assert_eq!(state.handle_key("x"), KeyOutcome::Draft);
        assert_eq!(state.handle_key("y"), KeyOutcome::Draft);
        assert_eq!(state.handle_key("backspace"), KeyOutcome::Draft);
        assert_eq!(state.draft, "Introx");
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitChanged);
        assert_eq!(state.editing_field, None);
        assert_eq!(state.selected_element().and_then(|e| e.name.clone()).as_deref(), Some("Introx"));

        // 未选中时 F2 无效；Esc 取消草稿；空草稿 Enter 判为未变更。
        let mut empty = ProjectState::load_demo().expect("演示项目应可加载");
        assert_eq!(empty.handle_key("f2"), KeyOutcome::Ignored);
        empty.select(Some("clip-intro".to_owned()));
        assert_eq!(empty.handle_key("f2"), KeyOutcome::BeginEdit);
        assert_eq!(empty.handle_key("escape"), KeyOutcome::Cancel);
        assert_eq!(empty.draft, "");
        assert_eq!(empty.handle_key("f2"), KeyOutcome::BeginEdit);
        empty.draft.clear();
        assert_eq!(empty.handle_key("enter"), KeyOutcome::CommitUnchanged);
    }

    /// 正常值 + 异常值：数值字段编辑（起点/时长/修剪）的键盘路由、校验与提交。
    #[test]
    fn numeric_fields_edit_with_validation() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        state.select(Some("clip-intro".to_owned()));

        // F3 起点：草稿初始化为 0 秒，键入 0.5 后提交 → 60000 ticks。
        assert_eq!(state.handle_key("f3"), KeyOutcome::BeginEdit);
        assert_eq!(state.editing_field, Some(EditableField::StartTime));
        assert_eq!(state.draft, "0");
        state.draft = "0.5".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitChanged);
        assert_eq!(state.selected_element().map(|e| e.start_time), Some(60_000));

        // F4 时长：1.5 秒 → 180000 ticks。
        assert_eq!(state.handle_key("f4"), KeyOutcome::BeginEdit);
        state.draft = "1.5".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitChanged);
        assert_eq!(state.selected_element().map(|e| e.duration), Some(180_000));

        // F5/F6 修剪：各自 0.25 秒，合计 0.5s < 1.5s 时长。
        assert_eq!(state.handle_key("f5"), KeyOutcome::BeginEdit);
        state.draft = "0.25".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitChanged);
        assert_eq!(state.handle_key("f6"), KeyOutcome::BeginEdit);
        state.draft = "0.25".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitChanged);
        assert_eq!(state.selected_element().map(|e| e.trim_start), Some(30_000));
        assert_eq!(state.selected_element().map(|e| e.trim_end), Some(30_000));

        // 数值字段拒绝非数字字符；非法/越界输入保留草稿并给中文错误。
        assert_eq!(state.handle_key("f4"), KeyOutcome::BeginEdit);
        assert_eq!(state.handle_key("x"), KeyOutcome::Ignored);
        state.draft = "abc".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitUnchanged);
        assert_eq!(state.edit_error.as_deref(), Some("请输入 0 ~ 36000 之间的秒数"));
        state.draft = "0".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitUnchanged);
        assert_eq!(state.edit_error.as_deref(), Some("时长必须大于 0"));
        state.cancel_edit();

        // 修剪总长超过时长时拒绝。
        let element = state.selected_element().expect("元素应存在").clone();
        assert!(validate_edit(EditableField::TrimStart, 180_000, &element).is_some());
        assert!(validate_edit(EditableField::StartTime, -1, &element).is_some());
        assert!(validate_edit(EditableField::Name, 0, &element).is_none());
    }

    /// 正常值 + 异常值：编辑后写回原 JSON，未知字段保留且产物可再次解析。
    #[test]
    fn save_writes_back_preserving_unknown_fields() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/public/fixtures/classic-project-v31.json");
        let original = std::fs::read_to_string(&fixture).expect("fixture 应可读");
        let mut state = ProjectState::load(&original).expect("fixture 应可加载");
        state.select(Some("clip-intro".to_owned()));
        assert_eq!(state.handle_key("f2"), KeyOutcome::BeginEdit);
        state.draft = "已改名片段".to_owned();
        assert_eq!(state.handle_key("enter"), KeyOutcome::CommitChanged);

        let written = write_classic_project(&original, &state.view).expect("写回应成功");
        assert!(written.contains("已改名片段"));
        // 原始文档里的视图外字段必须原样保留。
        assert!(written.contains("timelineViewState") && written.contains("canvasSizeMode"));
        let reparsed = read_classic_project(&written).expect("写回产物应可再次解析");
        assert_eq!(reparsed.duration_ticks, 360_000);
        assert!(reparsed.scenes.iter().flat_map(|s| &s.tracks).flat_map(|t| &t.elements).any(|e| e.name.as_deref() == Some("已改名片段")));

        // 真实落盘：写入临时文件 → 文件字节含新名称 → 清理临时文件。
        let temp_dir = std::env::temp_dir().join(format!("opencut-save-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("临时目录应可创建");
        let temp_path = temp_dir.join("project-v31.json");
        std::fs::write(&temp_path, &original).expect("临时项目文件应可写");
        let mut file_state = ProjectState::load_from_path(&temp_path).expect("临时项目应可加载");
        file_state.select(Some("clip-intro".to_owned()));
        file_state.begin_edit(EditableField::Name);
        file_state.draft = "落盘验证".to_owned();
        assert_eq!(file_state.handle_key("enter"), KeyOutcome::CommitChanged);
        file_state.save_to_file().expect("保存应成功");
        let saved = std::fs::read_to_string(&temp_path).expect("保存后文件应可读");
        assert!(saved.contains("落盘验证"));
        assert!(saved.contains("timelineViewState"), "未知字段必须保留");
        std::fs::remove_dir_all(&temp_dir).expect("临时目录应可清理");

        // 内嵌演示项目无文件路径，保存应返回友好错误而非 panic。
        let demo = ProjectState::load_demo().expect("演示项目应可加载");
        assert!(matches!(demo.save_to_file(), Err(ProjectError::WriteFile(_))));
    }

    /// 正常值：播放开关与逐帧步进（前后退、自动暂停、边界夹逼）。
    #[test]
    fn playback_controls_step_and_pause() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        assert!(!state.playing);
        state.toggle_play();
        assert!(state.playing);
        state.step_frame(1);
        assert!(!state.playing);
        assert_eq!(state.playhead_ticks, state.ticks_per_frame());
        state.step_frame(-1);
        assert_eq!(state.playhead_ticks, 0);
        state.step_frame(-10);
        assert_eq!(state.playhead_ticks, 0);
        state.seek_end();
        assert_eq!(state.playhead_ticks, 360_000);
        state.seek_start();
        assert_eq!(state.playhead_ticks, 0);
    }

    /// 正常值 + 异常值：快捷键全分支分发（播放/逐帧/首尾/未知键）。
    #[test]
    fn apply_shortcut_covers_all_branches() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        assert!(state.apply_shortcut("space"));
        assert!(state.playing);
        assert_eq!(state.last_shortcut, "space");

        assert!(state.apply_shortcut("right"));
        assert!(!state.playing);
        assert_eq!(state.playhead_ticks, state.ticks_per_frame());
        assert!(state.apply_shortcut("left"));
        assert_eq!(state.playhead_ticks, 0);

        assert!(state.apply_shortcut("end"));
        assert_eq!(state.playhead_ticks, 360_000);
        assert!(state.apply_shortcut("home"));
        assert_eq!(state.playhead_ticks, 0);

        assert!(!state.apply_shortcut("unknown"));
        assert_eq!(state.last_shortcut, "unknown");
        assert_eq!(state.playhead_ticks, 0);
    }

    /// 边界值：播放推进到结尾自动停止，暂停后不再推进。
    #[test]
    fn advance_playback_stops_at_end() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        assert!(!state.advance_playback());
        state.toggle_play();
        let mut advanced = 0;
        while state.playing {
            assert!(state.advance_playback());
            advanced += 1;
            assert!(advanced <= 100, "3 秒 30fps 应在 90 帧内结束");
        }
        assert_eq!(advanced, 90);
        assert_eq!(state.playhead_ticks, 360_000);
        assert!(!state.advance_playback());
    }

    /// 正常值：命令行 `--project` 两种写法均可解析，且优先于无参数情况。
    #[test]
    fn project_path_from_args_accepts_both_forms() {
        let args = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            ProjectState::project_path_from_args(&args(&["ocx-desktop", "--project", "a.json"])),
            Some("a.json".to_owned())
        );
        assert_eq!(
            ProjectState::project_path_from_args(&args(&["ocx-desktop", "--project=b.json"])),
            Some("b.json".to_owned())
        );
        assert_eq!(ProjectState::project_path_from_args(&args(&["ocx-desktop"])), None);
        assert_eq!(
            ProjectState::project_path_from_args(&args(&["ocx-desktop", "--project"])),
            None
        );
        assert_eq!(
            ProjectState::project_path_from_args(&args(&["ocx-desktop", "--project="])),
            None
        );
    }

    /// 正常值 + 异常值：按路径加载 Web fixture 成功并带来源标签；不存在的文件返回 ReadFile。
    #[test]
    fn load_from_path_handles_success_and_missing_file() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/public/fixtures/classic-project-v31.json");
        let state = ProjectState::load_from_path(&fixture).expect("fixture 应可加载");
        assert_eq!(state.source_label, "classic-project-v31.json");
        assert_eq!(state.view.duration_ticks, 360_000);
        assert!(state.load_error.is_none());

        let missing = fixture.with_file_name("does-not-exist-v31.json");
        assert!(matches!(
            ProjectState::load_from_path(&missing),
            Err(ProjectError::ReadFile(_))
        ));
    }

    /// 撤销/重做：提交编辑后可恢复原始视图，边界处返回 false。
    #[test]
    fn undo_redo_restores_view() {
        let mut state = ProjectState::load_demo().expect("演示项目应可加载");
        assert!(!state.undo());
        let original = state.view.clone();
        let first_id = state.view.scenes.iter()
            .flat_map(|scene| &scene.tracks)
            .flat_map(|track| &track.elements)
            .next()
            .map(|element| element.id.clone())
            .expect("应有片段");
        state.selected_element_id = Some(first_id);
        state.editing_field = Some(EditableField::Name);
        state.draft = "改名".to_owned();
        assert!(state.commit_edit());
        assert_ne!(state.view, original);
        assert!(state.undo());
        assert_eq!(state.view, original);
        assert!(state.redo());
        assert_ne!(state.view, original);
        assert!(!state.redo());
    }
}
