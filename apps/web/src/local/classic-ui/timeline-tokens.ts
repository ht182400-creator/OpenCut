/**
 * 经典版 UI 像素级 1:1 改造 · 批 2 时间轴尺寸/布局/缩放 token。
 *
 * 来源：<opencut-classic>/apps/web/src/timeline/ 下的
 * - components/layout.ts、track-layout.ts、theme.ts、layers.ts、interaction.ts
 * - scale.ts、pixel-utils.ts、zoom-utils.ts、ruler-utils.ts
 *
 * 这些值与经典版逐项对齐，由 timeline-tokens.test.ts 在源码可用时逐项比对。
 * 组件逻辑为本地重写（Vite + React），不拷贝经典版状态库与 Next.js 代码。
 */

/** 每秒基准像素（经典版 scale.ts）。 */
export const BASE_TIMELINE_PIXELS_PER_SECOND = 50;

/** 缩放上下限（经典版 scale.ts）。 */
export const TIMELINE_ZOOM_MIN = 0.1;
export const TIMELINE_ZOOM_MAX = 100;

/** 缩放按钮步进倍率与滚轮系数（经典版 interaction.ts）。 */
export const TIMELINE_ZOOM_BUTTON_FACTOR = 1.7;
export const TIMELINE_HORIZONTAL_WHEEL_STEP_PX = 40;
export const TIMELINE_DRAG_THRESHOLD_PX = 5;
export const TIMELINE_ZOOM_ANCHOR_PLAYHEAD_THRESHOLD = 0.15;

/** 轨道基础高度（经典版 components/layout.ts）。 */
export const TIMELINE_TRACK_HEIGHTS_PX = {
  video: 65,
  text: 25,
  audio: 50,
  graphic: 25,
  effect: 25,
} as const;

/** 关键帧通道/展开行高度（经典版 components/layout.ts）。 */
export const KEYFRAME_LANE_HEIGHT_PX = 20;
export const KEYFRAME_DIAMOND_SIZE_PX = 14;
export const EXPANDED_GROUP_HEADER_HEIGHT_PX = 18;

/** 轨道间距、轨道头列宽、标尺/书签/滚动条高度、顶部留白。 */
export const TIMELINE_TRACK_GAP_PX = 6;
export const TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX = 112;
export const TIMELINE_RULER_HEIGHT_PX = 22;
export const TIMELINE_BOOKMARK_ROW_HEIGHT_PX = 16;
export const TIMELINE_SCROLLBAR_SIZE_PX = 12;
export const TIMELINE_CONTENT_TOP_PADDING_PX = 2;

/** 轨道容器最大高度与视口宽度兜底（经典版 index.tsx）。 */
export const TRACKS_CONTAINER_MAX_HEIGHT = 800;
export const FALLBACK_CONTAINER_WIDTH = 1000;

/** 播放头/吸附指示线宽度（经典版 pixel-utils.ts）。 */
export const TIMELINE_INDICATOR_LINE_WIDTH_PX = 2;

/** 层级顺序（经典版 components/layers.ts）。 */
export const TIMELINE_LAYERS = {
  trackContent: 10,
  dragLine: 20,
  playhead: 30,
  snapIndicator: 40,
  marquee: 50,
} as const;

/** 框选橡皮筋：超过该像素位移才视为框（低于阈值仍按单击定位播放头）。 */
export const TIMELINE_MARQUEE_MIN_PX = 4;

/** 各类型轨道元素的背景色（经典版 components/theme.ts）。 */
export const TIMELINE_TRACK_THEME = {
  video: 'transparent',
  text: 'bg-[#5DBAA0]',
  audio: 'bg-[#8F5DBA]',
  graphic: 'bg-[#BA5D7A]',
  effect: 'bg-[#5d93ba]',
} as const;

/** 选中元素描边宽度、书签默认色、音频波形色（经典版 theme.ts / timeline-element.tsx）。 */
export const ELEMENT_RING_WIDTH_PX = 1.5;
export const DEFAULT_TIMELINE_BOOKMARK_COLOR = '#009dff';
export const TIMELINE_AUDIO_WAVEFORM_COLOR = 'rgba(255, 255, 255, 0.7)';
export const THUMBNAIL_ASPECT_RATIO = 16 / 9;

/** 标尺刻度间隔候选（经典版 ruler-utils.ts）。 */
export const LABEL_FRAME_INTERVALS = [2, 3, 5, 10, 15] as const;
export const TICK_FRAME_INTERVALS = [1, 2, 3, 5, 10, 15] as const;
export const SECOND_MULTIPLIERS = [
  1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
] as const;

