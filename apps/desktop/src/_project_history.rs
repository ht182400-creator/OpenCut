//! W-14 桌面编辑历史（批 8）：对齐 Web `clip-history` 的快照栈。
//!
//! 保存完整 `ProjectView` 克隆而非仅片段列表：五字段编辑不改变结构，后续时间轴
//! 删除/分割会改变结构，完整快照可直接复用。本模块为纯逻辑，与 GPUI 无关。

use ocx_domain::ProjectView;

/// 一次编辑后的不可变快照。
#[derive(Debug, Clone)]
pub(crate) struct HistorySnapshot {
    /// 编辑后的完整项目视图。
    pub(crate) view: ProjectView,
    /// 编辑时的播放头（ticks）。
    pub(crate) playhead_ticks: i64,
    /// 编辑时选中的元素 id。
    pub(crate) selected_element_id: Option<String>,
    /// 动作说明（用于 UI 显示）。
    pub(crate) label: String,
}

/// 历史状态：entries 按时间顺序，index 指向当前生效的快照。
#[derive(Debug, Clone)]
pub(crate) struct ProjectHistory {
    entries: Vec<HistorySnapshot>,
    index: usize,
}

/// 最多保留的快照数，避免长时间编辑占用内存。
pub(crate) const MAX_HISTORY_ENTRIES: usize = 50;

impl ProjectHistory {
    /**
     * 建立只含一条初始快照的历史（加载项目时调用）。
     *
     * @param view 当前项目视图
     * @param playhead_ticks 当前播放头
     * @param selected_element_id 当前选中元素 id
     * @returns {ProjectHistory} 历史状态
     */
    pub(crate) fn new(
        view: &ProjectView,
        playhead_ticks: i64,
        selected_element_id: Option<&str>,
    ) -> Self {
        Self {
            entries: vec![HistorySnapshot {
                view: view.clone(),
                playhead_ticks,
                selected_element_id: selected_element_id.map(str::to_owned),
                label: "打开项目".to_owned(),
            }],
            index: 0,
        }
    }

    /**
     * 记录一次编辑：丢弃当前位置之后的 redo 分支，追加新快照并裁剪到容量上限。
     *
     * @param view 编辑后的项目视图
     * @param playhead_ticks 当前播放头
     * @param selected_element_id 当前选中元素 id
     * @param label 动作说明
     */
    pub(crate) fn push(
        &mut self,
        view: &ProjectView,
        playhead_ticks: i64,
        selected_element_id: Option<&str>,
        label: &str,
    ) {
        // 保留当前指针及之前的条目；之后的 redo 分支在新编辑时被丢弃。
        self.entries.truncate(self.index + 1);
        self.entries.push(HistorySnapshot {
            view: view.clone(),
            playhead_ticks,
            selected_element_id: selected_element_id.map(str::to_owned),
            label: label.to_owned(),
        });
        if self.entries.len() > MAX_HISTORY_ENTRIES {
            let excess = self.entries.len() - MAX_HISTORY_ENTRIES;
            self.entries.drain(0..excess);
        }
        self.index = self.entries.len() - 1;
    }

    /**
     * 在历史中前后移动；到头/到尾返回 None 且不改变状态。
     *
     * @param delta -1 撤销 / +1 重做
     * @returns {Option<HistorySnapshot>} 需恢复的快照（克隆，避免与宿主状态借用冲突）
     */
    pub(crate) fn travel(&mut self, delta: i32) -> Option<HistorySnapshot> {
        let next = self.index as i32 + delta;
        if next < 0 || next as usize >= self.entries.len() {
            return None;
        }
        self.index = next as usize;
        Some(self.entries[self.index].clone())
    }

    /// 是否可撤销。
    pub(crate) fn can_undo(&self) -> bool {
        self.index > 0
    }

    /// 是否可重做。
    pub(crate) fn can_redo(&self) -> bool {
        self.index + 1 < self.entries.len()
    }

    /**
     * 历史摘要，用于 UI 显示；箭头标示当前可用方向。
     *
     * @returns {String} 形如「2 / 4 步 · 编辑 名称 ↶↷」
     */
    pub(crate) fn label(&self) -> String {
        let direction = if self.can_undo() && self.can_redo() {
            " ↶↷"
        } else if self.can_undo() {
            " ↶"
        } else if self.can_redo() {
            " ↷"
        } else {
            ""
        };
        format!(
            "{} / {} 步 · {}{}",
            self.index + 1,
            self.entries.len(),
            self.entries[self.index].label,
            direction
        )
    }

    /// 当前快照数量（单测用）。
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /**
     * 构造测试用项目视图（复用桌面内嵌 v31 fixture）。
     *
     * @returns {ProjectView} 可解析的项目视图
     */
    fn demo_view() -> ProjectView {
        ocx_domain::read_classic_project(crate::project::DEMO_PROJECT_JSON)
            .expect("内嵌 v31 fixture 应可解析")
    }

    /// 初始历史只有一条快照，两个方向都不可移动。
    #[test]
    fn new_history_has_one_entry_and_no_travel() {
        let view = demo_view();
        let mut history = ProjectHistory::new(&view, 0, None);
        assert_eq!(history.label(), "1 / 1 步 · 打开项目");
        assert!(!history.can_undo());
        assert!(!history.can_redo());
        assert!(history.travel(-1).is_none());
        assert!(history.travel(1).is_none());
    }

    /// 编辑→撤销→重做逐字段恢复视图、播放头与选中 id。
    #[test]
    fn push_undo_redo_restore_view_and_metadata() {
        let mut view = demo_view();
        let original_duration = view.duration_ticks;
        let mut history = ProjectHistory::new(&view, 0, None);
        view.duration_ticks += 1;
        history.push(&view, 120, Some("clip-intro"), "编辑 名称");

        assert_eq!(history.label(), "2 / 2 步 · 编辑 名称 ↶");
        let restored = history.travel(-1).expect("应可撤销");
        assert_eq!(restored.view.duration_ticks, original_duration);
        assert_eq!(restored.playhead_ticks, 0);
        assert!(restored.selected_element_id.is_none());
        assert!(history.can_redo());

        let redone = history.travel(1).expect("应可重做");
        assert_eq!(redone.view.duration_ticks, original_duration + 1);
        assert_eq!(redone.playhead_ticks, 120);
        assert_eq!(redone.selected_element_id.as_deref(), Some("clip-intro"));
        assert!(!history.can_redo());
    }

    /// 撤销后产生新编辑：redo 分支被丢弃，指针移到新末尾。
    #[test]
    fn push_after_undo_discards_redo_branch() {
        let view = demo_view();
        let mut history = ProjectHistory::new(&view, 0, None);
        history.push(&view, 0, None, "编辑 1");
        history.push(&view, 0, None, "编辑 2");
        assert_eq!(history.len(), 3);

        history.travel(-1);
        assert!(history.can_redo());
        history.push(&view, 0, None, "编辑 3");
        assert_eq!(history.len(), 3);
        assert!(!history.can_redo());
        assert!(history.label().contains("编辑 3"));
    }

    /// 快照数超过上限时从头部裁剪，容量恒定且指针在末尾。
    #[test]
    fn push_trims_to_capacity() {
        let view = demo_view();
        let mut history = ProjectHistory::new(&view, 0, None);
        for index in 0..MAX_HISTORY_ENTRIES + 5 {
            history.push(&view, 0, None, &format!("编辑 {index}"));
        }
        assert_eq!(history.len(), MAX_HISTORY_ENTRIES);
        assert!(!history.can_redo());
        assert!(history.can_undo());
    }
}
