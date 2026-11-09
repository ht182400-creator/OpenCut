import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { buildTimelineAudio, isAacEncodingSupported, type PcmAudio } from '../local/audio'
import {
  createEditorAdapter,
  formatCoreError,
  type DiscoverResult,
  type EditorAdapter,
  type ProjectView,
} from '../local/editor-adapter'
import {
  BASE_PROFILE,
  BUTTON_STYLE,
  DEMO_PARAMS,
  PANEL_STYLE,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  TEXT_MAIN,
  TEXT_MUTED,
  Timeline,
  blankFrame,
  type CoreElement,
} from '../local/editor-ui'
import { exportProjectToMp4, isExportSupported } from '../local/export'
import {
  clearFrameCache,
  createDemoVideoFile,
  createProxyFile,
  decodeVideoFile,
  getFrameCacheStats,
  getPersistedCacheStats,
  isVideoFile,
  mediaFrameAt,
  type DecodedMedia,
} from '../local/media'
import { clipAtTime, mapProjectFrame, splitClipAt } from '../local/timeline'
import { probeWebCodecsSupport, type WebCodecsSupport } from '../local/webcodecs'

export const Route = createFileRoute('/editor')({ component: Editor })

const PROJECT_FIXTURE_URL = '/fixtures/classic-project-v31.json'
const TICKS_PER_SECOND = 120000
/** 单次解码的最大帧数，避免长项目逐帧 seek 过慢。 */
const MAX_DECODE_FRAMES = 90
/** W-09 量化阈值：单帧预览合成耗时不超过 16ms（60fps）。 */
const SCRUB_THRESHOLD_MS = 16

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
}

interface Session {
  adapter: EditorAdapter
  project: ProjectView
  info: DiscoverResult
  codecs: WebCodecsSupport
  fps: number
  ticksPerFrame: number
  profile: Record<string, unknown>
  projectTrackCount: number
}

interface ExportState {
  status: 'idle' | 'running' | 'done' | 'error'
  done: number
  total: number
  message: string
  url: string | null
  bytes: number
}

/** 计算当前元素集合覆盖的总时长（ticks）。 */
function effectiveDuration(elements: CoreElement[]): number {
  return Math.max(...elements.map((item) => item.startTime + item.duration), 0)
}

/**
 * Web-first 编辑器：导入项目 JSON 与真实音视频素材 → 删除/分割片段 →
 * 逐帧预览（三级代理缓存 + 片段 trimStart 映射）→ 带 AAC 音轨导出 MP4。
 * 所有 core 调用都经 `editor-adapter`（I-01），错误统一友好提示。
 * @returns {React.ReactElement} 页面
 */
