/**
 * editor-shortcuts.ts 单元测试：非修饰键 + P1 Ctrl/Meta 组合键 + 输入框/撤销豁免。
 * 覆盖：每个动作映射、大小写、Alt 组合跳过、Ctrl+Z 不接管、输入框聚焦跳过。
 */

import { describe, expect, it } from 'vitest'
import { matchShortcut } from './editor-shortcuts'

describe('非修饰键动作', () => {
  it('空格播放/暂停', () => {
    expect(matchShortcut({ key: ' ' })).toBe('togglePlay')
    expect(matchShortcut({ key: 'Spacebar' })).toBe('togglePlay')
  })

  it('方向键逐帧、Home/End 首尾', () => {
    expect(matchShortcut({ key: 'ArrowLeft' })).toBe('prevFrame')
    expect(matchShortcut({ key: 'ArrowRight' })).toBe('nextFrame')
    expect(matchShortcut({ key: 'Home' })).toBe('firstFrame')
    expect(matchShortcut({ key: 'End' })).toBe('lastFrame')
  })

  it('Delete/Backspace 删除', () => {
    expect(matchShortcut({ key: 'Delete' })).toBe('deleteSelected')
    expect(matchShortcut({ key: 'Backspace' })).toBe('deleteSelected')
  })

  it('S/I/O 动作（大小写不敏感）', () => {
    expect(matchShortcut({ key: 's' })).toBe('splitAtPlayhead')
    expect(matchShortcut({ key: 'S' })).toBe('splitAtPlayhead')
    expect(matchShortcut({ key: 'i' })).toBe('trimIn')
    expect(matchShortcut({ key: 'O' })).toBe('trimOut')
  })

  it('未知键返回 null', () => {
    expect(matchShortcut({ key: 'q' })).toBeNull()
    expect(matchShortcut({ key: '' })).toBeNull()
  })
})

describe('P1 Ctrl/Meta 组合键', () => {
  it('Ctrl+C/V/D/A 映射', () => {
    expect(matchShortcut({ key: 'c', ctrlKey: true })).toBe('copySelected')
    expect(matchShortcut({ key: 'v', ctrlKey: true })).toBe('pasteAtPlayhead')
    expect(matchShortcut({ key: 'd', ctrlKey: true })).toBe('duplicateSelected')
    expect(matchShortcut({ key: 'a', ctrlKey: true })).toBe('selectAll')
  })

  it('Meta 等价（macOS）', () => {
    expect(matchShortcut({ key: 'C', metaKey: true })).toBe('copySelected')
  })

  it('Ctrl+Z 不接管（归 clip-history）', () => {
    expect(matchShortcut({ key: 'z', ctrlKey: true })).toBeNull()
    expect(matchShortcut({ key: 'Z', metaKey: true, shiftKey: true } as never)).toBeNull()
  })

  it('Ctrl+其他键返回 null', () => {
    expect(matchShortcut({ key: 'x', ctrlKey: true })).toBeNull()
  })

  it('Alt 组合一律跳过', () => {
    expect(matchShortcut({ key: 'c', ctrlKey: true, altKey: true })).toBeNull()
    expect(matchShortcut({ key: 'c', altKey: true })).toBeNull()
  })
})

describe('输入框聚焦豁免', () => {
  it('INPUT/TEXTAREA/SELECT 与可编辑区域不劫持', () => {
    expect(matchShortcut({ key: 'c', ctrlKey: true, target: { tagName: 'INPUT' } })).toBeNull()
    expect(matchShortcut({ key: 'Delete', target: { tagName: 'TEXTAREA' } })).toBeNull()
    expect(matchShortcut({ key: 'a', ctrlKey: true, target: { tagName: 'SELECT' } })).toBeNull()
    expect(matchShortcut({ key: 'v', ctrlKey: true, target: { isContentEditable: true } })).toBeNull()
  })
})
