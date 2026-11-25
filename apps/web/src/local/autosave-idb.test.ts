/**
 * autosave-idb.ts 迁移与降级测试（ISTQB 组件测试级别 + 错误推测）。
 * 覆盖：migrateLegacyAutosave 的 6 个分支（无 legacy/已迁移标记/无旧数据/损坏 JSON/
 * 结构非法/成功迁移）、target.setItem 抛错时返回 error 不抛给调用方、
 * defaultAutosaveBackend 在 IndexedDB 失败时降级到 fallback。
 * 全部用可注入存储，无需真实 IndexedDB。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_MIGRATION_KEY, defaultAutosaveBackend, migrateLegacyAutosave } from './autosave-idb'
import type { AutosaveStorage } from './project-autosave'
import type { AsyncAutosaveStorage } from './project-autosave'

/** 每个用例后恢复 stub。 */
afterEach(() => vi.unstubAllGlobals())

/** 构造同步存储（legacy/flag）。 */
function makeSync(data: Record<string, string> = {}): AutosaveStorage & { data: Record<string, string> } {
  const store: Record<string, string> = { ...data }
  return {
    data: store,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
  }
}

/** 构造异步存储（target）。 */
function makeAsync(overrides: Partial<AsyncAutosaveStorage> = {}): AsyncAutosaveStorage {
  return {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
    ...overrides,
  }
}

/** 合法旧数据。 */
const VALID_LEGACY = JSON.stringify({ projectKey: 'proj-1', state: { entries: [], index: 0 } })

describe('autosave-idb 迁移分支', () => {
  it('迁移标记常量固定', () => {
    expect(AUTOSAVE_MIGRATION_KEY).toBe('opencut-autosave-migrated-v1')
  })

  it('无 legacy 或 flagStorage 时跳过', async () => {
    expect(await migrateLegacyAutosave(null, makeAsync())).toEqual({ migrated: false, skipped: true })
    expect(await migrateLegacyAutosave(makeSync(), makeAsync(), null)).toEqual({ migrated: false, skipped: true })
  })

  it('已有迁移标记时跳过', async () => {
    const legacy = makeSync({ [AUTOSAVE_MIGRATION_KEY]: '1' })
    expect(await migrateLegacyAutosave(legacy, makeAsync())).toEqual({ migrated: false, skipped: true })
  })

  it('无旧数据时写标记并跳过', async () => {
    const legacy = makeSync()
    const result = await migrateLegacyAutosave(legacy, makeAsync())
    expect(result).toEqual({ migrated: false, skipped: true })
    expect(legacy.data[AUTOSAVE_MIGRATION_KEY]).toBe('1')
  })

  it('旧数据 JSON 损坏时写标记并跳过（不反复解析）', async () => {
    const legacy = makeSync({ 'opencut-autosave-v1': 'not json' })
    expect((await migrateLegacyAutosave(legacy, makeAsync())).skipped).toBe(true)
    expect(legacy.data[AUTOSAVE_MIGRATION_KEY]).toBe('1')
  })

  it('结构非法（缺 projectKey/state）时写标记并跳过', async () => {
    for (const bad of ['{}', '{"projectKey":123,"state":{}}', '{"projectKey":"p"}']) {
      const legacy = makeSync({ 'opencut-autosave-v1': bad })
      expect((await migrateLegacyAutosave(legacy, makeAsync())).skipped).toBe(true)
    }
  })

  it('合法旧数据迁移成功并写标记', async () => {
    const legacy = makeSync({ 'opencut-autosave-v1': VALID_LEGACY })
    const target = makeAsync()
    expect(await migrateLegacyAutosave(legacy, target)).toEqual({ migrated: true, skipped: false })
    expect(target.setItem).toHaveBeenCalledWith('opencut-autosave-v1', VALID_LEGACY)
    expect(legacy.data[AUTOSAVE_MIGRATION_KEY]).toBe('1')
  })

  it('target 写入失败时返回 error，不写标记以便下次重试', async () => {
    const legacy = makeSync({ 'opencut-autosave-v1': VALID_LEGACY })
    const target = makeAsync({ setItem: vi.fn(async () => { throw new Error('quota') }) })
    const result = await migrateLegacyAutosave(legacy, target)
    expect(result.migrated).toBe(false)
    expect(result.error).toContain('quota')
    expect(legacy.data[AUTOSAVE_MIGRATION_KEY]).toBeUndefined()
  })
})

describe('autosave-idb 默认后端降级', () => {
  it('无 fallback 时 IndexedDB 失败返回 null（静默降级）', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const backend = defaultAutosaveBackend(null)
    await expect(backend.getItem('k')).resolves.toBeNull()
    await expect(backend.setItem('k', 'v')).resolves.toBeUndefined()
    await expect(backend.removeItem('k')).resolves.toBeUndefined()
  })

  it('有 fallback 时 IndexedDB 失败读写走 localStorage', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const fallback = makeSync()
    const backend = defaultAutosaveBackend(fallback)
    await backend.setItem('k', 'v')
    expect(await backend.getItem('k')).toBe('v')
    await backend.removeItem('k')
    expect(await backend.getItem('k')).toBeNull()
  })
})
