// @vitest-environment jsdom
/**
 * useSelection Hook 测试（ISTQB 组件测试级别）。
 * 覆盖：单选/加选/区间/框选/全选/清空、复制粘贴/复制片段（含 canEdit 门禁）、
 * 空选中不复制、异常分支（formatError → setErrorText）、resetSelection。
 * 用 @testing-library/react 的 renderHook + act，无需 mock（底层 element-operations 为纯函数）。
 */

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSelection, type UseSelectionDeps } from './use-selection'
import type { CoreElement } from './editor-ui'

/** 构造最小元素。 */
function el(id: string, startTime: number): CoreElement {
  return { id, startTime, duration: 100, trimStart: 0, name: id }
}

/** 构造依赖，全部回调为 spy。 */
function makeDeps(overrides: Partial<UseSelectionDeps> = {}): UseSelectionDeps & {
  setPrimaryId: ReturnType<typeof vi.fn>
  setElements: ReturnType<typeof vi.fn>
  recordHistory: ReturnType<typeof vi.fn>
  recomputeFrameCount: ReturnType<typeof vi.fn>
  formatError: ReturnType<typeof vi.fn>
  setErrorText: ReturnType<typeof vi.fn>
  setMediaStatus: ReturnType<typeof vi.fn>
  canEdit: ReturnType<typeof vi.fn>
  playheadTicks: ReturnType<typeof vi.fn>
} {
  return {
    elements: [el('a', 0), el('b', 100), el('c', 200)],
    primaryId: null,
    setPrimaryId: vi.fn(),
    setElements: vi.fn(),
    recordHistory: vi.fn(),
    recomputeFrameCount: vi.fn(),
    formatError: vi.fn((e: unknown) => String(e)),
    setErrorText: vi.fn(),
    setMediaStatus: vi.fn(),
    canEdit: vi.fn(() => true),
    playheadTicks: vi.fn(() => 300),
    ...overrides,
  } as UseSelectionDeps & {
    setPrimaryId: ReturnType<typeof vi.fn>
    setElements: ReturnType<typeof vi.fn>
    recordHistory: ReturnType<typeof vi.fn>
    recomputeFrameCount: ReturnType<typeof vi.fn>
    formatError: ReturnType<typeof vi.fn>
    setErrorText: ReturnType<typeof vi.fn>
    setMediaStatus: ReturnType<typeof vi.fn>
    canEdit: ReturnType<typeof vi.fn>
    playheadTicks: ReturnType<typeof vi.fn>
  }
}

describe('useSelection 选择与剪贴板', () => {
  it('单选：设置 selectedIds 与主选中', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('b', false, false))
    expect(result.current.selectedIds).toEqual(['b'])
    expect(deps.setPrimaryId).toHaveBeenCalledWith('b')
  })

  it('加选：toggle 第二次移除', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('a', true, false))
    expect(result.current.selectedIds).toEqual(['a'])
    act(() => result.current.handleSelectClip('a', true, false))
    expect(result.current.selectedIds).toEqual([])
  })

  it('区间选择：从 a 到 c 选中包含中间片段', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('a', false, false))
    act(() => result.current.handleSelectClip('c', false, true))
    expect(result.current.selectedIds).toContain('b')
    expect(result.current.selectedIds.length).toBeGreaterThanOrEqual(2)
  })

  it('框选：命中集合写入 selectedIds 并提示', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleBoxSelect(['a', 'c'], false))
    expect(result.current.selectedIds).toEqual(['a', 'c'])
    expect(deps.setMediaStatus).toHaveBeenCalledWith('框选 2 个片段')
  })

  it('框选空命中：不写状态提示', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleBoxSelect([], false))
    expect(deps.setMediaStatus).not.toHaveBeenCalled()
  })

  it('全选与清空', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectAll())
    expect(result.current.selectedIds).toEqual(['a', 'b', 'c'])
    act(() => result.current.handleClear())
    expect(result.current.selectedIds).toEqual([])
  })

  it('复制：无选中且不传 primaryId 时不写状态', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleCopy())
    expect(deps.setMediaStatus).not.toHaveBeenCalled()
  })

  it('复制后粘贴：走 canEdit 门禁、写历史与帧数、选中新增片段', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('a', false, false))
    act(() => result.current.handleCopy())
    act(() => result.current.handlePaste())
    expect(deps.setElements).toHaveBeenCalled()
    expect(deps.recordHistory).toHaveBeenCalledWith(expect.any(Array), '粘贴片段', expect.any(String))
    expect(deps.recomputeFrameCount).toHaveBeenCalled()
    expect(deps.setMediaStatus).toHaveBeenCalledWith(expect.stringContaining('已粘贴'))
  })

  it('复制片段 duplicate：不依赖剪贴板，直接复制当前选中', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('b', false, false))
    act(() => result.current.handleDuplicate())
    expect(deps.recordHistory).toHaveBeenCalledWith(expect.any(Array), '复制片段', expect.any(String))
    expect(deps.setMediaStatus).toHaveBeenCalledWith(expect.stringContaining('已复制'))
  })

  it('paste 门禁：canEdit=false 时不改元素', () => {
    const deps = makeDeps({ canEdit: vi.fn(() => false) })
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('a', false, false))
    act(() => result.current.handleCopy())
    act(() => result.current.handlePaste())
    expect(deps.setElements).not.toHaveBeenCalled()
  })

  it('异常：粘贴抛错时 formatError 写友好提示', () => {
    const deps = makeDeps({
      playheadTicks: vi.fn(() => { throw new Error('bad time') }),
    })
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectClip('a', false, false))
    act(() => result.current.handleCopy())
    act(() => result.current.handlePaste())
    expect(deps.formatError).toHaveBeenCalled()
    expect(deps.setErrorText).toHaveBeenCalledWith(expect.stringContaining('粘贴失败'))
  })

  it('resetSelection 清空选中与锚点', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useSelection(deps))
    act(() => result.current.handleSelectAll())
    act(() => result.current.resetSelection())
    expect(result.current.selectedIds).toEqual([])
  })
})
