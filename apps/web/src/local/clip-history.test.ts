import { describe, expect, it } from 'vitest';

import {
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
  type HistoryState,
} from './clip-history';
import type { TimelineClip } from './timeline';

/** 构造两条片段，便于观察撤销恢复。 */
function clips(count = 2): TimelineClip[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `clip-${index}`,
    startTime: index * 120000,
    duration: 120000,
    trimStart: 0,
  }));
}

/** 时间线版本快照回归（W-09 第三批 / M6）。 */
describe('createHistory / pushSnapshot', () => {
  it('初始历史只有一条快照且不可撤销重做', () => {
    const state = createHistory(clips(), '导入项目');
    expect(state.entries).toHaveLength(1);
    expect(state.index).toBe(0);
    expect(state.entries[0].label).toBe('导入项目');
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
  });

  it('记录剪辑后追加快照并推进 index', () => {
    const state = pushSnapshot(createHistory(clips()), clips(1), '删除片段');
    expect(state.entries).toHaveLength(2);
    expect(state.index).toBe(1);
    expect(state.entries[1].clips).toHaveLength(1);
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);
  });

  it('快照是深拷贝，后续修改原片段不污染历史', () => {
    const original = clips();
    const state = pushSnapshot(createHistory(original), original, '编辑');
    original[0].duration = 999;
    original.push({ id: 'new', startTime: 0, duration: 1, trimStart: 0 });
    expect(state.entries[1].clips).toHaveLength(2);
    expect(state.entries[1].clips[0].duration).toBe(120000);
  });

  it('undo 后再编辑会丢弃 redo 分支', () => {
    let state = pushSnapshot(createHistory(clips()), clips(1), '删除片段');
    state = moveHistory(state, -1).state;
    expect(canRedo(state)).toBe(true);
    const branched = pushSnapshot(state, clips(3), '分割片段');
    expect(branched.entries).toHaveLength(2);
    expect(branched.entries[1].label).toBe('分割片段');
    expect(canRedo(branched)).toBe(false);
  });

  it('容量上限裁剪后仍保持 index 指向最新', () => {
    let state: HistoryState = createHistory(clips());
    for (let index = 0; index < MAX_HISTORY + 10; index += 1) {
      state = pushSnapshot(state, clips(1 + (index % 2)), `step-${index}`);
    }
    expect(state.entries).toHaveLength(MAX_HISTORY);
    expect(state.index).toBe(MAX_HISTORY - 1);
    expect(state.entries[state.index].label).toBe(`step-${MAX_HISTORY + 9}`);
  });
});

describe('moveHistory', () => {
  it('撤销返回上一条快照的片段，重做返回下一条', () => {
    let state = createHistory(clips(), '初始');
    state = pushSnapshot(state, clips(1), '删除');
    const undone = moveHistory(state, -1);
    expect(undone.clips).toHaveLength(2);
    expect(undone.state.index).toBe(0);

    const redone = moveHistory(undone.state, 1);
    expect(redone.clips).toHaveLength(1);
    expect(redone.state.index).toBe(1);
  });

  it('到头/到尾时返回 null 且状态不变', () => {
    const state = pushSnapshot(createHistory(clips()), clips(1), '删除');
    const beyondStart = moveHistory(createHistory(clips()), -1);
    expect(beyondStart.clips).toBeNull();
    expect(beyondStart.state.index).toBe(0);
    const beyondEnd = moveHistory(state, 1);
    expect(beyondEnd.clips).toBeNull();
    expect(beyondEnd.state.index).toBe(1);
  });

  it('恢复的片段是副本，修改不会污染历史', () => {
    const state = pushSnapshot(createHistory(clips()), clips(1), '删除');
    const undone = moveHistory(state, -1);
    undone.clips?.[0] && (undone.clips[0].duration = 1);
    expect(state.entries[0].clips[0].duration).toBe(120000);
  });
});

describe('historyLabel', () => {
  it('显示当前步数、总步数与动作名', () => {
    const state = pushSnapshot(createHistory(clips()), clips(1), '删除选中片段');
    expect(historyLabel(state)).toBe('2 / 2 步 · 当前：删除选中片段');
  });
});

