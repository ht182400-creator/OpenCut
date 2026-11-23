//! W-14 桌面 OTIO 导入导出（批 10）：`ProjectView` ↔ `ocx-io::EditTimeline` 桥接。
//!
//! core 的 `ocx-io` 已完全达标（W-10 六批、官方 OTIO 往返 42/42），本模块只做
//! 字段映射与路径接线，不重写交换格式。导入只取视频轨非 Gap/Transition 片段，
//! 与 Web `editTimelineToClips` 语义一致；导出写单条 main 轨。路径由启动参数
//! `--otio` / 环境变量 `OPENCUT_OTIO` 与项目同目录固定文件名决定，不做交互对话框。

use std::fmt;
use std::path::{Path, PathBuf};

use ocx_domain::{ElementView, ProjectView};
use ocx_io::{EditClip, EditTimeline, EditTrack, export_otio, import_otio};

use crate::project::ProjectState;

/// 命令行 OTIO 输入参数名。
const OTIO_ARG: &str = "--otio";
/// OTIO 路径环境变量。
const OTIO_ENV_VAR: &str = "OPENCUT_OTIO";
/// 导出文件扩展名。
const OTIO_EXTENSION: &str = "otio";
/// 项目名为空时的导出文件名。
const DEFAULT_OTIO_NAME: &str = "timeline";
/// 导入片段的默认元素类型（与 Web 片段模型一致）。
const DEFAULT_ELEMENT_TYPE: &str = "video";
/// 主轨 id（经典版固定为 `main`）。
const MAIN_TRACK_ID: &str = "main";
/// 新建 OTIO 时间线的 schema 版本（additive-only 基线）。
const OTIO_SCHEMA_VERSION: u32 = 1;

/// OTIO 桌面桥接错误（统一给 UI 中文提示）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OtioDesktopError {
    /// 导入文件读取失败。
    ReadFile(String),
    /// core 拒绝该 OTIO 文本（含稳定错误码）。
    Import(String),
    /// OTIO 没有可用的视频轨片段。
    NoClips,
    /// core 拒绝导出。
    Export(String),
    /// 内嵌项目无落盘目录，无法确定导出路径。
    NoProjectDir,
    /// 导出文件写入失败。
    WriteFile(String),
}

impl fmt::Display for OtioDesktopError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            OtioDesktopError::ReadFile(detail) => format!("OTIO 文件读取失败：{detail}"),
            OtioDesktopError::Import(detail) => format!("OTIO 导入被拒绝（{detail}）；请检查文件格式"),
            OtioDesktopError::NoClips => "OTIO 文件没有可用的视频轨片段（Gap 与转场不会导入）".to_owned(),
            OtioDesktopError::Export(detail) => format!("OTIO 导出失败（{detail}）"),
            OtioDesktopError::NoProjectDir => "内嵌演示项目没有目录，请先另存为项目再导出 OTIO".to_owned(),
            OtioDesktopError::WriteFile(detail) => format!("OTIO 文件写入失败：{detail}"),
        };
        write!(formatter, "{message}")
    }
}

/**
 * 从命令行参数解析 `--otio <path>` / `--otio=<path>`。
 *
 * @param args 完整命令行参数（含程序名）
 * @returns {Option<String>} 非空路径
 */
pub(crate) fn otio_path_from_args(args: &[String]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        if arg == OTIO_ARG {
            return args.get(index + 1).filter(|path| !path.trim().is_empty()).cloned();
        }
        if let Some(path) = arg.strip_prefix(&format!("{OTIO_ARG}=")) {
            if !path.trim().is_empty() {
                return Some(path.to_owned());
            }
        }
    }
    None
}

/**
 * 按「命令行 `--otio` → 环境变量 `OPENCUT_OTIO`」解析 OTIO 输入路径。
 *
 * @returns {Option<String>} 路径
 */
pub(crate) fn resolve_otio_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(path) = otio_path_from_args(&args) {
        return Some(path);
    }
    std::env::var(OTIO_ENV_VAR)
        .ok()
        .filter(|path| !path.trim().is_empty())
}