/** 标签/刻度最小像素间距（经典版 ruler-utils.ts）。 */
export const MIN_LABEL_SPACING_PX = 120;
export const MIN_TICK_SPACING_PX = 18;

/** 时间轴尾部留白比例（经典版 zoom-utils.ts）。 */
export const PADDING_MAX_RATIO = 0.75;
export const PADDING_MIN_RATIO = 0.15;
export const PADDING_MIN_AT_ZOOM_PERCENT = 0.2;

/** 轨道类型：与经典版 TimelineTrack["type"] 对齐的子集。 */
export type ClassicTrackType = keyof typeof TIMELINE_TRACK_HEIGHTS_PX;

/** 标尺配置：标签间隔与刻度间隔（秒）。 */
export interface ClassicRulerConfig {
  labelIntervalSeconds: number;
  tickIntervalSeconds: number;
}

/**
 * 取轨道高度；未知类型回退到 text 轨高度（经典版 getTrackHeight）。
 * @param type 轨道类型
 * @returns {number} 轨道高度（px）
 */
export function getTrackHeight(type: ClassicTrackType): number {
  return TIMELINE_TRACK_HEIGHTS_PX[type] ?? TIMELINE_TRACK_HEIGHTS_PX.text;
}

/**
 * 计算指定轨道之前的累计高度（含轨道间距），用于绝对定位（经典版 getCumulativeHeightBefore）。
 * @param tracks 轨道类型列表
 * @param trackIndex 目标轨道索引
 * @returns {number} 累计高度（px）
 */
export function getCumulativeHeightBefore(
  tracks: readonly ClassicTrackType[],
  trackIndex: number,
): number {
  return tracks
    .slice(0, trackIndex)
    .reduce((sum, type) => sum + getTrackHeight(type) + TIMELINE_TRACK_GAP_PX, 0);
}

/**
 * 计算全部轨道的总高度（含轨道之间的间距，经典版 getTotalTracksHeight）。
 * @param tracks 轨道类型列表
 * @returns {number} 总高度（px）
 */
export function getTotalTracksHeight(tracks: readonly ClassicTrackType[]): number {
  const tracksHeight = tracks.reduce((sum, type) => sum + getTrackHeight(type), 0);
  const gapsHeight = Math.max(0, tracks.length - 1) * TIMELINE_TRACK_GAP_PX;
  return tracksHeight + gapsHeight;
}

/**
 * 把 ticks 换算为像素（经典版 timelineTimeToPixels）。
 * @param timeTicks 时间（ticks）
 * @param zoomLevel 缩放倍数
 * @param ticksPerSecond 每秒 ticks
 * @returns {number} 像素位置
 */
export function timelineTimeToPixels(
  timeTicks: number,
  zoomLevel: number,
  ticksPerSecond: number,
): number {
  return (timeTicks / ticksPerSecond) * BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel;
}

/**
 * 把像素换算为 ticks（timelineTimeToPixels 的逆运算，供框选落点/时间段计算）。
 * 非法缩放或 ticksPerSecond 时返回 0，避免除零产生 Infinity 污染后续吸附。
 * @param pixel 内容坐标像素（已含 scrollLeft）
 * @param zoomLevel 缩放倍数
 * @param ticksPerSecond 每秒 ticks
 * @returns {number} ticks（可含小数，调用方按需吸附帧网格）
 */
export function timelinePixelsToTicks(
  pixel: number,
  zoomLevel: number,
  ticksPerSecond: number,
): number {
  if (!Number.isFinite(pixel) || !Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) return 0;
  const safeZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 1;
  return (pixel / (BASE_TIMELINE_PIXELS_PER_SECOND * safeZoom)) * ticksPerSecond;
}

/** 矩形相交计算用的轴对齐矩形（内容坐标，px）。 */
export interface TimelineRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 由拖拽起点/终点构造规范化矩形（保证 left<=right、top<=bottom，支持反向框选）。
 * @param startX 起点 x
 * @param startY 起点 y
 * @param endX 终点 x
 * @param endY 终点 y
 * @returns {TimelineRect} 规范化矩形
 */
export function normalizeTimelineRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): TimelineRect {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
  };
}

/**
 * 判断两个轴对齐矩形是否相交（边界接触算相交，零面积矩形返回 false）。
 * @param a 矩形 a
 * @param b 矩形 b
 * @returns {boolean} 是否相交
 */
