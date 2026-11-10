/**
 * 时间线版本快照（W-09 第三批 / M6）：记录每次剪辑后的片段集合，支持撤销/重做与回溯。
 *
 * 纯函数层（createHistory / pushSnapshot / moveHistory / canUndo / canRedo）不依赖 React，
 * 便于单测；`useClipHistory` 在其上封装状态、快捷键与恢复回调。
 * 快照保存深拷贝，编辑后的片段对象变化不会污染历史。
 */

import { useEffect, useRef, useState } from 'react';

import type { TimelineClip } from './timeline';

/** 一次剪辑后的不可变时间线快照。 */
export interface TimelineSnapshot {
  id: number;
  label: string;
  at: number;
  clips: TimelineClip[];
}

/** 历史状态：entries 按时间顺序，index 指向当前生效的快照。 */
export interface HistoryState {
  entries: TimelineSnapshot[];
  index: number;
}

/** 最多保留的快照数，避免长时间编辑占满内存。 */
export const MAX_HISTORY = 50;

/** 复制片段集合，避免后续编辑改动历史条目。 */
function cloneClips(clips: TimelineClip[]): TimelineClip[] {
  return clips.map((clip) => ({ ...clip }));
}

/**
 * 建立只含一条初始快照的历史（用于加载项目时重置）。
 * @param clips 初始片段
 * @param label 快照说明
 * @returns {HistoryState} 历史状态
 */
export function createHistory(clips: TimelineClip[], label = '初始时间轴'): HistoryState {
  return {
    entries: [{ id: 0, label, at: 0, clips: cloneClips(clips) }],
    index: 0,
  };
}

/**
 * 记录一次剪辑：丢弃当前位置之后的 redo 分支，追加新快照并裁剪到容量上限。
 * @param state 当前历史
 * @param clips 剪辑后的片段
 * @param label 动作说明
 * @returns {HistoryState} 新历史
 */
export function pushSnapshot(
  state: HistoryState,
  clips: TimelineClip[],
  label: string,
): HistoryState {
  const kept = state.entries.slice(0, state.index + 1);
  const previous = kept[kept.length - 1];
  const entry: TimelineSnapshot = {
    id: (previous?.id ?? -1) + 1,
    label,
    at: Date.now(),
    clips: cloneClips(clips),
  };
  const entries = [...kept, entry].slice(-MAX_HISTORY);
  return { entries, index: entries.length - 1 };
}

/**
 * 在历史中前后移动；到头/到尾时返回 null 且不改变状态。
 * @param state 当前历史
 * @param delta -1 撤销 / +1 重做
 * @returns {{state: HistoryState, clips: TimelineClip[] | null}} 新状态与要恢复的片段
 */
export function moveHistory(
  state: HistoryState,
  delta: -1 | 1,
): { state: HistoryState; clips: TimelineClip[] | null } {
  const index = state.index + delta;
  if (index < 0 || index >= state.entries.length) {
    return { state, clips: null };
  }
  return {
    state: { ...state, index },
    clips: cloneClips(state.entries[index].clips),
  };
}

/** 是否可撤销。 */
export function canUndo(state: HistoryState): boolean {
  return state.index > 0;
}

/** 是否可重做。 */
export function canRedo(state: HistoryState): boolean {
  return state.index < state.entries.length - 1;
}

/**
 * 历史摘要，用于界面显示。
 * @param state 当前历史
 * @returns {string} 形如「3 / 5 步 · 当前：删除选中片段」
 */
export function historyLabel(state: HistoryState): string {
  const current = state.entries[state.index];
  return `${state.index + 1} / ${state.entries.length} 步 · 当前：${current?.label ?? '—'}`;
}

/**
 * 编辑器侧的历史 hook：提供记录、重置、撤销/重做与 Ctrl/Cmd+Z 快捷键。
 * 恢复的片段通过 `onRestore` 交回编辑器重新应用帧计划。
 * @param onRestore 恢复回调
 * @returns {object} 历史状态与操作
 */
export function useClipHistory(onRestore: (clips: TimelineClip[]) => void) {
  const [state, setState] = useState<HistoryState>(() => createHistory([]));
  const stateRef = useRef(state);
  const restoreRef = useRef(onRestore);
  stateRef.current = state;
  restoreRef.current = onRestore;

  /** 记录一次剪辑后的快照。 */
  const record = (clips: TimelineClip[], label: string) => {
    setState((previous) => pushSnapshot(previous, clips, label));
  };

  /** 加载新项目时重置历史。 */
  const reset = (clips: TimelineClip[], label: string) => {
    setState(createHistory(clips, label));
  };

  /** 在历史中移动并把恢复的片段交给编辑器。 */
  const travel = (delta: -1 | 1) => {
    const result = moveHistory(stateRef.current, delta);
    if (result.clips) {
      setState(result.state);
      restoreRef.current(result.clips);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      travel(event.shiftKey ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    state,
    record,
    reset,
    undo: () => travel(-1),
    redo: () => travel(1),
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    label: historyLabel(state),
  };
}
