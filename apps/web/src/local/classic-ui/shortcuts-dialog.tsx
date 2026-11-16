/**
 * 经典版 UI 像素级 1:1 改造 · 批 6 快捷键帮助对话框 + 通用 Dialog 外壳
 * （本地重写，不拷贝经典版 React/zustand 源码）。
 *
 * 结构对照经典版：
 * - components/ui/dialog.tsx：遮罩 z-250/black10/blur、容器 max-w-lg、Header p-6、Body p-6、Footer py-5
 * - actions/components/shortcuts-dialog.tsx：max-w-2xl/max-h-80vh、8 分类分组（gap-6/组内 gap-1）、
 *   badge h-7/px-2.5、点击录制、Reset to default
 *
 * 边界：经典版无命令面板（Command Palette），本组件如实对齐「快捷键帮助」这一最接近的实现；
 * 本工程仅 9 个快捷键动作已接入（editor-shortcuts.ts），其余动作 badge 标 disabled 占位。
 * 尺寸/文案来自 commands-tokens.ts；图标为本地绘制 SVG。
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ACTION_CATEGORIES,
  ACTION_DEFINITIONS,
  DIALOG_CLOSE_ICON_SIZE_PX,
  DIALOG_CLOSE_TOP_RIGHT_PX,
  DIALOG_FOOTER_GAP_PX,
  DIALOG_FOOTER_PY_PX,
  DIALOG_MAX_WIDTH_PX,
  DIALOG_OVERLAY_BLUR,
  DIALOG_OVERLAY_BG,
  DIALOG_PADDING_PX,
  DIALOG_Z_INDEX,
  KEYBINDINGS_STORAGE_KEY,
  SHORTCUT_BADGE_GAP_PX,
  SHORTCUT_BADGE_HEIGHT_PX,
  SHORTCUT_BADGE_PADDING_X_PX,
  SHORTCUTS_DIALOG_MAX_HEIGHT_VH,
  SHORTCUTS_DIALOG_MAX_WIDTH_PX,
  SHORTCUTS_GROUP_GAP_PX,
  SHORTCUTS_ITEM_GAP_PX,
  SHORTCUTS_RESET_LABEL,
  SHORTCUTS_TITLE,
  formatShortcut,
  type ActionDefinition,
} from './commands-tokens';

/** 本工程已接入的快捷键动作 id（editor-shortcuts.ts 的 matchShortcut 覆盖）。 */
const IMPLEMENTED_ACTION_IDS = new Set([
  'toggle-play', 'frame-step-forward', 'frame-step-backward', 'goto-start', 'goto-end',
  'delete-selected', 'split', 'seek-backward', 'seek-forward',
])

