//! W-14 项目编辑的纯逻辑：字段枚举、键盘路由结果、输入校验与秒数解析。
//!
//! 从 `project.rs` 拆出以控制单文件行数（用户规则 ≤1000 行）。本模块不持有状态，
//! 所有函数都是纯函数，便于单测覆盖边界值。

use ocx_domain::ElementView;
use ocx_time::TICKS_PER_SECOND;

/// 编辑可输入的最大秒数（10 小时，防止极端值撑爆 ticks）。
const MAX_EDIT_SECONDS: f64 = 36_000.0;

/// 可编辑的元素字段（快捷键 F2~F6 依次对应）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EditableField {
    /// 元素名称。
    Name,
    /// 起点（以秒输入，内部存 ticks）。
    StartTime,
    /// 时长（以秒输入）。
    Duration,
    /// 修剪入点（以秒输入）。
    TrimStart,
    /// 修剪出点（以秒输入）。
    TrimEnd,
}

impl EditableField {
    /**
     * 由功能键解析可编辑字段（纯函数便于单测）。
     *
     * @param key `Keystroke.key` 字符串
     * @returns {Option<EditableField>} 命中的字段；非 F2~F6 返回 None
     */
    pub(crate) fn from_key(key: &str) -> Option<Self> {
        match key {
            "f2" => Some(Self::Name),
            "f3" => Some(Self::StartTime),
            "f4" => Some(Self::Duration),
            "f5" => Some(Self::TrimStart),
            "f6" => Some(Self::TrimEnd),
            _ => None,
        }
    }

    /// 字段中文显示名（Inspector 提示用）。
    #[allow(dead_code)]
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Name => "名称",
            Self::StartTime => "起点(秒)",
            Self::Duration => "时长(秒)",
            Self::TrimStart => "修剪入(秒)",
            Self::TrimEnd => "修剪出(秒)",
        }
    }

    /// 是否按数值字段处理（仅 name 是文本）。
    pub(crate) fn is_numeric(self) -> bool {
        !matches!(self, Self::Name)
    }
}

/// 键盘路由结果（供 UI 反馈与单测断言）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KeyOutcome {
    /// 进入编辑模式。
    BeginEdit,
    /// 草稿更新（键入/退格）。
    Draft,
    /// 提交草稿，值有变化。
    CommitChanged,
    /// 提交草稿但无变化。
    CommitUnchanged,
    /// 取消编辑。
    Cancel,
    /// 已识别的播放快捷键。
    Shortcut,
    /// 未处理的按键。
    Ignored,
}

/**
 * 另存为草稿的键盘处理：Enter 提交路径、Esc 取消、Backspace 退格、单字符追加。
 *
 * @param draft 当前路径草稿（None 表示不在另存为模式）
 * @param key 按键字符串
 * @returns {Option<(String, bool)>} Some((新草稿, 是否提交))；None 表示退出模式或忽略
 */
pub(crate) fn save_as_key(draft: Option<&str>, key: &str) -> Option<(String, bool)> {
    let current = draft?;
    match key {
        "enter" => Some((current.to_owned(), true)),
        "escape" => None,
        "backspace" => {
            let mut next = current.to_owned();
            next.pop();
            Some((next, false))
        }
        single if single.chars().count() == 1 => {
            Some((format!("{current}{single}"), false))
        }
        _ => Some((current.to_owned(), false)),
    }
}

/**
 * 数值字段允许的键入字符：数字、小数点、负号（文本字段允许任意单字符）。
 *
 * @param field 目标字段
 * @param key 按键字符串
 * @returns {bool} 是否可接受进草稿
 */
pub(crate) fn input_allowed(field: EditableField, key: &str) -> bool {
    if !field.is_numeric() {
        return key.chars().count() == 1;
    }
    key.chars().count() == 1 && key.chars().all(|ch| ch.is_ascii_digit() || ch == '.' || ch == '-')
}

/**
 * 把以秒为单位的草稿解析为 ticks（边界值由校验函数负责）。
 *
 * @param draft 秒字符串
 * @returns {Option<i64>} 解析成功返回 ticks，非法返回 None
 */
