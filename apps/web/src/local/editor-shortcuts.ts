/**
 * 经典版 UI 同步第三批：编辑器快捷键的纯匹配层。
 *
 * 只做「事件 → 动作名」的映射，不碰 DOM / React，便于单测覆盖。
 * W-09 第三批已在 clip-history.ts 绑定 Ctrl/Cmd+Z 与 Shift+Z，
 * 这里显式跳过所有 Ctrl/Meta/Alt 组合，避免重复触发。
 */

export type ShortcutAction =
  | 'togglePlay'
  | 'prevFrame'
  | 'nextFrame'
  | 'firstFrame'
  | 'lastFrame'
  | 'deleteSelected'
  | 'splitAtPlayhead'
  | 'trimIn'
  | 'trimOut';

/** 键盘事件的最小结构（真实 KeyboardEvent 与其测试桩都满足）。 */
export interface ShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

/** 输入框获得焦点时不劫持键盘（否则数字输入、快捷键互相打架）。 */
function isTypingTarget(event: ShortcutEvent): boolean {
  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes((target.tagName ?? '').toUpperCase());
}

/**
 * 把键盘事件映射为编辑器动作；不匹配的返回 null。
 * @param event 键盘事件（或测试桩）
 * @returns {ShortcutAction | null} 动作名
 */
export function matchShortcut(event: ShortcutEvent): ShortcutAction | null {
  if (!event.key || isTypingTarget(event)) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return 'togglePlay';
    case 'ArrowLeft':
      return 'prevFrame';
    case 'ArrowRight':
      return 'nextFrame';
    case 'Home':
      return 'firstFrame';
    case 'End':
      return 'lastFrame';
    case 'Delete':
    case 'Backspace':
      return 'deleteSelected';
    default:
      break;
  }
  switch (event.key.toLowerCase()) {
    case 's':
      return 'splitAtPlayhead';
    case 'i':
      return 'trimIn';
    case 'o':
      return 'trimOut';
    default:
      return null;
  }
}

/** 快捷键帮助文本，供 UI 展示。 */
export const SHORTCUT_HELP = [
  '空格 播放/暂停',
  '←/→ 逐帧',
  'Home/End 首尾帧',
  'Delete 删除片段',
  'S 在播放头分割',
  'I/O 设入/出点',
  'Ctrl/Cmd+Z 撤销 · Shift+Z 重做',
].join(' · ');
