/**
 * 经典版 UI 像素级 1:1 改造 · 批 3 素材面板尺寸/布局 token。
 *
 * 来源：<opencut-classic>/apps/web/src/components/editor/panels/assets/ 下的
 * - tabbar.tsx（tab 尺寸/间距）、views/base-panel.tsx（PanelView 头/滚动区）
 * - views/assets.tsx（Media 网格/卡片/徽标）、draggable-item.tsx（卡片/拖拽浮层）
 * - views/{text,stickers,sounds,effects,subtitles,settings}/（其余 tab 视图）
 * - ../../timeline/drag-source.ts（拖入时间轴的 MIME）
 *
 * 这些值与经典版逐项对齐，由 assets-tokens.test.ts 在源码可用时逐项比对。
 * 组件逻辑为本地重写（Vite + React），不拷贝经典版状态库与 Next.js 代码。
 */

/** 竖排 tab 按钮尺寸与间距（tabbar.tsx：h-8 w-8 / gap-0.5 / p-1）。 */
export const ASSETS_TAB_SIZE_PX = 32;
export const ASSETS_TAB_GAP_PX = 2;
export const ASSETS_TABBAR_PADDING_PX = 4;

/** PanelView 头高度与内边距（base-panel.tsx：h-11 / pl-3 pr-2，滚动区 pt-2=8px）。 */
export const ASSETS_PANEL_HEADER_HEIGHT_PX = 44;
export const ASSETS_PANEL_HEADER_PADDING_LEFT_PX = 12;
export const ASSETS_PANEL_HEADER_PADDING_RIGHT_PX = 8;
export const ASSETS_PANEL_SCROLL_TOP_PADDING_PX = 8;
export const ASSETS_PANEL_CONTENT_PADDING_X_PX = 8;

/** Media 网格：列宽 7rem=112px、gap-4=16px；列表 gap-1.5=6px（assets.tsx）。 */
export const ASSETS_GRID_COLUMN_WIDTH_REM = 7;
export const ASSETS_GRID_COLUMN_WIDTH_PX = 112;
export const ASSETS_GRID_GAP_PX = 16;
export const ASSETS_LIST_GAP_PX = 6;

/** 卡片内层 gap-1=4px；名称字号 0.7rem=11.2px（draggable-item.tsx）。 */
export const ASSETS_CARD_INNER_GAP_PX = 4;
export const ASSETS_CARD_NAME_FONT_REM = 0.7;
export const ASSETS_CARD_NAME_MAX_CHARS = 8;

/** 卡片时长徽标（assets.tsx：right-1 bottom-1、bg-black/70、text-xs）。 */
export const ASSETS_DURATION_BADGE_OFFSET_PX = 4;
export const ASSETS_DURATION_BADGE_BG = 'rgba(0, 0, 0, 0.7)';

/** 卡片 hover 加号按钮尺寸（draggable-item.tsx：size-5=20px、right-2 bottom-2）。 */
export const ASSETS_ADD_BUTTON_SIZE_PX = 20;
export const ASSETS_ADD_BUTTON_OFFSET_PX = 8;

/** 拖拽浮层宽度与层级（draggable-item.tsx：w-[80px]、z-9999、ring-3）。 */
export const ASSETS_DRAG_OVERLAY_WIDTH_PX = 80;
export const ASSETS_DRAG_OVERLAY_Z_INDEX = 9999;
export const ASSETS_DRAG_OVERLAY_OFFSET_PX = 40;

/** 拖入时间轴的 dataTransfer MIME（timeline/drag-source.ts）。 */
export const TIMELINE_DRAG_MIME = 'application/x-timeline-drag';

/** 其余 tab 网格断点（effects/assets-view.tsx、stickers/assets-view.tsx）。 */
export const ASSETS_EFFECTS_GRID_MIN_PX = 96;
export const ASSETS_STICKERS_GRID_MIN_PX = 80;
export const ASSETS_STICKERS_GRID_MAX_PX = 140;

/** 素材面板九个 tab 的顺序（assets-panel-store.tsx：TAB_KEYS）。 */
export const ASSETS_TAB_KEYS = [
  'media', 'sounds', 'text', 'stickers', 'effects',
  'transitions', 'captions', 'adjustment', 'settings',
] as const;

/** 经典版 UI 文案（英文；当前工程保留中文 label，见差异登记）。 */
export const ASSETS_TAB_LABELS = {
  media: 'Media', sounds: 'Sounds', text: 'Text', stickers: 'Stickers',
  effects: 'Effects', transitions: 'Transitions', captions: 'Captions',
  adjustment: 'Adjustment', settings: 'Settings',
} as const;
