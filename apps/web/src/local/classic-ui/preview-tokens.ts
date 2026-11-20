/**
 * 经典版 UI 像素级 1:1 改造 · 批 5 预览交互尺寸/缩放/手柄 token。
 *
 * 来源：<opencut-classic>/apps/web/src/preview/ 下的
 * - zoom.ts（缩放预设/范围/步进）、preview-snap.ts（吸附阈值）
 * - components/handle-primitives.tsx（手柄尺寸/命中区/颜色/光标）
 * - components/snap-guides.tsx（参考线）、element-bounds.ts（旋转手柄偏移）
 * - components/index.tsx（视口 padding/分层）、components/toolbar.tsx（控制条）
 * - components/editable-timecode.tsx（时间码格式）
 *
 * 这些值与经典版逐项对齐，由 preview-tokens.test.ts 在源码可用时逐项比对。
 * 组件逻辑为本地重写（Vite + React），不拷贝经典版状态库与 Next.js 代码。
 */

/** 缩放预设百分比（zoom.ts：PREVIEW_ZOOM_PRESETS）。 */
export const PREVIEW_ZOOM_PRESETS = [25, 50, 75, 100, 150, 200] as const;

/** 缩放范围与步进（zoom.ts：PREVIEW_ZOOM）。 */
export const PREVIEW_ZOOM_MIN = 0.25;
export const PREVIEW_ZOOM_MAX = 16;
export const PREVIEW_ZOOM_STEP = 1.25;

/** 缩放判定 epsilon（preview-viewport.tsx）。 */
export const IS_AT_FIT_EPSILON = 0.001;
export const IS_AT_ACTUAL_SIZE_EPSILON = 0.01;
export const MIDDLE_MOUSE_BUTTON = 1;
export const WHEEL_DELTA_CAP = 30;
export const WHEEL_ZOOM_DIVISOR = 300;

/** 手柄尺寸（handle-primitives.tsx:7-12）。 */
export const HANDLE_SIZE = 10;
export const HANDLE_HIT_AREA_SIZE = 18;
export const ICON_HANDLE_RADIUS = 10;
export const EDGE_HANDLE_THIN_SIZE = 6;
export const EDGE_HANDLE_THICK_SIZE = 14;
export const LINE_HIT_AREA_SIZE = 48;

/** 旋转手柄偏移（element-bounds.ts:201）。 */
export const ROTATION_HANDLE_OFFSET = 24;

/** 吸附阈值与旋转吸附（preview-snap.ts:6-9）。 */
export const SNAP_THRESHOLD_SCREEN_PIXELS = 8;
export const ROTATION_SNAP_STEP_DEGREES = 90;
export const ROTATION_SNAP_THRESHOLD_DEGREES = 5;
export const MIN_SCALE = 0.01;

/** 选框描边（handle-primitives.tsx：white / 0.75 opacity / 1px / non-scaling）。 */
export const SELECTION_STROKE_COLOR = 'white';
export const SELECTION_STROKE_OPACITY = 0.75;
export const SELECTION_STROKE_WIDTH = 1;

/** 参考线（snap-guides.tsx：1px / white 70%）。 */
export const SNAP_GUIDE_WIDTH = 1;
export const SNAP_GUIDE_COLOR = 'rgba(255, 255, 255, 0.7)';

/** 手柄颜色/圆角（handle-primitives.tsx：bg-white / rounded-sm；旋转 text-black shadow-sm）。 */
export const HANDLE_FILL = '#ffffff';
export const HANDLE_BORDER_RADIUS = 'var(--radius-sm)';
export const ICON_HANDLE_FILL = '#ffffff';
export const ICON_HANDLE_TEXT = '#000000';

/** 视口内容 padding（index.tsx：p-2 pb-0 = 上/左/右 8px，底 0）。 */
export const PREVIEW_VIEWPORT_PADDING_PX = 8;
export const PREVIEW_VIEWPORT_PADDING_BOTTOM_PX = 0;

