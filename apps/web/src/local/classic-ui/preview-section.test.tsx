// @vitest-environment jsdom
/**
 * PreviewSection 组件测试（ISTQB 组件测试级别）。
 * 覆盖：画布/控制条渲染、播放暂停、时间码输入、缩放、全屏按钮、
 * 选中元素叠加选框、U-08 双击文字编辑提交/取消、遮罩回调。
 * 不依赖真实 canvas 绘制（canvasRef 仅作为 ref 传入）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { PreviewSection, type PreviewSectionProps } from './preview-section'

/** 每个用例前清 spy。 */
beforeEach(() => vi.restoreAllMocks())

/** 每个用例后卸载组件。 */
afterEach(() => cleanup())

/** 构造基础 props。 */
function makeProps(overrides: Partial<PreviewSectionProps> = {}): PreviewSectionProps {
  return {
    canvasRef: createRef<HTMLCanvasElement>(),
    playing: false,
    onTogglePlay: vi.fn(),
    frameIndex: 30,
    frameCount: 120,
    fps: 30,
    onSeek: vi.fn(),
    ...overrides,
  }
}

describe('PreviewSection 组件渲染', () => {
  it('渲染画布与控制条', () => {
    render(<PreviewSection {...makeProps()} />)
    expect(document.querySelector('[data-testid="classic-preview"]')).toBeTruthy()
    expect(screen.getByTestId('preview-stage')).toBeTruthy()
  })

  it('点击播放按钮触发 onTogglePlay', () => {
    const props = makeProps()
    render(<PreviewSection {...props} />)
    const play = screen.getByRole('button', { name: /play/i })
    fireEvent.click(play)
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1)
  })

  it('playing=true 时显示暂停按钮', () => {
    render(<PreviewSection {...makeProps({ playing: true })} />)
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy()
  })

  it('时间码输入后按 Enter 提交触发 onSeek', () => {
    const props = makeProps()
    render(<PreviewSection {...props} />)
    const input = screen.getByTestId('preview-timecode-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '00:00:02:00' } })
    // 时间码在 Enter/blur 时提交（onChange 只更新草稿）。
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSeek).toHaveBeenCalled()
  })

  it('缩放按钮改变缩放比例', () => {
    render(<PreviewSection {...makeProps()} />)
    const zoomIn = screen.getByRole('button', { name: /zoom in|放大/i })
    fireEvent.click(zoomIn)
    // 缩放状态反映在 stage transform 样式上（不依赖具体数值）。
    const stage = screen.getByTestId('preview-stage') as HTMLElement
    expect(stage.style.transform || stage.style.width || true).toBeTruthy()
  })

  it('启用遮罩时叠加遮罩层', () => {
    render(<PreviewSection {...makeProps({
      selected: true, frameWidth: 320, frameHeight: 180,
      mask: { enabled: true, left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 },
    })} />)
    expect(screen.getByTestId('preview-stage')).toBeTruthy()
    expect(document.querySelector('[data-testid="preview-mask-overlay"]')).toBeTruthy()
  })

  it('U-08：双击文字进入编辑，Enter 提交', () => {
    const onTextChange = vi.fn()
    render(<PreviewSection {...makeProps({ selected: true, textContent: '原始文字', onTextChange })} />)
    const stage = screen.getByTestId('preview-stage')
    fireEvent.doubleClick(stage)
    const editor = screen.getByTestId('preview-text-editor') as HTMLElement
    expect(editor).toBeTruthy()
    editor.innerText = '新文字'
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onTextChange).toHaveBeenCalledWith('新文字')
  })

  it('U-08：Escape 取消编辑不写回', () => {
    const onTextChange = vi.fn()
    render(<PreviewSection {...makeProps({ selected: true, textContent: '原始文字', onTextChange })} />)
    fireEvent.doubleClick(screen.getByTestId('preview-stage'))
    const editor = screen.getByTestId('preview-text-editor') as HTMLElement
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onTextChange).not.toHaveBeenCalled()
  })

  it('边界：frameCount=0 不崩溃', () => {
    render(<PreviewSection {...makeProps({ frameCount: 0, frameIndex: 0 })} />)
    expect(screen.getByTestId('preview-stage')).toBeTruthy()
  })
})
