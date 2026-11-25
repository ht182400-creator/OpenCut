/**
 * 经典版 UI 像素级 1:1 改造 · 批 5 预览交互（本地重写，不拷贝经典版 React/zustand 源码）。
 *
 * 结构对照经典版 `preview/components/`：
 * - 视口（上/左/右 8px padding、底 0）+ 居中 16:9 画布 + 分层 overlay
 * - 选框 SVG（白色描边 0.75 / 1px）+ 8 手柄（4 角 10px + 3 边 6×14 + 旋转 20px）+ 对齐参考线（1px 白 70%）
 * - 三栏控制条：左时间码 HH:MM:SS:FF / 中播放暂停 28px / 右缩放（Fit + 6 预设）+ 全屏
 *
 * 边界：第二档起选框/手柄由 core transform 派生，拖拽松手写回 position/scale/rotate
 * （经 onTransformChange → patchElementParams），真正驱动合成；对齐参考线仍为视觉反馈。
 * 时间码由 frameIndex/fps 计算；画布分辨率可配置（frameWidth/frameHeight，默认 320×180）。
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
import { resizeMask, type ElementTransform, type RectMask } from '../element-composite';
import {
  NO_SNAP_GUIDES,
  boxFromTransform,
  pointerAngleDeg,
  rotateByPointer,
  snapBoxToCanvas,
  transformFromBox,
  type SnapGuides,
} from './preview-transform-model';

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
  /** 是否选中元素：选中时画布上叠加选框与手柄（第二档起可拖拽写回 transform）。 */
  selected?: boolean
  /** 批 7.2：画布内部分辨率（RGBA 像素缓冲尺寸），默认 320×180。 */
  frameWidth?: number
  frameHeight?: number
  /** 批 5（P4）：选中元素的矩形遮罩（归一化 0..1），启用时叠加可拖拽手柄。 */
  mask?: RectMask
  /** 批 5（P4）：遮罩拖拽变更回调（写回元素 mask.* 参数）。 */
  onMaskChange?: (mask: RectMask) => void
  /** 第二档：选中元素的 core 变换参数（选框初始位置/尺寸/旋转来源）。 */
  transform?: ElementTransform
  /** 第二档：变换拖拽提交回调（松手一次性写回 position/scale/rotate）。 */
  onTransformChange?: (transform: ElementTransform) => void
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
 * 预览画布 + 选框/手柄/参考线 + 三栏控制条（1:1 视觉结构，变换拖拽写回 core）。
 * @param props 画布 ref、播放状态、帧信息与回调
 * @returns {React.ReactElement} 预览面板
 */
