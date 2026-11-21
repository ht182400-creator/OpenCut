//! W-14 桌面项目状态：加载 v31 项目、维护播放头与选中、派生帧参数。
//!
//! 过渡边界（ADR-04）：预览帧仍由 `ocx_render::render_frame` 演示合成，与 Web/CLI/WASM
//! core 指纹一致；fixture 的元素 `params` 为空，不编造颜色/位置映射。真实素材解码与
//! 本地像素合成（Web 正式模式所用管线）属于后续独立工作。

use std::fmt;

use ocx_domain::{ElementView, ProjectView, read_classic_project};
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

/// 项目加载错误：统一给 UI 中文提示，不 panic。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProjectError {
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
        Ok(Self {
            view,
            playhead_ticks: 0,
            selected_element_id: None,
            playing: false,
            last_shortcut: String::new(),
        })
    }

    /// 加载默认演示项目（`load_demo` 的别名，便于 shell 一行调用）。
    pub(crate) fn load_demo() -> Result<Self, ProjectError> {
        Self::load(DEMO_PROJECT_JSON)
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

    /// 边界值：clamp_ticks 在负时长下不产生负 tick。
    #[test]
    fn clamp_ticks_handles_negative_duration() {
        assert_eq!(clamp_ticks(5, -1), 0);
        assert_eq!(clamp_ticks(5, 10), 5);
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
}
