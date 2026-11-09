import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  createEditorAdapter,
  formatCoreError,
  type DiscoverResult,
} from '../local/editor-adapter'
import { probeWebCodecsSupport, type WebCodecsSupport } from '../local/webcodecs'

export const Route = createFileRoute('/editor')({ component: Editor })

/** 与 Rust core 一致的时间单位。 */
const TICKS_PER_SECOND = 120000
const PREVIEW_WIDTH = 320
const PREVIEW_HEIGHT = 180
const PREVIEW_DURATION_TICKS = TICKS_PER_SECOND
const PANEL_STYLE: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
}
const TRACK_STYLE: React.CSSProperties = {
  position: 'relative',
  height: 36,
  background: '#1f2937',
  borderRadius: 6,
  overflow: 'hidden',
}

interface CoreElement {
  id: string
  startTime: number
  duration: number
}

interface RippleAdjustment {
  trackId: string
  afterTime: number
  shiftAmount: number
}

interface RippleResponse {
  adjustments: RippleAdjustment[]
}

interface ApplyResponse {
  tracks: { main: { elements: CoreElement[] } }
}

interface FramePlanView {
  frameCount: number
  ticksPerFrame: number
  totalAudioSamples: number
  durationSeconds: number
}

type ViewState =
  | { status: 'loading' }
  | {
      status: 'ready'
      info: DiscoverResult
      adjustments: RippleAdjustment[]
      elements: CoreElement[]
      plan: FramePlanView
      pixels: Uint8Array
      codecs: WebCodecsSupport
    }
  | { status: 'error'; message: string }

/** 演示用的两片段场景：删除 intro 后由 core 计算并应用 ripple。 */
const DEMO_BEFORE = {
  overlay: [],
  main: {
    id: 'main',
    elements: [
      { id: 'intro', startTime: 0, duration: TICKS_PER_SECOND * 2 },
      { id: 'clip', startTime: TICKS_PER_SECOND * 2, duration: TICKS_PER_SECOND },
    ],
  },
  audio: [],
}
const DEMO_AFTER = {
  overlay: [],
  main: {
    id: 'main',
    elements: [
      { id: 'clip', startTime: TICKS_PER_SECOND * 2, duration: TICKS_PER_SECOND },
    ],
  },
  audio: [],
}

/** 预览与导出共用的导出配置（W-07 契约）。 */
const DEMO_PROFILE = {
  container: 'mp4',
  codec: 'avc',
  width: PREVIEW_WIDTH,
  height: PREVIEW_HEIGHT,
  frameRate: { numerator: 30, denominator: 1 },
  videoBitrateBps: 1_000_000,
  includeAudio: false,
  audioSampleRateHz: 48000,
  audioChannels: 2,
}

/** 合成帧参数：通常由 domain 的动画通道在时间 t 求值得到。 */
const DEMO_PARAMS = {
  backgroundRgba: [17, 24, 39, 255],
  accentRgba: [249, 115, 22, 255],
  opacity: 1,
  positionX: 0.5,
  positionY: 0.5,
}

/**
 * 最小时间轴：把 ticks 换算成百分比定位，直观显示 core 计算后的位置。
 * @param props 元素列表
 * @returns {React.ReactElement} 时间轴
 */
function Timeline(props: { elements: CoreElement[] }) {
  const total = Math.max(
    ...props.elements.map((element) => element.startTime + element.duration),
    1,
  )
  return (
    <div style={TRACK_STYLE}>
      {props.elements.map((element) => (
        <div
          key={element.id}
          title={`${element.id}: ${element.startTime} + ${element.duration} ticks`}
          style={{
            position: 'absolute',
            left: `${(element.startTime / total) * 100}%`,
            width: `${(element.duration / total) * 100}%`,
            height: '100%',
            background: element.id === 'intro' ? '#6366f1' : '#22c55e',
            color: '#fff',
            fontSize: 12,
            padding: '8px 6px',
            boxSizing: 'border-box',
            borderRight: '1px solid #111827',
          }}
        >
          {element.id}
        </div>
      ))}
    </div>
  )
}