/** 通用 Dialog 外壳（1:1 遮罩/容器/Header/Body/Footer）。 */
export function AppDialog({ open, onClose, title, children, footer, maxWidthPx = DIALOG_MAX_WIDTH_PX, maxHeightVh }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  maxWidthPx?: number
  maxHeightVh?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: DIALOG_Z_INDEX,
      background: DIALOG_OVERLAY_BG, backdropFilter: DIALOG_OVERLAY_BLUR,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="classic-dialog-content"
        style={{
          position: 'relative', width: `calc(100% - 2rem)`, maxWidth: maxWidthPx,
          maxHeight: maxHeightVh ? `${maxHeightVh}vh` : undefined,
          display: 'flex', flexDirection: 'column',
          background: 'var(--popover)', color: 'var(--foreground)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 10px 30px rgba(0,0,0,.25)',
        }}>
        <button type="button" aria-label="Close" title="Close" onClick={onClose}
          style={{
            position: 'absolute', top: DIALOG_CLOSE_TOP_RIGHT_PX, right: DIALOG_CLOSE_TOP_RIGHT_PX,
            width: DIALOG_CLOSE_ICON_SIZE_PX, height: DIALOG_CLOSE_ICON_SIZE_PX, opacity: 0.7,
            border: 'none', background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer',
          }}>
          <svg width={DIALOG_CLOSE_ICON_SIZE_PX} height={DIALOG_CLOSE_ICON_SIZE_PX} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div style={{
          flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8,
          padding: DIALOG_PADDING_PX, borderBottom: '1px solid var(--border)',
          fontSize: '1.125rem', lineHeight: 1, fontWeight: 600, letterSpacing: '-0.025em',
        }}>{title}</div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: DIALOG_PADDING_PX, overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div style={{
            flex: '0 0 auto', display: 'flex', gap: DIALOG_FOOTER_GAP_PX,
            justifyContent: 'flex-end', paddingLeft: DIALOG_PADDING_PX, paddingRight: DIALOG_PADDING_PX,
            paddingTop: DIALOG_FOOTER_PY_PX, paddingBottom: DIALOG_FOOTER_PY_PX,
            borderTop: '1px solid var(--border)',
          }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

/** 从 localStorage 读取自定义快捷键（失败返回空对象）。 */
function loadBindings(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(KEYBINDINGS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

/** 单个快捷键条目：描述 + badge（可点击录制或 disabled 占位）。 */
function ShortcutItem({ action, bindings, recordingId, onStartRecord, isMac }: {
  action: ActionDefinition
  bindings: Record<string, string[]>
  recordingId: string | null
  onStartRecord: (id: string) => void
  isMac: boolean
}) {
  const implemented = IMPLEMENTED_ACTION_IDS.has(action.id)
  const keys = bindings[action.id] ?? [...action.shortcuts]
  const label = action.description
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, fontSize: 'var(--text-sm)', minHeight: 32 }}>
      <span style={{ color: 'var(--muted-foreground)' }} title={implemented ? undefined : '未接入当前工程快捷键'}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: SHORTCUT_BADGE_GAP_PX, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {keys.length === 0 && <span style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-xs)' }}>—</span>}
        {keys.map((shortcut, index) => (
          <span key={index} role="button" tabIndex={implemented ? 0 : -1}
            title={implemented ? (recordingId === action.id ? 'Press any key combination...' : 'Click to edit shortcut') : '未接入'}
            aria-disabled={!implemented}
            onClick={() => { if (implemented) onStartRecord(action.id) }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: SHORTCUT_BADGE_HEIGHT_PX, padding: `0 ${SHORTCUT_BADGE_PADDING_X_PX}px`,
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              background: 'var(--background)', fontSize: 'var(--text-sm)',
              opacity: implemented ? 1 : 0.5, cursor: implemented ? 'pointer' : 'default',
              fontVariantNumeric: 'tabular-nums',
            }}>
            {recordingId === action.id ? '…' : formatShortcut(shortcut, isMac)}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * 快捷键帮助对话框（1:1 外壳 + 8 分类分组 + 可编辑 badge）。
 * @param props open/onClose
 * @returns {React.ReactElement} 快捷键帮助对话框
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bindings, setBindings] = useState<Record<string, string[]>>(() => loadBindings())
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const recordingRef = useRef<string | null>(null)
  recordingRef.current = recordingId
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  // 录制组合键：keydown 捕获并写 localStorage；Esc 取消。
  useEffect(() => {
    if (!recordingId) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') { setRecordingId(null); return }
      const target = recordingRef.current
      if (!target) return
      const parts: string[] = []
      if (event.ctrlKey || event.metaKey) parts.push('ctrl')
      if (event.altKey) parts.push('alt')
      if (event.shiftKey) parts.push('shift')
      parts.push(event.key.toLowerCase())
      const combo = parts.join('+')
      const next = { ...loadBindings(), [target]: [combo] }
      try { localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(next)) } catch { /* 存储失败不影响主流程 */ }
      setBindings(next)
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingId])

  /** 重置为经典版默认快捷键并清除 localStorage。 */
  const resetDefaults = () => {
    try { localStorage.removeItem(KEYBINDINGS_STORAGE_KEY) } catch { /* 忽略存储失败 */ }
    setBindings({})
    setRecordingId(null)
  }

  return (
    <AppDialog open={open} onClose={onClose} title={SHORTCUTS_TITLE}
      maxWidthPx={SHORTCUTS_DIALOG_MAX_WIDTH_PX} maxHeightVh={SHORTCUTS_DIALOG_MAX_HEIGHT_VH}
      footer={
        <button type="button" className="classic-button" onClick={resetDefaults}
          style={{ color: 'var(--destructive)' }}>{SHORTCUTS_RESET_LABEL}</button>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SHORTCUTS_GROUP_GAP_PX }}>
        {ACTION_CATEGORIES.map((category) => {
          const group = ACTION_DEFINITIONS.filter((action) => action.category === category)
          if (group.length === 0) return null
          return (
            <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: SHORTCUTS_ITEM_GAP_PX }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>
                {category}
              </h3>
              {group.map((action) => (
                <ShortcutItem key={action.id} action={action} bindings={bindings}
                  recordingId={recordingId} onStartRecord={setRecordingId} isMac={isMac} />
              ))}
            </div>
          )
        })}
      </div>
    </AppDialog>
  )
}
