/**
 * 经典版 UI 像素级 1:1 改造 · 批 6 命令/对话框尺寸与命令注册表 token。
 *
 * 来源：<opencut-classic>/apps/web/src/ 下的
 * - actions/definitions.ts（动作表 + 默认快捷键 + 8 分类）
 * - actions/components/shortcuts-dialog.tsx（快捷键帮助对话框）
 * - components/ui/dialog.tsx（通用 Dialog 遮罩/容器/Header/Body/Footer）
 * - components/ui/button.tsx（badge/按钮尺寸）
 * - components/editor/export-button.tsx（导出 Popover）
 * - components/ui/context-menu.tsx + preview/components/context-menu.tsx（右键菜单）
 *
 * 重要：经典版**没有**命令面板（Command Palette / Ctrl+K），最接近的是
 * ShortcutsDialog；本 token 如实反映该事实，未虚构命令面板尺寸。
 * 由 commands-tokens.test.ts 在源码可用时逐项比对。
 */

/** 通用 Dialog（dialog.tsx）。 */
export const DIALOG_MAX_WIDTH_REM = 32; // max-w-lg
export const DIALOG_MAX_WIDTH_PX = 512;
export const DIALOG_WIDTH_VIEWPORT_MINUS_REM = 2; // w-[calc(100%-2rem)]
export const DIALOG_PADDING_PX = 24; // p-6
export const DIALOG_FOOTER_PY_PX = 20; // py-5
export const DIALOG_FOOTER_GAP_PX = 12; // gap-3
export const DIALOG_Z_INDEX = 250; // z-250
export const DIALOG_OVERLAY_BG = 'rgba(0, 0, 0, 0.1)'; // bg-black/10
export const DIALOG_OVERLAY_BLUR = 'blur(4px)'; // backdrop-blur-sm
export const DIALOG_CLOSE_TOP_RIGHT_PX = 24; // top-6 right-6
export const DIALOG_CLOSE_ICON_SIZE_PX = 20; // size-5

/** ShortcutsDialog（shortcuts-dialog.tsx）。 */
export const SHORTCUTS_DIALOG_MAX_WIDTH_REM = 42; // max-w-2xl
export const SHORTCUTS_DIALOG_MAX_WIDTH_PX = 672;
export const SHORTCUTS_DIALOG_MAX_HEIGHT_VH = 80; // max-h-[80vh]
export const SHORTCUTS_GROUP_GAP_PX = 24; // gap-6
export const SHORTCUTS_ITEM_GAP_PX = 4; // gap-1
export const SHORTCUTS_TITLE = 'Keyboard shortcuts';
export const SHORTCUTS_RESET_LABEL = 'Reset to default';

/** 快捷键 badge（button.tsx outline+sm）。 */
export const SHORTCUT_BADGE_HEIGHT_PX = 28; // h-7
export const SHORTCUT_BADGE_PADDING_X_PX = 10; // px-2.5
export const SHORTCUT_BADGE_GAP_PX = 4; // gap-1
export const SHORTCUT_BADGE_RADIUS = 'var(--radius-sm)'; // rounded-sm

/** 导出 Popover（export-button.tsx，非 Dialog）。 */
export const EXPORT_POPOVER_WIDTH_PX = 320; // w-80
export const EXPORT_POPOVER_HEADER_PADDING_PX = 12; // p-3
export const EXPORT_POPOVER_GROUPS = ['Format', 'Quality', 'Audio'] as const;
export const EXPORT_POPOVER_FORMAT_OPTIONS = [
  'MP4 (H.264) - Better compatibility',
  'WebM (VP9) - Smaller file size',
] as const;
export const EXPORT_POPOVER_QUALITY_OPTIONS = [
  'Low - Smallest file size',
  'Medium - Balanced',
  'High - Recommended',
  'Very high - Largest file size',
] as const;
export const EXPORT_POPOVER_AUDIO_LABEL = 'Include audio in export';

/** 右键菜单（context-menu.tsx / preview/components/context-menu.tsx）。 */
export const CONTEXT_MENU_MIN_WIDTH_PX = 192; // min-w-48
export const CONTEXT_MENU_PREVIEW_WIDTH_PX = 224; // w-56
export const CONTEXT_MENU_PADDING_PX = 4; // p-1
export const CONTEXT_MENU_ITEM_PADDING_X_PX = 12; // px-3
export const CONTEXT_MENU_ITEM_PADDING_Y_PX = 6; // py-1.5
export const CONTEXT_MENU_ITEM_ICON_SIZE_PX = 14; // size-3.5
export const CONTEXT_MENU_PREVIEW_ITEMS = [
  'Fit to screen', 'Full screen', 'Save snapshot', 'Copy snapshot',
] as const;

/** 8 个命令分类（definitions.ts，按字母序）。 */
export const ACTION_CATEGORIES = [
  'playback', 'navigation', 'editing', 'selection',
  'history', 'timeline', 'controls', 'assets',
] as const;

