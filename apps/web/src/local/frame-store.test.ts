/**
 * frame-store.ts 完整测试（ISTQB 组件测试级别）。
 * 覆盖：MemoryFrameStore 读写统计、FrameStore 门面正常/异常降级（load/save/clear/stats）、
 * createDefaultBackend 在有无 IndexedDB 时的选择、常量契约。
 * 后端可注入，无需真实 IndexedDB（异常用 fake backend 模拟）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FRAME_STORE_DB_NAME,
  FRAME_STORE_NAME,
  FRAME_STORE_SCHEMA_VERSION,
  FrameStore,
  IndexedDbFrameStore,
  MemoryFrameStore,
  createDefaultBackend,
  type FrameStoreBackend,
  type PersistedEntry,
} from './frame-store'
import type { CachedMedia } from './frame-cache'

/** 每个用例后恢复全局。 */
afterEach(() => vi.unstubAllGlobals())

/** 构造最小 CachedMedia。 */
function makeMedia(bytes = 8): CachedMedia {
  return {
    key: 'k1',
    frames: [new Uint8Array(bytes)],
    audio: null,
    width: 320,
    height: 180,
    savedAt: 1,
  } as unknown as CachedMedia
}

/** 构造一个抛异常的后端（覆盖所有 catch 分支）。 */
function makeFailingBackend(): FrameStoreBackend {
  return {
    get: vi.fn(async () => { throw new Error('read fail') }),
    put: vi.fn(async () => { throw new Error('write fail') }),
    clear: vi.fn(async () => { throw new Error('clear fail') }),
    stats: vi.fn(async () => { throw new Error('stats fail') }),
  }
}

describe('MemoryFrameStore', () => {
  it('put/get/clear/stats 正常读写与统计', async () => {
    const store = new MemoryFrameStore()
    const entry: PersistedEntry = { key: 'k1', value: makeMedia(), savedAt: 1, bytes: 8 }
    await store.put(entry)
    expect(await store.get('k1')).toEqual(entry)
    expect((await store.stats()).entries).toBe(1)
    await store.clear()
    expect(await store.get('k1')).toBeNull()
    expect((await store.stats()).bytes).toBe(0)
  })

  it('get 不存在的 key 返回 null', async () => {
    expect(await new MemoryFrameStore().get('missing')).toBeNull()
  })
})

describe('FrameStore 门面正常分支', () => {
  it('load/save/clear/stats 委托给后端', async () => {
    const backend = new MemoryFrameStore()
    const store = new FrameStore(backend)
    const media = makeMedia()
    expect(await store.save('k1', media)).toBe(true)
    expect(await store.load('k1')).toEqual(media)
    expect((await store.stats()).entries).toBe(1)
    expect(await store.clear()).toBe(true)
  })
})

describe('FrameStore 门面异常降级（静默不阻断主流程）', () => {
  it('load：后端抛错返回 null', async () => {
    expect(await new FrameStore(makeFailingBackend()).load('k')).toBeNull()
  })

  it('save：后端抛错返回 false', async () => {
    expect(await new FrameStore(makeFailingBackend()).save('k', makeMedia())).toBe(false)
  })

  it('clear：后端抛错返回 false', async () => {
    expect(await new FrameStore(makeFailingBackend()).clear()).toBe(false)
  })

  it('stats：后端抛错返回零值', async () => {
    expect(await new FrameStore(makeFailingBackend()).stats()).toEqual({ entries: 0, bytes: 0 })
  })
})

describe('createDefaultBackend 与常量', () => {
  it('无 IndexedDB 时降级为 MemoryFrameStore', () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(createDefaultBackend()).toBeInstanceOf(MemoryFrameStore)
  })

  it('有 IndexedDB 时使用 IndexedDbFrameStore', () => {
    vi.stubGlobal('indexedDB', { open: vi.fn() })
    expect(createDefaultBackend()).toBeInstanceOf(IndexedDbFrameStore)
  })

  it('schema/DB/store 名称为固定契约值', () => {
    expect(FRAME_STORE_SCHEMA_VERSION).toBe(1)
    expect(FRAME_STORE_DB_NAME).toBe('opencut-proxy-frames')
    expect(FRAME_STORE_NAME).toBe('frames')
  })
})
