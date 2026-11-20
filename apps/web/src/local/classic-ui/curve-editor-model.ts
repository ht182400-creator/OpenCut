/**
 * P3 长尾批 3 · 关键帧曲线编辑器的纯函数模型（无 DOM/React）。
 *
 * 数据模型（关键帧增删改/采样/缓动）在 element-model.ts 已完整，本模块只负责
 * 「轨道数据 ↔ 图表几何」的换算与命中，便于用边界值/异常用例充分单测。
 */

import type { AnimationKeyframe } from '../element-model'

/** 曲线图表几何常量（避免业务代码裸数字）。 */
export const CURVE_CHART = Object.freeze({
  /** 每张参数轨道图高度 px。 */
  TRACK_HEIGHT_PX: 56,
  /** 图表左右内边距 px（留给首尾帧点）。 */
  PADDING_X_PX: 10,
  /** 图表上下内边距 px。 */
  PADDING_Y_PX: 8,
  /** 关键帧点半径 px（命中判定放宽到半径 + 阈值）。 */
  POINT_RADIUS_PX: 5,
  /** 命中额外容差 px。 */
  HIT_TOLERANCE_PX: 3,
  /** 折线采样点数（平滑缓动曲线用）。 */
  SAMPLE_COUNT: 24,
  /** 无 max 定义时，值域相对关键帧值/默认值的扩展比例。 */
  AUTO_RANGE_PADDING_RATIO: 0.2,
  /** 值域退化为零跨度时的最小跨度。 */
  MIN_VALUE_SPAN: 1,
})

/** 参数值域（y 轴映射用）。 */
export interface ValueRange {
  min: number
  max: number
}

/**
 * 解析参数值域：优先用注册表 min/max；仅有 min 时按关键帧最大值向上扩展；
 * 都缺失时按关键帧值与默认值的 min/max 加 20% 留白，退化时给最小跨度。
 * @param definedMin 注册表 min（可能 undefined）
 * @param definedMax 注册表 max（可能 undefined）
 * @param frames 关键帧数组
 * @param defaultValue 参数默认值
 * @returns {ValueRange} 有效值域（max > min）
 */
export function resolveValueRange(
  definedMin: number | undefined,
  definedMax: number | undefined,
  frames: readonly AnimationKeyframe[],
  defaultValue: number,
): ValueRange {
  const values = frames.map((frame) => frame.value).concat(defaultValue)
  const finite = values.filter((v) => Number.isFinite(v))
  const fallbackMin = finite.length > 0 ? Math.min(...finite) : 0
  const fallbackMax = finite.length > 0 ? Math.max(...finite) : 1
  let min = Number.isFinite(definedMin) ? (definedMin as number) : fallbackMin
  let max = Number.isFinite(definedMax) ? (definedMax as number) : fallbackMax
  // min 有定义但 max 无定义：向上扩展至少一个比例，保证能容纳关键帧值。
  if (!Number.isFinite(definedMax) && max < fallbackMax) max = fallbackMax
  if (!Number.isFinite(definedMin) && min > fallbackMin) min = fallbackMin
  if (!Number.isFinite(min)) min = 0
  if (!Number.isFinite(max)) max = min + CURVE_CHART.MIN_VALUE_SPAN
  if (max - min < CURVE_CHART.MIN_VALUE_SPAN) {
    const center = (min + max) / 2
    min = center - CURVE_CHART.MIN_VALUE_SPAN / 2
    max = center + CURVE_CHART.MIN_VALUE_SPAN / 2
  }
  // 有留白比例时（无明确 max/min）再扩一点，避免点贴边。
  if (!Number.isFinite(definedMax)) max += (max - min) * CURVE_CHART.AUTO_RANGE_PADDING_RATIO
  if (!Number.isFinite(definedMin)) min -= (max - min) * CURVE_CHART.AUTO_RANGE_PADDING_RATIO
  return { min, max }
}

/** 把（时间, 总时长）映射到图表 x 像素，输入非法时安全回落 0。 */
export function timeToX(time: number, durationTicks: number, widthPx: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(durationTicks) || durationTicks <= 0) {
    return CURVE_CHART.PADDING_X_PX
  }
  const ratio = Math.min(1, Math.max(0, time / durationTicks))
  return CURVE_CHART.PADDING_X_PX + ratio * (widthPx - 2 * CURVE_CHART.PADDING_X_PX)
}

