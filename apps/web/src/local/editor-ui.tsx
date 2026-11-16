/**
 * 编辑器共享 UI 片段与配置（W-08 / W-09 / UI 同步第一批）。
 *
 * UI 同步第一批（经典版信息架构）：`TopBar`（项目 + 导出）、`DiagnosticsPanel`（诊断与高级工具）；
 * 素材面板（批 3）位于 `classic-ui/assets-panel.tsx`，属性面板（批 4）位于
 * `classic-ui/properties-panel.tsx`，预览画布（批 5）位于 `classic-ui/preview-section.tsx`
 * （本文件保留三者共用的 `ClipPatch`/帧工具数据契约）。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'

import { SHORTCUT_HELP } from './editor-shortcuts'
import type { DiscoverResult, EditorAdapter, ProjectView } from './editor-adapter'
import { CONTAINER_LABELS } from './export-settings'
import type { ExportContainerChoice, ExportSettings } from './export-settings'
import type { TimelineClip } from './timeline'
import type { WebCodecsSupport } from './webcodecs'

/** 预览帧尺寸（同时是代理帧尺寸）。 */
export const PREVIEW_WIDTH = 320
export const PREVIEW_HEIGHT = 180

/** 主文字色 / 次要文字色：批 1 起改由经典版主题变量驱动。 */
export const TEXT_MAIN = 'var(--foreground)'
export const TEXT_MUTED = 'var(--muted-foreground)'

export const PANEL_STYLE: CSSProperties = {
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 12,
  color: TEXT_MAIN,
}
export const BUTTON_STYLE: CSSProperties = {
  background: 'transparent',
  color: TEXT_MAIN,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
  display: 'inline-block',
}

/** 批 1：外壳改由 .classic-shell / .classic-header / .classic-split 控制，这里只保留兼容值。 */
export const SURFACE_STYLE: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--background)',
  color: TEXT_MAIN,
  padding: 0,
}
export const TOPBAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  background: 'var(--background)',
}
export const WORKSPACE_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'stretch',
}
export const COLUMN_STYLE: CSSProperties = {
  ...PANEL_STYLE,
  minWidth: 0,
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
  /** 项目下拉菜单项（经典版 ProjectDropdown 的位置）。 */
  actions: ToolbarAction[]
  onExport: () => void
  exportDisabled?: boolean
  /** 批 1：亮/暗主题切换（对应经典版 ThemeToggle）。 */
  dark: boolean
  onToggleTheme: () => void
  exportState: ExportState
  otioUrl: string | null
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="classic-header" data-testid="classic-header">
      <div className="classic-header-left" style={{ position: 'relative' }}>
        <button type="button" className="classic-header-title" title="项目菜单"
          onClick={() => setMenuOpen((value) => !value)}>{props.projectName}</button>
        {menuOpen && (
          <div className="classic-menu" onMouseLeave={() => setMenuOpen(false)}>
            {props.actions.map((action) => (
              <button key={action.label} type="button" className="classic-menu-item"
                disabled={action.disabled}
                onClick={() => { action.onClick(); setMenuOpen(false) }}>{action.label}</button>
            ))}
          </div>
        )}
        <span className="classic-header-meta">
          经典版 v{props.projectVersion} · {props.sceneCount} 场景 / {props.trackCount} 轨道
        </span>
      </div>
      <nav className="classic-header-nav">
        <button type="button" className="classic-button" title="切换亮/暗主题"
          onClick={props.onToggleTheme}>{props.dark ? '亮色' : '暗色'}</button>
        <button type="button" className="classic-button" data-variant="primary"
          onClick={props.onExport} disabled={props.exportDisabled}>导出</button>
      {props.exportState.status === 'running' && (
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>编码中 {props.exportState.done}/{props.exportState.total}</span>
      )}
      {props.exportState.status === 'done' && props.exportState.url && (
        <a href={props.exportState.url} download={props.exportState.filename ?? 'opencut-export.mp4'} style={{ color: 'var(--primary)', fontSize: 'var(--text-xs)' }}>
          下载 {props.exportState.filename?.includes('-av1') ? 'AV1 WebM' : props.exportState.filename?.endsWith('.webm') ? 'WebM' : 'MP4'}
        </a>
      )}
      {props.exportState.status === 'error' && (
        <span style={{ color: 'var(--destructive)', fontSize: 'var(--text-xs)' }}>{props.exportState.message}</span>
      )}
      {props.otioUrl && (
        <a href={props.otioUrl} download="opencut-timeline.otio" style={{ color: 'var(--primary)', fontSize: 'var(--text-xs)' }}>下载 OTIO</a>
      )}
      </nav>
    </header>
  )
}

/** 属性面板可编辑的片段字段（ticks）。 */
export interface ClipPatch {
  startTime?: number
  duration?: number
  trimStart?: number
  trimEnd?: number
}

/** 通用输入控件样式（ExportSettingsPanel 仍在使用）。 */
const INPUT_STYLE: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--input)', color: TEXT_MAIN,
  border: '1px solid #475569', borderRadius: 4, padding: '4px 6px', fontSize: 12,
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

/** 工具栏动作描述。 */
export interface ToolbarAction {
  label: string
  onClick: () => void
  disabled?: boolean
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

