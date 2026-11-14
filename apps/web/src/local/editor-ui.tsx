/**
 * 编辑器共享 UI 片段与配置（W-08 / W-09 / UI 同步第一批）。
 *
 * UI 同步第一批（经典版信息架构）：`TopBar`（项目 + 撤销重做 + 导出）、
 * `MediaPanel`（左栏素材与导入）、`PropertiesPanel`（右栏选中片段属性）、
 * `DiagnosticsPanel`（折叠的诊断与高级工具）；调试信息不再平铺在主界面。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react'

import { SHORTCUT_HELP } from './editor-shortcuts'
import type { DiscoverResult, EditorAdapter, ProjectView } from './editor-adapter'
import { CONTAINER_LABELS } from './export-settings'
import type { ExportContainerChoice, ExportSettings } from './export-settings'
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

/** UI 同步第一批：工作区三栏与顶栏布局。 */
export const SURFACE_STYLE: CSSProperties = {
  minHeight: '100vh',
  background: '#0b1220',
  color: TEXT_MAIN,
  padding: '0 16px 24px',
}
export const TOPBAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap',
  padding: '10px 0',
  borderBottom: '1px solid #1f2937',
  marginBottom: 12,
}
export const WORKSPACE_STYLE: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'stretch',
  flexWrap: 'wrap',
}
export const COLUMN_STYLE: CSSProperties = {
  ...PANEL_STYLE,
  flex: '1 1 260px',
  minWidth: 240,
  marginBottom: 12,
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

/** 顶栏：项目名、撤销重做与导出组（含导出状态与下载链接）。 */
export function TopBar(props: {
  projectName: string
  projectVersion: number
  sceneCount: number
  trackCount: number
  actions: ToolbarAction[]
  onExport: () => void
  exportDisabled?: boolean
  onToggleSettings: () => void
  settingsOpen: boolean
  exportState: ExportState
  otioUrl: string | null
}) {
  return (
    <header style={TOPBAR_STYLE}>
      <strong style={{ fontSize: 17 }}>OpenCut Editor</strong>
      <span style={{ color: TEXT_MUTED, fontSize: 13 }}>
        {props.projectName} · 经典版 v{props.projectVersion} · {props.sceneCount} 场景 / {props.trackCount} 轨道
      </span>
      <span style={{ flex: 1 }} />
      {props.actions.map((action) => (
        <button key={action.label} type="button" style={BUTTON_STYLE}
          onClick={action.onClick} disabled={action.disabled}>{action.label}</button>
      ))}
      <button type="button" style={BUTTON_STYLE}
        onClick={props.onToggleSettings}>{props.settingsOpen ? '收起设置' : '导出设置'}</button>
      <button type="button" style={{ ...BUTTON_STYLE, background: '#1d4ed8', borderColor: '#3b82f6' }}
        onClick={props.onExport} disabled={props.exportDisabled}>导出</button>
      {props.exportState.status === 'running' && (
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>编码中 {props.exportState.done}/{props.exportState.total}</span>
      )}
      {props.exportState.status === 'done' && props.exportState.url && (
        <a href={props.exportState.url} download={props.exportState.filename ?? 'opencut-export.mp4'} style={{ color: '#7dd3fc', fontSize: 13 }}>
          下载 {props.exportState.filename?.includes('-av1') ? 'AV1 WebM' : props.exportState.filename?.endsWith('.webm') ? 'WebM' : 'MP4'}
        </a>
      )}
      {props.exportState.status === 'error' && (
        <span style={{ color: '#fca5a5', fontSize: 13 }}>{props.exportState.message}</span>
      )}
      {props.otioUrl && (
        <a href={props.otioUrl} download="opencut-timeline.otio" style={{ color: '#7dd3fc', fontSize: 13 }}>下载 OTIO</a>
      )}
    </header>
  )
}

/** 左栏素材库：项目/素材/OTIO 导入、拖放与演示素材。 */
export function MediaPanel(props: {
  projectFileRef: RefObject<HTMLInputElement | null>
  videoFileRef: RefObject<HTMLInputElement | null>
  otioFileRef: RefObject<HTMLInputElement | null>
  onDropFile: (file?: File) => void
  onOtioFile: (file?: File) => void
  onDemo: () => void
  sourceName: string
  mediaStatus: string
}) {
  return (
    <section
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        props.onDropFile(event.dataTransfer.files[0])
      }}
      style={COLUMN_STYLE}
    >
      <h2 style={{ fontSize: 15, margin: '0 0 10px', color: TEXT_MAIN }}>素材</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        <label style={BUTTON_STYLE}>
          导入 OTIO
          <input ref={props.otioFileRef} type="file" accept=".otio,application/json" style={{ display: 'none' }}
            onChange={(event) => props.onOtioFile(event.target.files?.[0])} />
        </label>
        <button type="button" style={BUTTON_STYLE} onClick={props.onDemo}>生成演示素材</button>
      </div>
      <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '10px 0 0' }}>
        当前：{props.sourceName}
        <br />
        {props.mediaStatus}
      </p>
      <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '6px 0 0' }}>支持把视频文件拖放到本面板。</p>
    </section>
  )
}

