/**
 * element-model.ts 单元测试（P0）。
 * 覆盖：默认值构建、placement 空位算法（空/重叠/尾部/负数/非法输入）、
 * 参数归一化边界（超出上下界/NaN/字符串/未知字段透传）、插入去重、删除不存在、
 * 参数补丁合并、id 唯一性、秒数换算异常输入。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEDIA_DURATION_SECONDS,
  DEFAULT_TEXT_CONTENT,
  DEFAULT_TEXT_DURATION_SECONDS,
  IDENTITY_VISUAL_PARAMS,
  MEDIA_ID_PREFIX,
  OPACITY_MAX,
  OPACITY_MIN,
  SCALE_MIN,
  TEXT_ID_PREFIX,
  TICKS_PER_SECOND,
  buildMediaElement,
  buildTextElement,
  insertElement,
  makeElementId,
  normalizeElementParams,
  patchElementParams,
  readParamValue,
  removeElementById,
  resolveAutoPlacement,
  secondsToTicks,
} from './element-model'
import type { CoreElement } from './editor-ui'

/** 构造最小片段，便于 placement 测试。 */
function clip(id: string, startTime: number, duration: number) {
  return { id, startTime, duration, trimStart: 0 }
}

describe('resolveAutoPlacement（placement 找空位）', () => {
  it('空时间轴：从期望起点开始', () => {
    expect(resolveAutoPlacement([], 500, 100)).toBe(500)
  })

  it('负数起点夹逼到 0', () => {
    expect(resolveAutoPlacement([], -100, 100)).toBe(0)
  })

  it('与已有片段重叠时跳到其后面', () => {
    const clips = [clip('a', 0, 1000)]
    expect(resolveAutoPlacement(clips, 500, 200)).toBe(1000)
  })

  it('连续多个重叠片段逐段跳过', () => {
    const clips = [clip('a', 0, 1000), clip('b', 1000, 1000), clip('c', 2000, 1000)]
    expect(resolveAutoPlacement(clips, 500, 200)).toBe(3000)
  })

  it('期望起点在已有片段之后：不改动', () => {
    const clips = [clip('a', 0, 1000)]
    expect(resolveAutoPlacement(clips, 2000, 200)).toBe(2000)
  })

  it('gap 间隔生效', () => {
    const clips = [clip('a', 0, 1000)]
    expect(resolveAutoPlacement(clips, 500, 200, 100)).toBe(1100)
  })

  it('非法输入（NaN/Infinity）回落到安全值且不死循环', () => {
    expect(resolveAutoPlacement([], Number.NaN, Number.NaN)).toBe(0)
    expect(resolveAutoPlacement([clip('a', 0, 100)], Number.POSITIVE_INFINITY, 10)).toBe(100)
    expect(resolveAutoPlacement([clip('a', 0, 100)], 0, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('normalizeElementParams（参数归一化边界）', () => {
  it('空输入返回 identity 变换', () => {
    const params = normalizeElementParams()
    expect(params.opacity).toBe(IDENTITY_VISUAL_PARAMS.opacity)
    expect(params.scaleX).toBe(1)
    expect(params.rotate).toBe(0)
  })

  it('opacity 超出上界夹逼到 1，低于下界夹逼到 0', () => {
    expect(normalizeElementParams({ opacity: 5 }).opacity).toBe(OPACITY_MAX)
    expect(normalizeElementParams({ opacity: -3 }).opacity).toBe(OPACITY_MIN)
  })

  it('scale 下限夹逼，NaN 回落默认值', () => {
    expect(normalizeElementParams({ scaleX: 0 }).scaleX).toBe(SCALE_MIN)
    expect(normalizeElementParams({ scaleY: Number.NaN }).scaleY).toBe(IDENTITY_VISUAL_PARAMS.scaleY)
  })

  it('字符串数字被解析，非数字字符串回落', () => {
    expect(normalizeElementParams({ positionX: '120' as unknown as number }).positionX).toBe(120)
    expect(normalizeElementParams({ positionY: 'abc' as unknown as number }).positionY).toBe(0)
  })

  it('未知字段原样透传（保真经典版参数）', () => {
    const params = normalizeElementParams({ fontFamily: 'Georgia', volume: -6 } as never)
    expect(params.fontFamily).toBe('Georgia')
    expect(params.volume).toBe(-6)
  })

  it('null / 非对象输入不抛异常', () => {
    expect(() => normalizeElementParams(null)).not.toThrow()
    expect(normalizeElementParams(null).opacity).toBe(1)
    expect(normalizeElementParams('bad' as never).rotate).toBe(0)
  })
})

describe('buildTextElement / buildMediaElement（构建元素）', () => {
  it('文字元素：默认内容、时长与类型', () => {
    const element = buildTextElement({ id: 't1', content: 'Hi', startTime: 0 })
    expect(element.elementType).toBe('text')
    expect(element.duration).toBe(DEFAULT_TEXT_DURATION_SECONDS * TICKS_PER_SECOND)
    expect(element.content).toBe('Hi')
    expect(element.params?.content).toBe('Hi')
    expect(element.params?.opacity).toBe(1)
  })

  it('文字元素：显式时长与起点', () => {
    const element = buildTextElement({
      id: 't2', content: 'X', startTime: -50, durationTicks: 999,
    })
    expect(element.startTime).toBe(0)
    expect(element.duration).toBe(999)
  })

  it('媒体元素：时长来自素材 duration', () => {
    const element = buildMediaElement({
      id: 'm1', name: 'clip.mp4', elementType: 'video', startTime: 0, durationSeconds: 12.5,
    })
    expect(element.duration).toBe(12.5 * TICKS_PER_SECOND)
    expect(element.elementType).toBe('video')
    expect(element.mediaId).toBeUndefined()
  })

  it('媒体元素：无 duration 时回落默认值', () => {
    const element = buildMediaElement({
      id: 'm2', name: 'a.mp4', elementType: 'video', startTime: 0,
    })
    expect(element.duration).toBe(DEFAULT_MEDIA_DURATION_SECONDS * TICKS_PER_SECOND)
  })

  it('非法 ticksPerSecond 回落到契约常量', () => {
    const element = buildMediaElement({
      id: 'm3', name: 'a.mp4', elementType: 'video', startTime: 0,
      durationSeconds: 2, ticksPerSecond: 0,
    })
    expect(element.duration).toBe(2 * TICKS_PER_SECOND)
  })
})

describe('insertElement / removeElementById（增删改）', () => {
  const a = buildTextElement({ id: 'a', content: 'A', startTime: 0 })
  const b = buildTextElement({ id: 'b', content: 'B', startTime: 100 })

  it('插入后按 startTime 排序', () => {
    const result = insertElement([b], a)
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('重复 id 抛异常', () => {
    expect(() => insertElement([a], a)).toThrow(/id 已存在/)
  })

  it('删除存在的元素', () => {
    expect(removeElementById([a, b], 'a').map((item) => item.id)).toEqual(['b'])
  })

  it('删除不存在的元素返回原列表', () => {
    expect(removeElementById([a, b], 'z')).toHaveLength(2)
  })
})

describe('patchElementParams / readParamValue（参数补丁）', () => {
  it('合并补丁后生效', () => {
    const element = buildTextElement({ id: 't', content: DEFAULT_TEXT_CONTENT, startTime: 0 })
    const next = patchElementParams(element, { opacity: 0.5, scaleX: 2 })
    expect(next.params?.opacity).toBe(0.5)
    expect(next.params?.scaleX).toBe(2)
    expect(element.params?.opacity).toBe(1) // 不改入参
  })

  it('无变化返回原引用', () => {
    const element = buildTextElement({ id: 't', content: 'x', startTime: 0 })
    expect(patchElementParams(element, {})).toBe(element)
  })

  it('读取参数值：显式值优先，缺失回落默认', () => {
    const element = buildTextElement({ id: 't', content: 'x', startTime: 0 })
    expect(readParamValue(element, 'opacity', 1)).toBe(1)
    expect(readParamValue(element, 'fontSize', 15)).toBe(15)
    expect(readParamValue(null, 'opacity', 0.8)).toBe(0.8)
  })
})

describe('makeElementId（id 唯一性）', () => {
  it('带前缀且两次调用不同', () => {
    const first = makeElementId(TEXT_ID_PREFIX)
    const second = makeElementId(TEXT_ID_PREFIX)
    expect(first).toMatch(/^text-/)
    expect(first).not.toBe(second)
  })

  it('媒体前缀正确', () => {
    expect(makeElementId(MEDIA_ID_PREFIX)).toMatch(/^media-/)
  })
})

describe('secondsToTicks（时间换算）', () => {
  it('正常换算', () => {
    expect(secondsToTicks(2, TICKS_PER_SECOND, 5)).toBe(2 * TICKS_PER_SECOND)
  })

  it('非法值回落默认秒数', () => {
    expect(secondsToTicks(undefined, TICKS_PER_SECOND, 5)).toBe(5 * TICKS_PER_SECOND)
    expect(secondsToTicks(-1, TICKS_PER_SECOND, 5)).toBe(5 * TICKS_PER_SECOND)
    expect(secondsToTicks(2, 0, 5)).toBe(2 * TICKS_PER_SECOND)
  })
})

/** 数据驱动：placement 边界用例（JSON 结构化）。 */
const PLACEMENT_CASES: Array<{
  name: string
  clips: Array<{ id: string; startTime: number; duration: number; trimStart: number }>
  desired: number
  duration: number
  gap: number
  expected: number
}> = [
  { name: '空轴', clips: [], desired: 0, duration: 100, gap: 0, expected: 0 },
  { name: '紧贴已有', clips: [clip('a', 0, 500)], desired: 0, duration: 100, gap: 0, expected: 500 },
  { name: '间隙足够', clips: [clip('a', 0, 500), clip('b', 1000, 500)], desired: 550, duration: 400, gap: 0, expected: 550 },
  { name: '间隙不足跳后面', clips: [clip('a', 0, 500), clip('b', 1000, 500)], desired: 550, duration: 500, gap: 0, expected: 1500 },
]

describe('resolveAutoPlacement 数据驱动用例', () => {
  for (const testCase of PLACEMENT_CASES) {
    it(testCase.name, () => {
      expect(resolveAutoPlacement(testCase.clips, testCase.desired, testCase.duration, testCase.gap))
        .toBe(testCase.expected)
    })
  }
})

/** 确保 CoreElement 上 params 字段类型可用于插值（编译期校验）。 */
const _typeCheck: CoreElement = buildTextElement({ id: 'x', content: 'y', startTime: 0 })
void _typeCheck
