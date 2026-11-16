import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ASSETS_ADD_BUTTON_OFFSET_PX,
  ASSETS_ADD_BUTTON_SIZE_PX,
  ASSETS_CARD_INNER_GAP_PX,
  ASSETS_CARD_NAME_FONT_REM,
  ASSETS_CARD_NAME_MAX_CHARS,
  ASSETS_DRAG_OVERLAY_OFFSET_PX,
  ASSETS_DRAG_OVERLAY_WIDTH_PX,
  ASSETS_DRAG_OVERLAY_Z_INDEX,
  ASSETS_DURATION_BADGE_BG,
  ASSETS_DURATION_BADGE_OFFSET_PX,
  ASSETS_EFFECTS_GRID_MIN_PX,
  ASSETS_GRID_COLUMN_WIDTH_PX,
  ASSETS_GRID_COLUMN_WIDTH_REM,
  ASSETS_GRID_GAP_PX,
  ASSETS_LIST_GAP_PX,
  ASSETS_PANEL_CONTENT_PADDING_X_PX,
  ASSETS_PANEL_HEADER_HEIGHT_PX,
  ASSETS_PANEL_HEADER_PADDING_LEFT_PX,
  ASSETS_PANEL_HEADER_PADDING_RIGHT_PX,
  ASSETS_PANEL_SCROLL_TOP_PADDING_PX,
  ASSETS_STICKERS_GRID_MAX_PX,
  ASSETS_STICKERS_GRID_MIN_PX,
  ASSETS_TAB_GAP_PX,
  ASSETS_TABBAR_PADDING_PX,
  ASSETS_TAB_LABELS,
  ASSETS_TAB_KEYS,
  ASSETS_TAB_SIZE_PX,
  TIMELINE_DRAG_MIME,
} from './assets-tokens';

/** 参照物根目录由环境变量提供；未设置时不执行源码比对（CI / 非作者机器）。 */
const CLASSIC_ROOT = process.env.OPENCUT_CLASSIC_ROOT ?? '';

const ASSETS_SOURCES = {
  store: 'apps/web/src/components/editor/panels/assets/assets-panel-store.tsx',
  tabbar: 'apps/web/src/components/editor/panels/assets/tabbar.tsx',
  basePanel: 'apps/web/src/components/editor/panels/assets/views/base-panel.tsx',
  assets: 'apps/web/src/components/editor/panels/assets/views/assets.tsx',
  draggableItem: 'apps/web/src/components/editor/panels/assets/views/draggable-item.tsx',
  effects: 'apps/web/src/components/editor/panels/assets/views/effects/components/assets-view.tsx',
  stickers: 'apps/web/src/components/editor/panels/assets/views/stickers/components/assets-view.tsx',
  dragSource: 'apps/web/src/timeline/drag-source.ts',
} as const;

type SourceKey = keyof typeof ASSETS_SOURCES;

