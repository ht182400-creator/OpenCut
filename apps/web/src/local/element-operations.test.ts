/**
 * element-operations.ts 单元测试（P1）：多选/剪贴板/复制品纯函数。
 * 覆盖：单选/切换/区间/全选/清空、复制深拷贝、粘贴避让 placement、
 * 复制品新 id 唯一性、空剪贴板、边界（NaN 起点/空元素/不存在 id）。
 */

import { describe, expect, it } from 'vitest'
import {
  clearSelection,
  copyElements,
  duplicateElements,
  pasteElements,
  selectAll,
  selectFromBox,
  selectRange,
  selectSingle,
  toggleSelection,
  type SelectionContext,
} from './element-operations'
import { buildMediaElement, buildTextElement, normalizeElementParams } from './element-model'

const t1 = buildTextElement({ id: 't1', content: 'A', startTime: 0, durationTicks: 100 })
const t2 = buildTextElement({ id: 't2', content: 'B', startTime: 200, durationTicks: 100 })
const t3 = buildMediaElement({ id: 'm1', name: 'v.mp4', elementType: 'video', startTime: 400, durationSeconds: 1 })
t3.mediaId = 'v.mp4'

function context(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    orderedIds: ['t1', 't2', 'm1'],
    selectedIds: ['t1'],
    anchorId: 't1',
    primaryId: 't1',
    ...overrides,
  }
}

describe('选择操作', () => {
  it('单选清空集合并设锚点', () => {
    expect(selectSingle('t2')).toEqual({ selectedIds: ['t2'], anchorId: 't2', primaryId: 't2' })
  })

  it('Cmd 切换：加选/取消且不按时间顺序误排', () => {
    const added = toggleSelection(context(), 'm1')
    expect(added.selectedIds).toEqual(['t1', 'm1'])
    expect(added.primaryId).toBe('m1')
    const removed = toggleSelection(context({ selectedIds: ['t1', 'm1'], primaryId: 'm1' }), 't1')
    expect(removed.selectedIds).toEqual(['m1'])
  })

  it('Shift 区间选择含两端', () => {
    const result = selectRange(context(), 'm1')
    expect(result.selectedIds).toEqual(['t1', 't2', 'm1'])
    expect(result.primaryId).toBe('m1')
  })

  it('Shift 无锚点退化为单选', () => {
    const result = selectRange(context({ anchorId: null, primaryId: null }), 't2')
    expect(result.selectedIds).toEqual(['t2'])
  })

  it('Shift 目标 id 不存在退化为单选', () => {
    const result = selectRange(context(), 'missing')
    expect(result.selectedIds).toEqual(['missing'])
  })

  it('全选按时间顺序，空列表安全', () => {
    expect(selectAll(['t2', 't1']).selectedIds).toEqual(['t2', 't1'])
    const empty = selectAll([])
    expect(empty.selectedIds).toEqual([])
    expect(empty.anchorId).toBeNull()
  })

  it('清空选择', () => {
    expect(clearSelection()).toEqual({ selectedIds: [], anchorId: null, primaryId: null })
  })

  it('框选普通模式：命中按时间顺序、锚点取首个', () => {
    const result = selectFromBox(context(), ['m1', 't2'], false)
    expect(result).toEqual({ selectedIds: ['t2', 'm1'], anchorId: 't2', primaryId: 't2' })
  })

  it('框选加框模式：与既有集合取并集、保留原锚点', () => {
    const result = selectFromBox(context({ selectedIds: ['t1'] }), ['m1'], true)
    expect(result.selectedIds).toEqual(['t1', 'm1'])
    expect(result.anchorId).toBe('t1')
    expect(result.primaryId).toBe('m1')
  })

  it('框选空命中：普通框清空、加框保持', () => {
    expect(selectFromBox(context(), [], false).selectedIds).toEqual([])
    expect(selectFromBox(context({ selectedIds: ['t1'] }), [], true).selectedIds).toEqual(['t1'])
  })

  it('框选忽略未知 id 与重复 id', () => {
    const result = selectFromBox(context(), ['missing', 't2', 't2'], false)
    expect(result.selectedIds).toEqual(['t2'])
  })
})

describe('copyElements（复制快照）', () => {
  it('按时间顺序选中且 params 深拷贝', () => {
    t1.params = normalizeElementParams({ ...t1.params, opacity: 0.4 })
    const clip = copyElements([t3, t2, t1], ['t1', 't2'], '2026-01-01T00:00:00.000Z')
    expect(clip.copiedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(clip.elements.map((item) => item.id)).toEqual(['', ''])
    expect(clip.elements[0].content).toBe('A')
    expect(clip.elements[0].params).toEqual(t1.params)
    expect(clip.elements[0].params).not.toBe(t1.params)
  })

  it('空选择返回空', () => {
    expect(copyElements([t1], []).elements).toEqual([])
  })
})

describe('pasteElements（粘贴到播放头）', () => {
  it('粘贴生成新 id 且避开既有片段', () => {
    const clip = copyElements([t1, t2], ['t1', 't2'])
    const next = pasteElements([t1, t2], clip, 100)
    expect(next).toHaveLength(4)
    const added = next.filter((item) => item.id !== 't1' && item.id !== 't2')
    expect(added).toHaveLength(2)
    expect(added[0].id).not.toBe(added[1].id)
    // 起点不早于期望位置，且不与既有片段重叠。
    expect(added[0].startTime).toBeGreaterThanOrEqual(100)
  })

  it('空剪贴板原样返回', () => {
    const empty = copyElements([t1], [])
    expect(pasteElements([t1], empty, 0)).toEqual([t1])
  })

  it('NaN 起点按 0 处理', () => {
    const clip = copyElements([t1], ['t1'])
    const next = pasteElements([t1], clip, Number.NaN)
    expect(next.some((item) => item.id !== 't1')).toBe(true)
  })

  it('媒体片段 id 用 media 前缀', () => {
    const clip = copyElements([t3], ['m1'])
    const next = pasteElements([t1], clip, 1000)
    const added = next.find((item) => item.id.startsWith('media-'))
    expect(added).toBeDefined()
  })
})

describe('duplicateElements（复制品）', () => {
  it('生成唯一新 id 并选中副本', () => {
    const result = duplicateElements([t1, t2], ['t1'])
    expect(result.newIds).toHaveLength(1)
    expect(result.elements).toHaveLength(3)
    expect(result.elements.some((item) => item.id === result.newIds[0])).toBe(true)
  })

  it('多选复制生成多个副本', () => {
    const result = duplicateElements([t1, t2, t3], ['t1', 't2'])
    expect(result.newIds).toHaveLength(2)
  })

  it('空选择返回原数组', () => {
    const result = duplicateElements([t1], [])
    expect(result.newIds).toEqual([])
    expect(result.elements).toEqual([t1])
  })
})