export function rectsIntersect(a: TimelineRect, b: TimelineRect): boolean {
  const aWidth = a.right - a.left
  const aHeight = a.bottom - a.top
  const bWidth = b.right - b.left
  const bHeight = b.bottom - b.top
  if (aWidth <= 0 || aHeight <= 0 || bWidth <= 0 || bHeight <= 0) return false;
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/**
 * 把像素吸附到设备网格（经典版 snapPixelToDeviceGrid）。
 * @param pixel 原始像素
 * @param devicePixelRatio 设备像素比
 * @returns {number} 吸附后的像素
 */
export function snapPixelToDeviceGrid(
  pixel: number,
  devicePixelRatio = 1,
): number {
  const safeRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.round(pixel * safeRatio) / safeRatio;
}

/**
 * 计算居中指示线的左边界（经典版 getCenteredLineLeft）。
 * @param centerPixel 中心像素
 * @param lineWidthPx 线宽
 * @returns {number} 左边界像素
 */
export function getCenteredLineLeft(
  centerPixel: number,
  lineWidthPx = TIMELINE_INDICATOR_LINE_WIDTH_PX,
): number {
  return centerPixel - lineWidthPx / 2;
}

/**
 * 计算适配内容的最小缩放（经典版 getTimelineZoomMin）。
 * @param durationTicks 总时长（ticks）
 * @param containerWidth 容器宽度
 * @param ticksPerSecond 每秒 ticks
 * @returns {number} 最小缩放倍数
 */
export function getTimelineZoomMin(
  durationTicks: number,
  containerWidth: number | null | undefined,
  ticksPerSecond: number,
): number {
  const safeDurationSeconds = Math.max(durationTicks / ticksPerSecond, 1);
  const safeContainerWidth = containerWidth ?? FALLBACK_CONTAINER_WIDTH;
  const zoomToFit =
    (safeContainerWidth * (1 - PADDING_MAX_RATIO)) /
    (safeDurationSeconds * BASE_TIMELINE_PIXELS_PER_SECOND);
  return Math.min(TIMELINE_ZOOM_MAX, zoomToFit);
}

/**
 * 计算缩放百分比（经典版 getZoomPercent）。
 * @param zoomLevel 当前缩放
 * @param minZoom 最小缩放
 * @returns {number} 0~1 的百分比
 */
export function getZoomPercent(zoomLevel: number, minZoom: number): number {
  return (zoomLevel - minZoom) / (TIMELINE_ZOOM_MAX - minZoom);
}

/**
 * 计算时间轴尾部留白（经典版 getTimelinePaddingPx）。
 * @param containerWidth 容器宽度
 * @param zoomLevel 当前缩放
 * @param minZoom 最小缩放
 * @returns {number} 留白像素
 */
export function getTimelinePaddingPx(
  containerWidth: number,
  zoomLevel: number,
  minZoom: number,
): number {
  const zoomPercent = getZoomPercent(zoomLevel, minZoom);
  const transition = Math.min(zoomPercent / PADDING_MIN_AT_ZOOM_PERCENT, 1);
  const paddingRatio = PADDING_MAX_RATIO - (PADDING_MAX_RATIO - PADDING_MIN_RATIO) * transition;
  return containerWidth * paddingRatio;
}

/**
 * 线性滑块位置转指数缩放（经典版 sliderToZoom）。
 * @param sliderPosition 0~1 的滑块位置
 * @param minZoom 最小缩放
 * @returns {number} 缩放倍数
 */
export function sliderToZoom(sliderPosition: number, minZoom: number): number {
  const clamped = Math.max(0, Math.min(1, sliderPosition));
  return minZoom * (TIMELINE_ZOOM_MAX / minZoom) ** clamped;
}

/**
 * 指数缩放转线性滑块位置（经典版 zoomToSlider）。
 * @param zoomLevel 当前缩放
 * @param minZoom 最小缩放
 * @returns {number} 0~1 的滑块位置
 */
export function zoomToSlider(zoomLevel: number, minZoom: number): number {
  const clamped = Math.max(minZoom, Math.min(TIMELINE_ZOOM_MAX, zoomLevel));
  return Math.log(clamped / minZoom) / Math.log(TIMELINE_ZOOM_MAX / minZoom);
}

/**
 * 按缩放和帧率选择最优的标签/刻度间隔（经典版 getRulerConfig）。
 * @param zoomLevel 缩放倍数
 * @param fps 帧率（数值）
 * @returns {ClassicRulerConfig} 标签与刻度间隔（秒）
 */
export function getRulerConfig(zoomLevel: number, fps: number): ClassicRulerConfig {
  const fpsFloat = fps > 0 ? fps : 30;
  const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel;
  const pixelsPerFrame = pixelsPerSecond / fpsFloat;

  const labelIntervalSeconds = findOptimalInterval(
    pixelsPerFrame,
    pixelsPerSecond,
    fpsFloat,
    MIN_LABEL_SPACING_PX,
    LABEL_FRAME_INTERVALS,
  );
  const rawTickIntervalSeconds = findOptimalInterval(
    pixelsPerFrame,
    pixelsPerSecond,
    fpsFloat,
    MIN_TICK_SPACING_PX,
    TICK_FRAME_INTERVALS,
  );
  const tickIntervalSeconds = ensureTickDividesLabel({
    tickIntervalSeconds: rawTickIntervalSeconds,
    labelIntervalSeconds,
    pixelsPerFrame,
    pixelsPerSecond,
    fps: fpsFloat,
  });
  return { labelIntervalSeconds, tickIntervalSeconds };
}

/** 在帧间隔/秒间隔候选里选出满足最小像素间距的最大间隔（经典版 findOptimalInterval）。 */
function findOptimalInterval(
  pixelsPerFrame: number,
  pixelsPerSecond: number,
  fps: number,
  minSpacingPx: number,
  frameIntervals: readonly number[],
): number {
  for (const frameInterval of frameIntervals) {
    if (pixelsPerFrame * frameInterval >= minSpacingPx) return frameInterval / fps;
  }
  for (const secondMultiplier of SECOND_MULTIPLIERS) {
    if (pixelsPerSecond * secondMultiplier >= minSpacingPx) return secondMultiplier;
  }
  return 60;
}

/** 保证刻度间隔能整除标签间隔，标签永远落在刻度上（经典版 ensureTickDividesLabel）。 */
function ensureTickDividesLabel(params: {
  tickIntervalSeconds: number;
  labelIntervalSeconds: number;
  pixelsPerFrame: number;
  pixelsPerSecond: number;
  fps: number;
}): number {
  const { tickIntervalSeconds, labelIntervalSeconds, pixelsPerFrame, pixelsPerSecond, fps } = params;
  const labelFrames = Math.round(labelIntervalSeconds * fps);
  const tickFrames = Math.round(tickIntervalSeconds * fps);
  if (labelFrames % tickFrames === 0) return tickIntervalSeconds;
  for (const candidateFrames of TICK_FRAME_INTERVALS) {
    if (labelFrames % candidateFrames === 0 && pixelsPerFrame * candidateFrames >= MIN_TICK_SPACING_PX) {
      return candidateFrames / fps;
    }
  }
  for (const candidateSeconds of SECOND_MULTIPLIERS) {
    const ratio = labelIntervalSeconds / candidateSeconds;
    if (Math.abs(ratio - Math.round(ratio)) < 0.0001 && pixelsPerSecond * candidateSeconds >= MIN_TICK_SPACING_PX) {
      return candidateSeconds;
    }
  }
  return labelIntervalSeconds;
}

/**
 * 判断一个时间点是否应显示文字标签（经典版 shouldShowLabel）。
 * @param timeSeconds 时间（秒）
 * @param labelIntervalSeconds 标签间隔（秒）
 * @returns {boolean} 是否显示标签
 */
export function shouldShowLabel(timeSeconds: number, labelIntervalSeconds: number): boolean {
  const epsilon = 0.0001;
  const remainder = timeSeconds % labelIntervalSeconds;
  return remainder < epsilon || remainder > labelIntervalSeconds - epsilon;
}

/**
 * 格式化标尺标签：整秒为 MM:SS，帧内为 Xf（经典版 formatRulerLabel）。
 * @param timeInSeconds 时间（秒）
 * @param fps 帧率（数值）
 * @returns {string} 标签文本
 */
export function formatRulerLabel(timeInSeconds: number, fps: number): string {
  const epsilon = 0.0001;
  const remainder = timeInSeconds % 1;
  const isSecondBoundary = remainder < epsilon || remainder > 1 - epsilon;
  if (isSecondBoundary) {
    const totalSeconds = Math.round(timeInSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  const safeFps = fps > 0 ? fps : 30;
  return `${Math.round(remainder * safeFps)}f`;
}
