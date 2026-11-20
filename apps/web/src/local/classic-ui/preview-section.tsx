/**
 * 经典版 UI 像素级 1:1 改造 · 批 5 预览交互（本地重写，不拷贝经典版 React/zustand 源码）。
 *
 * 结构对照经典版 `preview/components/`：
 * - 视口（上/左/右 8px padding、底 0）+ 居中 16:9 画布 + 分层 overlay
 * - 选框 SVG（白色描边 0.75 / 1px）+ 8 手柄（4 角 10px + 3 边 6×14 + 旋转 20px）+ 对齐参考线（1px 白 70%）
 * - 三栏控制条：左时间码 HH:MM:SS:FF / 中播放暂停 28px / 右缩放（Fit + 6 预设）+ 全屏
 *
 * 边界：core 无元素 transform 存储（属批 7），故选框/手柄/参考线为视觉叠加 +
 * 本地交互状态，不改变合成结果；时间码由 frameIndex/fps 计算。批 7.2 起画布
 * 分辨率可配置（由 frameWidth/frameHeight 传入，默认 320×180），16:9 预设不变。
 * 尺寸/文案来自 preview-tokens.ts；图标为本地绘制 SVG。
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject, WheelEvent } from 'react';

import {
  EDGE_HANDLE_THICK_SIZE,
  EDGE_HANDLE_THIN_SIZE,
  HANDLE_BORDER_RADIUS,
  HANDLE_FILL,
  HANDLE_HIT_AREA_SIZE,
  HANDLE_SIZE,
  ICON_HANDLE_FILL,
  ICON_HANDLE_RADIUS,
  ICON_HANDLE_TEXT,
  PREVIEW_ICON_BUTTON_SIZE_PX,
  PREVIEW_TOOLBAR_GAP_PX,
  PREVIEW_TOOLBAR_PADDING_BOTTOM_PX,
  PREVIEW_TOOLBAR_PADDING_TOP_PX,
  PREVIEW_TOOLBAR_PADDING_X_PX,
  PREVIEW_VIEWPORT_PADDING_BOTTOM_PX,
  PREVIEW_VIEWPORT_PADDING_PX,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_MIN,
  PREVIEW_ZOOM_PRESETS,
  PREVIEW_ZOOM_STEP,
  ROTATION_HANDLE_OFFSET,
  SELECTION_STROKE_OPACITY,
  SELECTION_STROKE_WIDTH,
  SNAP_GUIDE_COLOR,
  SNAP_GUIDE_WIDTH,
  SNAP_THRESHOLD_SCREEN_PIXELS,
  TRANSFORM_CORNERS,
  TRANSFORM_EDGES,
  WHEEL_DELTA_CAP,
  WHEEL_ZOOM_DIVISOR,
  formatFrameTimecode,
  formatZoomLabel,
  getResizeCursor,
  parseFrameTimecode,
} from './preview-tokens';
import {
  CONTEXT_MENU_ITEM_PADDING_X_PX,
  CONTEXT_MENU_ITEM_PADDING_Y_PX,
  CONTEXT_MENU_MIN_WIDTH_PX,
  CONTEXT_MENU_PADDING_PX,
  CONTEXT_MENU_PREVIEW_ITEMS,
} from './commands-tokens';

export interface PreviewSectionProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  playing: boolean
  onTogglePlay: () => void
  frameIndex: number
  frameCount: number
  /** 帧率（时间码 FF 字段用）。 */
  fps?: number
  onSeek: (frameIndex: number) => void
  /** 兼容旧调用的补充时间码文本（显示在时间码旁，经典版无此字段）。 */
  timecode?: string
  /** 是否选中元素：选中时画布上叠加选框与手柄（视觉占位，见边界说明）。 */
  selected?: boolean
  /** 批 7.2：画布内部分辨率（RGBA 像素缓冲尺寸），默认 320×180。 */
  frameWidth?: number
  frameHeight?: number
}

/** 本地选框矩形（百分比坐标，0~100；旋转恒 0，见边界）。 */
interface LocalBox {
  left: number
  top: number
  width: number
  height: number
  rotation: number
}

const INITIAL_BOX: LocalBox = { left: 20, top: 20, width: 60, height: 60, rotation: 0 }

