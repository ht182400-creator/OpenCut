import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BASE_TIMELINE_PIXELS_PER_SECOND,
  DEFAULT_TIMELINE_BOOKMARK_COLOR,
  ELEMENT_RING_WIDTH_PX,
  FALLBACK_CONTAINER_WIDTH,
  KEYFRAME_DIAMOND_SIZE_PX,
  KEYFRAME_LANE_HEIGHT_PX,
  LABEL_FRAME_INTERVALS,
  MIN_LABEL_SPACING_PX,
  MIN_TICK_SPACING_PX,
  SECOND_MULTIPLIERS,
  THUMBNAIL_ASPECT_RATIO,
  TIMELINE_AUDIO_WAVEFORM_COLOR,
  TIMELINE_BOOKMARK_ROW_HEIGHT_PX,
  TIMELINE_CONTENT_TOP_PADDING_PX,
  TIMELINE_DRAG_THRESHOLD_PX,
  TIMELINE_HORIZONTAL_WHEEL_STEP_PX,
  TIMELINE_INDICATOR_LINE_WIDTH_PX,
  TIMELINE_LAYERS,
  TIMELINE_RULER_HEIGHT_PX,
  TIMELINE_SCROLLBAR_SIZE_PX,
  TIMELINE_TRACK_GAP_PX,
  TIMELINE_TRACK_HEIGHTS_PX,
  TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX,
  TIMELINE_TRACK_THEME,
  TIMELINE_ZOOM_ANCHOR_PLAYHEAD_THRESHOLD,
  TIMELINE_ZOOM_BUTTON_FACTOR,
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
  TICK_FRAME_INTERVALS,
  TRACKS_CONTAINER_MAX_HEIGHT,
  formatRulerLabel,
  getCenteredLineLeft,
  getCumulativeHeightBefore,
  getRulerConfig,
  getTimelinePaddingPx,
  getTimelineZoomMin,
  getTotalTracksHeight,
  getTrackHeight,
  getZoomPercent,
  shouldShowLabel,
  sliderToZoom,
  snapPixelToDeviceGrid,
  timelineTimeToPixels,
  zoomToSlider,
} from './timeline-tokens';

/** 参照物根目录可用环境变量覆盖；源码不在本机时退回内置期望值。 */
const CLASSIC_ROOT =
  process.env.OPENCUT_CLASSIC_ROOT ?? 'E:/AI_Studio/opencut-classic';
const TIMELINE_SOURCES = {
  layout: 'apps/web/src/timeline/components/layout.ts',
  theme: 'apps/web/src/timeline/components/theme.ts',
  layers: 'apps/web/src/timeline/components/layers.ts',
  interaction: 'apps/web/src/timeline/components/interaction.ts',
  scale: 'apps/web/src/timeline/scale.ts',
  zoomUtils: 'apps/web/src/timeline/zoom-utils.ts',
  rulerUtils: 'apps/web/src/timeline/ruler-utils.ts',
  pixelUtils: 'apps/web/src/timeline/pixel-utils.ts',
  index: 'apps/web/src/timeline/components/index.tsx',
  timelineElement: 'apps/web/src/timeline/components/timeline-element.tsx',
} as const;