/** 控制条 padding（toolbar.tsx：pt-5 pb-3 px-5 = 20/12/20px）与 icon 按钮 28px。 */
export const PREVIEW_TOOLBAR_PADDING_TOP_PX = 20;
export const PREVIEW_TOOLBAR_PADDING_BOTTOM_PX = 12;
export const PREVIEW_TOOLBAR_PADDING_X_PX = 20;
export const PREVIEW_TOOLBAR_GAP_PX = 10;
export const PREVIEW_ICON_BUTTON_SIZE_PX = 28;

/** 时间码格式 HH:MM:SS:FF（editable-timecode.tsx）。 */
export const PREVIEW_TIMECODE_FIELDS = ['HH', 'MM', 'SS', 'FF'] as const;

/** 四个角 / 三条边（transform-handles.tsx：无 top 边，被旋转手柄占据）。 */
export const TRANSFORM_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const TRANSFORM_EDGES = ['right', 'left', 'bottom'] as const;

/**
 * 按旋转角返回手柄光标（handle-primitives.tsx getResizeCursor：归一化到 [0,180)）。
 * @param degrees 元素旋转角（度）
 * @returns {string} CSS cursor 值
 */
export function getResizeCursor(degrees: number): string {
  const normalized = ((degrees % 180) + 180) % 180
  if (normalized < 22.5 || normalized >= 157.5) return 'ew-resize'
  if (normalized < 67.5) return 'nwse-resize'
  if (normalized < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

/**
 * 把缩放百分比转成 Fit 显示文案（toolbar.tsx：zoom===1 显示 Fit）。
 * @param zoom 缩放倍率（1 = Fit）
 * @returns {string} select 显示值
 */
export function formatZoomLabel(zoom: number): string {
  return Math.abs(zoom - 1) <= IS_AT_FIT_EPSILON ? 'Fit' : `${Math.round(zoom * 100)}%`
}

/** 时间码字段分隔与补位常量（editable-timecode.tsx）。 */
export const TIMECODE_FIELDS = 4 as const
export const TIMECODE_PAD_WIDTH = 2 as const
export const SECONDS_PER_MINUTE = 60 as const
export const MINUTES_PER_HOUR = 60 as const

/**
 * 帧号 → HH:MM:SS:FF（经典版 EditableTimecode 显示格式）。
 * @param frameIndex 帧号（负值按 0）
 * @param fps 帧率（非法回落 1）
 * @returns {string} HH:MM:SS:FF
 */
export function formatFrameTimecode(frameIndex: number, fps: number): string {
  const rate = Math.max(1, Math.round(Number.isFinite(fps) ? fps : 1))
  const total = Math.max(0, Math.floor(Number.isFinite(frameIndex) ? frameIndex : 0))
  const frames = total % rate
  const seconds = Math.floor(total / rate) % SECONDS_PER_MINUTE
  const minutes = Math.floor(total / (rate * SECONDS_PER_MINUTE)) % MINUTES_PER_HOUR
  const hours = Math.floor(total / (rate * SECONDS_PER_MINUTE * MINUTES_PER_HOUR))
  const pad = (value: number) => String(value).padStart(TIMECODE_PAD_WIDTH, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

/**
 * 解析 HH:MM:SS:FF → 帧号；非法/超范围返回 null 由调用方保持原值。
 * 兼容 H:M:S:F（不补位）与纯秒数（当作 SS:FF 前的秒）。
 * @param text 输入文本
 * @param fps 帧率
 * @returns {number | null} 帧号或 null
 */
export function parseFrameTimecode(text: string, fps: number): number | null {
  const rate = Math.max(1, Math.round(Number.isFinite(fps) ? fps : 1))
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const parts = trimmed.split(':')
  if (parts.length !== TIMECODE_FIELDS) return null
  const nums = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN
    return Number.parseInt(part, 10)
  })
  if (nums.some((value) => !Number.isFinite(value))) return null
  const [hours, minutes, seconds, frames] = nums
  if (minutes >= MINUTES_PER_HOUR || seconds >= SECONDS_PER_MINUTE || frames >= rate) return null
  const totalSeconds = hours * SECONDS_PER_MINUTE * MINUTES_PER_HOUR
    + minutes * SECONDS_PER_MINUTE + seconds
  return totalSeconds * rate + frames
}