/**
 * 从 OTIO 文本导入片段并替换项目主轨（不修改输入视图）。
 *
 * @param view 当前项目视图
 * @param text OTIO JSON 文本
 * @returns {Result<ProjectView, OtioDesktopError>} 新视图或友好错误
 */
pub(crate) fn import_into_view(
    view: &ProjectView,
    text: &str,
) -> Result<ProjectView, OtioDesktopError> {
    let timeline = import_otio(text).map_err(|error| OtioDesktopError::Import(error.to_string()))?;
    let video = timeline.tracks.iter()
        .find(|track| track.kind.eq_ignore_ascii_case("video"))
        .or_else(|| timeline.tracks.first())
        .ok_or(OtioDesktopError::NoClips)?;
    let clips: Vec<&EditClip> = video.clips.iter()
        .filter(|clip| !clip.is_gap && !clip.is_transition)
        .collect();
    if clips.is_empty() {
        return Err(OtioDesktopError::NoClips);
    }

    let mut next = view.clone();
    // 先按不可变借用在场景中定位 (scene, track)，再按索引取可变借用，避免二次借用冲突。
    let mut location = None;
    'search: for (scene_index, scene) in next.scenes.iter().enumerate() {
        for (track_index, track) in scene.tracks.iter().enumerate() {
            if track.id == MAIN_TRACK_ID {
                location = Some((scene_index, track_index));
                break 'search;
            }
        }
    }
    if location.is_none() {
        for (scene_index, scene) in next.scenes.iter().enumerate() {
            if !scene.tracks.is_empty() {
                location = Some((scene_index, 0));
                break;
            }
        }
    }
    let (scene_index, track_index) = location.ok_or(OtioDesktopError::NoClips)?;
    let track = &mut next.scenes[scene_index].tracks[track_index];
    track.elements = clips.into_iter().map(|clip| ElementView {
        id: clip.id.clone(),
        element_type: DEFAULT_ELEMENT_TYPE.to_owned(),
        start_time: clip.start_ticks,
        duration: clip.duration_ticks,
        trim_start: clip.source_start_ticks,
        trim_end: 0,
        name: Some(if clip.name.is_empty() { clip.id.clone() } else { clip.name.clone() }),
        media_id: clip.media_url.clone(),
        content: None,
        params: None,
    }).collect();
    track.element_count = track.elements.len();
    next.duration_ticks = next.scenes.iter()
        .flat_map(|scene| &scene.tracks)
        .flat_map(|track| &track.elements)
        .map(|element| element.start_time.saturating_add(element.duration))
        .max()
        .unwrap_or(0)
        .max(1);
    Ok(next)
}

/**
 * 把项目主轨导出为 OTIO 时间线视图。
 *
 * @param view 当前项目视图
 * @returns {EditTimeline} 内部时间线（供 core 序列化）
 */
fn view_to_timeline(view: &ProjectView) -> EditTimeline {
    let fps = view.fps.numerator as f64 / view.fps.denominator as f64;
    let clips = view.scenes.iter()
        .flat_map(|scene| &scene.tracks)
        .find(|track| track.id == MAIN_TRACK_ID)
        .or_else(|| view.scenes.iter().flat_map(|scene| &scene.tracks).next())
        .map(|track| track.elements.as_slice())
        .unwrap_or(&[])
        .iter()
        .map(|element| EditClip {
            id: element.id.clone(),
            // OTIO 不保留内部 id；按 Web clipsToEditTimeline 语义把 id 写入 name，
            // 使 import_otio 重建的 clip.id 与原始 id 一致，保证 decision_key 往返稳定。
            name: element.id.clone(),
            is_gap: false,
            start_ticks: element.start_time,
            duration_ticks: element.duration,
            source_start_ticks: element.trim_start,
            media_url: element.media_id.clone(),
            source_value: None,
            duration_value: None,
            source_rate: None,
            is_transition: false,
            in_offset_ticks: 0,
            out_offset_ticks: 0,
            transition_type: None,
            effects: Vec::new(),
            markers: Vec::new(),
        })
        .collect();
    EditTimeline {
        name: view.name.clone(),
        schema_version: OTIO_SCHEMA_VERSION,
        rate: fps,
        tracks: vec![EditTrack {
            id: "main".to_owned(),
            name: "main".to_owned(),
            kind: "Video".to_owned(),
            clips,
            markers: Vec::new(),
        }],
        markers: Vec::new(),
        nested_stacks: Vec::new(),
        warnings: Vec::new(),
    }
}

