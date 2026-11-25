/**
 * project-autosave.ts 单元测试（P0）。
 * 覆盖：合法读写、项目隔离、版本不符、结构损坏、存储异常、清除、默认存储降级。
 */

import { describe, expect, it } from 'vitest'
import {
  AUTOSAVE_SCHEMA_VERSION,
  AUTOSAVE_STORAGE_KEY,
  clearAutosave,
  defaultAutosaveStorage,
  parseAutosaveEnvelope,
  persistAutosave,
  readAutosave,
  type AutosaveState,
  type AutosaveStorage,
} from './project-autosave'
import type { ResolutionPreset } from './resolution'
import { normalizeElementParams } from './element-model'

/** 内存存储后端（可注入）。 */
function memoryStorage(): AutosaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: (key) => { data.delete(key) },
  }
}

const RESOLUTION: ResolutionPreset = { width: 320, height: 180, label: '360p' }

function makeState(): AutosaveState {
  return {
    elements: [{ id: 'a', startTime: 0, duration: 100, trimStart: 0, params: normalizeElementParams({ opacity: 0.5 }) }],
    frameIndex: 3,
    selectedId: 'a',
    adjustments: [],
    resolution: RESOLUTION,
    sourceName: 'demo.json',
  }
}

describe('persistAutosave / readAutosave（往返）', () => {
  it('写入后可原样读回', () => {
    const storage = memoryStorage()
    expect(persistAutosave(makeState(), 'proj-a', storage, '2026-01-01T00:00:00.000Z')).toBe(true)
    const restored = readAutosave(storage, 'proj-a')
    expect(restored?.state.frameIndex).toBe(3)
    expect(restored?.state.elements[0].id).toBe('a')
    expect(restored?.state.elements[0].params?.opacity).toBe(0.5)
    expect(restored?.savedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('P4 批 6：轨道标志与书签往返保留', () => {
    const storage = memoryStorage()
    const state: AutosaveState = {
      ...makeState(),
      trackFlags: { muted: ['main'], hidden: ['audio'] },
      bookmarks: [{ id: 'bm-1', ticks: 120000, name: '书签 1' }],
    }
    expect(persistAutosave(state, 'proj-a', storage)).toBe(true)
    const restored = readAutosave(storage, 'proj-a')
    expect(restored?.state.trackFlags).toEqual({ muted: ['main'], hidden: ['audio'] })
    expect(restored?.state.bookmarks).toEqual([{ id: 'bm-1', ticks: 120000, name: '书签 1' }])
  })

  it('U-06：新增轨往返保留，非法类型/结构整体作废', () => {
    const storage = memoryStorage()
    const state: AutosaveState = {
      ...makeState(),
      extraTracks: [
        { id: 'new-track-1', trackType: 'text' },
        { id: 'new-track-2', trackType: 'audio', muted: true, hidden: false },
      ],
    }
    expect(persistAutosave(state, 'proj-a', storage)).toBe(true)
    const restored = readAutosave(storage, 'proj-a')
    expect(restored?.state.extraTracks).toEqual(state.extraTracks)

    const envelope = {
      version: AUTOSAVE_SCHEMA_VERSION,
      projectKey: 'proj-a',
      savedAt: '2026-01-01T00:00:00.000Z',
      state: { ...makeState(), extraTracks: [{ id: 'bad', trackType: 'unknown' }] },
    }
    expect(parseAutosaveEnvelope(JSON.stringify(envelope), 'proj-a')).toBeNull()
    const badFlags = {
      ...envelope,
      state: { ...makeState(), extraTracks: [{ id: 'bad', trackType: 'video', muted: 'yes' }] },
    }
    expect(parseAutosaveEnvelope(JSON.stringify(badFlags), 'proj-a')).toBeNull()
  })

  it('UI 长尾：书签 note 往返保留，旧书签无 note 兼容', () => {
    const storage = memoryStorage()
    const state: AutosaveState = {
      ...makeState(),
      bookmarks: [
        { id: 'bm-1', ticks: 120000, name: '书签 1', note: '开场提示' },
        { id: 'bm-2', ticks: 0, name: '书签 2' },
      ],
    }
    expect(persistAutosave(state, 'proj-a', storage)).toBe(true)
    const restored = readAutosave(storage, 'proj-a')
    expect(restored?.state.bookmarks).toEqual([
      { id: 'bm-1', ticks: 120000, name: '书签 1', note: '开场提示' },
      { id: 'bm-2', ticks: 0, name: '书签 2' },
    ])
  })

  it('UI 长尾：非法 note 类型使状态作废（不静默吞损坏数据）', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    const raw = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY) ?? '{}')
    raw.state.bookmarks = [{ id: 'bm-1', ticks: 0, name: 'A', note: 42 }]
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(raw))
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })

  it('P4 批 6：旧状态无新字段也能读回（additive 兼容）', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage) // makeState 无 trackFlags/bookmarks
    const restored = readAutosave(storage, 'proj-a')
    expect(restored?.state.trackFlags).toBeUndefined()
    expect(restored?.state.bookmarks).toBeUndefined()
  })

  it('写入的信封版本与存储键正确', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    const raw = storage.getItem(AUTOSAVE_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).version).toBe(AUTOSAVE_SCHEMA_VERSION)
  })

  it('项目标识不匹配时返回 null（项目隔离）', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    expect(readAutosave(storage, 'proj-b')).toBeNull()
  })

  it('版本不符时作废', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    const raw = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!)
    raw.version = AUTOSAVE_SCHEMA_VERSION + 1
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(raw))
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })

  it('元素结构损坏时作废（缺 duration）', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    const raw = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!)
    delete raw.state.elements[0].duration
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(raw))
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })

  it('P4 批 6：trackFlags/bookmarks 结构损坏时作废', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    const raw = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!)
    raw.state.trackFlags = { muted: 'not-array', hidden: [] }
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(raw))
    expect(readAutosave(storage, 'proj-a')).toBeNull()

    const raw2 = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!)
    delete raw2.state.trackFlags
    raw2.state.bookmarks = [{ id: 'bm', ticks: 'bad', name: 'x' }]
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(raw2))
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })

  it('非法 JSON 时作废且不抛异常', () => {
    const storage = memoryStorage()
    storage.setItem(AUTOSAVE_STORAGE_KEY, '{bad json')
    expect(() => readAutosave(storage, 'proj-a')).not.toThrow()
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })

  it('frameIndex 非法时作废', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    const raw = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!)
    raw.state.frameIndex = Number.NaN
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(raw))
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })
})