/** 跨会话持久化回归（W-09 收尾）。 */
describe('跨会话持久化', () => {
  /** 内存存储桩。 */
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('写入后按项目键读回完整历史', () => {
    const storage = memoryStorage();
    const state = pushSnapshot(createHistory(clips()), clips(1), '删除片段');
    expect(persistHistory(state, 'project-a', storage)).toBe(true);
    const loaded = readPersistedHistory(storage);
    expect(loaded?.projectKey).toBe('project-a');
    expect(loaded?.state.entries).toHaveLength(2);
    expect(loaded?.state.index).toBe(1);
  });

  it('恢复当前指针的片段，且是副本', () => {
    const storage = memoryStorage();
    let state = pushSnapshot(createHistory(clips()), clips(1), '删除片段');
    state = moveHistory(state, -1).state;
    persistHistory(state, 'project-a', storage);
    const restored = restoreProjectClips(readPersistedHistory(storage), 'project-a');
    expect(restored).toHaveLength(2);
    restored?.[0] && (restored[0].duration = 1);
    expect(state.entries[0].clips[0].duration).toBe(120000);
  });

  it('项目键不匹配时拒绝恢复', () => {
    const storage = memoryStorage();
    persistHistory(createHistory(clips()), 'project-a', storage);
    expect(restoreProjectClips(readPersistedHistory(storage), 'project-b')).toBeNull();
  });

  it('损坏数据、空条目与越界 index 一律返回 null', () => {
    const storage = memoryStorage();
    storage.setItem('opencut-clip-history-v1', '{ 非法 json');
    expect(readPersistedHistory(storage)).toBeNull();
    storage.setItem('opencut-clip-history-v1', JSON.stringify({ projectKey: 'a', state: { entries: [], index: 0 } }));
    expect(readPersistedHistory(storage)).toBeNull();
    storage.setItem('opencut-clip-history-v1', JSON.stringify({
      projectKey: 'a', state: { entries: [{ id: 0, label: 'x', at: 0, clips: [] }], index: 9 },
    }));
    expect(readPersistedHistory(storage)).toBeNull();
    expect(readPersistedHistory(null)).toBeNull();
  });

  it('缺项目键或存储异常时静默降级', () => {
    const storage = memoryStorage();
    expect(persistHistory(createHistory(clips()), '', storage)).toBe(false);
    expect(persistHistory(createHistory(clips()), 'a', null)).toBe(false);
    const broken = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    };
    expect(persistHistory(createHistory(clips()), 'a', broken)).toBe(false);
  });
});

/** U-02：编辑器快照（书签/轨道标志/选中态/ripple）全覆盖回归。 */
describe('编辑器快照全覆盖', () => {
  /** 一份完整的编辑器侧状态样本；每次调用返回新对象，避免用例间共享可变引用。 */
  const sampleParts = (): HistoryParts => ({
    bookmarks: [{ id: 'bm-1', ticks: 24000, name: '开场', note: '提示' }],
    trackFlags: { muted: ['audio'], hidden: ['overlay'] },
    selectedId: 'clip-0',
    adjustments: [{ trackId: 'main', afterTime: 120000, shiftAmount: 4000 }],
  });

  it('初始快照携带编辑器侧状态且与外部对象隔离', () => {
    const external = sampleParts();
    const state = createHistory(clips(), '导入项目', external);
    expect(state.entries[0].bookmarks).toEqual(external.bookmarks);
    expect(state.entries[0].trackFlags).toEqual({ muted: ['audio'], hidden: ['overlay'] });
    expect(state.entries[0].selectedId).toBe('clip-0');
    expect(state.entries[0].adjustments).toEqual(external.adjustments);
    external.bookmarks[0].name = '外部改动';
    external.trackFlags.muted.push('main');
    expect(state.entries[0].bookmarks[0].name).toBe('开场');
    expect(state.entries[0].trackFlags.muted).toEqual(['audio']);
  });

  it('片段动作未传 parts 时继承上一条快照的编辑器状态', () => {
    const state = pushSnapshot(createHistory(clips(), '初始', sampleParts()), clips(1), '删除片段');
    expect(state.entries[1].bookmarks).toEqual(sampleParts().bookmarks);
    expect(state.entries[1].trackFlags).toEqual(sampleParts().trackFlags);
    expect(state.entries[1].selectedId).toBe('clip-0');
    expect(state.entries[1].adjustments).toEqual(sampleParts().adjustments);
  });

  it('显式 parts 只覆盖指定字段，其余沿用上一条', () => {
    const nextBookmarks = [{ id: 'bm-2', ticks: 48000, name: '新书签' }];
    const state = pushSnapshot(
      createHistory(clips(), '初始', sampleParts()), clips(1), '编辑书签', { bookmarks: nextBookmarks },
    );
    expect(state.entries[1].bookmarks).toEqual(nextBookmarks);
    expect(state.entries[1].trackFlags).toEqual(sampleParts().trackFlags);
    expect(state.entries[1].selectedId).toBe('clip-0');
  });

  it('删除后撤销/重做恢复完整编辑器状态', () => {
    let state = createHistory(clips(), '初始', sampleParts());
    state = pushSnapshot(state, clips(1), '删除片段', {
      bookmarks: [], trackFlags: { muted: [], hidden: [] }, selectedId: null, adjustments: [],
    });
    const undone = moveHistory(state, -1);
    expect(undone.clips).toHaveLength(2);
    expect(undone.snapshot?.clips).toHaveLength(2);
    expect(undone.snapshot?.bookmarks).toEqual(sampleParts().bookmarks);
    expect(undone.snapshot?.trackFlags).toEqual(sampleParts().trackFlags);
    expect(undone.snapshot?.selectedId).toBe('clip-0');
    expect(undone.snapshot?.adjustments).toEqual(sampleParts().adjustments);

    const redone = moveHistory(undone.state, 1);
    expect(redone.snapshot?.clips).toHaveLength(1);
    expect(redone.snapshot?.bookmarks).toEqual([]);
    expect(redone.snapshot?.trackFlags).toEqual({ muted: [], hidden: [] });
    expect(redone.snapshot?.selectedId).toBeNull();
    expect(redone.snapshot?.adjustments).toEqual([]);
  });

  it('恢复的编辑器状态是副本，修改不污染历史', () => {
    const state = createHistory(clips(), '初始', sampleParts());
    const restored = moveHistory(pushSnapshot(state, clips(1), '删除'), -1).snapshot;
    if (restored) {
      restored.bookmarks[0].name = '污染';
      restored.trackFlags.muted.push('main');
      restored.adjustments[0].shiftAmount = 999;
    }
    expect(state.entries[0].bookmarks[0].name).toBe('开场');
    expect(state.entries[0].trackFlags.muted).toEqual(['audio']);
    expect(state.entries[0].adjustments[0].shiftAmount).toBe(4000);
  });

  it('到头/到尾时快照为 null，不返回半个状态', () => {
    const state = createHistory(clips(), '初始', sampleParts());
    expect(moveHistory(state, -1).snapshot).toBeNull();
    expect(moveHistory(state, 1).snapshot).toBeNull();
  });

  it('容量裁剪后最新快照仍保留编辑器侧状态', () => {
    let state: HistoryState = createHistory(clips(), '初始', sampleParts());
    for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
      state = pushSnapshot(state, clips(1), `step-${index}`);
    }
    expect(state.entries).toHaveLength(MAX_HISTORY);
    expect(state.entries[state.index].bookmarks).toEqual(sampleParts().bookmarks);
    expect(state.entries[state.index].selectedId).toBe('clip-0');
  });
});