/** 读取经典版源码文件；未配置参照根或文件不存在时返回 null。 */
function classicSource(key: SourceKey): string | null {
  if (!CLASSIC_ROOT) return null;
  const full = path.join(CLASSIC_ROOT, ASSETS_SOURCES[key]);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

describe('经典版素材面板 1:1 · 尺寸 token（批 3）', () => {
  it('tab 尺寸/间距/内边距与经典版一致', () => {
    expect(ASSETS_TAB_SIZE_PX).toBe(32);
    expect(ASSETS_TAB_GAP_PX).toBe(2);
    expect(ASSETS_TABBAR_PADDING_PX).toBe(4);
    const src = classicSource('tabbar');
    if (src) {
      expect(src).toContain('h-8 w-8');
      expect(src).toContain('gap-0.5');
      expect(src).toContain('p-1');
    }
  });

  it('PanelView 头高与内边距与经典版一致', () => {
    expect(ASSETS_PANEL_HEADER_HEIGHT_PX).toBe(44);
    expect(ASSETS_PANEL_HEADER_PADDING_LEFT_PX).toBe(12);
    expect(ASSETS_PANEL_HEADER_PADDING_RIGHT_PX).toBe(8);
    expect(ASSETS_PANEL_SCROLL_TOP_PADDING_PX).toBe(8);
    expect(ASSETS_PANEL_CONTENT_PADDING_X_PX).toBe(8);
    const src = classicSource('basePanel');
    if (src) {
      expect(src).toContain('h-11');
      expect(src).toContain('pl-3 pr-2');
      expect(src).toContain('pt-2');
    }
  });

  it('Media 网格列宽/间距与经典版一致', () => {
    expect(ASSETS_GRID_COLUMN_WIDTH_REM).toBe(7);
    expect(ASSETS_GRID_COLUMN_WIDTH_PX).toBe(112);
    expect(ASSETS_GRID_GAP_PX).toBe(16);
    expect(ASSETS_LIST_GAP_PX).toBe(6);
    const src = classicSource('assets');
    if (src) {
      expect(src).toContain('7rem');
      expect(src).toContain('gap-4');
      expect(src).toContain('gap-1.5');
    }
  });

  it('卡片内层间距/名称字号与经典版一致', () => {
    expect(ASSETS_CARD_INNER_GAP_PX).toBe(4);
    expect(ASSETS_CARD_NAME_FONT_REM).toBe(0.7);
    expect(ASSETS_CARD_NAME_MAX_CHARS).toBe(8);
    const src = classicSource('draggableItem');
    if (src) {
      expect(src).toContain('text-[0.7rem]');
      expect(src).toContain('gap-1');
    }
  });

  it('加号按钮与拖拽浮层尺寸与经典版一致', () => {
    expect(ASSETS_ADD_BUTTON_SIZE_PX).toBe(20);
    expect(ASSETS_ADD_BUTTON_OFFSET_PX).toBe(8);
    expect(ASSETS_DRAG_OVERLAY_WIDTH_PX).toBe(80);
    expect(ASSETS_DRAG_OVERLAY_Z_INDEX).toBe(9999);
    expect(ASSETS_DRAG_OVERLAY_OFFSET_PX).toBe(40);
    const src = classicSource('draggableItem');
    if (src) {
      expect(src).toContain('size-5');
      expect(src).toContain('w-[80px]');
      expect(src).toContain('z-9999');
    }
  });

  it('时长徽标样式与经典版一致', () => {
    expect(ASSETS_DURATION_BADGE_OFFSET_PX).toBe(4);
    expect(ASSETS_DURATION_BADGE_BG).toBe('rgba(0, 0, 0, 0.7)');
    const src = classicSource('assets');
    if (src) {
      expect(src).toContain('bg-black/70');
      expect(src).toContain('right-1 bottom-1');
    }
  });

  it('tab 顺序与经典版 TAB_KEYS 一致', () => {
    expect(ASSETS_TAB_KEYS).toEqual([
      'media', 'sounds', 'text', 'stickers', 'effects',
      'transitions', 'captions', 'adjustment', 'settings',
    ]);
    const src = classicSource('store');
    if (src) {
      for (const key of ASSETS_TAB_KEYS) expect(src).toContain(`"${key}"`);
    }
  });

  it('tab 英文文案与经典版一致', () => {
    expect(Object.values(ASSETS_TAB_LABELS)).toEqual([
      'Media', 'Sounds', 'Text', 'Stickers', 'Effects',
      'Transitions', 'Captions', 'Adjustment', 'Settings',
    ]);
  });

  it('拖入时间轴的 dataTransfer MIME 与经典版一致', () => {
    expect(TIMELINE_DRAG_MIME).toBe('application/x-timeline-drag');
    const src = classicSource('dragSource');
    if (src) expect(src).toContain(TIMELINE_DRAG_MIME);
  });

  it('效果/贴纸网格断点与经典版一致', () => {
    expect(ASSETS_EFFECTS_GRID_MIN_PX).toBe(96);
    expect(ASSETS_STICKERS_GRID_MIN_PX).toBe(80);
    expect(ASSETS_STICKERS_GRID_MAX_PX).toBe(140);
    const effects = classicSource('effects');
    if (effects) expect(effects).toContain('96px');
    const stickers = classicSource('stickers');
    if (stickers) expect(stickers).toContain('80px');
  });
});