/** 读取经典版源码；不存在时返回 null（CI / 非作者机器）。 */
function classicSource(key: keyof typeof TIMELINE_SOURCES): string | null {
  const full = path.join(CLASSIC_ROOT, TIMELINE_SOURCES[key]);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

/** 断言源码包含指定文本片段（忽略空白差异）。 */
function expectContains(source: string | null, needle: string): void {
  if (source === null) return;
  const compact = (text: string) => text.replace(/\s+/g, '');
  expect(compact(source), `经典版源码应包含：${needle}`).toContain(compact(needle));
}

describe('经典版时间轴 1:1 · 尺寸/层级/主题 token（批 2）', () => {
  it('轨道高度与间距逐项一致', () => {
    expect(TIMELINE_TRACK_HEIGHTS_PX).toEqual({
      video: 65, text: 25, audio: 50, graphic: 25, effect: 25,
    });
    expect(TIMELINE_TRACK_GAP_PX).toBe(6);
    expect(TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX).toBe(112);
    expect(TIMELINE_RULER_HEIGHT_PX).toBe(22);
    expect(TIMELINE_BOOKMARK_ROW_HEIGHT_PX).toBe(16);
    expect(TIMELINE_SCROLLBAR_SIZE_PX).toBe(12);
    expect(TIMELINE_CONTENT_TOP_PADDING_PX).toBe(2);
    expect(KEYFRAME_LANE_HEIGHT_PX).toBe(20);
    expect(KEYFRAME_DIAMOND_SIZE_PX).toBe(14);
    expect(TRACKS_CONTAINER_MAX_HEIGHT).toBe(800);
    expect(FALLBACK_CONTAINER_WIDTH).toBe(1000);
  });

  it('层级、描边、书签与波形配色一致', () => {
    expect(TIMELINE_LAYERS).toEqual({
      trackContent: 10, dragLine: 20, playhead: 30, snapIndicator: 40,
    });
    expect(ELEMENT_RING_WIDTH_PX).toBe(1.5);
    expect(TIMELINE_INDICATOR_LINE_WIDTH_PX).toBe(2);
    expect(DEFAULT_TIMELINE_BOOKMARK_COLOR).toBe('#009dff');
    expect(TIMELINE_AUDIO_WAVEFORM_COLOR).toBe('rgba(255, 255, 255, 0.7)');
    expect(THUMBNAIL_ASPECT_RATIO).toBe(16 / 9);
    expect(TIMELINE_TRACK_THEME).toEqual({
      video: 'transparent',
      text: 'bg-[#5DBAA0]',
      audio: 'bg-[#8F5DBA]',
      graphic: 'bg-[#BA5D7A]',
      effect: 'bg-[#5d93ba]',
    });
  });

  it('缩放与交互常量一致', () => {
    expect(BASE_TIMELINE_PIXELS_PER_SECOND).toBe(50);
    expect(TIMELINE_ZOOM_MIN).toBe(0.1);
    expect(TIMELINE_ZOOM_MAX).toBe(100);
    expect(TIMELINE_ZOOM_BUTTON_FACTOR).toBe(1.7);
    expect(TIMELINE_HORIZONTAL_WHEEL_STEP_PX).toBe(40);
    expect(TIMELINE_DRAG_THRESHOLD_PX).toBe(5);
    expect(TIMELINE_ZOOM_ANCHOR_PLAYHEAD_THRESHOLD).toBe(0.15);
  });

  it('标尺间隔候选与最小间距一致', () => {
    expect(LABEL_FRAME_INTERVALS).toEqual([2, 3, 5, 10, 15]);
    expect(TICK_FRAME_INTERVALS).toEqual([1, 2, 3, 5, 10, 15]);
    expect(SECOND_MULTIPLIERS).toEqual([1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]);
    expect(MIN_LABEL_SPACING_PX).toBe(120);
    expect(MIN_TICK_SPACING_PX).toBe(18);
  });

  it('与经典版源码逐项比对（源码可用时）', () => {
    expectContains(classicSource('layout'), 'video: 65, text: 25, audio: 50, graphic: 25, effect: 25');
    expectContains(classicSource('layout'), 'TIMELINE_TRACK_GAP_PX = 6');
    expectContains(classicSource('layout'), 'TIMELINE_TRACK_LABELS_COLUMN_WIDTH_PX = 112');
    expectContains(classicSource('layout'), 'TIMELINE_RULER_HEIGHT_PX = 22');
    expectContains(classicSource('layout'), 'TIMELINE_BOOKMARK_ROW_HEIGHT_PX = 16');
    expectContains(classicSource('layout'), 'TIMELINE_CONTENT_TOP_PADDING_PX = 2');
    expectContains(classicSource('theme'), 'bg-[#5DBAA0]');
    expectContains(classicSource('theme'), 'bg-[#8F5DBA]');
    expectContains(classicSource('theme'), '#009dff');
    expectContains(classicSource('layers'), 'trackContent: 10');
    expectContains(classicSource('layers'), 'snapIndicator: 40');
    expectContains(classicSource('interaction'), 'TIMELINE_ZOOM_BUTTON_FACTOR = 1.7');
    expectContains(classicSource('scale'), 'BASE_TIMELINE_PIXELS_PER_SECOND = 50');
    expectContains(classicSource('scale'), 'TIMELINE_ZOOM_MAX = 100');
    expectContains(classicSource('zoomUtils'), 'PADDING_MAX_RATIO = 0.75');
    expectContains(classicSource('rulerUtils'), 'MIN_LABEL_SPACING_PX = 120');
    expectContains(classicSource('rulerUtils'), 'const LABEL_FRAME_INTERVALS = [2, 3, 5, 10, 15]');
    expectContains(classicSource('pixelUtils'), 'TIMELINE_INDICATOR_LINE_WIDTH_PX = 2');
    expectContains(classicSource('index'), 'TRACKS_CONTAINER_MAX_HEIGHT = 800');
    expectContains(classicSource('timelineElement'), 'ELEMENT_RING_WIDTH_PX = 1.5');
  });
});

describe('经典版时间轴 1:1 · 纯函数（批 2）', () => {
  it('getTrackHeight 支持全部类型并对未知类型回退', () => {
    expect(getTrackHeight('video')).toBe(65);
    expect(getTrackHeight('audio')).toBe(50);
    expect(getTrackHeight('text')).toBe(25);
    // 未知类型走 text 轨高度，避免布局崩溃（边界值）
    expect(getTrackHeight('unknown' as 'text')).toBe(25);
  });

  it('累计高度与总高度按轨道间距计算', () => {
    // 轨道「类型」而非 id：overlay 为 text 轨、main 为 video 轨、audio 为 audio 轨
    const tracks = ['text', 'video', 'audio'] as const;
    expect(getCumulativeHeightBefore(tracks, 0)).toBe(0);
    // text(25) + gap(6)
    expect(getCumulativeHeightBefore(tracks, 1)).toBe(31);
    // + video(65) + gap(6)
    expect(getCumulativeHeightBefore(tracks, 2)).toBe(102);
    // 25 + 65 + 50 + 2 * 6
    expect(getTotalTracksHeight(tracks)).toBe(152);
    expect(getTotalTracksHeight([])).toBe(0);
  });

  it('timelineTimeToPixels 按 50px/s × 缩放换算', () => {
    expect(timelineTimeToPixels(120000, 1, 120000)).toBe(50);
    expect(timelineTimeToPixels(120000, 2, 120000)).toBe(100);
    expect(timelineTimeToPixels(0, 1, 120000)).toBe(0);
  });

  it('snapPixelToDeviceGrid 处理非法 dpr 与边界', () => {
    expect(snapPixelToDeviceGrid(10.4, 2)).toBe(10.5);
    expect(snapPixelToDeviceGrid(10.4, 0)).toBe(10);
    expect(snapPixelToDeviceGrid(10.4, Number.NaN)).toBe(10);
  });

  it('getCenteredLineLeft 返回线中心对齐的左边界', () => {
    expect(getCenteredLineLeft(100)).toBe(99);
    expect(getCenteredLineLeft(100, 4)).toBe(98);
  });

  it('缩放/滑块互换在边界闭环', () => {
    // duration 3s × 50px/s = 150px 内容宽；容器 1000px × 25% = 250px 可用宽
    const min = getTimelineZoomMin(360000, 1000, 120000);
    expect(min).toBeCloseTo(250 / 150, 5);
    expect(getZoomPercent(min, min)).toBe(0);
    expect(getZoomPercent(TIMELINE_ZOOM_MAX, min)).toBe(1);
    expect(sliderToZoom(0, min)).toBeCloseTo(min, 5);
    expect(sliderToZoom(1, min)).toBeCloseTo(TIMELINE_ZOOM_MAX, 5);
    expect(zoomToSlider(min, min)).toBeCloseTo(0, 5);
    expect(zoomToSlider(TIMELINE_ZOOM_MAX, min)).toBeCloseTo(1, 5);
    expect(getTimelinePaddingPx(1000, min, min)).toBeCloseTo(750, 5);
  });

  it('getRulerConfig 在高缩放用帧间隔、低缩放用秒间隔', () => {
    const high = getRulerConfig(2, 30);
    expect(high.labelIntervalSeconds).toBeGreaterThan(0);
    expect(high.tickIntervalSeconds).toBeGreaterThan(0);
    // 标签间隔必须能被刻度间隔整除（标签落在刻度上）
    const labelFrames = Math.round(high.labelIntervalSeconds * 30);
    const tickFrames = Math.round(high.tickIntervalSeconds * 30);
    expect(labelFrames % tickFrames).toBe(0);

    const low = getRulerConfig(0.2, 30);
    expect(low.labelIntervalSeconds).toBeGreaterThanOrEqual(1);
  });

  it('shouldShowLabel 在间隔边界显示标签', () => {
    expect(shouldShowLabel(0, 2)).toBe(true);
    expect(shouldShowLabel(2, 2)).toBe(true);
    expect(shouldShowLabel(1, 2)).toBe(false);
    // epsilon=0.0001，remainder 需严格大于 interval-epsilon
    expect(shouldShowLabel(1.99999, 2)).toBe(true);
  });

  it('formatRulerLabel 输出 MM:SS / H:MM:SS / Xf', () => {
    expect(formatRulerLabel(0, 30)).toBe('00:00');
    expect(formatRulerLabel(90, 30)).toBe('01:30');
    expect(formatRulerLabel(3600, 30)).toBe('1:00:00');
    expect(formatRulerLabel(1 / 6, 30)).toBe('5f');
  });
});
