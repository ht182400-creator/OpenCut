/**
 * P1 选择/剪贴板 Hook：把多选集合、区间锚点、内存剪贴板及其处理器集中管理，
 * 让路由文件只消费一个 hook 返回值（行数约束），且全部逻辑可单测于 element-operations。
 *
 * selectedId（主选中）继续由 editor.tsx 持有，本 hook 通过 setPrimaryId 同步，
 * 保持与既有单片段编辑（split/trim/属性面板）兼容。
 */

import { useRef, useState } from 'react';
import type { CoreElement } from './editor-ui';
import {
  clearSelection,
  copyElements,
  duplicateElements,
  pasteElements,
  selectAll,
  selectRange,
  selectSingle,
  toggleSelection,
  type ElementClipboard,
  type SelectionContext,
} from './element-operations';

/** Hook 依赖：编辑状态读取 + 写回回调。 */
export interface UseSelectionDeps {
  elements: CoreElement[]
  primaryId: string | null
  setPrimaryId: (id: string | null) => void
  setElements: (next: CoreElement[]) => void
  recordHistory: (clips: CoreElement[], label: string) => void
  recomputeFrameCount: (clips: CoreElement[]) => void
  formatError: (error: unknown) => string
  setErrorText: (text: string | null) => void
  setMediaStatus: (text: string) => void
  canEdit: () => boolean
  playheadTicks: () => number
}

/** Hook 返回值：选择状态 + 交互处理器。 */
export interface SelectionApi {
  selectedIds: string[]
  handleSelectClip: (id: string, additive: boolean, range: boolean) => void
  handleCopy: () => void
  handlePaste: () => void
  handleDuplicate: (ids?: string[]) => void
  handleSelectAll: () => void
  handleClear: () => void
  resetSelection: () => void
}

/**
 * 构造选择/剪贴板 API。
 * @param deps 编辑器状态与回调依赖
 * @returns {SelectionApi} 选择状态与处理器
 */
export function useSelection(deps: UseSelectionDeps): SelectionApi {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const anchorRef = useRef<string | null>(null)
  const clipboardRef = useRef<ElementClipboard | null>(null)

  const applySelection = (result: {
    selectedIds: string[]
    anchorId: string | null
    primaryId: string | null
  }) => {
    setSelectedIds(result.selectedIds)
    anchorRef.current = result.anchorId
    deps.setPrimaryId(result.primaryId)
  }

  const context = (): SelectionContext => ({
    orderedIds: [...deps.elements].sort((a, b) => a.startTime - b.startTime).map((item) => item.id),
    selectedIds,
    anchorId: anchorRef.current,
    primaryId: deps.primaryId,
  })

  const handleSelectClip = (id: string, additive: boolean, range: boolean) => {
    if (range) applySelection(selectRange(context(), id))
    else if (additive) applySelection(toggleSelection(context(), id))
    else applySelection(selectSingle(id))
  }

  const handleCopy = () => {
    const ids = selectedIds.length > 0 ? selectedIds : deps.primaryId ? [deps.primaryId] : []
    if (ids.length === 0) return
    clipboardRef.current = copyElements(deps.elements, ids)
    deps.setMediaStatus(`已复制 ${ids.length} 个片段到剪贴板`)
  }

  const handlePaste = () => {
    if (!deps.canEdit() || !clipboardRef.current) return
    try {
      const next = pasteElements(deps.elements, clipboardRef.current, deps.playheadTicks())
      if (next.length === deps.elements.length) return
      deps.setElements(next)
      deps.recordHistory(next, '粘贴片段')
      deps.recomputeFrameCount(next)
      const added = next.filter((item) => !deps.elements.some((old) => old.id === item.id)).map((item) => item.id)
      applySelection({ selectedIds: added, anchorId: added[0] ?? null, primaryId: added[0] ?? null })
      deps.setMediaStatus(`已粘贴 ${added.length} 个片段`)
    } catch (error) {
      deps.setErrorText(`粘贴失败：${deps.formatError(error)}`)
    }
  }

  const handleDuplicate = (ids?: string[]) => {
    if (!deps.canEdit()) return
    try {
      const targets = ids ?? (selectedIds.length > 0 ? selectedIds : deps.primaryId ? [deps.primaryId] : [])
      if (targets.length === 0) return
      const { elements: next, newIds } = duplicateElements(deps.elements, targets)
      if (newIds.length === 0) return
      deps.setElements(next)
      deps.recordHistory(next, '复制片段')
      deps.recomputeFrameCount(next)
      applySelection({ selectedIds: newIds, anchorId: newIds[0], primaryId: newIds[0] })
      deps.setMediaStatus(`已复制 ${newIds.length} 个片段`)
    } catch (error) {
      deps.setErrorText(`复制失败：${deps.formatError(error)}`)
    }
  }

  const handleSelectAll = () => {
    applySelection(selectAll([...deps.elements].sort((a, b) => a.startTime - b.startTime).map((item) => item.id)))
  }

  const handleClear = () => {
    applySelection(clearSelection())
  }

  const resetSelection = () => {
    setSelectedIds([])
    anchorRef.current = null
  }

  return {
    selectedIds, handleSelectClip, handleCopy, handlePaste,
    handleDuplicate, handleSelectAll, handleClear, resetSelection,
  }
}
