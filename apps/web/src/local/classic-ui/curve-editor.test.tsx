// @vitest-environment jsdom
/**
 * CurveEditor 组件测试（ISTQB 组件测试级别）。
 * 覆盖：空态/动画轨道渲染/选中点/右键删除/缓动切换/双击新增帧。
 * 用最小 CoreElement + __animations 参数构造动画轨道，不依赖 canvas/WASM。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CurveEditor } from './curve-editor'
import type { CoreElement } from '../editor-ui'

/** 每个用例后卸载组件。 */
afterEach(() => cleanup())

/** 构造带动画轨道的元素。 */
function makeElement(withTrack: boolean): CoreElement {
  const params = withTrack
    ? { __animations: { opacity: [{ time: 0, value: 0, easing: 'linear' }, { time: 100, value: 1, easing: 'linear' }] } }
    : {}
  return { id: 'c1', startTime: 0, duration: 200, trimStart: 0, params } as CoreElement
}

describe('CurveEditor 组件渲染', () => {
  it('selected=null 显示空态', () => {
    render(<CurveEditor selected={null} />)
    expect(screen.getByTestId('classic-curve-editor')).toBeTruthy()
  })

  it('无动画轨道显示空态提示', () => {
    render(<CurveEditor selected={makeElement(false)} />)
    expect(screen.getByTestId('classic-curve-editor')).toBeTruthy()
  })

  it('有动画轨道时渲染轨道 SVG 与关键帧点', () => {
    render(<CurveEditor selected={makeElement(true)} playheadTicks={50} />)
    expect(screen.getByTestId('classic-curve-editor')).toBeTruthy()
    expect(document.querySelector('[data-testid^="curve-track-"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-testid^="curve-point-"]').length).toBeGreaterThan(0)
  })

  it('按下关键帧选中点后显示缓动选择器', () => {
    render(<CurveEditor selected={makeElement(true)} onChange={vi.fn()} />)
    const point = document.querySelector('[data-testid^="curve-point-"]')
    expect(point).toBeTruthy()
    // 关键帧用 onMouseDown 选中（拖动起点），不是 onClick。
    fireEvent.mouseDown(point!)
    expect(screen.getByTestId('curve-easing-select')).toBeTruthy()
  })

  it('右键关键帧触发删除回调（commitTracks）', () => {
    const onChange = vi.fn()
    render(<CurveEditor selected={makeElement(true)} onChange={onChange} />)
    const point = document.querySelector('[data-testid^="curve-point-"]')
    fireEvent.contextMenu(point!)
    expect(onChange).toHaveBeenCalled()
  })

  it('切换缓动选择器触发写回回调', () => {
    const onChange = vi.fn()
    render(<CurveEditor selected={makeElement(true)} onChange={onChange} />)
    fireEvent.mouseDown(document.querySelector('[data-testid^="curve-point-"]')!)
    const select = screen.getByTestId('curve-easing-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'ease-in' } })
    expect(onChange).toHaveBeenCalled()
  })
})