/** 把 x 像素映射回时间 ticks（夹逼到 0..duration）。 */
export function xToTime(x: number, durationTicks: number, widthPx: number): number {
  const inner = widthPx - 2 * CURVE_CHART.PADDING_X_PX
  if (inner <= 0 || !Number.isFinite(x) || !Number.isFinite(durationTicks)) return 0
  const ratio = (x - CURVE_CHART.PADDING_X_PX) / inner
  return Math.round(Math.min(1, Math.max(0, ratio)) * durationTicks)
}

/** 把数值映射到图表 y 像素（y 向下增长，最大值在顶部），输入非法时安全回落中线。 */
export function valueToY(value: number, range: ValueRange, heightPx: number): number {
  const span = range.max - range.min
  if (!Number.isFinite(value) || !Number.isFinite(span) || span <= 0) return heightPx / 2
  const ratio = (value - range.min) / span
  return CURVE_CHART.PADDING_Y_PX + (1 - Math.min(1, Math.max(0, ratio))) * (heightPx - 2 * CURVE_CHART.PADDING_Y_PX)
}

/** 把 y 像素映射回参数数值（夹逼到值域）。 */
export function yToValue(y: number, range: ValueRange, heightPx: number): number {
  const inner = heightPx - 2 * CURVE_CHART.PADDING_Y_PX
  if (inner <= 0 || !Number.isFinite(y)) return range.min
  const ratio = (y - CURVE_CHART.PADDING_Y_PX) / inner
  return range.min + (1 - Math.min(1, Math.max(0, ratio))) * (range.max - range.min)
}

/**
 * 命中检测：返回距离给定像素最近且在容差内的关键帧索引。
 * @returns {number} 命中索引，-1 表示未命中
 */
export function hitTestKeyframe(
  x: number,
  y: number,
  frames: readonly AnimationKeyframe[],
  durationTicks: number,
  widthPx: number,
  range: ValueRange,
  heightPx: number,
): number {
  const tolerance = CURVE_CHART.POINT_RADIUS_PX + CURVE_CHART.HIT_TOLERANCE_PX
  let best = -1
  let bestDist = Infinity
  frames.forEach((frame, index) => {
    const px = timeToX(frame.time, durationTicks, widthPx)
    const py = valueToY(frame.value, range, heightPx)
    const dist = Math.hypot(px - x, py - y)
    if (dist <= tolerance && dist < bestDist) { best = index; bestDist = dist }
  })
  return best
}

/**
 * 生成曲线折线的 SVG points 串（按缓动采样，避免关键帧之间是直线丢失 ease 信息）。
 * @returns {string} "x,y x,y …"，无帧返回空串
 */
export function buildCurvePoints(
  frames: readonly AnimationKeyframe[],
  sample: (time: number) => number,
  durationTicks: number,
  widthPx: number,
  range: ValueRange,
  heightPx: number,
): string {
  if (frames.length === 0 || durationTicks <= 0) return ''
  const points: string[] = []
  for (let i = 0; i <= CURVE_CHART.SAMPLE_COUNT; i++) {
    const time = (i / CURVE_CHART.SAMPLE_COUNT) * durationTicks
    const value = sample(time)
    points.push(`${timeToX(time, durationTicks, widthPx).toFixed(2)},${valueToY(value, range, heightPx).toFixed(2)}`)
  }
  return points.join(' ')
}

/**
 * 从轨道表生成单帧删除后的新轨道表（不改入参）。
 * @returns {Record<string, AnimationKeyframe[]>} 新轨道表
 */
export function removeKeyframeAt(
  tracks: Readonly<Record<string, readonly AnimationKeyframe[]>>,
  key: string,
  index: number,
): Record<string, AnimationKeyframe[]> {
  const result: Record<string, AnimationKeyframe[]> = {}
  for (const [id, frames] of Object.entries(tracks)) {
    if (id === key) {
      const next = frames.filter((_, i) => i !== index).map((frame) => ({ ...frame }))
      if (next.length > 0) result[id] = next
    } else {
      result[id] = frames.map((frame) => ({ ...frame }))
    }
  }
  return result
}
