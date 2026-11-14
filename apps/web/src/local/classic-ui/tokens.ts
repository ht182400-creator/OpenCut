/**
 * 经典版 UI 像素级 1:1 改造 · 批 0 尺寸基线。
 *
 * 来源：E:\AI_Studio\opencut-classic
 * - PANEL_CONFIG: apps/web/src/panels/layout.ts
 * - 面板约束/间隙: apps/web/src/app/editor/[project_id]/page.tsx (EditorLayout)
 * - 顶栏: apps/web/src/components/editor/editor-header.tsx
 * - 圆角/字号/断点: apps/web/src/app/globals.css (@theme inline)
 *
 * 这些值由 tokens.test.ts 逐项锁定，改动必须与经典版同步。
 */

/** 五个可调整面板的默认尺寸（百分比）。 */
export const CLASSIC_PANEL_CONFIG = {
  tools: 25,
  preview: 50,
  properties: 25,
  mainContent: 50,
  timeline: 50,
} as const;

/** 面板尺寸约束（百分比；undefined 表示经典版未设上限）。 */
export const CLASSIC_PANEL_LIMITS = {
  tools: { min: 15, max: 40 },
  preview: { min: 30, max: undefined },
  properties: { min: undefined, max: undefined },
  mainContent: { min: 30, max: 85 },
  timeline: { min: undefined, max: undefined },
} as const;

/** 面板间隙与内边距（rem）。 */
export const CLASSIC_GAPS = {
  vertical: 0.18,
  horizontal: 0.19,
  horizontalPadding: 0.75,
} as const;

/** 顶栏尺寸（rem）。 */
export const CLASSIC_HEADER = {
  height: 3.4,
  paddingX: 0.75,
  paddingTop: 0.125,
} as const;

/** 圆角（rem）。 */
export const CLASSIC_RADIUS = {
  lg: 0.82,
  md: 0.65,
  sm: 0.35,
} as const;

/** 字号（rem）。 */
export const CLASSIC_FONT_SIZE = {
  xs: 0.72,
  sm: 0.79,
  base: 0.92,
} as const;

/** 自定义断点（rem）。 */
export const CLASSIC_BREAKPOINT_XS = 30;

/** 经典版主题变量名（供测试与运行时检查使用）。 */
export const CLASSIC_THEME_KEYS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover',
  'popover-hover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-border', 'secondary-foreground', 'muted',
  'muted-foreground', 'accent', 'accent-foreground', 'destructive',
  'destructive-foreground', 'constructive', 'constructive-foreground',
  'caution', 'caution-foreground', 'border', 'input', 'ring',
] as const;
