/**
 * 编辑器共享 UI 片段与配置（W-08 / W-09）：样式常量、时间轴组件与导出配置。
 * 从 `routes/editor.tsx` 抽离，保持单个代码文件不超过 500 行。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react'

import type { DiscoverResult, EditorAdapter, ProjectView } from './editor-adapter'
import type { TimelineClip } from './timeline'
import type { WebCodecsSupport } from './webcodecs'

/** 预览帧尺寸（同时是代理帧尺寸）。 */
export const PREVIEW_WIDTH = 320
export const PREVIEW_HEIGHT = 180

/** 深色面板内的主文字色 / 次要文字色。 */
export const TEXT_MAIN = '#e5e7eb'
export const TEXT_MUTED = '#94a3b8'

export const PANEL_STYLE: CSSProperties = {
  background: '#111827',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  color: TEXT_MAIN,
}
export const BUTTON_STYLE: CSSProperties = {
  background: '#334155',
  color: TEXT_MAIN,
  border: '1px solid #475569',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 13,
  cursor: 'pointer',
  display: 'inline-block',
}
const TRACK_STYLE: CSSProperties = {
  position: 'relative',
  height: 36,
  background: '#1f2937',
  borderRadius: 6,
  overflow: 'hidden',
}

/** core 导出配置基线；帧率在载入项目后补齐。 */
export const BASE_PROFILE: Record<string, unknown> = {
  container: 'mp4',
  codec: 'avc',
  width: PREVIEW_WIDTH,
  height: PREVIEW_HEIGHT,
  videoBitrateBps: 1_000_000,
  includeAudio: false,
  audioSampleRateHz: 48000,
  audioChannels: 2,
}

/** core 合成帧参数：深蓝底 + 半透明橙色前景矩形。 */
export const DEMO_PARAMS = {
  backgroundRgba: [17, 24, 39, 255],
  accentRgba: [249, 115, 22, 255],
  opacity: 0.65,
  positionX: 0.5,
  positionY: 0.5,
}

/** W-09 量化阈值：单帧预览合成耗时不超过 16ms（60fps）。 */
export const SCRUB_THRESHOLD_MS = 16

/** 预览画布与播放头：绘制由编辑器页面的副作用驱动，这里只承载交互与展示。 */
export function PreviewSection(props: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  playing: boolean
  onTogglePlay: () => void
  frameIndex: number
  frameCount: number
  onSeek: (frameIndex: number) => void
  footer: string
}) {
  return (
    <section style={PANEL_STYLE}>
      <h2 style={{ fontSize: 16, marginBottom: 8, color: TEXT_MAIN }}>预览与播放头</h2>
      <canvas ref={props.canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}
        style={{ borderRadius: 6, border: '1px solid #334155', display: 'block' }} />
      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={BUTTON_STYLE} onClick={props.onTogglePlay}>
          {props.playing ? '暂停' : '播放'}
        </button>
        <input type="range" min={0} max={Math.max(props.frameCount - 1, 0)}
          value={Math.min(props.frameIndex, props.frameCount - 1)}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          style={{ flex: 1, minWidth: 200 }} aria-label="播放头" />
        <span style={{ color: TEXT_MUTED, fontSize: 13, whiteSpace: 'nowrap' }}>{props.footer}</span>
      </div>
    </section>
  )
}

/** 项目信息摘要：只读展示经典版项目与 core 能力。 */
export function ProjectSummary(props: { session: Session; trackCount: number }) {
  const { session } = props
  return (
    <section style={PANEL_STYLE}>
      <h2 style={{ fontSize: 16, marginBottom: 8, color: TEXT_MAIN }}>项目（经典版 v{session.project.version}）</h2>
      <p style={{ fontSize: 13, margin: '4px 0', color: TEXT_MAIN }}>
        {session.project.name} · {session.project.sceneCount} 场景 / {props.trackCount} 轨道 ·
        兼容提示 {session.project.warnings.length} 条
      </p>
      <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '4px 0' }}>
        {session.project.fps.numerator}/{session.project.fps.denominator} fps ·{' '}
        {session.project.canvas.width}×{session.project.canvas.height} ·
        API {session.info.apiVersion} / {session.info.backendId} ·
        WebCodecs {session.codecs.available ? '可用' : '不可用'}
      </p>
    </section>
  )
}