/** 播放图标。 */
function PlayIcon({ playing }: { playing: boolean }): ReactNode {
  return playing
    ? <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="3" height="10" rx="0.5" /><rect x="8" y="2" width="3" height="10" rx="0.5" /></svg>
    : <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M4 2.5v9l7-4.5z" /></svg>
}

/** 全屏图标。 */
function FullscreenIcon(): ReactNode {
  return <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9" /></svg>
}

/** 旋转图标（顶边中点的圆形手柄）。 */
function RotateIcon(): ReactNode {
  return <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" /></svg>
}

/**
 * 预览画布 + 选框/手柄/参考线 + 三栏控制条（1:1 视觉结构，变换交互为本地占位）。
 * @param props 画布 ref、播放状态、帧信息与回调
 * @returns {React.ReactElement} 预览面板
 */
export function PreviewSection(props: PreviewSectionProps) {
  const [zoom, setZoom] = useState(1)
  const [box, setBox] = useState<LocalBox>(INITIAL_BOX)
  const [snapLines, setSnapLines] = useState<{ vertical: boolean; horizontal: boolean }>({ vertical: false, horizontal: false })
  /** 批 4：可编辑时间码的输入草稿（回车/失焦提交）。 */
  const [timecodeDraft, setTimecodeDraft] = useState<string | null>(null)
  /** 批 4：右键菜单开关与屏幕坐标。 */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ mode: string; startX: number; startY: number; orig: LocalBox } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // 帧切换时重置本地选框（元素变换不随 core 存储，见边界）
  useEffect(() => {
    setBox(INITIAL_BOX)
    setSnapLines({ vertical: false, horizontal: false })
  }, [props.selected])

  // 帧号外部变化（播放/seek）时清空时间码草稿，避免显示与真实帧不一致。
  useEffect(() => { setTimecodeDraft(null) }, [props.frameIndex])

  /** 缩放：步进 ×1.25，夹在 [0.25,16]。 */
  const applyZoom = (next: number) => {
    try {
      setZoom(Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, next)))
    } catch {
      setZoom(1)
    }
  }

  /** Ctrl/Cmd + wheel 缩放，普通 wheel 不改缩放（平移未在 core 帧源上实现）。 */
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    try {
      const capped = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, event.deltaY))
      applyZoom(zoom * Math.exp(-capped / WHEEL_ZOOM_DIVISOR))
    } catch {
      applyZoom(1)
    }
  }

  /** 手柄拖拽起点（本地视觉状态，不写 core）。 */
  const startDrag = (event: ReactMouseEvent, mode: string) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, orig: { ...box } }
  }

  // 全局 mousemove/up：按视口尺寸换算百分比，中心/边缘吸附阈值 8px
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      const rect = stageRef.current?.getBoundingClientRect()
      if (!drag || !rect) return
      const dx = ((event.clientX - drag.startX) / rect.width) * 100
      const dy = ((event.clientY - drag.startY) / rect.height) * 100
      const orig = drag.orig
      let next = { ...orig }
      if (drag.mode === 'move') {
        next.left = Math.max(0, Math.min(100 - orig.width, orig.left + dx))
        next.top = Math.max(0, Math.min(100 - orig.height, orig.top + dy))
      } else if (drag.mode.includes('left')) {
        next.left = Math.max(0, Math.min(orig.left + orig.width - 5, orig.left + dx))
        next.width = orig.width + orig.left - next.left
      } else if (drag.mode.includes('right')) {
        next.width = Math.max(5, Math.min(100 - orig.left, orig.width + dx))
      } else if (drag.mode.includes('top')) {
        next.top = Math.max(0, Math.min(orig.top + orig.height - 5, orig.top + dy))
        next.height = orig.height + orig.top - next.top
      } else if (drag.mode.includes('bottom')) {
        next.height = Math.max(5, Math.min(100 - orig.top, orig.height + dy))
      }
      // 中心吸附（屏幕 8px 阈值换算为百分比阈值）
      const threshold = (SNAP_THRESHOLD_SCREEN_PIXELS / rect.width) * 100
      const centerX = next.left + next.width / 2
      const centerY = next.top + next.height / 2
      const vertical = Math.abs(centerX - 50) < threshold
      const horizontal = Math.abs(centerY - 50) < threshold
      if (vertical) next.left = 50 - next.width / 2
      if (horizontal) next.top = 50 - next.height / 2
      setSnapLines({ vertical, horizontal })
      setBox(next)
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setSnapLines({ vertical: false, horizontal: false })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  /** 全屏切换（浏览器 Fullscreen API，失败不影响主流程）。 */
  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void viewportRef.current?.requestFullscreen?.()
    } catch {
      // 全屏能力受限时静默降级，预览本身不受影响
    }
  }

  /**
   * 批 4：提交编辑的时间码（回车/失焦），解析成功则 seek，失败则丢弃草稿回落显示。
   * @param text 输入文本
   */
  const commitTimecode = (text: string) => {
    const frame = parseFrameTimecode(text, props.fps ?? 30)
    if (frame !== null) props.onSeek(Math.min(frame, Math.max(0, props.frameCount - 1)))
    setTimecodeDraft(null)
  }

  /** 批 4：保存当前画布为 PNG（snapshot）；toDataURL 失败时静默降级。 */
  const saveSnapshot = () => {
    try {
      const canvas = props.canvasRef.current
      if (!canvas) return
      const url = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = url
      link.download = `snapshot-${formatFrameTimecode(props.frameIndex, props.fps ?? 30).replace(/:/g, '-')}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      // 画布跨域/taint 时无法导出，静默降级不影响预览
    }
  }

  /** 批 4：复制当前画布 PNG 到剪贴板（ClipboardItem 可用时）。 */
  const copySnapshot = () => {
    try {
      const canvas = props.canvasRef.current
      if (!canvas || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return
      canvas.toBlob((blob) => {
        if (blob) void navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      }, 'image/png')
    } catch {
      // 剪贴板权限受限时静默降级
    }
  }

  /** 批 4：右键打开预览菜单（阻止浏览器默认菜单）。 */
  const openContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  /** 批 4：执行右键菜单项后关闭菜单。 */
  const runContextAction = (action: string) => {
    setContextMenu(null)
    if (action === 'Fit to screen') applyZoom(1)
    else if (action === 'Full screen') toggleFullscreen()
    else if (action === 'Save snapshot') saveSnapshot()
    else if (action === 'Copy snapshot') copySnapshot()
  }

  const timecode = formatFrameTimecode(props.frameIndex, props.fps ?? 30)
  const totalTimecode = formatFrameTimecode(props.frameCount, props.fps ?? 30)
  const zoomPercent = Math.round(zoom * 100)
  const zoomIsPreset = (PREVIEW_ZOOM_PRESETS as readonly number[]).includes(zoomPercent)

  /** 8 个手柄渲染：4 角方形 + 3 边矩形 + 顶边中点旋转圆钮。 */
  const handleStyle = (mode: string): CSSProperties => {
    const isCorner = TRANSFORM_CORNERS.some((corner) => mode === corner)
    const isEdge = TRANSFORM_EDGES.some((edge) => mode === edge)
    const w = isCorner ? HANDLE_SIZE : isEdge && (mode === 'left' || mode === 'right') ? EDGE_HANDLE_THIN_SIZE : EDGE_HANDLE_THICK_SIZE
    const h = isCorner ? HANDLE_SIZE : isEdge && (mode === 'bottom') ? EDGE_HANDLE_THIN_SIZE : EDGE_HANDLE_THICK_SIZE
    return {
      position: 'absolute', width: w, height: h, background: HANDLE_FILL,
      borderRadius: HANDLE_BORDER_RADIUS, pointerEvents: 'auto',
      cursor: getResizeCursor(box.rotation),
    }
  }
  const cornerPos = (corner: string): CSSProperties => {
    const x = corner.includes('left') ? box.left : box.left + box.width
    const y = corner.includes('top') ? box.top : box.top + box.height
    return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }
  }
  const edgePos = (edge: string): CSSProperties => {
    if (edge === 'left') return { left: `${box.left}%`, top: `${box.top + box.height / 2}%`, transform: 'translate(-50%, -50%)' }
    if (edge === 'right') return { left: `${box.left + box.width}%`, top: `${box.top + box.height / 2}%`, transform: 'translate(-50%, -50%)' }
    return { left: `${box.left + box.width / 2}%`, top: `${box.top + box.height}%`, transform: 'translate(-50%, -50%)' }
  }

  /** 手柄：18px 命中区包裹视觉方块，中心对齐（经典版 HANDLE_HIT_AREA_SIZE）。 */
  const renderHandle = (mode: string, pos: CSSProperties) => (
    <div key={mode} data-handle={mode} onMouseDown={(event) => startDrag(event, mode)}
      style={{
        position: 'absolute', ...pos, width: HANDLE_HIT_AREA_SIZE, height: HANDLE_HIT_AREA_SIZE,
        transform: `${(pos.transform as string) ?? ''}`.trim() || undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
        cursor: getResizeCursor(box.rotation),
      }}>
      <div style={{ width: handleStyle(mode).width, height: handleStyle(mode).height, background: HANDLE_FILL, borderRadius: HANDLE_BORDER_RADIUS }} />
    </div>
  )


  return (
    <section className="panel classic-panel" data-testid="classic-preview" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 视口：上/左/右 8px padding，底 0；画布居中 */}
      <div ref={viewportRef} style={{
        flex: 1, minHeight: 0, minWidth: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', padding: PREVIEW_VIEWPORT_PADDING_PX,
        paddingBottom: PREVIEW_VIEWPORT_PADDING_BOTTOM_PX,
        background: 'var(--background)',
      }} onWheel={onWheel} onContextMenu={openContextMenu}>
        <div ref={stageRef} data-testid="preview-stage" style={{
          position: 'relative', aspectRatio: '16 / 9',
          width: `${Math.min(100, 100 * zoom)}%`, height: '100%', maxWidth: '100%', maxHeight: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <canvas ref={props.canvasRef} width={props.frameWidth ?? 320} height={props.frameHeight ?? 180}
            style={{ width: '100%', height: '100%', objectFit: 'contain', border: '1px solid var(--border)', background: '#000' }} />
          {props.selected && (
            <div style={{ position: 'absolute', left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`, pointerEvents: 'none' }}>
              {/* 选框：SVG 白色描边 0.75 / 1px / non-scaling */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
                <rect x="0.5" y="0.5" width="99%" height="99%" fill="transparent"
                  stroke="white" strokeOpacity={SELECTION_STROKE_OPACITY}
                  strokeWidth={SELECTION_STROKE_WIDTH} vectorEffect="non-scaling-stroke" />
              </svg>
              {/* 拖拽移动整框 */}
              <div onMouseDown={(event) => startDrag(event, 'move')}
                style={{ position: 'absolute', inset: 0, cursor: 'move', pointerEvents: 'auto' }} />
              {/* 4 角 + 3 边手柄 */}
              {TRANSFORM_CORNERS.map((corner) => renderHandle(corner, cornerPos(corner)))}
              {TRANSFORM_EDGES.map((edge) => renderHandle(edge, edgePos(edge)))}
              {/* 旋转手柄：顶边中点外移 24px，直径 20px */}
              <div data-handle="rotate" title="Rotate"
                style={{
                  position: 'absolute', left: `${box.left + box.width / 2}%`, top: `${box.top}%`,
                  transform: 'translate(-50%, calc(-50% - ' + ROTATION_HANDLE_OFFSET + 'px))',
                  width: ICON_HANDLE_RADIUS * 2, height: ICON_HANDLE_RADIUS * 2,
                  borderRadius: '9999px', background: ICON_HANDLE_FILL, color: ICON_HANDLE_TEXT,
                  boxShadow: '0 1px 2px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'auto',
                }}><RotateIcon /></div>
              {/* 对齐参考线：1px 白 70% */}
              {snapLines.vertical && <div data-guide="vertical" style={{ position: 'absolute', left: '50%', top: -20, bottom: -20, width: SNAP_GUIDE_WIDTH, background: SNAP_GUIDE_COLOR }} />}
              {snapLines.horizontal && <div data-guide="horizontal" style={{ position: 'absolute', top: '50%', left: -20, right: -20, height: SNAP_GUIDE_WIDTH, background: SNAP_GUIDE_COLOR }} />}
            </div>
          )}
        </div>
      </div>
      {/* 三栏控制条：左时间码 / 中播放 / 右缩放 + 全屏 */}
      <div className="classic-preview-controls" style={{
        flex: '0 0 auto', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
        paddingTop: PREVIEW_TOOLBAR_PADDING_TOP_PX, paddingBottom: PREVIEW_TOOLBAR_PADDING_BOTTOM_PX,
        paddingLeft: PREVIEW_TOOLBAR_PADDING_X_PX, paddingRight: PREVIEW_TOOLBAR_PADDING_X_PX,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'monospace', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <input aria-label="Timecode" data-testid="preview-timecode-input"
            value={timecodeDraft ?? timecode}
            onChange={(event) => setTimecodeDraft(event.target.value)}
            onBlur={(event) => commitTimecode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { commitTimecode(event.currentTarget.value); event.currentTarget.blur() }
              else if (event.key === 'Escape') setTimecodeDraft(null)
            }}
            style={{ width: 78, color: 'var(--primary)', background: 'transparent',
              border: '1px solid transparent', borderRadius: 'var(--radius-sm)', padding: '1px 2px',
              fontFamily: 'inherit', fontSize: 'inherit', fontVariantNumeric: 'inherit' }} />
          <span style={{ color: 'var(--muted-foreground)' }}>/</span>
          <span style={{ color: 'var(--muted-foreground)' }}>{totalTimecode}</span>
          {props.timecode && <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>{props.timecode}</span>}
        </div>
        <button type="button" aria-label={props.playing ? 'Pause' : 'Play'} title={props.playing ? 'Pause' : 'Play'}
          onClick={props.onTogglePlay}
          style={{
            width: PREVIEW_ICON_BUTTON_SIZE_PX, height: PREVIEW_ICON_BUTTON_SIZE_PX,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent',
            color: 'var(--foreground)', cursor: 'pointer',
          }}><PlayIcon playing={props.playing} /></button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: PREVIEW_TOOLBAR_GAP_PX }}>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => applyZoom(zoom / PREVIEW_ZOOM_STEP)}
            style={{
              width: PREVIEW_ICON_BUTTON_SIZE_PX, height: PREVIEW_ICON_BUTTON_SIZE_PX,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent',
              color: 'var(--foreground)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}>−</button>
          <select aria-label="Zoom" value={Math.abs(zoom - 1) < 0.001 ? 'Fit' : String(zoomPercent)}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'Fit') applyZoom(1)
              else applyZoom(Number(value) / 100)
            }}
            style={{ background: 'var(--accent)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            <option value="Fit">{formatZoomLabel(1)}</option>
            {!zoomIsPreset && zoomPercent !== 100 && (
              <option value={String(zoomPercent)}>{zoomPercent}%</option>
            )}
            {PREVIEW_ZOOM_PRESETS.map((preset) => (
              <option key={preset} value={String(preset)}>{preset}%</option>
            ))}
          </select>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => applyZoom(zoom * PREVIEW_ZOOM_STEP)}
            style={{
              width: PREVIEW_ICON_BUTTON_SIZE_PX, height: PREVIEW_ICON_BUTTON_SIZE_PX,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent',
              color: 'var(--foreground)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}>＋</button>
          <button type="button" aria-label="Full screen" title="Full screen" onClick={toggleFullscreen}
            style={{
              width: PREVIEW_ICON_BUTTON_SIZE_PX, height: PREVIEW_ICON_BUTTON_SIZE_PX,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent',
              color: 'var(--foreground)', cursor: 'pointer',
            }}><FullscreenIcon /></button>
        </div>
      </div>
      {/* 批 4：预览右键菜单（Fit / Full screen / Save snapshot / Copy snapshot）。 */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setContextMenu(null)} />
          <div role="menu" data-testid="preview-context-menu" className="classic-menu"
            style={{
              position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 100,
              minWidth: CONTEXT_MENU_MIN_WIDTH_PX, padding: CONTEXT_MENU_PADDING_PX,
              background: 'var(--popover)', color: 'var(--popover-foreground)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              boxShadow: '0 4px 12px rgba(0,0,0,.2)',
            }}>
            {CONTEXT_MENU_PREVIEW_ITEMS.map((item) => (
              <button key={item} type="button" role="menuitem" data-testid={`preview-menu-${item}`}
                onClick={() => runContextAction(item)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: `${CONTEXT_MENU_ITEM_PADDING_Y_PX}px ${CONTEXT_MENU_ITEM_PADDING_X_PX}px`,
                  border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent',
                  color: 'inherit', cursor: 'pointer', fontSize: 'var(--text-sm)',
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--accent)' }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}>
                {item}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
