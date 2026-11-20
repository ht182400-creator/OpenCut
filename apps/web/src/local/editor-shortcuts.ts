/**
 * 编辑器快捷键匹配层（纯函数，不碰 DOM/React）。
 *
 * P3 长尾批 2：动作映射真相源下沉到 shortcut-bindings.ts，本模块保留既有 API：
 * `matchShortcut(event, bindings?)` —— 不传 bindings 时用默认绑定（向后兼容），
 * 传入由 `resolveBindings()` 生成的绑定表则支持用户重绑定。
 *
 * Ctrl+Z / Ctrl+Shift+Z 仍归 clip-history（默认绑定表不含 undo/redo，天然不接管）。
 */

import {
  EFFECTIVE_DEFAULT_BINDINGS,
  matchEventToAction,
  type Keybindings,
  type ShortcutAction,
  type ShortcutEvent,
} from './shortcut-bindings'

export type { ShortcutAction, ShortcutEvent, Keybindings } from './shortcut-bindings'
export {
  KEYBINDINGS_STORAGE_KEY,
  EFFECTIVE_DEFAULT_BINDINGS,
  ID_TO_SHORTCUT_ACTION,
  SHORTCUT_ACTION_TO_ID,
  loadBindings,
  resolveBindings,
  saveBinding,
  clearBindings,
  comboFromEvent,
  findComboConflict,
} from './shortcut-bindings'

/**
 * 把键盘事件映射为编辑器动作；不匹配的返回 null。
 * @param event 键盘事件（或测试桩）
 * @param bindings 用户绑定表；省略则用默认绑定
 * @returns {ShortcutAction | null} 动作名
 */
export function matchShortcut(
  event: ShortcutEvent,
  bindings: Keybindings = EFFECTIVE_DEFAULT_BINDINGS as Keybindings,
): ShortcutAction | null {
  return matchEventToAction(event, bindings)
}

/** 快捷键帮助文本，供 UI 展示。 */
export const SHORTCUT_HELP = [
  '空格 播放/暂停',
  '←/→ 逐帧',
  'Home/End 首尾帧',
  'Delete 删除片段',
  'S 在播放头分割',
  'I/O 设入/出点',
  'Ctrl/Cmd+C/V/D 复制/粘贴/副本',
  'Ctrl/Cmd+A 全选',
  'Ctrl/Cmd+Z 撤销 · Shift+Z 重做',
].join(' · ')
