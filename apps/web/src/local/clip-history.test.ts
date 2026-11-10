import { describe, expect, it } from 'vitest';

import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  createHistory,
  historyLabel,
  moveHistory,
  pushSnapshot,
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