export function PreviewSection(props: PreviewSectionProps) {
  const [zoom, setZoom] = useState(1)
  /** 第二档：选框由元素 core transform 派生（无 transform 时用满幅占位）。 */
  const [box, setBox] = useState<LocalBox>(() => props.transform
    ? boxFromTransform(props.transform, props.frameWidth ?? 320, props.frameHeight ?? 180)
    : INITIAL_BOX)
  /** U-04：参考线含画布百分比位置，不再固定画在中心。 */
  const [snapLines, setSnapLines] = useState<SnapGuides>(NO_SNAP_GUIDES)
  /** 批 4：可编辑时间码的输入草稿（回车/失焦提交）。 */
  const [timecodeDraft, setTimecodeDraft] = useState<string | null>(null)
  /** 批 4：右键菜单开关与屏幕坐标。 */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  /** 批 5：遮罩手柄拖拽起点（像素 + 原始遮罩）。 */
  const maskDragRef = useRef<{ edge: string; startX: number; startY: number; width: number; height: number; orig: RectMask } | null>(null)
  const dragRef = useRef<{
    mode: string; startX: number; startY: number; orig: LocalBox
    /** 旋转拖拽起点：指针角度与元素角度（仅 mode=rotate 用）。 */
    startAngle?: number; startRotation?: number
  } | null>(null)
  /** 第二档：写回回调用 ref 保持最新，避免空依赖 effect 的 stale closure。 */
  const transformChangeRef = useRef(props.onTransformChange)
  transformChangeRef.current = props.onTransformChange
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // 第二档：选中元素变化或外部 core transform 更新时，同步选框（拖拽中不重置）。
  useEffect(() => {
    if (dragRef.current) return
    setBox(props.transform
      ? boxFromTransform(props.transform, props.frameWidth ?? 320, props.frameHeight ?? 180)
      : INITIAL_BOX)
    setSnapLines(NO_SNAP_GUIDES)
  }, [props.selected, props.transform, props.frameWidth, props.frameHeight])

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

  /**
   * 手柄拖拽起点：旋转模式额外记录指针角度与元素角度，供最短角差计算。
   * @param event 鼠标事件
   * @param mode 拖拽模式（move / 角 / 边 / rotate）
   */
  const startDrag = (event: ReactMouseEvent, mode: string) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = stageRef.current?.getBoundingClientRect()
    const rotateMode = mode === 'rotate' && rect
      ? {
          startAngle: pointerAngleDeg(
            rect.left + (box.left + box.width / 2) / 100 * rect.width,
            rect.top + (box.top + box.height / 2) / 100 * rect.height,
            event.clientX, event.clientY,
          ),
          startRotation: box.rotation,
        }
      : {}
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, orig: { ...box }, ...rotateMode }
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
      } else if (drag.mode === 'rotate' && rect && drag.startAngle !== undefined) {
        const centerX = rect.left + (orig.left + orig.width / 2) / 100 * rect.width
        const centerY = rect.top + (orig.top + orig.height / 2) / 100 * rect.height
        const currentAngle = pointerAngleDeg(centerX, centerY, event.clientX, event.clientY)
        next.rotation = rotateByPointer(drag.startAngle, currentAngle, drag.startRotation ?? 0)
      }
      // U-04：三锚点吸附（左/中/右、上/中/下），横纵阈值分别按视口宽高换算；
      // 旋转模式只改角度、不移动选框，故不参与位置吸附。
      if (drag.mode === 'rotate') {
        setSnapLines(NO_SNAP_GUIDES)
      } else {
        const thresholdX = (SNAP_THRESHOLD_SCREEN_PIXELS / rect.width) * 100
        const thresholdY = (SNAP_THRESHOLD_SCREEN_PIXELS / rect.height) * 100
        const snapped = snapBoxToCanvas(next, thresholdX, thresholdY)
        next = snapped.box
        setSnapLines(snapped.guides)
      }
      setBox(next)
    }
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setSnapLines(NO_SNAP_GUIDES)
      // 第二档：松手一次性写回 core，避免拖拽每帧触发快照灌满撤销栈。
      if (!transformChangeRef.current) return
      try {
        setBox((current) => {
          // 用最新 box 计算变换并写回；box 与 drag.orig 相同（未拖动）时也提交，
          // 由 patchElementParams 的引用比较去重，不会产生额外快照。
          transformChangeRef.current?.(transformFromBox(current, props.frameWidth ?? 320, props.frameHeight ?? 180))
          return current
        })
      } catch (error) {
        console.error('[preview] 变换写回异常', error)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 批 5：遮罩手柄拖拽（props 用 ref 保持最新，避免空依赖 effect 的 stale closure）。
  const maskChangeRef = useRef(props.onMaskChange)
  maskChangeRef.current = props.onMaskChange
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = maskDragRef.current
      if (!drag || drag.width <= 0 || drag.height <= 0) return
      const dxNorm = (event.clientX - drag.startX) / drag.width
      const dyNorm = (event.clientY - drag.startY) / drag.height
      maskChangeRef.current?.(resizeMask(drag.orig, drag.edge as 'left' | 'top' | 'right' | 'bottom', dxNorm, dyNorm))
    }
    const onUp = () => { maskDragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  /**
   * 批 5：开始拖拽遮罩某一边。
   * @param event 鼠标事件
   * @param edge 边
   */
  const startMaskDrag = (event: ReactMouseEvent, edge: 'left' | 'top' | 'right' | 'bottom') => {
    if (!props.mask) return
    event.stopPropagation()
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    maskDragRef.current = {
      edge, startX: event.clientX, startY: event.clientY,
      width: rect.width, height: rect.height, orig: { ...props.mask },
    }
  }

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
          {/* 批 5：遮罩矩形 + 4 边拖拽手柄（仅启用时显示，驱动 mask.* 参数）。 */}
          {props.mask?.enabled && (
            <div data-testid="preview-mask-overlay" style={{
              position: 'absolute',
              left: `${props.mask.left * 100}%`, top: `${props.mask.top * 100}%`,
              width: `${(props.mask.right - props.mask.left) * 100}%`,
              height: `${(props.mask.bottom - props.mask.top) * 100}%`,
              border: '1px dashed var(--primary)', pointerEvents: 'none',
            }}>
              {(['left', 'top', 'right', 'bottom'] as const).map((edge) => (
                <div key={edge} data-mask-handle={edge} title={`Mask ${edge}`}
                  onMouseDown={(event) => startMaskDrag(event, edge)}
                  style={{
                    position: 'absolute',
                    ...(edge === 'left' ? { left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }
                      : edge === 'right' ? { right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }
                      : edge === 'top' ? { top: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize' }
                      : { bottom: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize' }),
                    background: 'color-mix(in srgb, var(--primary) 60%, transparent)', pointerEvents: 'auto',
                  }} />
              ))}
            </div>
          )}
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
              {/* 旋转手柄：顶边中点外移 24px；框贴顶时用 max 夹在可见区内，避免被 overflow:hidden 裁掉 */}
              <div data-handle="rotate" title="Rotate" onMouseDown={(event) => startDrag(event, 'rotate')}
                style={{
                  position: 'absolute', left: `${box.left + box.width / 2}%`,
                  top: `max(calc(${box.top}% - ${ROTATION_HANDLE_OFFSET}px), ${ICON_HANDLE_RADIUS}px)`,
                  transform: 'translate(-50%, -50%)',
                  width: ICON_HANDLE_RADIUS * 2, height: ICON_HANDLE_RADIUS * 2,
                  borderRadius: '9999px', background: ICON_HANDLE_FILL, color: ICON_HANDLE_TEXT,
                  boxShadow: '0 1px 2px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'auto',
                }}><RotateIcon /></div>
            </div>
          )}
          {/* U-04：参考线画在画布坐标系（stage 层），位置来自吸附锚点，不再固定画在选框中心 */}
          {props.selected && snapLines.vertical && (
            <div data-guide="vertical" style={{
              position: 'absolute', left: `${snapLines.verticalAt}%`, top: 0, bottom: 0,
              width: SNAP_GUIDE_WIDTH, background: SNAP_GUIDE_COLOR, pointerEvents: 'none',
            }} />
          )}
          {props.selected && snapLines.horizontal && (
            <div data-guide="horizontal" style={{
              position: 'absolute', top: `${snapLines.horizontalAt}%`, left: 0, right: 0,
              height: SNAP_GUIDE_WIDTH, background: SNAP_GUIDE_COLOR, pointerEvents: 'none',
            }} />
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
