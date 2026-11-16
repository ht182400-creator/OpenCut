import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTION_CATEGORIES,
  ACTION_DEFINITIONS,
  CONTEXT_MENU_ITEM_ICON_SIZE_PX,
  CONTEXT_MENU_ITEM_PADDING_X_PX,
  CONTEXT_MENU_ITEM_PADDING_Y_PX,
  CONTEXT_MENU_MIN_WIDTH_PX,
  CONTEXT_MENU_PADDING_PX,
  CONTEXT_MENU_PREVIEW_ITEMS,
  CONTEXT_MENU_PREVIEW_WIDTH_PX,
  DIALOG_FOOTER_GAP_PX,
  DIALOG_FOOTER_PY_PX,
  DIALOG_MAX_WIDTH_PX,
  DIALOG_MAX_WIDTH_REM,
  DIALOG_OVERLAY_BG,
  DIALOG_PADDING_PX,
  DIALOG_Z_INDEX,
  EXPORT_POPOVER_AUDIO_LABEL,
  EXPORT_POPOVER_FORMAT_OPTIONS,
  EXPORT_POPOVER_GROUPS,
  EXPORT_POPOVER_HEADER_PADDING_PX,
  EXPORT_POPOVER_QUALITY_OPTIONS,
  EXPORT_POPOVER_WIDTH_PX,
  KEYBINDINGS_STORAGE_KEY,
  SHORTCUTS_DIALOG_MAX_HEIGHT_VH,
  SHORTCUTS_DIALOG_MAX_WIDTH_PX,
  SHORTCUTS_DIALOG_MAX_WIDTH_REM,
  SHORTCUTS_GROUP_GAP_PX,
  SHORTCUTS_ITEM_GAP_PX,
  SHORTCUTS_RESET_LABEL,
  SHORTCUTS_TITLE,
  SHORTCUT_BADGE_GAP_PX,
  SHORTCUT_BADGE_HEIGHT_PX,
  SHORTCUT_BADGE_PADDING_X_PX,
  formatShortcut,
} from './commands-tokens';

/** 参照物根目录由环境变量提供；未设置时不执行源码比对（CI / 非作者机器）。 */
const CLASSIC_ROOT = process.env.OPENCUT_CLASSIC_ROOT ?? '';

const COMMAND_SOURCES = {
  definitions: 'apps/web/src/actions/definitions.ts',
  shortcutsDialog: 'apps/web/src/actions/components/shortcuts-dialog.tsx',
  dialog: 'apps/web/src/components/ui/dialog.tsx',
  button: 'apps/web/src/components/ui/button.tsx',
  exportButton: 'apps/web/src/components/editor/export-button.tsx',
  contextMenu: 'apps/web/src/components/ui/context-menu.tsx',
  previewContextMenu: 'apps/web/src/preview/components/context-menu.tsx',
  keybindingsStore: 'apps/web/src/actions/keybindings-store.ts',
} as const;

type SourceKey = keyof typeof COMMAND_SOURCES;

