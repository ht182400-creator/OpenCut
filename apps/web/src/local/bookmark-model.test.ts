/** 书签拖动/备注纯函数回归（2026-11-24）。 */

import { describe, expect, it } from 'vitest'

import { draggedBookmarkTicks, moveBookmark, setBookmarkNote } from './bookmark-model'

const BASE_ZOOM = 1
const TPS_30 = 30000
const FRAME_1 = 1000

describe('draggedBookmarkTicks：拖动位移换算', () => {
  it('向右拖动增加 ticks（50px/s 基准，zoom=1）', () => {
    // 50 px/s，拖动 100px = 2s = 60000 ticks
    expect(draggedBookmarkTicks(30000, 100, BASE_ZOOM, TPS_30)).toBe(90000)
  })

  it('向左拖动减少 ticks 并 clamp 到 0（不为负）', () => {
    expect(draggedBookmarkTicks(30000, -100, BASE_ZOOM, TPS_30)).toBe(0)
    expect(draggedBookmarkTicks(0, -500, BASE_ZOOM, TPS_30)).toBe(0)
  })

  it('帧网格吸附：非整帧 ticks 归到最近帧', () => {
    // 30000 + 25px = 30000 + 15000 = 45000，吸附到 1000 网格仍 45000
    expect(draggedBookmarkTicks(30000, 25, BASE_ZOOM, TPS_30, FRAME_1)).toBe(45000)
    // 12345 + 1px(70000tps→约1428ticks)=13773，四舍五入到 1000 网格 = 14000
    expect(draggedBookmarkTicks(12345, 1, BASE_ZOOM, 70000, FRAME_1)).toBe(14000)
  })

  it('异常输入：非法 startTicks/zoom/ticksPerSecond 不产生 NaN/Infinity', () => {
    // NaN / 负数 startTicks 归 0，100px = 60000
    expect(draggedBookmarkTicks(Number.NaN, 100, BASE_ZOOM, TPS_30)).toBe(60000)
    expect(draggedBookmarkTicks(-100, 100, BASE_ZOOM, TPS_30)).toBe(60000)
    // zoom<=0 时 timelinePixelsToTicks 退化为 zoom=1，delta=60000
    expect(draggedBookmarkTicks(30000, 100, 0, TPS_30)).toBe(90000)
    // ticksPerSecond=0 时 delta=0，保持原 ticks
    expect(draggedBookmarkTicks(30000, 100, BASE_ZOOM, 0)).toBe(30000)
    expect(Number.isFinite(draggedBookmarkTicks(30000, Number.NaN, BASE_ZOOM, TPS_30))).toBe(true)
  })
})

describe('moveBookmark：按 id 更新 ticks', () => {
  const items = [
    { id: 'a', ticks: 0, name: 'A' },
    { id: 'b', ticks: 120000, name: 'B' },
  ]

  it('只改目标书签，不改入参', () => {
    const result = moveBookmark(items, 'b', 90000)
    expect(result[1].ticks).toBe(90000)
    expect(items[1].ticks).toBe(120000)
    expect(result).not.toBe(items)
  })

  it('无匹配 id 返回新数组但内容不变', () => {
    expect(moveBookmark(items, 'missing', 42)).toEqual(items)
  })

  it('空数组不报错', () => {
    expect(moveBookmark([], 'a', 1)).toEqual([])
  })
})

describe('setBookmarkNote：备注编辑', () => {
  const items = [
    { id: 'a', ticks: 0, name: 'A' },
    { id: 'b', ticks: 10, name: 'B', note: '旧备注' },
  ]

  it('设置备注并 trim，不改入参', () => {
    const result = setBookmarkNote(items, 'a', '  新备注  ')
    expect(result[0].note).toBe('新备注')
    expect(items[0].note).toBeUndefined()
  })

  it('空备注删除 note 字段（additive-only 不写空值）', () => {
    const result = setBookmarkNote(items, 'b', '   ')
    expect(result[1]).not.toHaveProperty('note')
  })

  it('无匹配 id 与空数组安全', () => {
    expect(setBookmarkNote(items, 'missing', 'x')).toEqual(items)
    expect(setBookmarkNote([], 'a', 'x')).toEqual([])
  })
})