/** 动作定义（id / 描述 / 分类 / 默认快捷键）。快捷键用经典版字符串规范。 */
export interface ActionDefinition {
  id: string
  description: string
  category: typeof ACTION_CATEGORIES[number]
  shortcuts: readonly string[]
}

/** 24 个编辑器动作（definitions.ts + ACTION_DEFAULT_SHORTCUTS）。 */
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  { id: 'toggle-play', description: 'Play/Pause', category: 'playback', shortcuts: ['space', 'k'] },
  { id: 'stop-playback', description: 'Stop playback', category: 'playback', shortcuts: [] },
  { id: 'seek-forward', description: 'Seek forward 1 second', category: 'playback', shortcuts: ['l'] },
  { id: 'seek-backward', description: 'Seek backward 1 second', category: 'playback', shortcuts: ['j'] },
  { id: 'frame-step-forward', description: 'Frame step forward', category: 'navigation', shortcuts: ['right'] },
  { id: 'frame-step-backward', description: 'Frame step backward', category: 'navigation', shortcuts: ['left'] },
  { id: 'jump-forward', description: 'Jump forward 5 seconds', category: 'navigation', shortcuts: ['shift+right'] },
  { id: 'jump-backward', description: 'Jump backward 5 seconds', category: 'navigation', shortcuts: ['shift+left'] },
  { id: 'goto-start', description: 'Go to timeline start', category: 'navigation', shortcuts: ['home', 'enter'] },
  { id: 'goto-end', description: 'Go to timeline end', category: 'navigation', shortcuts: ['end'] },
  { id: 'split', description: 'Split elements at playhead', category: 'editing', shortcuts: ['s'] },
  { id: 'split-left', description: 'Split and remove left', category: 'editing', shortcuts: ['q'] },
  { id: 'split-right', description: 'Split and remove right', category: 'editing', shortcuts: ['w'] },
  { id: 'delete-selected', description: 'Delete current selection', category: 'editing', shortcuts: ['backspace', 'delete'] },
  { id: 'copy-selected', description: 'Copy selected elements', category: 'editing', shortcuts: ['ctrl+c'] },
  { id: 'paste-copied', description: 'Paste elements at playhead', category: 'editing', shortcuts: ['ctrl+v'] },
  { id: 'toggle-snapping', description: 'Toggle snapping', category: 'editing', shortcuts: ['n'] },
  { id: 'toggle-ripple-editing', description: 'Toggle ripple editing', category: 'editing', shortcuts: [] },
  { id: 'toggle-source-audio', description: 'Extract or recover source audio', category: 'editing', shortcuts: [] },
  { id: 'select-all', description: 'Select all elements', category: 'selection', shortcuts: ['ctrl+a'] },
  { id: 'deselect-all', description: 'Deselect all elements', category: 'selection', shortcuts: [] },
  { id: 'duplicate-selected', description: 'Duplicate selected element', category: 'selection', shortcuts: ['ctrl+d'] },
  { id: 'toggle-elements-muted-selected', description: 'Mute/unmute selected elements', category: 'selection', shortcuts: [] },
  { id: 'toggle-elements-visibility-selected', description: 'Show/hide selected elements', category: 'selection', shortcuts: [] },
  { id: 'toggle-bookmark', description: 'Toggle bookmark at playhead', category: 'timeline', shortcuts: [] },
  { id: 'undo', description: 'Undo', category: 'history', shortcuts: ['ctrl+z'] },
  { id: 'redo', description: 'Redo', category: 'history', shortcuts: ['ctrl+shift+z', 'ctrl+y'] },
  { id: 'cancel-interaction', description: 'Cancel current interaction', category: 'controls', shortcuts: ['escape'] },
  { id: 'remove-media-asset', description: 'Remove media asset', category: 'assets', shortcuts: [] },
] as const;

/** localStorage keybindings 持久化 key。 */
export const KEYBINDINGS_STORAGE_KEY = 'opencut-keybindings';

/**
 * 把经典版快捷键字符串格式化为展示文本（Mac 用 Cmd/Option，方向键用箭头）。
 * @param shortcut 经典版快捷键字符串（如 ctrl+c / shift+right）
 * @param isMac 是否 macOS
 * @returns {string} 展示文本
 */
export function formatShortcut(shortcut: string, isMac: boolean): string {
  const parts = shortcut.split('+')
  const map: Record<string, string> = isMac
    ? { ctrl: 'Cmd', alt: 'Option', shift: 'Shift', space: 'Space', enter: 'Enter', escape: 'Esc', backspace: 'Delete' }
    : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', space: 'Space', enter: 'Enter', escape: 'Esc', backspace: 'Backspace' }
  const arrows: Record<string, string> = { left: '←', right: '→', up: '↑', down: '↓' }
  return parts.map((part) => arrows[part] ?? map[part] ?? part.toUpperCase()).join('+')
}
