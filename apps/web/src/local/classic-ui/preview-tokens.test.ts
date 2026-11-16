import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EDGE_HANDLE_THICK_SIZE,
  EDGE_HANDLE_THIN_SIZE,
  HANDLE_HIT_AREA_SIZE,
  HANDLE_SIZE,
  ICON_HANDLE_RADIUS,
  IS_AT_ACTUAL_SIZE_EPSILON,
  IS_AT_FIT_EPSILON,
  MIDDLE_MOUSE_BUTTON,
  MIN_SCALE,
  PREVIEW_ICON_BUTTON_SIZE_PX,
  PREVIEW_TIMECODE_FIELDS,
  PREVIEW_TOOLBAR_GAP_PX,
  PREVIEW_TOOLBAR_PADDING_BOTTOM_PX,
  PREVIEW_TOOLBAR_PADDING_TOP_PX,
  PREVIEW_TOOLBAR_PADDING_X_PX,
  PREVIEW_VIEWPORT_PADDING_BOTTOM_PX,
  PREVIEW_VIEWPORT_PADDING_PX,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_MIN,
  PREVIEW_ZOOM_PRESETS,
  PREVIEW_ZOOM_STEP,
  ROTATION_HANDLE_OFFSET,
  ROTATION_SNAP_STEP_DEGREES,
  ROTATION_SNAP_THRESHOLD_DEGREES,
  SELECTION_STROKE_OPACITY,
  SELECTION_STROKE_WIDTH,
  SNAP_GUIDE_WIDTH,
  SNAP_THRESHOLD_SCREEN_PIXELS,
  TRANSFORM_CORNERS,
  TRANSFORM_EDGES,
  WHEEL_DELTA_CAP,
  WHEEL_ZOOM_DIVISOR,
  formatZoomLabel,
  getResizeCursor,
} from './preview-tokens';

/** 参照物根目录由环境变量提供；未设置时不执行源码比对（CI / 非作者机器）。 */
const CLASSIC_ROOT = process.env.OPENCUT_CLASSIC_ROOT ?? '';

const PREVIEW_SOURCES = {
  zoom: 'apps/web/src/preview/zoom.ts',
  snap: 'apps/web/src/preview/preview-snap.ts',
  handles: 'apps/web/src/preview/components/handle-primitives.tsx',
  snapGuides: 'apps/web/src/preview/components/snap-guides.tsx',
  bounds: 'apps/web/src/preview/element-bounds.ts',
  viewport: 'apps/web/src/preview/components/preview-viewport.tsx',
  index: 'apps/web/src/preview/components/index.tsx',
  toolbar: 'apps/web/src/preview/components/toolbar.tsx',
} as const;

type SourceKey = keyof typeof PREVIEW_SOURCES;