/** 工具栏动作描述。 */
export interface ToolbarAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

/** 工具栏：文件输入、动作按钮、状态信息与下载链接。 */
export function ToolbarSection(props: {
  projectFileRef: RefObject<HTMLInputElement | null>
  videoFileRef: RefObject<HTMLInputElement | null>
  otioFileRef: RefObject<HTMLInputElement | null>
  onDropFile: (file?: File) => void
  onOtioFile: (file?: File) => void
  actions: ToolbarAction[]
  sourceName: string
  mediaStatus: string
  cacheInfo: string
  historyLabel: string
  benchmarkInfo: string
  proxyUrl: string | null
  otioUrl: string | null
  exportState: ExportState
}) {
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        props.onDropFile(event.dataTransfer.files[0])
      }}
      style={{ ...PANEL_STYLE, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <label style={BUTTON_STYLE}>
        导入项目 JSON
        <input ref={props.projectFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(event) => props.onDropFile(event.target.files?.[0])} />
      </label>
      <label style={BUTTON_STYLE}>
        导入视频素材
        <input ref={props.videoFileRef} type="file" accept="video/*,.mp4,.webm" style={{ display: 'none' }}
          onChange={(event) => props.onDropFile(event.target.files?.[0])} />
      </label>
      {props.actions.map((action) => (
        <button key={action.label} type="button" style={BUTTON_STYLE}
          onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </button>
      ))}
      <label style={BUTTON_STYLE}>
        导入 OTIO
        <input ref={props.otioFileRef} type="file" accept=".otio,application/json" style={{ display: 'none' }}
          onChange={(event) => props.onOtioFile(event.target.files?.[0])} />
      </label>
      <span style={{ color: TEXT_MUTED, fontSize: 13 }}>当前：{props.sourceName} · {props.mediaStatus}</span>
      <span style={{ color: TEXT_MUTED, fontSize: 13 }}>{props.cacheInfo}</span>
      <span style={{ color: TEXT_MUTED, fontSize: 13 }}>{props.historyLabel}</span>
      {props.benchmarkInfo && (
        <span style={{ color: '#7dd3fc', fontSize: 13 }}>4K 基准：{props.benchmarkInfo}</span>
      )}
      {props.proxyUrl && (
        <a href={props.proxyUrl} download="opencut-proxy.mp4" style={{ color: '#7dd3fc', fontSize: 13 }}>
          下载代理 MP4
        </a>
      )}
      {props.otioUrl && (
        <a href={props.otioUrl} download="opencut-timeline.otio" style={{ color: '#7dd3fc', fontSize: 13 }}>
          下载 OTIO
        </a>
      )}
      {props.exportState.status === 'running' && (
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>编码中 {props.exportState.done}/{props.exportState.total}</span>
      )}
      {props.exportState.status === 'done' && props.exportState.url && (
        <a href={props.exportState.url} download={props.exportState.filename ?? 'opencut-export.mp4'} style={{ color: '#7dd3fc', fontSize: 13 }}>
          下载 {props.exportState.filename?.includes('-av1') ? 'AV1 WebM' : props.exportState.filename?.endsWith('.webm') ? 'WebM' : 'MP4'}（{props.exportState.message} · {props.exportState.bytes} 字节）
        </a>
      )}
      {props.exportState.status === 'error' && (
        <span style={{ color: '#fca5a5', fontSize: 13 }}>{props.exportState.message}</span>
      )}
    </div>
  )
}