/**
 * 从项目视图导出 OTIO JSON 文本。
 *
 * @param view 当前项目视图
 * @returns {Result<String, OtioDesktopError>} OTIO 文本或友好错误
 */
pub(crate) fn export_from_view(view: &ProjectView) -> Result<String, OtioDesktopError> {
    let timeline = view_to_timeline(view);
    export_otio(&timeline).map_err(|error| OtioDesktopError::Export(error.to_string()))
}

/**
 * 计算 OTIO 导出路径：项目同目录下 `<项目名>.otio`。
 *
 * @param view 项目视图（取名称）
 * @param project_path 当前项目文件路径（None 表示内嵌项目）
 * @returns {Result<PathBuf, OtioDesktopError>} 输出路径
 */
pub(crate) fn export_path_for(
    view: &ProjectView,
    project_path: Option<&Path>,
) -> Result<PathBuf, OtioDesktopError> {
    let project = project_path.ok_or(OtioDesktopError::NoProjectDir)?;
    let directory = project.parent().ok_or(OtioDesktopError::NoProjectDir)?;
    let stem = if view.name.trim().is_empty() {
        DEFAULT_OTIO_NAME
    } else {
        view.name.trim()
    };
    Ok(directory.join(format!("{stem}.{OTIO_EXTENSION}")))
}

/**
 * 把 OTIO 文本导入到共享状态：成功后记录历史与写回，失败写入友好提示。
 *
 * @param state 桌面项目状态
 * @param text OTIO JSON 文本
 * @returns {bool} 是否实际修改了视图
 */
pub(crate) fn apply_import(state: &mut ProjectState, text: &str) -> bool {
    match import_into_view(&state.view, text) {
        Ok(view) => {
            state.view = view;
            state.edit_error = None;
            state.selected_element_id = None;
            state.playhead_ticks = 0;
            state.history.push(&state.view, 0, None, "导入 OTIO");
            let message = match state.save_to_file() {
                Ok(()) => "OTIO 已导入并保存到原项目".to_owned(),
                Err(error) => error.to_string(),
            };
            state.save_status = Some(message);
            true
        }
        Err(error) => {
            state.edit_error = Some(error.to_string());
            false
        }
    }
}

/**
 * 把共享状态的主轨导出为 OTIO 文件并提示结果。
 *
 * @param state 桌面项目状态
 * @returns {Result<PathBuf, OtioDesktopError>} 输出路径或友好错误
 */
pub(crate) fn apply_export(state: &ProjectState) -> Result<PathBuf, OtioDesktopError> {
    let text = export_from_view(&state.view)?;
    let path = export_path_for(&state.view, state.file_path.as_deref())?;
    std::fs::write(&path, text).map_err(|error| OtioDesktopError::WriteFile(error.to_string()))?;
    Ok(path)
}

/**
 * 导出并把结果（成功路径 / 友好错误）写入状态提示。
 *
 * @param state 桌面项目状态
 */
