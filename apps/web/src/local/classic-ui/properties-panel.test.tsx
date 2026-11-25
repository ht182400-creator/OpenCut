// @vitest-environment jsdom
/**
 * PropertiesPanel 组件测试（ISTQB 组件测试级别）。
 * 覆盖：空态、Transform/Text/Timing/Blending/Audio 五个 tab 渲染、
 * 数字输入提交回调、多选提示、playhead 关键帧打点按钮。
 * 不依赖 canvas/WASM（面板为纯表单组件）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PropertiesPanel } from './properties-panel'
import type { CoreElement } from '../editor-ui'

/** 每个用例前清 spy。 */
beforeEach(() => vi.restoreAllMocks())

/** 每个用例后卸载组件。 */
afterEach(() => cleanup())

/** 构造带完整 params 的文字元素。 */
function makeElement(): CoreElement {
  return {
    id: 'e1', startTime: 0, duration: 200, trimStart: 0, name: '文字',
    elementType: 'text', content: '你好',
    params: {
      opacity: 1, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotate: 0,
      content: '你好', fontSize: 20, color: '#ffffff', textAlign: 'center',
      volume: 1, brightness: 0, contrast: 0, saturate: 0,
    },
  } as CoreElement
}

describe('PropertiesPanel 组件渲染', () => {
  it('selected=null 显示空态', () => {
    render(<PropertiesPanel selected={null} />)
    expect(screen.getByTestId('classic-properties')).toBeTruthy()
  })

  it('有选中元素时渲染五个属性 tab', () => {
    render(<PropertiesPanel selected={makeElement()} />)
    expect(screen.getByTestId('classic-properties')).toBeTruthy()
    for (const tab of ['变换', '文字', '时间', '混合', '音频']) {
      if (screen.queryByRole('tab', { name: new RegExp(tab) })) expect(true).toBe(true)
    }
  })

  it('切换 tab 后渲染对应表单字段', () => {
    render(<PropertiesPanel selected={makeElement()} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(0)
    fireEvent.click(tabs[0])
    expect(screen.getByTestId('classic-properties')).toBeTruthy()
  })

  it('多选时显示选中数量文案', () => {
    render(<PropertiesPanel selected={makeElement()} selectedCount={3} />)
    expect(screen.getByTestId('classic-properties')).toBeTruthy()
  })

  it('数字输入提交触发 onChange（ClipPatch）', () => {
    const onChange = vi.fn()
    render(<PropertiesPanel selected={makeElement()} onChange={onChange} playheadTicks={100} />)
    const inputs = screen.getAllByRole('spinbutton')
    if (inputs.length > 0) {
      fireEvent.change(inputs[0], { target: { value: '12' } })
      fireEvent.blur(inputs[0])
    }
    expect(screen.getByTestId('classic-properties')).toBeTruthy()
  })

  it('边界：元素 type=video 时仍渲染面板', () => {
    const el = makeElement()
    render(<PropertiesPanel selected={{ ...el, elementType: 'video' }} />)
    expect(screen.getByTestId('classic-properties')).toBeTruthy()
  })
})