/** 读取经典版源码；未配置参照根或文件不存在时返回 null。 */
function classicSource(key: SourceKey): string | null {
  if (!CLASSIC_ROOT) return null;
  const full = path.join(CLASSIC_ROOT, PREVIEW_SOURCES[key]);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

describe('经典版预览交互 1:1 · 尺寸/缩放/手柄 token（批 5）', () => {
  it('缩放预设/范围/步进与经典版一致', () => {
    expect(PREVIEW_ZOOM_PRESETS).toEqual([25, 50, 75, 100, 150, 200]);
    expect(PREVIEW_ZOOM_MIN).toBe(0.25);
    expect(PREVIEW_ZOOM_MAX).toBe(16);
    expect(PREVIEW_ZOOM_STEP).toBe(1.25);
    const src = classicSource('zoom');
    if (src) {
      expect(src).toContain('25, 50, 75, 100, 150, 200');
      expect(src).toContain('min: 0.25');
      expect(src).toContain('max: 16');
    }
  });

  it('手柄尺寸/命中区/旋转按钮与经典版一致', () => {
    expect(HANDLE_SIZE).toBe(10);
    expect(HANDLE_HIT_AREA_SIZE).toBe(18);
    expect(ICON_HANDLE_RADIUS).toBe(10);
    expect(EDGE_HANDLE_THIN_SIZE).toBe(6);
    expect(EDGE_HANDLE_THICK_SIZE).toBe(14);
    const src = classicSource('handles');
    if (src) {
      expect(src).toContain('HANDLE_SIZE = 10');
      expect(src).toContain('HANDLE_HIT_AREA_SIZE = 18');
      expect(src).toContain('ICON_HANDLE_RADIUS = 10');
    }
  });

  it('选框/参考线与吸附阈值与经典版一致', () => {
    expect(SELECTION_STROKE_WIDTH).toBe(1);
    expect(SELECTION_STROKE_OPACITY).toBe(0.75);
    expect(SNAP_GUIDE_WIDTH).toBe(1);
    expect(SNAP_THRESHOLD_SCREEN_PIXELS).toBe(8);
    expect(ROTATION_SNAP_STEP_DEGREES).toBe(90);
    expect(ROTATION_SNAP_THRESHOLD_DEGREES).toBe(5);
    expect(MIN_SCALE).toBe(0.01);
    expect(ROTATION_HANDLE_OFFSET).toBe(24);
    const snap = classicSource('snap');
    if (snap) {
      expect(snap).toContain('SNAP_THRESHOLD_SCREEN_PIXELS = 8');
      expect(snap).toContain('ROTATION_SNAP_STEP_DEGREES = 90');
    }
    const guides = classicSource('snapGuides');
    if (guides) expect(guides).toContain('bg-white/70');
  });

  it('视口/控制条 padding 与按钮尺寸与经典版一致', () => {
    expect(PREVIEW_VIEWPORT_PADDING_PX).toBe(8);
    expect(PREVIEW_VIEWPORT_PADDING_BOTTOM_PX).toBe(0);
    expect(PREVIEW_TOOLBAR_PADDING_TOP_PX).toBe(20);
    expect(PREVIEW_TOOLBAR_PADDING_BOTTOM_PX).toBe(12);
    expect(PREVIEW_TOOLBAR_PADDING_X_PX).toBe(20);
    expect(PREVIEW_TOOLBAR_GAP_PX).toBe(10);
    expect(PREVIEW_ICON_BUTTON_SIZE_PX).toBe(28);
    const index = classicSource('index');
    if (index) expect(index).toContain('p-2 pb-0');
    const toolbar = classicSource('toolbar');
    if (toolbar) expect(toolbar).toContain('pt-5 pb-3 px-5');
  });

  it('缩放 epsilon/中键/滚轮常量与经典版一致', () => {
    expect(IS_AT_FIT_EPSILON).toBe(0.001);
    expect(IS_AT_ACTUAL_SIZE_EPSILON).toBe(0.01);
    expect(MIDDLE_MOUSE_BUTTON).toBe(1);
    expect(WHEEL_DELTA_CAP).toBe(30);
    expect(WHEEL_ZOOM_DIVISOR).toBe(300);
    const src = classicSource('viewport');
    if (src) {
      expect(src).toContain('MIDDLE_MOUSE_BUTTON = 1');
      expect(src).toContain('IS_AT_FIT_EPSILON = 0.001');
    }
  });

  it('时间码字段与手柄集合与经典版一致', () => {
    expect(PREVIEW_TIMECODE_FIELDS).toEqual(['HH', 'MM', 'SS', 'FF']);
    expect(TRANSFORM_CORNERS).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    // 无 top 边（被旋转手柄占据）
    expect(TRANSFORM_EDGES).toEqual(['right', 'left', 'bottom']);
  });

  it('getResizeCursor 按角度返回正确光标', () => {
    expect(getResizeCursor(0)).toBe('ew-resize');
    expect(getResizeCursor(45)).toBe('nwse-resize');
    expect(getResizeCursor(90)).toBe('ns-resize');
    expect(getResizeCursor(135)).toBe('nesw-resize');
    expect(getResizeCursor(180)).toBe('ew-resize');
    expect(getResizeCursor(-90)).toBe('ns-resize');
  });

  it('formatZoomLabel 在 Fit 与百分比间正确切换', () => {
    expect(formatZoomLabel(1)).toBe('Fit');
    expect(formatZoomLabel(1.0005)).toBe('Fit');
    expect(formatZoomLabel(1.5)).toBe('150%');
    expect(formatZoomLabel(0.25)).toBe('25%');
    expect(formatZoomLabel(2)).toBe('200%');
  });
});