/** 属性面板可编辑的片段字段（ticks）。 */
export interface ClipPatch {
  startTime?: number
  duration?: number
  trimStart?: number
  trimEnd?: number
}

const EDITABLE_FIELDS: Array<{ key: keyof ClipPatch; label: string }> = [
  { key: 'startTime', label: '开始 (ticks)' },
  { key: 'duration', label: '时长 (ticks)' },
  { key: 'trimStart', label: '入点 (ticks)' },
  { key: 'trimEnd', label: '出点 (ticks)' },
]

const INPUT_STYLE: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#0b1220', color: TEXT_MAIN,
  border: '1px solid #475569', borderRadius: 4, padding: '4px 6px', fontSize: 12,
}

function draftOf(selected: CoreElement | null): Record<keyof ClipPatch, string> {
  return {
    startTime: String(selected?.startTime ?? 0),
    duration: String(selected?.duration ?? 0),
    trimStart: String(selected?.trimStart ?? 0),
    trimEnd: String(selected?.trimEnd ?? 0),
  }
}

/** 右栏属性检查器：选中片段的可编辑属性（UI 第三批）。 */
export function PropertiesPanel(props: {
  selected: CoreElement | null
  onChange?: (patch: ClipPatch) => void
}) {
  const selected = props.selected
  const [draft, setDraft] = useState<Record<keyof ClipPatch, string>>(() => draftOf(selected))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(draftOf(selected))
    setError(null)
  }, [selected])
  return (
    <section style={COLUMN_STYLE}>
      <h2 style={{ fontSize: 15, margin: '0 0 10px', color: TEXT_MAIN }}>属性</h2>
      {!selected && <p style={{ fontSize: 13, color: TEXT_MUTED, margin: 0 }}>在时间轴点击片段查看属性。</p>}
      {selected && (
        <>
          <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '0 0 8px' }}>id：{selected.id}</p>
          <table style={{ fontSize: 13, color: TEXT_MAIN, borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {EDITABLE_FIELDS.map(({ key, label }) => (
                <tr key={key}>
                  <td style={{ padding: '3px 8px 3px 0', color: TEXT_MUTED, whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ padding: 3, width: '55%' }}>
                    <input type="number" min={0} step={1000} aria-label={label} value={draft[key]}
                      style={INPUT_STYLE}
                      onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p style={{ fontSize: 12, color: '#fca5a5', margin: '8px 0 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" style={BUTTON_STYLE} disabled={!props.onChange} onClick={() => {
              const patch: ClipPatch = {}
              for (const { key } of EDITABLE_FIELDS) {
                const value = Number(draft[key])
                if (!Number.isFinite(value) || value < 0) {
                  setError('字段必须是非负数字')
                  return
                }
                patch[key] = Math.round(value)
              }
              setError(null)
              props.onChange?.(patch)
            }}>应用修改</button>
            <button type="button" style={BUTTON_STYLE} onClick={() => { setDraft(draftOf(selected)); setError(null) }}>重置</button>
          </div>
        </>
      )}
    </section>
  )
}

/** 导出设置面板（UI 第三批）：容器、音轨、码率与快捷键说明。 */
export function ExportSettingsPanel(props: {
  open: boolean
  settings: ExportSettings
  onChange: (settings: ExportSettings) => void
  onExport: () => void
  exportDisabled?: boolean
  resolution: string
}) {
  if (!props.open) return null
  const settings = props.settings
  return (
    <section style={{ ...PANEL_STYLE, marginTop: 8 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 10px', color: TEXT_MAIN }}>导出设置</h2>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          容器
          <select aria-label="导出容器" value={settings.container}
            style={{ ...INPUT_STYLE, width: 'auto' }}
            onChange={(event) => props.onChange({
              ...settings, container: event.target.value as ExportContainerChoice,
            })}>
            {(Object.keys(CONTAINER_LABELS) as ExportContainerChoice[]).map((key) => (
              <option key={key} value={key}>{CONTAINER_LABELS[key]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={settings.includeAudio}
            onChange={(event) => props.onChange({ ...settings, includeAudio: event.target.checked })} />
          包含音轨
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          码率 (bps)
          <input type="number" min={1} step={100000} aria-label="导出码率"
            value={settings.bitrateBps}
            style={{ ...INPUT_STYLE, width: 110 }}
            onChange={(event) => props.onChange({
              ...settings, bitrateBps: Math.max(1, Number(event.target.value) || 1),
            })} />
        </label>
        <span style={{ color: TEXT_MUTED, fontSize: 12 }}>
          分辨率 {props.resolution}（由 core 帧源固定，暂不可改）
        </span>
        <button type="button" style={{ ...BUTTON_STYLE, background: '#1d4ed8', borderColor: '#3b82f6' }}
          onClick={props.onExport} disabled={props.exportDisabled}>开始导出</button>
      </div>
      <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '10px 0 0' }}>快捷键：{SHORTCUT_HELP}</p>
    </section>
  )
}

/** 折叠的诊断与高级工具：缓存、基准、剪辑历史、代理文件与 core 信息。 */
export function DiagnosticsPanel(props: { items: Array<{ label: string; value: string }>; proxyUrl: string | null }) {
  return (
    <details style={{ ...PANEL_STYLE, padding: '10px 16px' }}>
      <summary style={{ cursor: 'pointer', color: TEXT_MUTED, fontSize: 13 }}>诊断与高级工具</summary>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {props.items.map((item) => (
          <span key={item.label} style={{ fontSize: 12, color: TEXT_MUTED }}>
            {item.label}：{item.value}
          </span>
        ))}
        {props.proxyUrl && (
          <a href={props.proxyUrl} download="opencut-proxy.mp4" style={{ color: '#7dd3fc', fontSize: 12 }}>
            下载代理 MP4
          </a>
        )}
      </div>
    </details>
  )
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
  /** 时间码（帧号 + 秒），诊断信息不放这里。 */
  timecode: string
}) {
  return (
    <section style={{ ...COLUMN_STYLE, flex: '2 1 380px' }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px', color: TEXT_MAIN }}>预览</h2>
      <canvas ref={props.canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}
        style={{ borderRadius: 6, border: '1px solid #334155', display: 'block', width: '100%', maxWidth: 640, background: '#020617' }} />
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={BUTTON_STYLE} onClick={props.onTogglePlay}>
          {props.playing ? '暂停' : '播放'}
        </button>
        <input type="range" min={0} max={Math.max(props.frameCount - 1, 0)}
          value={Math.min(props.frameIndex, props.frameCount - 1)}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          style={{ flex: 1, minWidth: 160 }} aria-label="播放头" />
        <span style={{ color: TEXT_MUTED, fontSize: 13, whiteSpace: 'nowrap' }}>{props.timecode}</span>
      </div>
    </section>
  )
}

/** 工具栏动作描述。 */
export interface ToolbarAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

/** 时间轴面板：标尺/播放头/缩放/吸附 + 片段选中、剪辑动作与涟漪建议。 */
export function TimelineSection(props: {
  elements: CoreElement[]
  selectedId: string | null
  onSelect: (id: string) => void
  actions: Array<{ label: string; onClick: () => void; disabled?: boolean }>
  statusText: string
  adjustments: RippleAdjustment[]
  onMoveClip?: (clipId: string, proposedStart: number) => void
  onResizeClip?: (clipId: string, edge: 'left' | 'right', deltaTicks: number) => void
  /** UI 第二批：播放头与时间刻度所需的时间基准。 */
  frameIndex: number
  frameCount: number
  ticksPerFrame: number
  ticksPerSecond: number
  onSeek: (frameIndex: number) => void
}) {
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const spanTicks = Math.max(
    ...props.elements.map((item) => item.startTime + item.duration),
    props.frameCount * props.ticksPerFrame,
    1,
  )
  return (
    <section style={PANEL_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0, color: TEXT_MAIN }}>时间轴</h2>
        <span style={{ color: '#fbbf24', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {formatTimecode(props.frameIndex, props.ticksPerFrame, props.ticksPerSecond)}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" style={BUTTON_STYLE} onClick={() => setZoom((value) => Math.max(1, value / 2))}
          disabled={zoom <= 1}>缩小</button>
        <span style={{ color: TEXT_MUTED, fontSize: 12, minWidth: 34, textAlign: 'center' }}>{zoom.toFixed(1)}×</span>
        <button type="button" style={BUTTON_STYLE} onClick={() => setZoom((value) => Math.min(8, value * 2))}
          disabled={zoom >= 8}>放大</button>
        <label style={{ color: TEXT_MUTED, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> 吸附
        </label>
      </div>
      <Timeline elements={props.elements} selectedId={props.selectedId}
        onSelect={props.onSelect} onMoveClip={props.onMoveClip} onResizeClip={props.onResizeClip}
        zoom={zoom} snap={snap} spanTicks={spanTicks}
        ticksPerFrame={props.ticksPerFrame} ticksPerSecond={props.ticksPerSecond}
        frameIndex={props.frameIndex} frameCount={props.frameCount} onSeek={props.onSeek} />
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
type DragMode = 'move' | 'left' | 'right' | 'playhead'

interface ClipDrag {
  id: string
  mode: DragMode
  startX: number
  /** 轨道左边界的屏幕坐标，供播放头拖拽换算。 */
  left: number
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

/** 时间标尺主刻度：每秒一个，最多 `maxTicks` 个防止超长时间轴卡死。 */
export function rulerTicks(spanTicks: number, ticksPerSecond: number, maxTicks = 120): number[] {
  if (spanTicks <= 0 || ticksPerSecond <= 0) return [0]
  const count = Math.min(Math.ceil(spanTicks / ticksPerSecond), maxTicks)
  return Array.from({ length: count + 1 }, (_, index) => index * ticksPerSecond)
}

/**
 * 吸附：先按帧网格量化，再在阈值内取最近的片段/时间轴边界。
 * 关闭时只做四舍五入，保持原有连续拖拽手感。
 */
export function snapTicks(
  value: number,
  boundaries: number[],
  ticksPerFrame: number,
  thresholdTicks: number,
  enabled: boolean,
): number {
  const rounded = Math.max(0, Math.round(value))
  if (!enabled) return rounded
  const grid = ticksPerFrame > 0 ? Math.round(rounded / ticksPerFrame) * ticksPerFrame : rounded
  let best = grid
  let bestDistance = thresholdTicks
  for (const boundary of boundaries) {
    const distance = Math.abs(boundary - grid)
    if (distance < bestDistance) {
      bestDistance = distance
      best = boundary
    }
  }
  return Math.max(0, Math.round(best))
}

/** 时间码 `mm:ss.ff`（ff 为当前秒内的帧号）。 */
export function formatTimecode(frameIndex: number, ticksPerFrame: number, ticksPerSecond: number): string {
  const tpf = Math.max(1, ticksPerFrame)
  const tps = Math.max(1, ticksPerSecond)
  const ticks = Math.max(0, frameIndex) * tpf
  const minutes = Math.floor(ticks / (60 * tps))
  const seconds = Math.floor((ticks % (60 * tps)) / tps)
  const frames = Math.floor((ticks % tps) / tpf)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

export function Timeline(props: {
  elements: CoreElement[]
  selectedId: string | null
  onSelect?: (id: string) => void
  /** 提供时启用整段拖拽；松开鼠标提交目标起点，重叠约束由调用方处理。 */
  onMoveClip?: (clipId: string, proposedStart: number) => void
  /** 提供时启用边缘裁剪；提交边缘与位移量，约束由调用方处理。 */
  onResizeClip?: (clipId: string, edge: 'left' | 'right', deltaTicks: number) => void
  /** UI 第二批：缩放倍数、吸附、时间基准与播放头。 */
  zoom?: number
  snap?: boolean
  spanTicks?: number
  ticksPerFrame?: number
  ticksPerSecond?: number
  frameIndex?: number
  frameCount?: number
  onSeek?: (frameIndex: number) => void
}) {
  const total = props.spanTicks ?? Math.max(...props.elements.map((item) => item.startTime + item.duration), 1)
  const ticksPerFrame = props.ticksPerFrame ?? 4000
  const ticksPerSecond = props.ticksPerSecond ?? 120000
  const zoom = props.zoom ?? 1
  const marks = rulerTicks(total, ticksPerSecond)
  const playheadTicks = props.frameIndex === undefined ? null : props.frameIndex * ticksPerFrame
  const trackRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<ClipDrag | null>(null)
  const moveRef = useRef(props.onMoveClip)
  const resizeRef = useRef(props.onResizeClip)
  const seekRef = useRef(props.onSeek)
  const elementsRef = useRef(props.elements)
  const configRef = useRef({ total, ticksPerFrame, snap: props.snap ?? false, frameCount: props.frameCount ?? 1 })
  const [preview, setPreview] = useState<{ id: string; start: number; duration: number } | null>(null)
  moveRef.current = props.onMoveClip
  resizeRef.current = props.onResizeClip
  seekRef.current = props.onSeek
  elementsRef.current = props.elements
  configRef.current = { total, ticksPerFrame, snap: props.snap ?? false, frameCount: props.frameCount ?? 1 }

  /** 开始一次拖拽；边缘把手会阻止冒泡以免触发整段平移。 */
  const startDrag = (event: ReactMouseEvent, element: CoreElement, mode: DragMode) => {
    if (mode === 'move' && !props.onMoveClip) return
    if (mode !== 'move' && !props.onResizeClip) return
    event.preventDefault()
    event.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    dragRef.current = {
      id: element.id, mode,
      startX: event.clientX, left: rect?.left ?? 0,
      startTicks: element.startTime,
      origDuration: element.duration, total,
      width: rect?.width ?? 1,
      proposed: element.startTime, delta: 0,
    }
  }

  /** 点击/拖动标尺定位播放头。 */
  const seekAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !seekRef.current) return
    const ticks = Math.max(0, ((clientX - rect.left) / rect.width) * configRef.current.total)
    const frame = Math.round(ticks / configRef.current.ticksPerFrame)
    seekRef.current(Math.min(frame, Math.max(0, configRef.current.frameCount - 1)))
  }
  const startPlayhead = (event: ReactMouseEvent) => {
    if (!props.onSeek) return
    event.preventDefault()
    const rect = trackRef.current?.getBoundingClientRect()
    dragRef.current = {
      id: '', mode: 'playhead',
      startX: event.clientX, left: rect?.left ?? 0,
      startTicks: 0, origDuration: 0, total,
      width: rect?.width ?? 1, proposed: 0, delta: 0,
    }
    seekAt(event.clientX)
  }

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.mode === 'playhead') {
        seekAt(event.clientX)
        return
      }
      const delta = Math.round(((event.clientX - drag.startX) / drag.width) * drag.total)
      const { ticksPerFrame: tpf, snap: snapping } = configRef.current
      if (drag.mode === 'move') {
        const boundaries = [
          0,
          drag.total,
          ...elementsRef.current
            .filter((item) => item.id !== drag.id)
            .flatMap((item) => [item.startTime, item.startTime + item.duration]),
        ]
        const threshold = Math.max(1, (8 / drag.width) * drag.total)
        drag.proposed = snapTicks(
          Math.max(0, drag.startTicks + delta), boundaries, tpf, threshold, snapping,
        )
        setPreview({ id: drag.id, start: drag.proposed, duration: drag.origDuration })
      } else {
        const direction = drag.mode === 'right' ? 1 : -1
        const raw = drag.origDuration + direction * delta
        const shown = snapping && tpf > 0
          ? Math.max(tpf, Math.round(raw / tpf) * tpf)
          : Math.max(1, raw)
        drag.delta = direction * (shown - drag.origDuration)
        setPreview({
          id: drag.id,
          start: drag.mode === 'left' ? drag.startTicks + drag.origDuration - shown : drag.startTicks,
          duration: shown,
        })
      }
    }
    const onUp = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setPreview(null)
      if (drag.mode === 'move' && drag.proposed !== drag.startTicks) {
        moveRef.current?.(drag.id, drag.proposed)
      } else if (drag.mode === 'left' || drag.mode === 'right') {
        if (drag.delta !== 0) resizeRef.current?.(drag.id, drag.mode, drag.delta)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  /** 缩放后播放头跑出视口时自动横向滚动到可见区域。 */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || playheadTicks === null || zoom <= 1) return
    const x = (playheadTicks / total) * viewport.scrollWidth
    if (x < viewport.scrollLeft + 20 || x > viewport.scrollLeft + viewport.clientWidth - 20) {
      viewport.scrollLeft = Math.max(0, x - viewport.clientWidth / 2)
    }
  }, [playheadTicks, zoom, total])

  return (
    <div ref={viewportRef} style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 6, background: '#0b1220' }}>
      <div style={{ position: 'relative', width: `${zoom * 100}%`, minWidth: '100%' }}>
        <div onMouseDown={startPlayhead}
          style={{ position: 'relative', height: 24, borderBottom: '1px solid #334155', cursor: 'ew-resize', userSelect: 'none' }}
          title="点击或拖动标尺定位播放头">
          {marks.map((tick) => (
            <div key={tick} style={{ position: 'absolute', left: `${(tick / total) * 100}%`, top: 10, bottom: 0, borderLeft: '1px solid #64748b' }}>
              <span style={{ position: 'absolute', left: 3, bottom: 10, fontSize: 10, color: TEXT_MUTED, whiteSpace: 'nowrap' }}>
                {(tick / ticksPerSecond).toFixed(0)}s
              </span>
            </div>
          ))}
        </div>
        <div ref={trackRef} style={{ ...TRACK_STYLE, height: 52, borderRadius: 0 }}>
          {marks.map((tick) => (
            <div key={`grid-${tick}`} style={{ position: 'absolute', left: `${(tick / total) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid rgba(148,163,184,.18)' }} />
          ))}
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
                    ? '#4f46e5'
                    : '#15803d',
                  color: '#ffffff',
                  fontSize: 11,
                  padding: '4px 6px',
                  boxSizing: 'border-box',
                  borderRight: '1px solid #0b1220',
                  outline: props.selectedId === element.id ? '2px solid #fbbf24' : 'none',
                  outlineOffset: -2,
                  cursor: props.onMoveClip ? (preview ? 'grabbing' : 'grab') : (props.onSelect ? 'pointer' : 'default'),
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', gap: 4, whiteSpace: 'nowrap' }}>
                  <span>{element.id}</span>
                  <span style={{ opacity: 0.85 }}>{(shownDuration / ticksPerSecond).toFixed(2)}s</span>
                </div>
                <div style={{ position: 'absolute', left: 6, right: 6, bottom: 3, height: 14, display: 'flex', alignItems: 'flex-end', gap: 2, opacity: 0.32, pointerEvents: 'none' }}>
                  {Array.from({ length: 16 }, (_, index) => (
                    <span key={index} style={{
                      flex: 1, borderRadius: 1, background: '#ffffff',
                      height: `${25 + ((index * 17 + element.id.length * 11) % 70)}%`,
                    }} />
                  ))}
                </div>
                {props.onResizeClip && (
                  <>
                    <div data-edge="left" title="拖动左边缘裁剪入点" style={{ ...HANDLE_STYLE, left: 0 }}
                      onMouseDown={(event) => startDrag(event, element, 'left')} />
                    <div data-edge="right" title="拖动右边缘裁剪出点" style={{ ...HANDLE_STYLE, right: 0 }}
                      onMouseDown={(event) => startDrag(event, element, 'right')} />
                  </>
                )}
              </div>
            )
          })}
        </div>
        {playheadTicks !== null && (
          <div style={{
            position: 'absolute', left: `${(playheadTicks / total) * 100}%`, top: 0, bottom: 0,
            width: 2, background: '#f87171', zIndex: 6, pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: -5,
              borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
              borderTop: '8px solid #f87171',
            }} />
          </div>
        )}
      </div>
    </div>
  )
}
