/**
 * editor-shortcuts.ts 单元测试：非修饰键 + P1 Ctrl/Meta 组合键 + 输入框/撤销豁免。
 * 覆盖：每个动作映射、大小写、Alt 组合跳过、Ctrl+Z 不接管、输入框聚焦跳过。
 */

import { describe, expect, it } from 'vitest'
import { matchShortcut } from './editor-shortcuts'
import {
  EFFECTIVE_DEFAULT_BINDINGS,
  clearBindings,
  comboFromEvent,
  findComboConflict,
  loadBindings,
  resolveBindings,
  saveBinding,
  type BindingStorage,
} from './shortcut-bindings'

/** 内存存储桩，模拟 localStorage 的可注入后端。 */
function memoryStorage(seed?: string): BindingStorage {
  let value: string | null = seed ?? null
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next },
    removeItem: () => { value = null },
  }
}

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

  it('第二档项3：q/w 分割左侧/右侧，j/l seek±1s，shift+方向 jump±5s', () => {
    expect(matchShortcut({ key: 'q' })).toBe('splitLeft')
    expect(matchShortcut({ key: 'w' })).toBe('splitRight')
    expect(matchShortcut({ key: 'j' })).toBe('seekBackward')
    expect(matchShortcut({ key: 'l' })).toBe('seekForward')
    expect(matchShortcut({ key: 'ArrowRight', shiftKey: true })).toBe('jumpForward')
    expect(matchShortcut({ key: 'ArrowLeft', shiftKey: true })).toBe('jumpBackward')
  })

  it('未知键返回 null', () => {
    expect(matchShortcut({ key: '' })).toBeNull()
    expect(matchShortcut({ key: 'f13' })).toBeNull()
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

describe('P3 批 2 · 快捷键重绑定', () => {
  it('comboFromEvent 归一化按键与修饰键顺序', () => {
    expect(comboFromEvent({ key: ' ' })).toBe('space')
    expect(comboFromEvent({ key: 'ArrowRight' })).toBe('right')
    expect(comboFromEvent({ key: 'C', metaKey: true })).toBe('ctrl+c')
    expect(comboFromEvent({ key: 'ArrowLeft', ctrlKey: true, altKey: true, shiftKey: true }))
      .toBe('ctrl+alt+shift+left')
  })

  it('默认绑定表与既有 matchShortcut 行为一致且不含 undo/redo', () => {
    expect(EFFECTIVE_DEFAULT_BINDINGS['toggle-play']).toEqual(['space'])
    expect(EFFECTIVE_DEFAULT_BINDINGS['copy-selected']).toEqual(['ctrl+c'])
    expect(EFFECTIVE_DEFAULT_BINDINGS.undo).toBeUndefined()
    expect(EFFECTIVE_DEFAULT_BINDINGS.redo).toBeUndefined()
  })

  it('resolveBindings 用户覆盖优先，未知 id 忽略', () => {
    const store = memoryStorage(JSON.stringify({
      'toggle-play': ['k'],
      'unknown-action': ['x'],
    }))
    const resolved = resolveBindings(store)
    expect(resolved['toggle-play']).toEqual(['k'])
    expect(resolved['next-frame'] ?? resolved['frame-step-forward']).toEqual(['right'])
    expect(resolved['unknown-action']).toBeUndefined()
  })

  it('重绑定生效：旧键失效、新键触发，且保留输入框豁免', () => {
    const store = memoryStorage()
    saveBinding('toggle-play', ['k'], store)
    const bindings = resolveBindings(store)
    expect(matchShortcut({ key: ' ' }, bindings)).toBeNull() // 旧 space 失效
    expect(matchShortcut({ key: 'k' }, bindings)).toBe('togglePlay') // 新 k 生效
    expect(matchShortcut({ key: 'k', target: { tagName: 'INPUT' } }, bindings)).toBeNull()
  })

  it('Ctrl+Z 仍不接管（默认表无 undo），重绑定也不误伤', () => {
    const bindings = resolveBindings(memoryStorage(JSON.stringify({ redo: ['ctrl+z'] })))
    expect(matchShortcut({ key: 'z', ctrlKey: true }, bindings)).toBeNull()
  })

  it('第二档项3：无默认键动作（stop/deselect/bookmark）录制后生效', () => {
    const store = memoryStorage(JSON.stringify({
      'stop-playback': ['x'],
      'deselect-all': ['ctrl+shift+a'],
      'toggle-bookmark': ['b'],
    }))
    const bindings = resolveBindings(store)
    expect(matchShortcut({ key: 'x' }, bindings)).toBe('stopPlayback')
    expect(matchShortcut({ key: 'a', ctrlKey: true, shiftKey: true }, bindings)).toBe('deselectAll')
    expect(matchShortcut({ key: 'b' }, bindings)).toBe('toggleBookmark')
  })

  it('冲突检测：同 combo 被占用返回归属 id，排除自身', () => {
    const bindings = resolveBindings(memoryStorage())
    expect(findComboConflict('right', bindings)).toBe('frame-step-forward')
    expect(findComboConflict('right', bindings, 'frame-step-forward')).toBeNull()
    expect(findComboConflict('f13', bindings)).toBeNull()
  })

  it('存储异常降级：非法 JSON 与损坏结构均返回安全值', () => {
    expect(loadBindings(memoryStorage('{not json'))).toEqual({})
    expect(loadBindings(memoryStorage('[]'))).toEqual({})
    expect(loadBindings(memoryStorage('{"a":"not-array"}'))).toEqual({})
    expect(loadBindings(memoryStorage('{"a":[1,"ok",null]}'))).toEqual({ a: ['ok'] })
  })

  it('clearBindings 后恢复默认', () => {
    const store = memoryStorage()
    saveBinding('split', ['x'], store)
    expect(resolveBindings(store).split).toEqual(['x'])
    clearBindings(store)
    expect(resolveBindings(store).split).toEqual(['s'])
  })
})
