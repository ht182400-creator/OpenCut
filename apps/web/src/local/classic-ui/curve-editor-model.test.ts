import { describe, expect, it } from 'vitest'
import type { AnimationKeyframe } from '../element-model'
import {
  CURVE_CHART,
  buildCurvePoints,
  hitTestKeyframe,
  removeKeyframeAt,
  resolveValueRange,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
} from './curve-editor-model'

const W = 200
const H = CURVE_CHART.TRACK_HEIGHT_PX
const RANGE = { min: 0, max: 1 }

function frames(...values: [number, number][]): AnimationKeyframe[] {
  return values.map(([time, value]) => ({ time, value, easing: 'linear' }))
}

describe('resolveValueRange', () => {
  it('用注册表 min/max', () => {
    expect(resolveValueRange(0, 1, frames([0, 0.5]), 1)).toEqual({ min: 0, max: 1 })
  })

  it('无 max 时向上扩展到覆盖关键帧最大值', () => {
    const range = resolveValueRange(0, undefined, frames([0, 5]), 0)
    expect(range.min).toBe(0)
    expect(range.max).toBeGreaterThanOrEqual(5)
  })

  it('无 min/max 时按关键帧与默认值生成留白值域', () => {
    const range = resolveValueRange(undefined, undefined, frames([0, 10], [1, 20]), 0)
    expect(range.min).toBeLessThan(10)
    expect(range.max).toBeGreaterThan(20)
  })

  it('全退化（相同值）时保证最小跨度', () => {
    const range = resolveValueRange(0, 0, frames([0, 0]), 0)
    expect(range.max - range.min).toBeGreaterThanOrEqual(1)
  })

  it('非法注册值安全回落', () => {
    const range = resolveValueRange(Number.NaN, Number.POSITIVE_INFINITY, frames([0, 2]), 1)
    expect(Number.isFinite(range.min)).toBe(true)
    expect(Number.isFinite(range.max)).toBe(true)
    expect(range.max).toBeGreaterThan(range.min)
  })
})

describe('坐标换算', () => {
  it('timeToX/xToTime 往返一致', () => {
    const duration = 120000
    expect(xToTime(timeToX(60000, duration, W), duration, W)).toBe(60000)
    expect(xToTime(timeToX(0, duration, W), duration, W)).toBe(0)
    expect(xToTime(timeToX(duration, duration, W), duration, W)).toBe(duration)
  })

  it('timeToX 非法入参安全回落', () => {
    expect(timeToX(Number.NaN, 100, W)).toBe(CURVE_CHART.PADDING_X_PX)
    expect(timeToX(50, 0, W)).toBe(CURVE_CHART.PADDING_X_PX)
    expect(timeToX(50, Number.POSITIVE_INFINITY, W)).toBe(CURVE_CHART.PADDING_X_PX)
  })

  it('xToTime 夹逼到 0..duration', () => {
    expect(xToTime(-100, 1000, W)).toBe(0)
    expect(xToTime(9999, 1000, W)).toBe(1000)
    expect(xToTime(Number.NaN, 1000, W)).toBe(0)
    expect(xToTime(50, 0, W)).toBe(0)
  })

  it('valueToY/yToValue 往返一致（最大值在顶部）', () => {
    expect(valueToY(1, RANGE, H)).toBe(CURVE_CHART.PADDING_Y_PX)
    expect(valueToY(0, RANGE, H)).toBe(H - CURVE_CHART.PADDING_Y_PX)
    expect(yToValue(valueToY(0.3, RANGE, H), RANGE, H)).toBeCloseTo(0.3, 5)
  })

  it('yToValue/valueToY 非法入参安全回落', () => {
    expect(yToValue(Number.NaN, RANGE, H)).toBe(RANGE.min)
    expect(valueToY(Number.NaN, RANGE, H)).toBe(H / 2)
    expect(valueToY(0.5, { min: 1, max: 1 }, H)).toBe(H / 2)
  })
})

describe('hitTestKeyframe', () => {
  it('命中最近的关键帧', () => {
    const fs = frames([0, 0], [60000, 1])
    const px = timeToX(60000, 120000, W)
    const py = valueToY(1, RANGE, H)
    expect(hitTestKeyframe(px, py, fs, 120000, W, RANGE, H)).toBe(1)
  })

  it('容差外返回 -1', () => {
    const fs = frames([0, 0])
    expect(hitTestKeyframe(W - 2, 2, fs, 120000, W, RANGE, H)).toBe(-1)
  })

  it('重叠关键帧取更近者', () => {
    const fs = frames([60000, 0.4], [60000, 0.6])
    const px = timeToX(60000, 120000, W)
    const py = valueToY(0.6, RANGE, H)
    expect(hitTestKeyframe(px, py, fs, 120000, W, RANGE, H)).toBe(1)
  })

  it('空轨道返回 -1', () => {
    expect(hitTestKeyframe(10, 10, [], 120000, W, RANGE, H)).toBe(-1)
  })
})

describe('buildCurvePoints', () => {
  it('按采样数生成折线点串', () => {
    const fs = frames([0, 0], [120000, 1])
    const points = buildCurvePoints(fs, (t) => t / 120000, 120000, W, RANGE, H)
    const pairs = points.split(' ')
    expect(pairs).toHaveLength(CURVE_CHART.SAMPLE_COUNT + 1)
    expect(pairs[0]).toMatch(/^[\d.]+,[\d.]+$/)
  })

  it('无帧或非法时长返回空串', () => {
    expect(buildCurvePoints([], () => 0, 100, W, RANGE, H)).toBe('')
    expect(buildCurvePoints(frames([0, 0]), () => 0, 0, W, RANGE, H)).toBe('')
  })

  it('采样函数异常值不污染坐标（夹逼到图内）', () => {
    const fs = frames([0, 0], [100, 1])
    const points = buildCurvePoints(fs, () => Number.NaN, 100, W, RANGE, H)
    for (const pair of points.split(' ')) {
      const [x, y] = pair.split(',').map(Number)
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
    }
  })
})

describe('removeKeyframeAt', () => {
  it('按索引删除单帧，保留其它帧与其它轨道', () => {
    const tracks = {
      opacity: frames([0, 0], [1, 1], [2, 2]),
      rotate: frames([0, 10]),
    }
    const next = removeKeyframeAt(tracks, 'opacity', 1)
    expect(next.opacity.map((f) => f.value)).toEqual([0, 2])
    expect(next.rotate).toHaveLength(1)
    expect(tracks.opacity).toHaveLength(3) // 不改入参
  })

  it('删空整条轨道时移除该 key', () => {
    const next = removeKeyframeAt({ opacity: frames([0, 0]) }, 'opacity', 0)
    expect(next.opacity).toBeUndefined()
  })

  it('非法索引安全返回原样副本', () => {
    const tracks = { opacity: frames([0, 0]) }
    expect(removeKeyframeAt(tracks, 'opacity', 99).opacity).toHaveLength(1)
    expect(removeKeyframeAt(tracks, 'missing', 0).opacity).toHaveLength(1)
  })
})