function Editor() {
  const [session, setSession] = useState<Session | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [originalElements, setOriginalElements] = useState<CoreElement[]>([])
  const [elements, setElements] = useState<CoreElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adjustments, setAdjustments] = useState<RippleAdjustment[]>([])
  const [frameIndex, setFrameIndex] = useState(0)
  const [frameCount, setFrameCount] = useState(1)
  const [frameCost, setFrameCost] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [media, setMedia] = useState<DecodedMedia | null>(null)
  const [mediaStatus, setMediaStatus] = useState('未加载素材')
  const [cacheInfo, setCacheInfo] = useState('代理缓存 0 份')
  const [proxyUrl, setProxyUrl] = useState<string | null>(null)
  const [exportState, setExportState] = useState<ExportState>({
    status: 'idle', done: 0, total: 0, message: '', url: null, bytes: 0,
  })
  const [sourceName, setSourceName] = useState('内置示例项目')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectFileRef = useRef<HTMLInputElement>(null)
  const videoFileRef = useRef<HTMLInputElement>(null)

  /** 刷新内存与持久化缓存统计展示。 */
  const refreshCacheInfo = async () => {
    const stats = getFrameCacheStats()
    const persisted = await getPersistedCacheStats()
    setCacheInfo(
      `代理缓存 ${stats.entries} 份 / ${stats.cachedFrames} 帧 / ${(stats.cachedBytes / 1048576).toFixed(1)}MB · 持久化 ${persisted.entries} 份 / ${(persisted.bytes / 1048576).toFixed(1)}MB · 命中 ${stats.hits} / 未命中 ${stats.misses}`,
    )
  }

  /** 载入项目 JSON 文本并初始化会话。 */
  const loadProject = async (text: string, name: string) => {
    setErrorText(null)
    setPlaying(false)
    try {
      const adapter = await createEditorAdapter()
      const project = adapter.readClassicProject(text)
      if ('error' in project) throw new Error(`项目不兼容：${project.error}`)
      const tracks = project.scenes.flatMap((scene) => scene.tracks)
      const mainTrack = tracks.find((track) => track.trackType === 'video' && track.id === 'main')
      const mainElements: CoreElement[] = (mainTrack?.elements ?? []).map((element) => ({
        id: element.id,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart,
      }))
      if (mainElements.length === 0) throw new Error('项目中没有可编辑的主轨片段')

      const fps = project.fps.numerator / project.fps.denominator
      const profile = { ...BASE_PROFILE, frameRate: project.fps }
      const duration = effectiveDuration(mainElements)
      const plan = adapter.evaluate<FramePlanView>({
        kind: 'buildFramePlan', durationTicks: duration, profile,
      })
      const codecs = await probeWebCodecsSupport()
      setSession({
        adapter, project, info: adapter.discover(), codecs, fps,
        ticksPerFrame: plan.ticksPerFrame, profile, projectTrackCount: tracks.length,
      })
      setOriginalElements(mainElements)
      setElements(mainElements)
      setAdjustments([])
      setSelectedId(null)
      setFrameIndex(0)
      setFrameCount(Math.max(plan.frameCount, 1))
      setSourceName(name)
    } catch (error) {
      setErrorText(formatCoreError(error))
      setSession(null)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(PROJECT_FIXTURE_URL)
        if (!response.ok) throw new Error(`示例项目加载失败（HTTP ${response.status}）`)
        await loadProject(await response.text(), '内置示例项目')
      } catch (error) {
        setErrorText(formatCoreError(error))
      }
    }
    void load()
    void refreshCacheInfo()
  }, [])

  /** 删除选中片段，由 core 计算并应用 ripple。 */
  const deleteSelected = () => {
    if (!session || !selectedId || elements.length < 2) return
    try {
      const after = elements.filter((item) => item.id !== selectedId)
      const before = { overlay: [], main: { id: 'main', elements }, audio: [] }
      const ripple = session.adapter.evaluate<RippleResponse>({
        kind: 'rippleAdjustments', before,
        after: { overlay: [], main: { id: 'main', elements: after }, audio: [] },
      })
      const applied = session.adapter.evaluate<ApplyResponse>({
        kind: 'rippleApply', tracks: before, adjustments: ripple.adjustments,
      })
      const remainingIds = new Set(after.map((item) => item.id))
      const trimById = new Map(elements.map((item) => [item.id, item.trimStart]))
      const next = applied.tracks.main.elements
        .filter((item) => remainingIds.has(item.id))
        .map((item) => ({ ...item, trimStart: trimById.get(item.id) ?? 0 }))
      const plan = session.adapter.evaluate<FramePlanView>({
        kind: 'buildFramePlan', durationTicks: effectiveDuration(next), profile: session.profile,
      })
      setAdjustments(ripple.adjustments)
      setElements(next)
      setSelectedId(null)
      setFrameCount(Math.max(plan.frameCount, 1))
      setFrameIndex(0)
      setPlaying(false)
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }

  /** 在播放头处分割选中片段：素材 trimStart 连续，不改变总时长。 */
  const splitAtPlayhead = () => {
    if (!session || !selectedId) return
    setErrorText(null)
    const next = splitClipAt(elements, selectedId, frameIndex * session.ticksPerFrame)
    if (next === elements) {
      setErrorText('播放头不在选中片段内部，无法分割')
      return
    }
    setElements(next)
    setSelectedId(null)
    setPlaying(false)
  }

  /** 生成当前帧像素：按片段 trimStart 取代理帧，交给 core 合成。 */
  const frameSource = (index: number): Uint8Array => {
    if (!session) throw new Error('会话尚未就绪')
    const timeTicks = index * session.ticksPerFrame
    if (media) {
      const mapping = mapProjectFrame(elements, timeTicks, session.fps, media.frames.length)
      const base = mapping.sourceFrameIndex === null
        ? blankFrame()
        : mediaFrameAt(media, mapping.sourceFrameIndex)
      return session.adapter.compositeFrameRgba(base, {
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        frameIndex: index,
        timeTicks,
        durationTicks: session.ticksPerFrame,
        params: DEMO_PARAMS,
      })
    }
    return session.adapter.renderFrameRgba({
      frameIndex: index,
      timeTicks,
      durationTicks: session.ticksPerFrame,
      profile: session.profile,
      params: DEMO_PARAMS,
    })
  }

  /** 逐帧预览：帧号、会话、片段或素材变化时重新向 core 取像素并绘制。 */
  useEffect(() => {
    if (!session) return
    try {
      const started = performance.now()
      const pixels = frameSource(frameIndex)
      setFrameCost(performance.now() - started)
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (canvas && context) {
        context.putImageData(
          new ImageData(new Uint8ClampedArray(pixels), PREVIEW_WIDTH, PREVIEW_HEIGHT), 0, 0,
        )
      }
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }, [session, frameIndex, media, elements])

  /** 播放：按帧率推进播放头，循环播放。 */
  useEffect(() => {
    if (!playing || frameCount <= 1 || !session) return
    const timer = window.setInterval(() => {
      setFrameIndex((previous) => (previous + 1) % frameCount)
    }, Math.max(16, 1000 / session.fps))
    return () => window.clearInterval(timer)
  }, [playing, frameCount, session])

  /** 真实导出：编码 core 帧与可选 AAC 音轨，生成可下载的 MP4。 */
  const handleExport = async () => {
    if (!session) return
    if (!isExportSupported()) {
      setExportState({ status: 'error', done: 0, total: 0, message: '当前浏览器不支持 WebCodecs 导出', url: null, bytes: 0 })
      return
    }
    if (exportState.url) URL.revokeObjectURL(exportState.url)
    setExportState({ status: 'running', done: 0, total: frameCount, message: '', url: null, bytes: 0 })
    try {
      let audioSource: PcmAudio | undefined
      if (media?.audio && await isAacEncodingSupported()) {
        audioSource = buildTimelineAudio({
          clips: elements,
          frameCount,
          fps: session.fps,
          ticksPerFrame: session.ticksPerFrame,
          sourceAudio: media.audio,
          ticksPerSecond: TICKS_PER_SECOND,
        })
      }
      const result = await exportProjectToMp4({
        width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
        fps: session.fps, frameCount, ticksPerFrame: session.ticksPerFrame,
        profile: session.profile, params: DEMO_PARAMS,
        frameSource,
        audioSource,
        onProgress: (done, total) => setExportState((previous) => ({ ...previous, done, total })),
      })
      setExportState({
        status: 'done', done: result.frameCount, total: frameCount,
        message: `已导出 ${result.frameCount} 帧 · ${result.durationSeconds.toFixed(2)}s${result.hasAudio ? ' · 含 AAC 音轨' : ''}`,
        url: URL.createObjectURL(result.blob), bytes: result.bytes,
      })
    } catch (error) {
      setExportState({
        status: 'error', done: 0, total: frameCount,
        message: error instanceof Error ? error.message : String(error), url: null, bytes: 0,
      })
    }
  }

  /** 把当前代理帧编码成低分辨率 MP4 供下载或跨设备复用。 */
  const handleProxyExport = async () => {
    if (!media) return
    try {
      const file = await createProxyFile(media)
      if (proxyUrl) URL.revokeObjectURL(proxyUrl)
      setProxyUrl(URL.createObjectURL(file))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }

  /** 清空内存与持久化代理缓存。 */
  const handleClearCache = async () => {
    if (proxyUrl) URL.revokeObjectURL(proxyUrl)
    setProxyUrl(null)
    await clearFrameCache()
    await refreshCacheInfo()
  }

  /** 读取用户选择/拖入的文件：视频走解码，其余按项目 JSON 处理。 */
  const readFile = async (file: File | undefined) => {
    if (!file) return
    if (isVideoFile(file)) {
      if (!session) {
        setErrorText('请先加载项目 JSON，再导入视频素材')
        return
      }
      setErrorText(null)
      setMediaStatus('解码中 0/' + Math.min(frameCount, MAX_DECODE_FRAMES))
      try {
        const decoded = await decodeVideoFile(file, {
          width: PREVIEW_WIDTH,
          height: PREVIEW_HEIGHT,
          fps: session.fps,
          frameCount: Math.min(frameCount, MAX_DECODE_FRAMES),
          onProgress: (done, total) => setMediaStatus(`解码中 ${done}/${total}`),
        })
        const cost = decoded.fromCache
          ? `${decoded.cacheDetail}命中 · ${decoded.decodeMilliseconds}ms`
          : `解码 ${decoded.decodeMilliseconds}ms${decoded.persisted ? ' · 已持久化' : ''}`
        setMedia(decoded)
        setMediaStatus(
          `已载入 ${decoded.name} · ${decoded.frames.length} 代理帧 · ${decoded.durationSeconds.toFixed(2)}s · ${decoded.audio ? '含音轨' : '无音轨'} · ${cost}`,
        )
        setFrameIndex(0)
        await refreshCacheInfo()
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : String(error))
        setMediaStatus('素材解码失败')
      }
      return
    }
    await loadProject(await file.text(), file.name)
  }

  /** 生成并导入一段演示音视频，便于无素材时体验完整链路。 */
  const handleDemoClip = async () => {
    setErrorText(null)
    setMediaStatus('正在生成演示素材…')
    try {
      const file = await createDemoVideoFile()
      await readFile(file)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setMediaStatus('演示素材生成失败')
    }
  }

  const activeClip = session
    ? clipAtTime(elements, frameIndex * session.ticksPerFrame)?.id ?? '空档'
    : '—'

  return (
    <main style={{ maxWidth: 880, margin: '32px auto', padding: '0 16px', color: '#0f172a' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Editor · Web-first 编辑器</h1>
      <p style={{ color: '#475569', fontSize: 13, marginBottom: 18 }}>
        导入项目 JSON 与真实音视频素材，删除或在播放头分割片段，逐帧预览，导出带 AAC 音轨的 MP4。代理帧三级缓存与单帧耗时量化由 W-09 提供，Rust core（WASM）负责合成与出帧。
      </p>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void readFile(event.dataTransfer.files[0])
        }}
        style={{ ...PANEL_STYLE, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <label style={BUTTON_STYLE}>
          导入项目 JSON
          <input ref={projectFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(event) => void readFile(event.target.files?.[0])} />
        </label>
        <label style={BUTTON_STYLE}>
          导入视频素材
          <input ref={videoFileRef} type="file" accept="video/*,.mp4,.webm" style={{ display: 'none' }}
            onChange={(event) => void readFile(event.target.files?.[0])} />
        </label>
        <button type="button" style={BUTTON_STYLE} onClick={() => void handleDemoClip()}>
          生成演示素材
        </button>
        <button type="button" style={BUTTON_STYLE} onClick={() => void handleClearCache()}>
          清除帧缓存
        </button>
        <button type="button" style={BUTTON_STYLE} onClick={() => void handleProxyExport()} disabled={!media}>
          导出代理文件
        </button>
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>
          当前：{sourceName} · {mediaStatus}
        </span>
        <span style={{ color: TEXT_MUTED, fontSize: 13 }}>{cacheInfo}</span>
        {proxyUrl && (
          <a href={proxyUrl} download="opencut-proxy.mp4" style={{ color: '#7dd3fc', fontSize: 13 }}>
            下载代理 MP4
          </a>
        )}
        <button type="button" style={BUTTON_STYLE} onClick={() => void handleExport()} disabled={!session || exportState.status === 'running'}>
          导出 MP4
        </button>
        {exportState.status === 'running' && (
          <span style={{ color: TEXT_MUTED, fontSize: 13 }}>编码中 {exportState.done}/{exportState.total}</span>
        )}
        {exportState.status === 'done' && exportState.url && (
          <a href={exportState.url} download="opencut-export.mp4" style={{ color: '#7dd3fc', fontSize: 13 }}>
            下载 MP4（{exportState.message} · {exportState.bytes} 字节）
          </a>
        )}
        {exportState.status === 'error' && (
          <span style={{ color: '#fca5a5', fontSize: 13 }}>{exportState.message}</span>
        )}
      </div>

      {!session && !errorText && <div style={{ ...PANEL_STYLE, color: TEXT_MAIN }}>正在加载项目与 Rust core WASM…</div>}
      {errorText && <div style={{ ...PANEL_STYLE, color: '#fecaca' }}>{errorText}</div>}

      {session && (
        <>
          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8, color: TEXT_MAIN }}>项目（经典版 v{session.project.version}）</h2>
            <p style={{ fontSize: 13, margin: '4px 0', color: TEXT_MAIN }}>
              {session.project.name} · {session.project.sceneCount} 场景 / {session.projectTrackCount} 轨道 ·
              兼容提示 {session.project.warnings.length} 条
            </p>
            <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '4px 0' }}>
              {session.project.fps.numerator}/{session.project.fps.denominator} fps ·{' '}
              {session.project.canvas.width}×{session.project.canvas.height} ·
              API {session.info.apiVersion} / {session.info.backendId} ·
              WebCodecs {session.codecs.available ? '可用' : '不可用'}
            </p>
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8, color: TEXT_MAIN }}>时间轴（点击片段选中）</h2>
            <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '0 0 6px' }}>导入时</p>
            <Timeline elements={originalElements} selectedId={null} />
            <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '10px 0 6px' }}>当前</p>
            <Timeline elements={elements} selectedId={selectedId} onSelect={setSelectedId} />
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={BUTTON_STYLE} onClick={deleteSelected} disabled={!selectedId || elements.length < 2}>
                删除选中片段
              </button>
              <button type="button" style={BUTTON_STYLE} onClick={splitAtPlayhead} disabled={!selectedId}>
                在播放头分割
              </button>
              <span style={{ color: TEXT_MUTED, fontSize: 13 }}>
                {selectedId ? `已选中 ${selectedId}` : '未选中片段'} · 剩余 {elements.length} 个
              </span>
            </div>
            {adjustments.length > 0 && (
              <pre style={{ fontSize: 12, color: '#a5b4fc', marginTop: 12, marginBottom: 0 }}>
                {JSON.stringify(adjustments, null, 2)}
              </pre>
            )}
          </section>

          <section style={PANEL_STYLE}>
            <h2 style={{ fontSize: 16, marginBottom: 8, color: TEXT_MAIN }}>预览与播放头</h2>
            <canvas ref={canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}
              style={{ borderRadius: 6, border: '1px solid #334155', display: 'block' }} />
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={BUTTON_STYLE} onClick={() => setPlaying((value) => !value)}>
                {playing ? '暂停' : '播放'}
              </button>
              <input type="range" min={0} max={Math.max(frameCount - 1, 0)}
                value={Math.min(frameIndex, frameCount - 1)}
                onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)) }}
                style={{ flex: 1, minWidth: 200 }} aria-label="播放头" />
              <span style={{ color: TEXT_MUTED, fontSize: 13, whiteSpace: 'nowrap' }}>
                帧 {frameIndex + 1}/{frameCount} · {(frameIndex * session.ticksPerFrame / TICKS_PER_SECOND).toFixed(2)}s · 片段 {activeClip} · 帧耗时 {frameCost.toFixed(2)}ms（阈值 {SCRUB_THRESHOLD_MS}ms {frameCost <= SCRUB_THRESHOLD_MS ? '达标' : '超标'}）
              </span>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
