/**
 * P1 多选/复制粘贴纯函数模块（无 DOM，可单测）。
 *
 * 经典版交互实证：多选用「主选中 + 集合」模型（Shift 加选/区间、Cmd/Ctrl 切换），
 * 剪贴板是一组元素的深拷贝（新 id、按落点偏移起点），复制/粘贴/复制品均走 placement
 * 找空位，写回仍是同一份 elements 数组。本模块把这些规则做成纯函数。
 */

import {
  DEFAULT_ELEMENT_GAP_TICKS,
  makeElementId,
  normalizeElementParams,
  resolveAutoPlacement,
} from './element-model';
import type { CoreElement } from './editor-ui';

/**
 * 判断元素是否为媒体片段（用于粘贴时选 id 前缀）。
 * @param element 元素
 * @returns {boolean} 是否媒体元素
 */
function isMediaElement(element: CoreElement): boolean {
  return element.elementType !== 'text' && Boolean(element.mediaId);
}

/** 剪贴板负载：一组可粘贴的元素（已带新 id 生成所需的元信息）。 */
export interface ElementClipboard {
  elements: CoreElement[]
  copiedAt: string
}

/** 选择操作上下文（把「锚点 + 有序 ids + 当前集合」封装成可测入参）。 */
export interface SelectionContext {
  orderedIds: readonly string[]
  selectedIds: readonly string[]
  anchorId: string | null
  primaryId: string | null
}

/** 选择操作结果。 */
export interface SelectionResult {
  selectedIds: string[]
  anchorId: string | null
  primaryId: string | null
}

/**
 * 普通点击选中单个元素（清空集合，重置锚点）。
 * @param id 被点元素 id
 * @returns {SelectionResult} 新选择状态
 */
export function selectSingle(id: string): SelectionResult {
  return { selectedIds: [id], anchorId: id, primaryId: id }
}

/**
 * 清空选择。
 * @returns {SelectionResult} 空选择
 */
export function clearSelection(): SelectionResult {
  return { selectedIds: [], anchorId: null, primaryId: null }
}

/**
 * Cmd/Ctrl 切换单个元素的选中态（不影响锚点，主选中取切换后最后一个）。
 * @param context 选择上下文
 * @param id 被切换元素 id
 * @returns {SelectionResult} 新选择状态
 */
export function toggleSelection(context: SelectionContext, id: string): SelectionResult {
  const set = new Set(context.selectedIds)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  const selectedIds = context.orderedIds.filter((candidate) => set.has(candidate))
  return {
    selectedIds,
    anchorId: context.anchorId,
    primaryId: selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null,
  }
}

/**
 * Shift 区间选择：从锚点到目标 id（含两端）按时间轴顺序全选；无锚点时退化为单选。
 * @param context 选择上下文
 * @param id 区间终点 id
 * @returns {SelectionResult} 新选择状态
 */
export function selectRange(context: SelectionContext, id: string): SelectionResult {
  const anchor = context.anchorId ?? context.primaryId ?? id
  const from = context.orderedIds.indexOf(anchor)
  const to = context.orderedIds.indexOf(id)
  if (from < 0 || to < 0) return selectSingle(id)
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  return {
    selectedIds: context.orderedIds.slice(start, end + 1),
    anchorId: anchor,
    primaryId: id,
  }
}

/**
 * 全选（按时间轴顺序）。
 * @param orderedIds 有序 id 列表
 * @returns {SelectionResult} 全选状态
 */
export function selectAll(orderedIds: readonly string[]): SelectionResult {
  return {
    selectedIds: [...orderedIds],
    anchorId: orderedIds[0] ?? null,
    primaryId: orderedIds[orderedIds.length - 1] ?? null,
  }
}

/**
 * 复制选中元素为剪贴板快照（深拷贝 params，不复用引用）。
 * @param elements 当前全部元素
 * @param selectedIds 选中 id 集合
 * @param copiedAt ISO 时间戳（可注入便于单测）
 * @returns {ElementClipboard} 剪贴板负载
 */
export function copyElements(
  elements: readonly CoreElement[],
  selectedIds: readonly string[],
  copiedAt: string = new Date().toISOString(),
): ElementClipboard {
  const selected = new Set(selectedIds)
  const ordered = [...elements].sort((a, b) => a.startTime - b.startTime)
  const clips = ordered
    .filter((element) => selected.has(element.id))
    .map((element) => ({
      ...element,
      params: normalizeElementParams(element.params),
      // 复制品不沿用原 id，粘贴时再生成；此处置空避免误写回。
      id: '',
    }))
  return { elements: clips, copiedAt }
}

/**
 * 把剪贴板粘贴到目标起点：为新片段生成 id，按相对间隔排布，并用 placement 避开既有片段。
 * @param elements 当前全部元素
 * @param clipboard 剪贴板负载
 * @param atTicks 目标起点（播放头 ticks）
 * @returns {CoreElement[]} 粘贴后的新数组（含新元素，按起点排序）
 */
export function pasteElements(
  elements: readonly CoreElement[],
  clipboard: ElementClipboard,
  atTicks: number,
): CoreElement[] {
  if (clipboard.elements.length === 0) return [...elements]
  const sorted = [...clipboard.elements].sort((a, b) => a.startTime - b.startTime)
  const baseStart = sorted[0].startTime
  const placements: CoreElement[] = []
  let cursor = Number.isFinite(atTicks) ? Math.max(0, Math.round(atTicks)) : 0
  for (const clip of sorted) {
    const offset = clip.startTime - baseStart
    const desired = cursor + offset
    const placed: CoreElement = {
      ...clip,
      id: makeElementId(isMediaElement(clip) ? 'media' : 'text'),
      startTime: resolveAutoPlacement([...elements, ...placements], desired, clip.duration, DEFAULT_ELEMENT_GAP_TICKS),
      params: normalizeElementParams(clip.params),
    }
    placements.push(placed)
    cursor = Math.max(cursor, placed.startTime + placed.duration)
  }
  return [...elements, ...placements].sort((a, b) => a.startTime - b.startTime)
}

/**
 * 复制（Duplicate）：与粘贴类似但在选中片段尾部找空位，返回新数组与新 id 集合。
 * @param elements 当前全部元素
 * @param selectedIds 选中 id 集合
 * @returns {{ elements: CoreElement[]; newIds: string[] }} 复制后数组与新 id
 */
export function duplicateElements(
  elements: readonly CoreElement[],
  selectedIds: readonly string[],
): { elements: CoreElement[]; newIds: string[] } {
  const clipboard = copyElements(elements, selectedIds)
  if (clipboard.elements.length === 0) return { elements: [...elements], newIds: [] }
  const sorted = [...clipboard.elements].sort((a, b) => a.startTime - b.startTime)
  const lastEnd = Math.max(...sorted.map((clip) => clip.startTime + clip.duration))
  const pasted = pasteElements(elements, clipboard, lastEnd + DEFAULT_ELEMENT_GAP_TICKS)
  const existing = new Set(elements.map((clip) => clip.id))
  const newIds = pasted.filter((clip) => !existing.has(clip.id)).map((clip) => clip.id)
  return { elements: pasted, newIds }
}
