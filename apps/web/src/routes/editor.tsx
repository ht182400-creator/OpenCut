import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  createEditorAdapter,
  formatCoreError,
  type DiscoverResult,
  type ProjectView,
} from '../local/editor-adapter'
import { probeWebCodecsSupport, type WebCodecsSupport } from '../local/webcodecs'

export const Route = createFileRoute('/editor')({ component: Editor })

/** 经典版 v31 项目静态资源（只读兼容层的输入）。 */
const PROJECT_FIXTURE_URL = '/fixtures/classic-project-v31.json'
const PREVIEW_WIDTH = 320
const PREVIEW_HEIGHT = 180
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
      project: ProjectView
      projectTrackCount: number
      beforeElements: CoreElement[]
      afterElements: CoreElement[]
      adjustments: RippleAdjustment[]
      plan: FramePlanView
      pixels: Uint8Array
      codecs: WebCodecsSupport
    }
  | { status: 'error'; message: string }

/** 预览与导出共用的导出配置（W-07 契约），帧率由项目 settings 填入。 */
const BASE_PROFILE = {
  container: 'mp4',
  codec: 'avc',
  width: PREVIEW_WIDTH,
  height: PREVIEW_HEIGHT,
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
            background: element.id.includes('intro') || element.id.includes('title')
              ? '#6366f1'
              : '#22c55e',
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
 * Web-first 最小编辑器页：加载经典版项目 JSON，由 Rust core（WASM）完成
 * 只读解析、ripple 计算、帧计划与预览帧生成。
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
        const response = await fetch(PROJECT_FIXTURE_URL)
        if (!response.ok) {
          throw new Error(`项目文件加载失败（HTTP ${response.status}）`)
        }
        const projectText = await response.text()
        const adapter = await createEditorAdapter()
        const project = adapter.readClassicProject(projectText)
        if ('error' in project) {
          throw new Error(`项目不兼容：${project.error}`)
        }

        const tracks = project.scenes.flatMap((scene) => scene.tracks)
        const mainTrack = tracks.find(
          (track) => track.trackType === 'video' && track.id === 'main',
        )
        const beforeElements: CoreElement[] = mainTrack?.elements ?? []
        if (beforeElements.length < 2) {
          throw new Error('项目主轨至少需要两个片段才能演示 ripple')
        }
        // 删除首片段，其余片段由 core 计算 ripple 后前移
        const before = {
          overlay: [],
          main: { id: 'main', elements: beforeElements },
          audio: [],
        }
        const after = {
          overlay: [],
          main: { id: 'main', elements: beforeElements.slice(1) },
          audio: [],
        }
        const info = adapter.discover()
        const ripple = adapter.evaluate<RippleResponse>({
          kind: 'rippleAdjustments',
          before,
          after,
        })
        const applied = adapter.evaluate<ApplyResponse>({
          kind: 'rippleApply',
          tracks: before,
          adjustments: ripple.adjustments,
        })
        const profile = {
          ...BASE_PROFILE,
          frameRate: {
            numerator: project.fps.numerator,
            denominator: project.fps.denominator,
          },
        }
        const plan = adapter.evaluate<FramePlanView>({
          kind: 'buildFramePlan',
          durationTicks: project.durationTicks,
          profile,
        })
        const pixels = adapter.renderFrameRgba({
          frameIndex: 0,
          timeTicks: 0,
          durationTicks: plan.ticksPerFrame,
          profile,
          params: DEMO_PARAMS,
        })
        const codecs = await probeWebCodecsSupport()
        if (!cancelled) {
          setView({
            status: 'ready',
            info,
            project,
            projectTrackCount: tracks.length,
            beforeElements,
            afterElements: applied.tracks.main.elements,
            adjustments: ripple.adjustments,
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
        项目解析、时间轴位移与预览帧像素均由 Rust core（WASM）生成；业务代码只经 editor-adapter 访问 core。
      </p>

      {view.status === 'loading' && (
        <div style={PANEL_STYLE}>正在加载项目与 Rust core WASM…</div>
      )}

      {view.status === 'error' && (
        <div style={{ ...PANEL_STYLE, borderColor: '#ef4444', color: '#fecaca' }}>
          {view.message}
        </div>
      )}

      {view.status === 'ready' && (
        <>
          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>项目（经典版 v{view.project.version}，只读）</h2>
            <p style={{ fontSize: 13, margin: '4px 0' }}>
              {view.project.name} · id {view.project.projectId} · {view.project.sceneCount} 场景 /{' '}
              {view.projectTrackCount} 轨道
            </p>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0' }}>
              {view.project.fps.numerator}/{view.project.fps.denominator} fps ·{' '}
              {view.project.canvas.width}×{view.project.canvas.height} · 时长{' '}
              {(view.project.durationTicks / 120000).toFixed(2)}s · 兼容提示{' '}
              {view.project.warnings.length} 条
            </p>
          </section>

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
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>删除首片段前</h2>
            <Timeline elements={view.beforeElements} />
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>core 应用 ripple 后</h2>
            <Timeline elements={view.afterElements} />
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
