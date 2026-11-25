/**
 * clip-history.ts 撤销/重做栈测试（ISTQB 组件测试级别 + 状态转换测试）。
 * 覆盖：createHistory 初始态、pushSnapshot 追加/截断重做分支/上限裁剪、
 * moveHistory 前进后退与边界、canUndo/canRedo/historyLabel、
 * persistHistory/readPersistedHistory 正常与损坏数据、深拷贝隔离、旧格式归一化、项目键校验。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HISTORY_PARTS,
  HISTORY_STORAGE_KEY,
  MAX_HISTORY,
  canRedo,
  canUndo,
  createHistory,
  historyLabel,
  moveHistory,
  persistHistory,
  pushSnapshot,
  readPersistedHistory,
  restoreProjectClips,
  restoreProjectSnapshot,
  type HistoryParts,
} from './clip-history'
import type { TimelineClip } from './timeline'

/** 构造最小片段。 */
function clip(id: string): TimelineClip {
  return { id, startTime: 0, duration: 100, trimStart: 0 }
}

/** 构造编辑器侧状态。 */
function parts(overrides: Partial<HistoryParts> = {}): HistoryParts {
  return { ...EMPTY_HISTORY_PARTS, ...overrides }
}

/** 构造存储 spy。 */
function makeStorage() {
  return { getItem: vi.fn(() => null as string | null), setItem: vi.fn(), removeItem: vi.fn() }
}

describe('clip-history 常量与初始态', () => {
  it('MAX_HISTORY / STORAGE_KEY / EMPTY_PARTS 为固定契约', () => {
    expect(MAX_HISTORY).toBe(50)
    expect(HISTORY_STORAGE_KEY).toBe('opencut-clip-history-v1')
    expect(EMPTY_HISTORY_PARTS.selectedId).toBeNull()
    expect(EMPTY_HISTORY_PARTS.trackFlags).toEqual({ muted: [], hidden: [] })
  })

  it('createHistory 生成 index=0 的初始快照（3 参签名）', () => {
    const h = createHistory([clip('a')], '导入项目', parts())
    expect(h.index).toBe(0)
    expect(h.entries).toHaveLength(1)
    expect(h.entries[0].label).toBe('导入项目')
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(historyLabel(h)).toContain('导入项目')
  })
})

describe('clip-history push/undo/redo 状态转换', () => {
  it('pushSnapshot 追加快照并可逐步撤销/重做', () => {
    let h = createHistory([clip('a')], '初始', parts())
    h = pushSnapshot(h, [clip('a'), clip('b')], '添加片段', parts({ selectedId: 'b' }))
    expect(h.entries).toHaveLength(2)
    expect(canUndo(h)).toBe(true)
    const undone = moveHistory(h, -1)
    expect(undone.state.index).toBe(0)
    expect(undone.clips).toEqual([clip('a')])
    const redone = moveHistory(undone.state, 1)
    expect(redone.state.index).toBe(1)
    expect(redone.snapshot?.selectedId).toBe('b')
  })

  it('在历史中段 push 时截断重做分支', () => {
    let h = createHistory([clip('a')], '初始', parts())
    h = pushSnapshot(h, [clip('a'), clip('b')], '步骤2', parts())
    h = pushSnapshot(h, [clip('a'), clip('b'), clip('c')], '步骤3', parts())
    h = moveHistory(h, -1).state
    h = moveHistory(h, -1).state
    h = pushSnapshot(h, [clip('x')], '新分支', parts())
    expect(h.entries).toHaveLength(2)
    expect(h.entries[1].label).toBe('新分支')
    expect(canRedo(h)).toBe(false)
  })

  it('moveHistory 边界：首尾不越界，clips/snapshot 为 null', () => {
    const h = createHistory([clip('a')], '初始', parts())
    expect(moveHistory(h, -1).clips).toBeNull()
    expect(moveHistory(h, -1).snapshot).toBeNull()
    expect(moveHistory(h, 1).clips).toBeNull()
  })

  it('pushSnapshot 超过 MAX_HISTORY 时裁剪最旧条目', () => {
    let h = createHistory([], '初始', parts())
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      h = pushSnapshot(h, [clip(`c${i}`)], `步骤${i}`, parts())
    }
    expect(h.entries.length).toBeLessThanOrEqual(MAX_HISTORY)
  })

  it('深拷贝隔离：修改源数组不污染历史快照', () => {
    const clips = [clip('a')]
    const h = createHistory(clips, '初始', parts())
    clips.push(clip('b'))
    expect(h.entries[0].clips).toHaveLength(1)
  })
})

describe('clip-history 持久化与归一化', () => {
  it('persistHistory/readPersistedHistory 往返（projectKey 必填）', () => {
    const storage = makeStorage()
    const h = createHistory([clip('a')], '初始', parts())
    expect(persistHistory(h, 'proj-1', storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(HISTORY_STORAGE_KEY, expect.any(String))
    storage.getItem.mockReturnValue(storage.setItem.mock.calls[0][1] as string)
    const restored = readPersistedHistory(storage)
    expect(restored?.projectKey).toBe('proj-1')
    expect(restored?.state.entries).toHaveLength(1)
  })

  it('persistHistory：无 storage / 空 projectKey 返回 false', () => {
    const h = createHistory([], '初始', parts())
    expect(persistHistory(h, 'proj', null)).toBe(false)
    expect(persistHistory(h, '', makeStorage())).toBe(false)
  })

  it('readPersistedHistory：无 storage / 损坏 JSON / 空结构 / 越界 index 返回 null', () => {
    expect(readPersistedHistory(null)).toBeNull()
    expect(readPersistedHistory({ ...makeStorage(), getItem: () => 'not json' })).toBeNull()
    expect(readPersistedHistory({ ...makeStorage(), getItem: () => '{"state":{"entries":[]},"projectKey":"p"}' })).toBeNull()
    expect(readPersistedHistory({ ...makeStorage(), getItem: () => '{"state":{"entries":[{}],"index":5},"projectKey":"p"}' })).toBeNull()
  })

  it('旧格式（仅 clips）归一化补齐字段', () => {
    const legacy = { projectKey: 'proj-1', state: { entries: [{ id: 1, clips: [clip('a')], label: '旧', at: 0 }], index: 0 } }
    const storage = { ...makeStorage(), getItem: () => JSON.stringify(legacy) }
    const restored = readPersistedHistory(storage)
    expect(restored?.state.entries[0].bookmarks).toEqual([])
    expect(restored?.state.entries[0].trackFlags).toEqual({ muted: [], hidden: [] })
  })

  it('restoreProjectClips / restoreProjectSnapshot 校验 projectKey', () => {
    const h = createHistory([clip('a')], '初始', parts())
    const persisted = { projectKey: 'proj-1', state: h }
    expect(restoreProjectClips(persisted, 'proj-1')?.map((c) => c.id)).toEqual(['a'])
    expect(restoreProjectClips(persisted, 'other')).toBeNull()
    expect(restoreProjectSnapshot(persisted, 'proj-1')?.clips.map((c) => c.id)).toEqual(['a'])
    expect(restoreProjectSnapshot(null, 'proj-1')).toBeNull()
  })
})