/**
 * Web-first 最小编辑器页：首次让 Rust core 在浏览器里真实执行。
 * 所有 core 调用都经 `editor-adapter`（不变量 I-01），错误统一友好提示。
 * @returns {React.ReactElement} 页面
 */
function Editor() {
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const adapter = await createEditorAdapter()
        const info = adapter.discover()
        const ripple = adapter.evaluate<RippleResponse>({
          kind: 'rippleAdjustments',
          before: DEMO_BEFORE,
          after: DEMO_AFTER,
        })
        const applied = adapter.evaluate<ApplyResponse>({
          kind: 'rippleApply',
          tracks: DEMO_BEFORE,
          adjustments: ripple.adjustments,
        })
        const plan = adapter.evaluate<FramePlanView>({
          kind: 'buildFramePlan',
          durationTicks: PREVIEW_DURATION_TICKS,
          profile: DEMO_PROFILE,
        })
        const pixels = adapter.renderFrameRgba({
          frameIndex: 0,
          timeTicks: 0,
          durationTicks: plan.ticksPerFrame,
          profile: DEMO_PROFILE,
          params: DEMO_PARAMS,
        })
        const codecs = await probeWebCodecsSupport()
        if (!cancelled) {
          setView({
            status: 'ready',
            info,
            adjustments: ripple.adjustments,
            elements: applied.tracks.main.elements,
            plan,
            pixels,
            codecs,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setView({ status: 'error', message: formatCoreError(error) })
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (view.status !== 'ready') return
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const image = new ImageData(
      new Uint8ClampedArray(view.pixels),
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    )
    context.putImageData(image, 0, 0)
  }, [view])

  return (
    <main style={{ maxWidth: 880, margin: '32px auto', padding: '0 16px', color: '#e5e7eb' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Editor · Web-first 最小时间轴</h1>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
        时间轴位移与预览帧像素均由 Rust core（WASM）生成；业务代码只经 editor-adapter 访问 core。
      </p>

      {view.status === 'loading' && (
        <div style={PANEL_STYLE}>正在加载 Rust core WASM…</div>
      )}

      {view.status === 'error' && (
        <div style={{ ...PANEL_STYLE, borderColor: '#ef4444', color: '#fecaca' }}>
          {view.message}
        </div>
      )}

      {view.status === 'ready' && (
        <>
          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>core 能力发现</h2>
            <p style={{ fontSize: 13, margin: '4px 0' }}>
              API {view.info.apiVersion} · schema {view.info.schemaVersion} · 后端 {view.info.backendId}
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0' }}>
              能力：{view.info.capabilities.join(' / ')}
            </p>
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>删除片段前</h2>
            <Timeline elements={DEMO_BEFORE.main.elements} />
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>core 应用 ripple 后</h2>
            <Timeline elements={view.elements} />
            <pre style={{ fontSize: 12, color: '#a5b4fc', marginTop: 12, marginBottom: 0 }}>
              {JSON.stringify(view.adjustments, null, 2)}
            </pre>
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>core 预览帧（RenderFrame）</h2>
            <canvas
              ref={canvasRef}
              width={PREVIEW_WIDTH}
              height={PREVIEW_HEIGHT}
              style={{ borderRadius: 6, border: '1px solid #334155', display: 'block' }}
            />
            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 10, marginBottom: 0 }}>
              帧数 {view.plan.frameCount} · 每帧 {view.plan.ticksPerFrame} ticks ·
              时长 {view.plan.durationSeconds.toFixed(2)}s ·
              像素 {view.pixels.length} 字节（{PREVIEW_WIDTH}×{PREVIEW_HEIGHT} RGBA8）
            </p>
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>WebCodecs 导出能力</h2>
            <p style={{ fontSize: 13, margin: '4px 0' }}>
              {view.codecs.available ? '可用' : '当前不可用'} · VideoEncoder{' '}
              {String(view.codecs.videoEncoder)} · VideoFrame {String(view.codecs.videoFrame)} ·
              codec {view.codecs.codec}
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0' }}>
              {view.codecs.reason}
            </p>
          </section>
        </>
      )}
    </main>
  )
}