/** U-02：编辑器快照持久化与旧格式兼容回归。 */
describe('编辑器快照持久化', () => {
  /** 内存存储桩。 */
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it('完整快照写入后按项目键读回', () => {
    const storage = memoryStorage();
    const state = pushSnapshot(
      createHistory(clips(), '初始', { bookmarks: [{ id: 'bm-1', ticks: 1, name: '开场' }],
        trackFlags: { muted: ['audio'], hidden: [] }, selectedId: 'clip-0',
        adjustments: [{ trackId: 'main', afterTime: 1, shiftAmount: 2 }] }),
      clips(1), '删除片段',
    );
    expect(persistHistory(state, 'project-a', storage)).toBe(true);
    const restored = restoreProjectSnapshot(readPersistedHistory(storage), 'project-a');
    expect(restored?.bookmarks).toEqual([{ id: 'bm-1', ticks: 1, name: '开场' }]);
    expect(restored?.trackFlags.muted).toEqual(['audio']);
    expect(restored?.selectedId).toBe('clip-0');
    expect(restored?.adjustments).toEqual([{ trackId: 'main', afterTime: 1, shiftAmount: 2 }]);
    expect(restoreProjectSnapshot(readPersistedHistory(storage), 'project-b')).toBeNull();
  });

  it('旧格式条目只有 clips 时补齐安全默认值', () => {
    const storage = memoryStorage();
    storage.setItem('opencut-clip-history-v1', JSON.stringify({
      projectKey: 'legacy',
      state: { entries: [{ id: 0, label: '旧格式', at: 0, clips: clips(2) }], index: 0 },
    }));
    const loaded = readPersistedHistory(storage);
    expect(loaded?.state.entries[0].clips).toHaveLength(2);
    expect(loaded?.state.entries[0].bookmarks).toEqual([]);
    expect(loaded?.state.entries[0].trackFlags).toEqual({ muted: [], hidden: [] });
    expect(loaded?.state.entries[0].selectedId).toBeNull();
    expect(loaded?.state.entries[0].adjustments).toEqual([]);
  });

  it('编辑器侧字段损坏时逐项归一化，不影响 clips 恢复', () => {
    const storage = memoryStorage();
    storage.setItem('opencut-clip-history-v1', JSON.stringify({
      projectKey: 'bad-parts',
      state: { entries: [{
        id: 0, label: 'x', at: 0, clips: clips(1),
        bookmarks: '非数组', trackFlags: { muted: '非数组' }, selectedId: 42, adjustments: {},
      }], index: 0 },
    }));
    const loaded = readPersistedHistory(storage);
    expect(loaded?.state.entries[0].clips).toHaveLength(1);
    expect(loaded?.state.entries[0].bookmarks).toEqual([]);
    expect(loaded?.state.entries[0].trackFlags).toEqual({ muted: [], hidden: [] });
    expect(loaded?.state.entries[0].selectedId).toBeNull();
    expect(loaded?.state.entries[0].adjustments).toEqual([]);
  });
});