/** 时间轴面板：导入前/后对照、片段选中与一组剪辑动作按钮。 */
export function TimelineSection(props: {
  originalElements: CoreElement[]
  elements: CoreElement[]
  selectedId: string | null
  onSelect: (id: string) => void
  actions: Array<{ label: string; onClick: () => void; disabled?: boolean }>
  statusText: string
  adjustments: RippleAdjustment[]
  onMoveClip?: (clipId: string, proposedStart: number) => void
  onResizeClip?: (clipId: string, edge: 'left' | 'right', deltaTicks: number) => void
}) {
  return (
    <section style={PANEL_STYLE}>
      <h2 style={{ fontSize: 16, marginBottom: 8, color: TEXT_MAIN }}>时间轴（点击片段选中）</h2>
      <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '0 0 6px' }}>导入时</p>
      <Timeline elements={props.originalElements} selectedId={null} />
      <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '10px 0 6px' }}>当前</p>
      <Timeline elements={props.elements} selectedId={props.selectedId}
        onSelect={props.onSelect} onMoveClip={props.onMoveClip} onResizeClip={props.onResizeClip} />
      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {props.actions.map((action) => (
          <button key={action.label} type="button" style={BUTTON_STYLE}
            onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </button>
        ))}
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>{props.statusText}</span>
      </div>
      {props.adjustments.length > 0 && (
        <pre style={{ fontSize: 12, color: '#a5b4fc', marginTop: 12, marginBottom: 0 }}>
          {JSON.stringify(props.adjustments, null, 2)}
        </pre>
      )}
    </section>
  )
}

/** 时间轴片段：在 core 的 TimedElement 之外额外携带素材裁剪起点。 */
export interface CoreElement extends TimelineClip {
  id: string
  startTime: number
  duration: number
  trimStart: number
}

/** core ripple 计算出的单条位移建议。 */
export interface RippleAdjustment {
  trackId: string
  afterTime: number
  shiftAmount: number
}

/** `rippleAdjustments` 求值的响应。 */
export interface RippleResponse {
  adjustments: RippleAdjustment[]
}

/** `rippleApply` 求值的响应。 */
export interface ApplyResponse {
  tracks: { main: { elements: CoreElement[] } }
}

/** `buildFramePlan` 求值的响应。 */
export interface FramePlanView {
  frameCount: number
  ticksPerFrame: number
}

/** 一次编辑会话：适配层、项目视图、帧率与导出配置基线。 */
export interface Session {
  adapter: EditorAdapter
  project: ProjectView
  info: DiscoverResult
  codecs: WebCodecsSupport
  fps: number
  ticksPerFrame: number
  profile: Record<string, unknown>
  projectTrackCount: number
}

/** MP4 导出进度与结果状态。 */
export interface ExportState {
  status: 'idle' | 'running' | 'done' | 'error'
  done: number
  total: number
  message: string
  url: string | null
  bytes: number
  /** 目标下载文件名；缺省按 MP4。 */
  filename?: string
}

/** 空档帧：不透明黑底，交给 core 叠加图层。 */
export function blankFrame(): Uint8Array {
  const pixels = new Uint8Array(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4)
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
  return pixels
}

/**
 * 可点击的时间轴：按 ticks 归一化定位，选中片段后可执行删除/分割。
 * @param props 元素、选中项与回调
 * @returns {React.ReactElement} 时间轴
 */
/** 拖拽中的鼠标位移记录（像素 → ticks 换算所需的上下文）。 */
type DragMode = 'move' | 'left' | 'right'

interface ClipDrag {
  id: string
  mode: DragMode
  startX: number
  startTicks: number
  origDuration: number
  total: number
  width: number
  proposed: number
  delta: number
}

/** 边缘把手样式：窄条、横向缩放光标、覆盖在片段之上。 */
const HANDLE_STYLE: CSSProperties = {
  position: 'absolute', top: 0, bottom: 0, width: 8, cursor: 'ew-resize',
  background: 'rgba(255,255,255,.28)',
}