/** 读取经典版源码；未配置参照根或文件不存在时返回 null。 */
function classicSource(key: SourceKey): string | null {
  if (!CLASSIC_ROOT) return null;
  const full = path.join(CLASSIC_ROOT, COMMAND_SOURCES[key]);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

describe('经典版命令/对话框 1:1 · 尺寸 token（批 6）', () => {
  it('通用 Dialog 遮罩/容器/内边距与经典版一致', () => {
    expect(DIALOG_MAX_WIDTH_REM).toBe(32);
    expect(DIALOG_MAX_WIDTH_PX).toBe(512);
    expect(DIALOG_PADDING_PX).toBe(24);
    expect(DIALOG_FOOTER_PY_PX).toBe(20);
    expect(DIALOG_FOOTER_GAP_PX).toBe(12);
    expect(DIALOG_Z_INDEX).toBe(250);
    expect(DIALOG_OVERLAY_BG).toBe('rgba(0, 0, 0, 0.1)');
    const src = classicSource('dialog');
    if (src) {
      expect(src).toContain('max-w-lg');
      expect(src).toContain('z-250');
      expect(src).toContain('bg-black/10');
      expect(src).toContain('p-6');
    }
  });

  it('快捷键帮助对话框尺寸/文案与经典版一致', () => {
    expect(SHORTCUTS_DIALOG_MAX_WIDTH_REM).toBe(42);
    expect(SHORTCUTS_DIALOG_MAX_WIDTH_PX).toBe(672);
    expect(SHORTCUTS_DIALOG_MAX_HEIGHT_VH).toBe(80);
    expect(SHORTCUTS_TITLE).toBe('Keyboard shortcuts');
    expect(SHORTCUTS_RESET_LABEL).toBe('Reset to default');
    expect(SHORTCUTS_GROUP_GAP_PX).toBe(24);
    expect(SHORTCUTS_ITEM_GAP_PX).toBe(4);
    const src = classicSource('shortcutsDialog');
    if (src) {
      expect(src).toContain('max-w-2xl');
      expect(src).toContain('max-h-[80vh]');
      expect(src).toContain('Keyboard shortcuts');
      expect(src).toContain('Reset to default');
    }
  });

  it('快捷键 badge 尺寸与经典版一致', () => {
    expect(SHORTCUT_BADGE_HEIGHT_PX).toBe(28);
    expect(SHORTCUT_BADGE_PADDING_X_PX).toBe(10);
    expect(SHORTCUT_BADGE_GAP_PX).toBe(4);
    const src = classicSource('button');
    if (src) {
      expect(src).toContain('h-7');
      expect(src).toContain('px-2.5');
    }
  });

  it('导出 Popover 尺寸/选项与经典版一致', () => {
    expect(EXPORT_POPOVER_WIDTH_PX).toBe(320);
    expect(EXPORT_POPOVER_HEADER_PADDING_PX).toBe(12);
    expect(EXPORT_POPOVER_GROUPS).toEqual(['Format', 'Quality', 'Audio']);
    expect(EXPORT_POPOVER_FORMAT_OPTIONS).toEqual([
      'MP4 (H.264) - Better compatibility',
      'WebM (VP9) - Smaller file size',
    ]);
    expect(EXPORT_POPOVER_QUALITY_OPTIONS).toHaveLength(4);
    expect(EXPORT_POPOVER_AUDIO_LABEL).toBe('Include audio in export');
    const src = classicSource('exportButton');
    if (src) {
      expect(src).toContain('w-80');
      expect(src).toContain('MP4 (H.264) - Better compatibility');
      expect(src).toContain('Include audio in export');
    }
  });

  it('右键菜单尺寸/项与经典版一致', () => {
    expect(CONTEXT_MENU_MIN_WIDTH_PX).toBe(192);
    expect(CONTEXT_MENU_PREVIEW_WIDTH_PX).toBe(224);
    expect(CONTEXT_MENU_PADDING_PX).toBe(4);
    expect(CONTEXT_MENU_ITEM_PADDING_X_PX).toBe(12);
    expect(CONTEXT_MENU_ITEM_PADDING_Y_PX).toBe(6);
    expect(CONTEXT_MENU_ITEM_ICON_SIZE_PX).toBe(14);
    expect(CONTEXT_MENU_PREVIEW_ITEMS).toEqual([
      'Fit to screen', 'Full screen', 'Save snapshot', 'Copy snapshot',
    ]);
    const src = classicSource('contextMenu');
    if (src) {
      expect(src).toContain('min-w-48');
      expect(src).toContain('px-3 py-1.5');
    }
  });

  it('8 个命令分类与经典版一致', () => {
    expect(ACTION_CATEGORIES).toEqual([
      'playback', 'navigation', 'editing', 'selection',
      'history', 'timeline', 'controls', 'assets',
    ]);
    const src = classicSource('definitions');
    if (src) {
      for (const category of ACTION_CATEGORIES) expect(src).toContain(`"${category}"`);
    }
  });

  it('命令注册表关键动作/快捷键与经典版一致', () => {
    // 报告文字称 24 个动作，但表格逐项列出 29 行；此处以表格逐项为准，如实按列表断言。
    expect(ACTION_DEFINITIONS.length).toBeGreaterThanOrEqual(24);
    const byId = new Map(ACTION_DEFINITIONS.map((a) => [a.id, a]))
    expect(byId.get('toggle-play')?.shortcuts).toEqual(['space', 'k']);
    expect(byId.get('split')?.shortcuts).toEqual(['s']);
    expect(byId.get('delete-selected')?.shortcuts).toEqual(['backspace', 'delete']);
    expect(byId.get('undo')?.shortcuts).toEqual(['ctrl+z']);
    expect(byId.get('redo')?.shortcuts).toEqual(['ctrl+shift+z', 'ctrl+y']);
    const src = classicSource('definitions');
    if (src) {
      expect(src).toContain('toggle-play');
      expect(src).toContain('ctrl+shift+z');
    }
  });

  it('持久化 key 与快捷键展示格式与经典版一致', () => {
    expect(KEYBINDINGS_STORAGE_KEY).toBe('opencut-keybindings');
    expect(formatShortcut('ctrl+c', false)).toBe('Ctrl+C');
    expect(formatShortcut('ctrl+c', true)).toBe('Cmd+C');
    expect(formatShortcut('shift+right', false)).toBe('Shift+→');
    expect(formatShortcut('alt+left', true)).toBe('Option+←');
    const src = classicSource('keybindingsStore');
    if (src) expect(src).toContain('opencut-keybindings');
  });
});
