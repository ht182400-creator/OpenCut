import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  createEditorAdapter,
  formatCoreError,
  type DiscoverResult,
} from '../local/editor-adapter'

export const Route = createFileRoute('/editor')({ component: Editor })

/** 与 Rust core 一致的时间单位。 */
const TICKS_PER_SECOND = 120000
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

type ViewState =
  | { status: 'loading' }
  | {
      status: 'ready'
      info: DiscoverResult
      adjustments: RippleAdjustment[]
      elements: CoreElement[]
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
        if (!cancelled) {
          setView({
            status: 'ready',
            info,
            adjustments: ripple.adjustments,
            elements: applied.tracks.main.elements,
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

  return (
    <main style={{ maxWidth: 880, margin: '32px auto', padding: '0 16px', color: '#e5e7eb' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Editor · Web-first 最小时间轴</h1>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
        本页的 ripple 计算与位移由 Rust core（WASM）执行；业务代码只经 editor-adapter 访问 core。
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
        </>
      )}
    </main>
  )
}
