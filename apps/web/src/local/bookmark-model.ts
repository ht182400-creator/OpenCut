/**
 * 书签拖动 / 备注编辑的纯函数模型（UI 长尾，2026-11-24）。
 *
 * 只做数据变换，不碰 DOM 与 core：书签结构沿用 `BookmarkState`
 * （`{id, ticks, name, note?}`，note 为 additive-only 可选字段）。
 * 拖动位置换算复用时间轴的 `timelinePixelsToTicks`，保证与标尺同一口径。
 */

import { timelinePixelsToTicks } from './classic-ui/timeline-tokens'

/** 书签数据（与 project-autosave.BookmarkState 同构，note 可选保持旧数据兼容）。 */
export interface BookmarkItem {
  id: string
  ticks: number
  name: string
  note?: string
}

/** 拖动会话：记录按下时的基准，避免逐帧累积误差。 */
export interface BookmarkDragSession {
  id: string
  startClientX: number
  startTicks: number
}

/**
 * 从拖动增量像素计算书签的新 ticks（clamp 到 ≥ 0，按帧网格可选吸附）。
 * @param startTicks 拖动开始时的 ticks
 * @param deltaPixels 指针水平位移（px，可正可负）
 * @param zoom 当前时间轴缩放倍数
 * @param ticksPerSecond 每秒 ticks
 * @param frameTicks 每帧 ticks（用于吸附到帧网格；<=0 时不吸附）
 * @returns {number} 非负整数 ticks
 */
export function draggedBookmarkTicks(
  startTicks: number,
  deltaPixels: number,
  zoom: number,
  ticksPerSecond: number,
  frameTicks: number = 0,
): number {
  const base = Number.isFinite(startTicks) && startTicks > 0 ? startTicks : 0
  const delta = timelinePixelsToTicks(deltaPixels, zoom, ticksPerSecond)
  const raw = Math.max(0, base + delta)
  if (!Number.isFinite(frameTicks) || frameTicks <= 0) return Math.round(raw)
  return Math.max(0, Math.round(raw / frameTicks) * frameTicks)
}

/**
 * 更新指定书签的 ticks（按 id 匹配，不改入参，无匹配返回原数组）。
 * @param bookmarks 当前书签列表
 * @param id 目标书签 id
 * @param ticks 新的 ticks（调用方已 clamp）
 * @returns {BookmarkItem[]} 新数组
 */
export function moveBookmark(
  bookmarks: readonly BookmarkItem[],
  id: string,
  ticks: number,
): BookmarkItem[] {
  return bookmarks.map((item) => (item.id === id ? { ...item, ticks } : item))
}

/**
 * 设置书签备注（空字符串归一化删除 note 字段，保持 additive-only 不写空值）。
 * @param bookmarks 当前书签列表
 * @param id 目标书签 id
 * @param note 备注文本
 * @returns {BookmarkItem[]} 新数组
 */
export function setBookmarkNote(
  bookmarks: readonly BookmarkItem[],
  id: string,
  note: string,
): BookmarkItem[] {
  const trimmed = note.trim()
  return bookmarks.map((item) => {
    if (item.id !== id) return item
    const next = { ...item }
    if (trimmed.length === 0) delete next.note
    else next.note = trimmed
    return next
  })
}