describe('存储异常降级（不吞异常但返回 false）', () => {
  it('写入抛异常返回 false', () => {
    const broken: AutosaveStorage = {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('quota') },
    }
    expect(persistAutosave(makeState(), 'proj-a', broken)).toBe(false)
    expect(() => readAutosave(broken, 'proj-a')).not.toThrow()
    expect(readAutosave(broken, 'proj-a')).toBeNull()
    expect(clearAutosave(broken)).toBe(false)
  })

  it('空存储后端/空项目 key 不写入', () => {
    expect(persistAutosave(makeState(), '', memoryStorage())).toBe(false)
    expect(persistAutosave(makeState(), 'proj-a', null)).toBe(false)
    expect(clearAutosave(null)).toBe(false)
  })

  it('清除后读不到', () => {
    const storage = memoryStorage()
    persistAutosave(makeState(), 'proj-a', storage)
    expect(clearAutosave(storage)).toBe(true)
    expect(readAutosave(storage, 'proj-a')).toBeNull()
  })
})

describe('defaultAutosaveStorage', () => {
  it('Node 环境无 localStorage 时返回 null（不抛异常）', () => {
    expect(() => defaultAutosaveStorage()).not.toThrow()
    expect(defaultAutosaveStorage()).toBeNull()
  })
})
