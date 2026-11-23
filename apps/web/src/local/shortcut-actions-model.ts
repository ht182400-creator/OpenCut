/**
 * 快捷键新增动作的纯逻辑（第二档项 3）：播放头 seek 边界、split-left/right。
 *
 * 全部为无 DOM/无 core 的纯函数，便于用边界值（首尾/极值/空片段）与异常输入
 * 充分覆盖。core 的 ripple 与历史快照仍由页面层 applyClipEdit 统一处理。
 */
import { splitClipAt } from './timeline';
import type { TimelineClip } from './timeline';

/** 每秒 ticks（与 TICKS_PER_SECOND 一致；此处字面量避免循环导入）。 */
const TICKS_PER_SECOND = 120000;
/** seek ±1 秒的秒数。 */
const SEEK_SECONDS = 1;
/** jump ±5 秒的秒数。 */
const JUMP_SECONDS = 5;

/**
 * 把任意数夹逼到 [0, max]，非有限值回落 0。
 * @param value 输入值
 * @param max 上界
 * @returns {number} 合法帧号
 */
function clampFrame(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  const upper = Number.isFinite(max) && max > 0 ? max : 0;
  return Math.min(upper, Math.max(0, Math.round(value)));
}

/**
 * 计算相对 seek 后的帧号（±1s / ±5s），夹逼到 [0, frameCount-1]。
 * @param frameIndex 当前帧
 * @param fps 帧率（非法时按 30 兜底）
 * @param frameCount 总帧数（非法时按 1 兜底）
 * @param seconds 偏移秒数（正前负后）
 * @returns {number} 目标帧号
 */
export function seekBySeconds(frameIndex: number, fps: number, frameCount: number, seconds: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeCount = Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 1;
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  const deltaFrames = Math.round(safeSeconds * safeFps);
  return clampFrame(frameIndex + deltaFrames, safeCount - 1);
}

/** seek ±1 秒。 */
export function seekForwardOneSecond(frameIndex: number, fps: number, frameCount: number): number {
  return seekBySeconds(frameIndex, fps, frameCount, SEEK_SECONDS);
}

/** seek 后退 ±1 秒。 */
export function seekBackwardOneSecond(frameIndex: number, fps: number, frameCount: number): number {
  return seekBySeconds(frameIndex, fps, frameCount, -SEEK_SECONDS);
}

/** jump 前进 5 秒。 */
export function jumpForwardFiveSeconds(frameIndex: number, fps: number, frameCount: number): number {
  return seekBySeconds(frameIndex, fps, frameCount, JUMP_SECONDS);
}

/** jump 后退 5 秒。 */
export function jumpBackwardFiveSeconds(frameIndex: number, fps: number, frameCount: number): number {
  return seekBySeconds(frameIndex, fps, frameCount, -JUMP_SECONDS);
}

/**
 * split-left：在切点分割选中片段，删除左半，保留右半并前移到原起点。
 * 切点不在片段内部时返回原引用（由调用方提示「无法分割」）。
 * @param clips 当前片段
 * @param clipId 选中片段 id
 * @param splitTicks 切点（项目 ticks）
 * @returns {TimelineClip[]} 处理后的片段
 */
export function splitAndRemoveLeft(
  clips: TimelineClip[],
  clipId: string,
  splitTicks: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const elapsed = splitTicks - target.startTime;
  if (elapsed <= 0 || elapsed >= target.duration) return clips;
  const split = splitClipAt(clips, clipId, splitTicks);
  const rightId = `${clipId}#2`;
  return split.map((clip) => {
    if (clip.id !== rightId) return clip.id === clipId ? null : clip;
    // 右半前移到原片段起点，trimStart 累加切点偏移，素材时间连续。
    return {
      ...clip,
      id: clipId,
      startTime: target.startTime,
      trimStart: target.trimStart + elapsed,
    };
  }).filter((clip): clip is TimelineClip => clip !== null);
}

/**
 * split-right：在切点分割选中片段，删除右半，保留左半（起点与 trim 不变）。
 * @param clips 当前片段
 * @param clipId 选中片段 id
 * @param splitTicks 切点（项目 ticks）
 * @returns {TimelineClip[]} 处理后的片段
 */
export function splitAndRemoveRight(
  clips: TimelineClip[],
  clipId: string,
  splitTicks: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const elapsed = splitTicks - target.startTime;
  if (elapsed <= 0 || elapsed >= target.duration) return clips;
  const split = splitClipAt(clips, clipId, splitTicks);
  const rightId = `${clipId}#2`;
  return split.filter((clip) => clip.id !== rightId);
}

/**
 * 在播放头切换书签：存在则删除，不存在则新增（id 稳定可复现，便于测试）。
 * @param bookmarks 当前书签
 * @param ticks 播放头 ticks
 * @param id 新增书签 id
 * @param name 新增书签名称
 * @returns {Array} 新书签数组（不改入参）
 */
export function toggleBookmarkAt(
  bookmarks: readonly { id: string; ticks: number; name: string }[],
  ticks: number,
  id: string,
  name: string,
): Array<{ id: string; ticks: number; name: string }> {
  const existing = bookmarks.find((item) => item.ticks === ticks);
  if (existing) return bookmarks.filter((item) => item.ticks !== ticks);
  return [...bookmarks, { id, ticks, name }];
}

/** 导出每秒 ticks，供测试与页面层复用（与模型层常量同源）。 */
export const SHORTCUT_TICKS_PER_SECOND = TICKS_PER_SECOND;
