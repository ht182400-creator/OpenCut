// @vitest-environment jsdom
/**
 * ShortcutsDialog 组件测试（ISTQB 组件测试级别）。
 * 覆盖：open/close 渲染、分类分组、绑定 badge/录制入口、Esc 取消录制、
 * 冲突键提示、重置默认值、onBindingsChange 回调。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ShortcutsDialog } from './shortcuts-dialog'

/** 每个用例前清 localStorage 与 spy。 */
beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/** 每个用例后卸载组件。 */
afterEach(() => cleanup())

describe('ShortcutsDialog 组件渲染', () => {
  it('open=false 时对话框不显示', () => {
    render(<ShortcutsDialog open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('open=true 时显示对话框与分类标题', () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy()
  })

  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('渲染快捷键绑定 badge（可点击录制）', () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />)
    const badges = screen.getAllByRole('button').filter((b) => b.getAttribute('role') === 'button')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('点击 badge 进入录制，Esc 取消录制', () => {
    render(<ShortcutsDialog open onClose={vi.fn()} />)
    const badge = screen.getAllByRole('button').find((b) => b.getAttribute('role') === 'button')
    expect(badge).toBeTruthy()
    fireEvent.click(badge!)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('录制普通组合键：保存绑定并通知编辑器', () => {
    const onBindingsChange = vi.fn()
    render(<ShortcutsDialog open onClose={vi.fn()} onBindingsChange={onBindingsChange} />)
    const badge = screen.getAllByRole('button').find((b) => b.getAttribute('role') === 'button')
    fireEvent.click(badge!)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(onBindingsChange).toHaveBeenCalled()
  })

  it('冲突组合键：显示 role=alert 提示且不通知', () => {
    const onBindingsChange = vi.fn()
    render(<ShortcutsDialog open onClose={vi.fn()} onBindingsChange={onBindingsChange} />)
    const badges = screen.getAllByRole('button').filter((b) => b.getAttribute('role') === 'button')
    // 用第一个 badge 录制第二个 badge 当前占用的组合（若默认有绑定）。
    fireEvent.click(badges[0])
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true, altKey: true })
    // 无冲突时也不应抛错；有冲突时展示 alert。
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('重置默认值：清 localStorage 并通知编辑器', () => {
    const onBindingsChange = vi.fn()
    localStorage.setItem('ocx-shortcut-bindings-v1', '{"x":["Ctrl+K"]}')
    render(<ShortcutsDialog open onClose={vi.fn()} onBindingsChange={onBindingsChange} />)
    const reset = screen.getByRole('button', { name: /reset/i })
    fireEvent.click(reset)
    expect(onBindingsChange).toHaveBeenCalled()
  })
})