pub(crate) fn parse_seconds_to_ticks(draft: &str) -> Option<i64> {
    let seconds: f64 = draft.parse().ok()?;
    if !seconds.is_finite() || seconds < 0.0 || seconds > MAX_EDIT_SECONDS {
        return None;
    }
    Some((seconds * TICKS_PER_SECOND as f64).round() as i64)
}

/**
 * 校验目标字段的新 ticks 值是否合法（起点非负、时长为正、trim 非负且不超时长）。
 *
 * @param field 目标字段
 * @param ticks 新值
 * @param element 当前元素（用于交叉校验 trim/duration）
 * @returns {Option<String>} 合法返回 None，否则给中文错误
 */
pub(crate) fn validate_edit(field: EditableField, ticks: i64, element: &ElementView) -> Option<String> {
    match field {
        EditableField::StartTime if ticks < 0 => Some("起点不能为负".to_owned()),
        EditableField::Duration if ticks <= 0 => Some("时长必须大于 0".to_owned()),
        EditableField::TrimStart | EditableField::TrimEnd if ticks < 0 => Some("修剪值不能为负".to_owned()),
        EditableField::TrimStart | EditableField::TrimEnd => {
            let other = if field == EditableField::TrimStart { element.trim_end } else { element.trim_start };
            if ticks.saturating_add(other) > element.duration {
                Some("修剪总长不能超过片段时长".to_owned())
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 边界值：F2~F6 映射、秒→ticks 解析与输入字符白名单。
    #[test]
    fn editable_field_mapping_and_input_rules() {
        assert_eq!(EditableField::from_key("f2"), Some(EditableField::Name));
        assert_eq!(EditableField::from_key("f3"), Some(EditableField::StartTime));
        assert_eq!(EditableField::from_key("f4"), Some(EditableField::Duration));
        assert_eq!(EditableField::from_key("f5"), Some(EditableField::TrimStart));
        assert_eq!(EditableField::from_key("f6"), Some(EditableField::TrimEnd));
        assert_eq!(EditableField::from_key("f7"), None);

        assert_eq!(parse_seconds_to_ticks("0.5"), Some(60_000));
        assert_eq!(parse_seconds_to_ticks("-1"), None);
        assert_eq!(parse_seconds_to_ticks("99999"), None);
        assert_eq!(parse_seconds_to_ticks("abc"), None);
        assert!(input_allowed(EditableField::Duration, "1"));
        assert!(input_allowed(EditableField::Duration, "."));
        assert!(!input_allowed(EditableField::Duration, "x"));
        assert!(input_allowed(EditableField::Name, "中"));
    }

    /// 正常值 + 边界值：另存为草稿键盘处理（追加/退格/提交/取消/不在模式）。
    #[test]
    fn save_as_key_covers_all_branches() {
        assert_eq!(save_as_key(None, "a"), None);
        assert_eq!(save_as_key(Some("out"), "x"), Some(("outx".to_owned(), false)));
        assert_eq!(save_as_key(Some("out"), "backspace"), Some(("ou".to_owned(), false)));
        assert_eq!(save_as_key(Some("out/"), "enter"), Some(("out/".to_owned(), true)));
        assert_eq!(save_as_key(Some("out"), "escape"), None);
        assert_eq!(save_as_key(Some("out"), "f2"), Some(("out".to_owned(), false)));
    }

    /// 异常值：数值字段校验（负起点、零时长、trim 越界、文本字段跳过校验）。
    #[test]
    fn validate_edit_covers_invalid_values() {
        let fixture = include_str!("../../web/public/fixtures/classic-project-v31.json");
        let view = ocx_domain::read_classic_project(fixture).expect("fixture 应可解析");
        let element = view.scenes.iter()
            .flat_map(|scene| &scene.tracks)
            .flat_map(|track| &track.elements)
            .find(|element| element.id == "clip-intro")
            .expect("clip-intro 应存在")
            .clone();
        assert!(validate_edit(EditableField::StartTime, -1, &element).is_some());
        assert!(validate_edit(EditableField::Duration, 0, &element).is_some());
        assert!(validate_edit(EditableField::TrimStart, 120_000, &element).is_some());
        assert!(validate_edit(EditableField::Name, 0, &element).is_none());
        assert!(validate_edit(EditableField::StartTime, 0, &element).is_none());
    }
}