export function Timeline(props: {
  elements: CoreElement[]
  selectedId: string | null
  onSelect?: (id: string) => void
  /** 提供时启用整段拖拽；松开鼠标提交目标起点，重叠约束由调用方处理。 */
  onMoveClip?: (clipId: string, proposedStart: number) => void
  /** 提供时启用边缘裁剪；提交边缘与位移量，约束由调用方处理。 */
  onResizeClip?: (clipId: string, edge: 'left' | 'right', deltaTicks: number) => void
}) {
  const total = Math.max(...props.elements.map((item) => item.startTime + item.duration), 1)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<ClipDrag | null>(null)
  const moveRef = useRef(props.onMoveClip)
  const resizeRef = useRef(props.onResizeClip)
  const [preview, setPreview] = useState<{ id: string; start: number; duration: number } | null>(null)
  moveRef.current = props.onMoveClip
  resizeRef.current = props.onResizeClip

  /** 开始一次拖拽；边缘把手会阻止冒泡以免触发整段平移。 */
  const startDrag = (event: ReactMouseEvent, element: CoreElement, mode: DragMode) => {
    if (mode === 'move' && !props.onMoveClip) return
    if (mode !== 'move' && !props.onResizeClip) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      id: element.id, mode,
      startX: event.clientX, startTicks: element.startTime,
      origDuration: element.duration, total,
      width: trackRef.current?.getBoundingClientRect().width ?? 1,
      proposed: element.startTime, delta: 0,
    }
  }

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = Math.round(((event.clientX - drag.startX) / drag.width) * drag.total)
      drag.delta = delta
      if (drag.mode === 'move') {
        drag.proposed = Math.max(0, drag.startTicks + delta)
        setPreview({ id: drag.id, start: drag.proposed, duration: drag.origDuration })
      } else {
        const shown = drag.origDuration + (drag.mode === 'right' ? delta : -delta)
        setPreview({ id: drag.id, start: drag.startTicks, duration: Math.max(1, shown) })
      }
    }
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setPreview(null)
      if (drag.mode === 'move' && drag.proposed !== drag.startTicks) {
        moveRef.current?.(drag.id, drag.proposed)
      } else if (drag.mode !== 'move' && drag.delta !== 0) {
        resizeRef.current?.(drag.id, drag.mode, drag.delta)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  return (
    <div ref={trackRef} style={TRACK_STYLE}>
      {props.elements.map((element) => {
        const shownStart = preview?.id === element.id ? preview.start : element.startTime
        const shownDuration = preview?.id === element.id ? preview.duration : element.duration
        return (
          <div
            key={element.id}
            onClick={() => props.onSelect?.(element.id)}
            onMouseDown={(event) => startDrag(event, element, 'move')}
            title={`${element.id}: ${element.startTime} + ${element.duration} ticks, trim=${element.trimStart}`}
            style={{
              position: 'absolute',
              left: `${(shownStart / total) * 100}%`,
              width: `${(shownDuration / total) * 100}%`,
              height: '100%',
              background: element.id.includes('intro') || element.id.includes('title')
                ? '#6366f1'
                : '#22c55e',
              color: '#ffffff',
              fontSize: 12,
              padding: '8px 6px',
              boxSizing: 'border-box',
              borderRight: '1px solid #111827',
              outline: props.selectedId === element.id ? '2px solid #fbbf24' : 'none',
              outlineOffset: -2,
              cursor: props.onMoveClip ? (preview ? 'grabbing' : 'grab') : (props.onSelect ? 'pointer' : 'default'),
            }}
          >
            {props.onResizeClip && (
              <>
                <div data-edge="left" title="拖动左边缘裁剪入点" style={{ ...HANDLE_STYLE, left: 0 }}
                  onMouseDown={(event) => startDrag(event, element, 'left')} />
                <div data-edge="right" title="拖动右边缘裁剪出点" style={{ ...HANDLE_STYLE, right: 0 }}
                  onMouseDown={(event) => startDrag(event, element, 'right')} />
              </>
            )}
            {element.id}
          </div>
        )
      })}
    </div>
  )
}
