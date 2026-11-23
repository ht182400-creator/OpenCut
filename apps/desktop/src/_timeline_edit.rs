//! W-14 桌面时间轴编辑（批 9）：删除 / 分割 / 入点 / 出点。
//!
//! core 的 `ocx-domain::ripple` 操作最小 `TimedElement`（只有 id/起点/时长），
//! 而桌面必须保留 v31 `ElementView` 的 trim/name/mediaId/params 全字段，
//! 故在 `ProjectView` 层实现等价语义（删除带同轨 ripple 前移），不丢失未知字段。
//! 纯函数 `edit_view` 与 GPUI 无关；`apply_to_state` 只做状态接线与历史记录。

use std::fmt;

use ocx_domain::{ElementView, ProjectView};

use crate::project::ProjectState;

/// 时间轴编辑动作（UI 按钮与快捷键共用分派）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TimelineEdit {
    /// 删除选中片段并让同轨后续片段前移（ripple）。
    Delete,
    /// 在播放头处把选中片段一分为二。
    Split,
    /// 入点设到播放头（head trim，起点不动）。
    TrimIn,
    /// 出点设到播放头（尾部裁剪）。
    TrimOut,
}

impl TimelineEdit {
    /**
     * 动作中文名（历史快照 label 用）。
     *
     * @returns {'static str} 中文说明
     */
    pub(crate) fn label(self) -> &'static str {
        match self {
            TimelineEdit::Delete => "删除片段",
            TimelineEdit::Split => "分割片段",
            TimelineEdit::TrimIn => "设入点",
            TimelineEdit::TrimOut => "设出点",
        }
    }
}

/// 编辑被拒绝的原因（统一给 UI 中文提示）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TimelineEditError {
    /// 尚未选中片段。
    NoSelection,
    /// 播放头不在选中片段内部。
    OutsideClip,
    /// 裁剪或分割后某段不足一帧。
    TooShort,
}

impl fmt::Display for TimelineEditError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            TimelineEditError::NoSelection => "请先点击时间轴上的片段",
            TimelineEditError::OutsideClip => "播放头不在选中片段内部，无法编辑",
            TimelineEditError::TooShort => "编辑后片段不足一帧，已取消",
        };
        write!(formatter, "{message}")
    }
}

/**
 * 为分割产生的新片段生成唯一 id（避免与既有 `#2` / `#3` 冲突）。
 *
 * @param elements 当前轨道元素列表
 * @param base 原片段 id
 * @returns {String} 未使用的新 id
 */
