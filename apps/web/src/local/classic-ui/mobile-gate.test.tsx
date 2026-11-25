// @vitest-environment jsdom
/**
 * MobileGate 组件渲染测试（ISTQB 组件测试级别）。
 * 覆盖：桌面放行 / 窄屏拦截 / 已确认放行 / 继续按钮写 localStorage / 返回按钮历史回退 /
 * localStorage 不可用降级（异常分支）/ 阈值边界（1023 与 1024）。
 * 用 @testing-library/react 渲染真实组件，不 mock 组件内部逻辑。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  MOBILE_ACKNOWLEDGED_KEY,
  MOBILE_GATE_BREAKPOINT_PX,
  MOBILE_GATE_COPY,
  MobileGate,
} from './mobile-gate'

/** 每个用例前清空 DOM 与 localStorage，保证用例独立（FIRST 原则）。 */
beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/** 每个用例后卸载组件，避免 DOM 残留。 */
afterEach(() => cleanup())

/** 设置视口宽度（jsdom 的 innerWidth 可写）。 */
function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

describe('MobileGate 组件渲染', () => {
  it('桌面宽度直接放行 children，不显示门禁', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX)
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    expect(screen.getByTestId('child')).toBeTruthy()
    expect(screen.queryByText(MOBILE_GATE_COPY.title)).toBeNull()
  })

  it('窄屏显示门禁文案，且不渲染 children', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    expect(screen.getByText(MOBILE_GATE_COPY.title)).toBeTruthy()
    expect(screen.getByText(MOBILE_GATE_COPY.body)).toBeTruthy()
    expect(screen.queryByTestId('child')).toBeNull()
  })

  it('边界：恰好阈值宽度视为桌面', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX)
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('localStorage 已确认时窄屏也放行', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    localStorage.setItem(MOBILE_ACKNOWLEDGED_KEY, 'true')
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    expect(screen.getByTestId('child')).toBeTruthy()
    expect(screen.queryByText(MOBILE_GATE_COPY.title)).toBeNull()
  })

  it('localStorage 值为非 "true" 时不视为已确认', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    localStorage.setItem(MOBILE_ACKNOWLEDGED_KEY, 'false')
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    expect(screen.getByText(MOBILE_GATE_COPY.title)).toBeTruthy()
  })

  it('点击继续：写入 localStorage 并放行 children', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    fireEvent.click(screen.getByRole('button', { name: MOBILE_GATE_COPY.continue }))
    expect(localStorage.getItem(MOBILE_ACKNOWLEDGED_KEY)).toBe('true')
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('点击返回：调用 history.back 且不写 localStorage', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    fireEvent.click(screen.getByRole('button', { name: MOBILE_GATE_COPY.back }))
    expect(backSpy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(MOBILE_ACKNOWLEDGED_KEY)).toBeNull()
  })

  it('异常：localStorage.getItem 抛错时按桌面处理，放行 children', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('异常：localStorage.setItem 抛错时仍本次放行（不阻断编辑）', () => {
    setWidth(MOBILE_GATE_BREAKPOINT_PX - 1)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    render(<MobileGate><div data-testid="child">编辑器</div></MobileGate>)
    fireEvent.click(screen.getByRole('button', { name: MOBILE_GATE_COPY.continue }))
    expect(screen.getByTestId('child')).toBeTruthy()
  })
})