pub(crate) fn export_to_status(state: &mut ProjectState) {
    let message = match apply_export(state) {
        Ok(path) => format!("OTIO 已导出到 {}", path.display()),
        Err(error) => error.to_string(),
    };
    state.save_status = Some(message);
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 简易参数数组构造。 */
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    /**
     * 构造测试视图（复用内嵌 v31 fixture）。
     *
     * @returns {ProjectView} 测试视图
     */
    fn demo_view() -> ProjectView {
        ocx_domain::read_classic_project(crate::project::DEMO_PROJECT_JSON)
            .expect("内嵌 v31 fixture 应可解析")
    }

    /// 参数解析覆盖两种写法与缺失/空值。
    #[test]
    fn otio_path_from_args_covers_both_forms() {
        assert_eq!(otio_path_from_args(&args(&["app", "--otio", "a.otio"])), Some("a.otio".to_owned()));
        assert_eq!(otio_path_from_args(&args(&["app", "--otio=b.otio"])), Some("b.otio".to_owned()));
        assert_eq!(otio_path_from_args(&args(&["app", "--otio="])), None);
        assert_eq!(otio_path_from_args(&args(&["app", "--otio"])), None);
        assert_eq!(otio_path_from_args(&args(&["app"])), None);
    }

    /// 导出→导入往返：片段 id/起点/时长/素材入点逐项一致，decision_key 不变。
    #[test]
    fn export_import_roundtrip_preserves_decisions() {
        let view = demo_view();
        let text = export_from_view(&view).expect("导出应成功");
        let source = view_to_timeline(&view);
        let imported_timeline = import_otio(&text).expect("导入应成功");
        assert_eq!(ocx_io::decision_key(&source), ocx_io::decision_key(&imported_timeline));

        let restored = import_into_view(&view, &text).expect("视图导入应成功");
        let source_elements: Vec<&ElementView> = view.scenes.iter()
            .flat_map(|scene| &scene.tracks)
            .find(|track| track.id == MAIN_TRACK_ID)
            .expect("应有主轨")
            .elements.iter().collect();
        let restored_elements: Vec<&ElementView> = restored.scenes.iter()
            .flat_map(|scene| &scene.tracks)
            .find(|track| track.id == MAIN_TRACK_ID)
            .expect("应有主轨")
            .elements.iter().collect();
        assert_eq!(source_elements.len(), restored_elements.len());
        for (before, after) in source_elements.iter().zip(restored_elements.iter()) {
            assert_eq!(before.id, after.id);
            assert_eq!(before.start_time, after.start_time);
            assert_eq!(before.duration, after.duration);
            assert_eq!(before.trim_start, after.trim_start);
        }
    }

    /// 官方 OTIO fixture 可导入：core 42/42 往返资产在桌面侧接线可用。
    #[test]
    fn import_official_fixture() {
        let view = demo_view();
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../local/crates/ocx-io/tests/fixtures/third_party_otio_018.json"
        ))
        .expect("官方 OTIO fixture 应可读");
        let imported = import_into_view(&view, &text)
            .unwrap_or_else(|error| panic!("官方 OTIO fixture 应可导入：{error}"));
        let count = imported.scenes.iter()
            .flat_map(|scene| &scene.tracks)
            .find(|track| track.id == MAIN_TRACK_ID)
            .map(|track| track.elements.len())
            .unwrap_or(0);
        assert_eq!(count, 2, "官方 fixture 有 2 个 Clip（Gap 被过滤）");
    }

    /// 导出落盘：项目同目录写 `.otio` 且文本可被 core 重新导入。
    #[test]
    fn apply_export_writes_reimportable_file() {
        let temp_dir = std::env::temp_dir().join(format!("ocx-otio-export-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("临时目录应可创建");
        let project_path = temp_dir.join("project.json");
        std::fs::write(&project_path, crate::project::DEMO_PROJECT_JSON).expect("fixture 应可写入");
        let state = ProjectState::load_from_path(&project_path).expect("项目应可加载");

        let path = apply_export(&state).expect("导出应成功");
        assert_eq!(path, temp_dir.join(format!("{}.otio", state.view.name)));
        let text = std::fs::read_to_string(&path).expect("导出文件应可读");
        let timeline = import_otio(&text).expect("导出文本应可重新导入");
        assert!(!timeline.tracks.is_empty());
    }

    /// 非法 OTIO 文本给稳定错误，不修改视图。
    #[test]
    fn import_rejects_invalid_text() {
        let view = demo_view();
        assert!(matches!(
            import_into_view(&view, "{not json"),
            Err(OtioDesktopError::Import(_))
        ));
    }

    /// 导出路径：项目同目录取项目名；内嵌项目无目录时拒绝。
    #[test]
    fn export_path_uses_project_directory() {
        let view = demo_view();
        let path = export_path_for(&view, Some(Path::new("some/dir/project.json")))
            .expect("有项目路径时应成功");
        assert_eq!(path, Path::new("some/dir").join(format!("{}.otio", view.name)));
        assert!(matches!(
            export_path_for(&view, None),
            Err(OtioDesktopError::NoProjectDir)
        ));
    }
}