fn unique_split_id(elements: &[ElementView], base: &str) -> String {
    let mut suffix = 2_usize;
    loop {
        let candidate = format!("{base}#{suffix}");
        if !elements.iter().any(|element| element.id == candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

/**
 * 定位选中元素在视图中的 (场景, 轨道, 元素) 下标。
 *
 * @param view 项目视图
 * @param selected_id 选中元素 id
 * @returns {Option<(usize, usize, usize)>} 三元组下标
 */
fn locate(view: &ProjectView, selected_id: Option<&str>) -> Option<(usize, usize, usize)> {
    let id = selected_id?;
    for (scene_index, scene) in view.scenes.iter().enumerate() {
        for (track_index, track) in scene.tracks.iter().enumerate() {
            for (element_index, element) in track.elements.iter().enumerate() {
                if element.id == id {
                    return Some((scene_index, track_index, element_index));
                }
            }
        }
    }
    None
}

/**
 * 在 `ProjectView` 层执行时间轴编辑，返回新视图（输入视图不被修改）。
 *
 * @param view 当前项目视图
 * @param selected_id 选中元素 id
 * @param playhead_ticks 播放头（ticks）
 * @param edit 编辑动作
 * @param ticks_per_frame 一帧的 ticks（最小片段长度）
 * @returns {Result<ProjectView, TimelineEditError>} 新视图或拒绝原因
 */
pub(crate) fn edit_view(
    view: &ProjectView,
    selected_id: Option<&str>,
    playhead_ticks: i64,
    edit: TimelineEdit,
    ticks_per_frame: i64,
) -> Result<ProjectView, TimelineEditError> {
    let (scene_index, track_index, element_index) =
        locate(view, selected_id).ok_or(TimelineEditError::NoSelection)?;
    let mut next = view.clone();
    let elements = &mut next.scenes[scene_index].tracks[track_index].elements;

    match edit {
        TimelineEdit::Delete => {
            // 同轨后续片段前移被删片段的时长（ripple 语义），保持无空档。
            let removed = elements.remove(element_index);
            for element in elements.iter_mut() {
                if element.start_time > removed.start_time {
                    element.start_time = element.start_time.saturating_sub(removed.duration);
                }
            }
        }
        TimelineEdit::Split => {
            let source = &elements[element_index];
            let elapsed = playhead_ticks - source.start_time;
            if elapsed <= 0 || elapsed >= source.duration {
                return Err(TimelineEditError::OutsideClip);
            }
            if elapsed < ticks_per_frame || source.duration - elapsed < ticks_per_frame {
                return Err(TimelineEditError::TooShort);
            }
            let mut second = source.clone();
            second.id = unique_split_id(elements, &source.id);
            second.start_time = playhead_ticks;
            second.duration = source.duration - elapsed;
            second.trim_start = source.trim_start + elapsed;
            elements[element_index].duration = elapsed;
            elements.insert(element_index + 1, second);
        }
        TimelineEdit::TrimIn => {
            let source = &elements[element_index];
            let elapsed = playhead_ticks - source.start_time;
            if elapsed <= 0 || elapsed >= source.duration {
                return Err(TimelineEditError::OutsideClip);
            }
            if elapsed > source.duration - ticks_per_frame {
                return Err(TimelineEditError::TooShort);
            }
            let target = &mut elements[element_index];
            target.duration -= elapsed;
            target.trim_start += elapsed;
        }
        TimelineEdit::TrimOut => {
            let source = &elements[element_index];
            let elapsed = playhead_ticks - source.start_time;
            if elapsed <= 0 || elapsed >= source.duration {
                return Err(TimelineEditError::OutsideClip);
            }
            if elapsed < ticks_per_frame {
                return Err(TimelineEditError::TooShort);
            }
            elements[element_index].duration = elapsed;
        }
    }

    // element_count 是视图派生字段，结构变化后必须同步，避免写回时不一致。
    next.scenes[scene_index].tracks[track_index].element_count = elements.len();
    Ok(next)
}

/**
 * 把编辑应用到共享项目状态：成功后记录历史快照，失败写入友好提示。
 *
 * @param state 桌面项目状态
 * @param edit 编辑动作
 * @returns {bool} 是否实际修改了视图
 */
pub(crate) fn apply_to_state(state: &mut ProjectState, edit: TimelineEdit) -> bool {
    let Some(id) = state.selected_element_id.clone() else {
        state.edit_error = Some(TimelineEditError::NoSelection.to_string());
        return false;
    };
    let result = edit_view(
        &state.view,
        Some(&id),
        state.playhead_ticks,
        edit,
        state.ticks_per_frame(),
    );
    match result {
        Ok(view) => {
            state.view = view;
            state.edit_error = None;
            state.history.push(
                &state.view,
                state.playhead_ticks,
                Some(&id),
                edit.label(),
            );
            // 编辑成功后立即写回，与字段编辑提交的行为保持一致。
            let message = match state.save_to_file() {
                Ok(()) => "时间轴编辑已保存到原文件".to_owned(),
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

#[cfg(test)]
mod tests {
    use super::*;

    /** 测试用一帧 ticks（30fps）。 */
    const TEST_FRAME_TICKS: i64 = 4_000;

    /**
     * 构造两片段的最小项目视图（main 轨：0~2s、2~4s）。
     *
     * @returns {ProjectView} 测试视图
     */
    fn two_clip_view() -> ProjectView {
        ocx_domain::read_classic_project(crate::project::DEMO_PROJECT_JSON)
            .expect("内嵌 v31 fixture 应可解析")
    }

    /**
     * 在主轨查找第一个元素的 (id, start, duration, trim_start)。
     *
     * @param view 项目视图
     * @returns {(String, i64, i64, i64)} 元素关键字段
     */
    fn first_element(view: &ProjectView) -> (String, i64, i64, i64) {
        view.scenes.iter()
            .flat_map(|scene| &scene.tracks)
            .flat_map(|track| &track.elements)
            .next()
            .map(|element| (element.id.clone(), element.start_time, element.duration, element.trim_start))
            .expect("应有片段")
    }

    /// 上下文：所有编辑拒绝分支（无选中、播放头越界、不足一帧）。
    #[test]
    fn edit_rejects_invalid_context() {
        let view = two_clip_view();
        let (id, start, duration, _) = first_element(&view);
        assert_eq!(
            edit_view(&view, None, start, TimelineEdit::Delete, TEST_FRAME_TICKS),
            Err(TimelineEditError::NoSelection)
        );
        assert_eq!(
            edit_view(&view, Some(&id), start - 1, TimelineEdit::Split, TEST_FRAME_TICKS),
            Err(TimelineEditError::OutsideClip)
        );
        assert_eq!(
            edit_view(&view, Some(&id), start + duration, TimelineEdit::TrimIn, TEST_FRAME_TICKS),
            Err(TimelineEditError::OutsideClip)
        );
        assert_eq!(
            edit_view(&view, Some(&id), start + 1, TimelineEdit::TrimOut, TEST_FRAME_TICKS),
            Err(TimelineEditError::TooShort)
        );
    }

    /// 删除片段：同轨后续片段前移被删时长，element_count 同步。
    #[test]
    fn delete_ripples_following_clips() {
        let view = two_clip_view();
        let (id, start, duration, _) = first_element(&view);
        let before = view.scenes[0].tracks.iter()
            .flat_map(|track| &track.elements)
            .count();
        let next = edit_view(&view, Some(&id), start, TimelineEdit::Delete, TEST_FRAME_TICKS)
            .expect("删除应成功");
        let after = next.scenes[0].tracks.iter()
            .flat_map(|track| &track.elements)
            .count();
        assert_eq!(after, before - 1);
        assert!(!next.scenes[0].tracks.iter().flat_map(|t| &t.elements).any(|e| e.id == id));
        for track in &next.scenes[0].tracks {
            assert_eq!(track.element_count, track.elements.len());
        }
        assert_eq!(view.scenes[0].tracks.iter().flat_map(|t| &t.elements).count(), before);
        let _ = duration;
    }

    /// 分割片段：后半段 trimStart 累加，id 唯一，合计时长不变。
    #[test]
    fn split_keeps_total_duration_and_unique_id() {
        let view = two_clip_view();
        let (id, start, duration, trim_start) = first_element(&view);
        let split_at = start + TEST_FRAME_TICKS * 2;
        let next = edit_view(&view, Some(&id), split_at, TimelineEdit::Split, TEST_FRAME_TICKS)
            .expect("分割应成功");
        let elements: Vec<&ElementView> = next.scenes[0].tracks.iter()
            .flat_map(|track| &track.elements)
            .collect();
        let first = elements.iter().find(|element| element.id == id).expect("前半段应存在");
        let second = elements.iter().find(|element| element.id != id && element.id.starts_with(&format!("{id}#")))
            .expect("后半段应存在");
        assert_eq!(first.duration + second.duration, duration);
        assert_eq!(second.start_time, split_at);
        assert_eq!(second.trim_start, trim_start + first.duration);
        assert_eq!(view.scenes[0].tracks.iter().flat_map(|t| &t.elements).count(), elements.len() - 1);
    }

    /// 入点/出点：起点不动与尾部裁剪，trimStart 只在入点时累加。
    #[test]
    fn trim_in_and_out_adjust_duration_and_trim() {
        let view = two_clip_view();
        let (id, start, duration, trim_start) = first_element(&view);
        let point = start + TEST_FRAME_TICKS * 2;
        let in_view = edit_view(&view, Some(&id), point, TimelineEdit::TrimIn, TEST_FRAME_TICKS)
            .expect("入点应成功");
        let in_element = in_view.scenes[0].tracks.iter().flat_map(|t| &t.elements)
            .find(|e| e.id == id).expect("片段仍在");
        assert_eq!(in_element.start_time, start);
        assert_eq!(in_element.duration, duration - TEST_FRAME_TICKS * 2);
        assert_eq!(in_element.trim_start, trim_start + TEST_FRAME_TICKS * 2);

        let out_view = edit_view(&view, Some(&id), point, TimelineEdit::TrimOut, TEST_FRAME_TICKS)
            .expect("出点应成功");
        let out_element = out_view.scenes[0].tracks.iter().flat_map(|t| &t.elements)
            .find(|e| e.id == id).expect("片段仍在");
        assert_eq!(out_element.duration, TEST_FRAME_TICKS * 2);
        assert_eq!(out_element.trim_start, trim_start);
    }
}
