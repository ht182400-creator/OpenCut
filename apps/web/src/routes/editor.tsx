import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import '../local/classic-ui/theme.css'
import { buildTimelineAudio, isAacEncodingSupported, type PcmAudio } from '../local/audio'
import { useClipHistory } from '../local/clip-history'
import { createEditorAdapter, formatCoreError } from '../local/editor-adapter'
import {
  BASE_PROFILE,
  DEMO_PARAMS,
  PANEL_STYLE,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  SCRUB_THRESHOLD_MS,
  SURFACE_STYLE,
  TEXT_MAIN,
  TOPBAR_STYLE,
  WORKSPACE_STYLE,
  DiagnosticsPanel,
  ExportSettingsPanel,
  MediaPanel,
  PreviewSection,
  PropertiesPanel,
  TimelineSection,
  TopBar,
  blankFrame,
  type ApplyResponse,
  type ClipPatch,
  type CoreElement,
  type ExportState,
  type FramePlanView,
  type RippleAdjustment,
  type RippleResponse,
  type Session,
} from '../local/editor-ui'
import {
  exportProjectToAv1WebM,
  exportProjectToMp4,
  exportProjectToWebM,
  isExportSupported,
  isOpusEncodingSupported,
} from '../local/export'
import {
  DEFAULT_EXPORT_SETTINGS,
  buildExportProfile,
  exportFilename,
  type ExportSettings,
} from '../local/export-settings'
import { matchShortcut } from '../local/editor-shortcuts'
import {
  createSnapshot,
  parseSnapshot,
  snapshotToJson,
} from '../local/project-snapshot'
import { formatBenchmark, measureFrameCost } from '../local/scrub-benchmark'
import {
  MAX_DECODE_FRAMES,
  clearFrameCache,
  createBenchmarkVideoFile,
  createDemoVideoFile,
  createProxyFile,
  decodeVideoFile,
  getFrameCacheStats,
  getPersistedCacheStats,
  isVideoFile,
  mediaFrameAt,
  type DecodedMedia,
} from '../local/media'
import {
  TICKS_PER_SECOND,
  clipAtTime,
  clipsToOtioText,
  mapProjectFrame,
  moveClipBy,
  moveClipClamped,
  otioImportToClips,
  plannedFrameCount,
  resizeClipEdge,
  splitClipAt,
  timelineDuration,
  trimClipInAt,
  trimClipOutAt,
} from '../local/timeline'
import { probeWebCodecsSupport } from '../local/webcodecs'

export const Route = createFileRoute('/editor')({ component: Editor })

const PROJECT_FIXTURE_URL = '/fixtures/classic-project-v31.json'

/**
 * Web-first 编辑器：导入项目 JSON 与真实音视频素材 → 删除/分割片段 →
 * 逐帧预览（三级代理缓存 + 片段 trimStart 映射）→ 带 AAC 音轨导出 MP4，
 * 并支持 OTIO 交换格式双向导入导出（W-10）。
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
  const [otioUrl, setOtioUrl] = useState<string | null>(null)
  const [benchmarkInfo, setBenchmarkInfo] = useState('')
  const [exportState, setExportState] = useState<ExportState>({
    status: 'idle', done: 0, total: 0, message: '', url: null, bytes: 0,
  })
  const [sourceName, setSourceName] = useState('内置示例项目')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 撤销/重做恢复的片段重新应用帧计划；历史由 M6 快照驱动。 */
  const clipHistory = useClipHistory((clips) => {
    setElements(clips as CoreElement[])
    setSelectedId(null)
    setPlaying(false)
    if (session) setFrameCount(plannedFrameCount(clips, session.adapter, session.profile))
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectFileRef = useRef<HTMLInputElement>(null)
  const videoFileRef = useRef<HTMLInputElement>(null)
  const otioFileRef = useRef<HTMLInputElement>(null)
  const snapshotFileRef = useRef<HTMLInputElement>(null)

  /** 刷新内存与持久化缓存统计展示。 */
  const refreshCacheInfo = async () => {
    const stats = getFrameCacheStats()
    const persisted = await getPersistedCacheStats()
    setCacheInfo(`代理缓存 ${stats.entries} 份 / ${stats.cachedFrames} 帧 / ${(stats.cachedBytes / 1048576).toFixed(1)}MB · 持久化 ${persisted.entries} 份 / ${(persisted.bytes / 1048576).toFixed(1)}MB · 命中 ${stats.hits} / 未命中 ${stats.misses}`)
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
        trimEnd: element.trimEnd,
      }))
      if (mainElements.length === 0) throw new Error('项目中没有可编辑的主轨片段')

      const fps = project.fps.numerator / project.fps.denominator
      const profile = { ...BASE_PROFILE, frameRate: project.fps }
      const activeClips = clipHistory.reset(mainElements, '导入项目', name) ?? mainElements
      const duration = timelineDuration(activeClips)
      const plan = adapter.evaluate<FramePlanView>({
        kind: 'buildFramePlan', durationTicks: duration, profile,
      })
      const codecs = await probeWebCodecsSupport()
      setSession({
        adapter, project, info: adapter.discover(), codecs, fps,
        ticksPerFrame: plan.ticksPerFrame, profile, projectTrackCount: tracks.length,
      })
      setOriginalElements(mainElements)
      setElements(activeClips)
      setMediaStatus(activeClips === mainElements ? '未加载素材' : '已恢复上次编辑会话（可撤销）')
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
      setAdjustments(ripple.adjustments)
      setElements(next)
      clipHistory.record(next, '删除片段')
      setSelectedId(null)
      setFrameCount(plannedFrameCount(next, session.adapter, session.profile))
      setFrameIndex(0)
      setPlaying(false)
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }

  /** 应用一次片段编辑：无变化时提示原因，有变化则重算帧计划并复位选中。 */
  const applyClipEdit = (
    unchangedHint: string,
    edit: (clips: CoreElement[], ctx: { clipId: string; playhead: number; ticksPerFrame: number }) => CoreElement[],
    forcedId?: string,
    label = '片段编辑',
  ) => {
    const clipId = forcedId ?? selectedId
    if (!session || !clipId) return
    setErrorText(null)
    const ctx = {
      clipId,
      playhead: frameIndex * session.ticksPerFrame,
      ticksPerFrame: session.ticksPerFrame,
    }
    const next = edit(elements, ctx)
    if (next === elements) {
      setErrorText(unchangedHint)
      return
    }
    setElements(next)
    clipHistory.record(next, label)
    setSelectedId(null)
    setPlaying(false)
    setFrameCount(plannedFrameCount(next, session.adapter, session.profile))
    setFrameIndex(Math.min(frameIndex, frameCount - 1))
  }

  /** UI 第三批：属性面板提交，时间与时长仍交给 core 的约束函数处理。 */
  const applyPropertyPatch = (patch: ClipPatch) => {
    if (!selectedId) return
    applyClipEdit('属性未变化或超出时间轴约束', (clips, ctx) => {
      const current = clips.find((item) => item.id === ctx.clipId)
      if (!current) return clips
      let next = clips
      if (patch.startTime !== undefined && patch.startTime !== current.startTime) {
        next = moveClipClamped(next, ctx.clipId, patch.startTime)
      }
      if (patch.duration !== undefined && patch.duration !== current.duration) {
        next = resizeClipEdge(next, ctx.clipId, 'right', patch.duration - current.duration, ctx.ticksPerFrame)
      }
      if (patch.trimStart !== undefined || patch.trimEnd !== undefined) {
        next = next.map((item) => item.id === ctx.clipId
          ? { ...item, trimStart: patch.trimStart ?? item.trimStart, trimEnd: patch.trimEnd ?? item.trimEnd }
          : item)
      }
      return next
    }, selectedId, '编辑属性')
  }

  /** UI 第三批：把当前剪辑决策保存为 OpenCut 工作区快照 JSON。 */
  const handleSaveSnapshot = () => {
    if (!session) return
    const snapshot = createSnapshot({
      name: session.project.name,
      fps: session.fps,
      ticksPerFrame: session.ticksPerFrame,
      ticksPerSecond: TICKS_PER_SECOND,
      frameCount,
      elements,
      savedAt: new Date().toISOString(),
    })
    const url = URL.createObjectURL(new Blob([snapshotToJson(snapshot)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'opencut-project.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    setErrorText(null)
  }

  /** UI 第三批：加载快照并恢复工作区（校验失败给中文提示，不改动现状）。 */
  const handleLoadSnapshot = async (file: File | undefined) => {
    if (!file || !session) return
    const parsed = parseSnapshot(await file.text())
    if (!parsed.ok) {
      setErrorText(`项目快照不兼容：${parsed.error}`)
      return
    }
    const restored: CoreElement[] = parsed.snapshot.elements.map((item) => ({ ...item }))
    setElements(restored)
    clipHistory.record(restored, '加载项目快照')
    setSelectedId(null)
    setAdjustments([])
    setPlaying(false)
    setFrameIndex(0)
    setFrameCount(plannedFrameCount(restored, session.adapter, session.profile))
    setSourceName(parsed.snapshot.name)
    setErrorText(null)
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

  /** UI 第三批：非修饰键快捷键；输入框聚焦与 Ctrl/Meta/Alt 组合由匹配层跳过。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target: event.target as HTMLElement | null,
      })
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'togglePlay':
          setPlaying((value) => !value)
          break
        case 'prevFrame':
          setPlaying(false)
          setFrameIndex((value) => Math.max(0, value - 1))
          break
        case 'nextFrame':
          setPlaying(false)
          setFrameIndex((value) => Math.min(frameCount - 1, value + 1))
          break
        case 'firstFrame':
          setPlaying(false)
          setFrameIndex(0)
          break
        case 'lastFrame':
          setPlaying(false)
          setFrameIndex(Math.max(0, frameCount - 1))
          break
        case 'deleteSelected':
          deleteSelected()
          break
        case 'splitAtPlayhead':
          applyClipEdit('播放头不在选中片段内部，无法分割',
            (cs, ctx) => splitClipAt(cs, ctx.clipId, ctx.playhead))
          break
        case 'trimIn':
          applyClipEdit('播放头不在选中片段内部，无法设置入点',
            (cs, ctx) => trimClipInAt(cs, ctx.clipId, ctx.playhead))
          break
        case 'trimOut':
          applyClipEdit('播放头不在选中片段内部，无法设置出点',
            (cs, ctx) => trimClipOutAt(cs, ctx.clipId, ctx.playhead))
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  /** 真实导出：同一帧源/音源编码为 MP4（H.264+AAC）或 WebM（VP9/AV1 + Opus）。 */
  const handleExport = async () => {
    if (!session) return
    const container = exportSettings.container
    if (!isExportSupported()) {
      setExportState({ status: 'error', done: 0, total: 0, message: '当前浏览器不支持 WebCodecs 导出', url: null, bytes: 0 })
      return
    }
    if (exportState.url) URL.revokeObjectURL(exportState.url)
    setExportState({ status: 'running', done: 0, total: frameCount, message: '', url: null, bytes: 0 })
    try {
      let audioSource: PcmAudio | undefined
      if (exportSettings.includeAudio && media?.audio && await (container !== 'mp4' ? isOpusEncodingSupported() : isAacEncodingSupported())) {
        audioSource = buildTimelineAudio({
          clips: elements,
          frameCount,
          fps: session.fps,
          ticksPerFrame: session.ticksPerFrame,
          sourceAudio: media.audio,
          ticksPerSecond: TICKS_PER_SECOND,
        })
      }
      const exporter = container === 'mp4' ? exportProjectToMp4
        : container === 'webm' ? exportProjectToWebM : exportProjectToAv1WebM
      const result = await exporter({
        width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
        fps: session.fps, frameCount, ticksPerFrame: session.ticksPerFrame,
        profile: buildExportProfile(session.profile, exportSettings), params: DEMO_PARAMS,
        frameSource,
        audioSource,
        onProgress: (done, total) => setExportState((previous) => ({ ...previous, done, total })),
      })
      setExportState({
        status: 'done', done: result.frameCount, total: frameCount,
        message: `已导出 ${result.frameCount} 帧 · ${result.durationSeconds.toFixed(2)}s${result.hasAudio ? (container !== 'mp4' ? ' · 含 Opus 音轨' : ' · 含 AAC 音轨') : ''}`,
        filename: exportFilename(exportSettings),
        url: URL.createObjectURL(result.blob), bytes: result.bytes,
      })
    } catch (error) {
      setExportState({
        status: 'error', done: 0, total: frameCount,
        message: error instanceof Error ? error.message : String(error), url: null, bytes: 0,
      })
    }
  }

  /** 生成 3840×2160 素材，导入后测量代理帧 scrub 的量化基准。 */
  const handleBenchmark = async () => {
    if (!session) return
    setErrorText(null)
    setBenchmarkInfo('正在生成 3840×2160 基准素材…')
    try {
      const started = performance.now()
      const file = await createBenchmarkVideoFile()
      const encodeMs = Math.round(performance.now() - started)
      await readFile(file)
      await new Promise((resolve) => window.setTimeout(resolve, 200))
      const result = measureFrameCost((index) => frameSource(index), 30)
      setBenchmarkInfo(`4K 源 ${file.size} 字节 · 编码 ${encodeMs}ms · ${formatBenchmark(result)}`)
    } catch (error) { setBenchmarkInfo(formatCoreError(error)) }
  }

  /** 把当前代理帧编码成低分辨率 MP4 供下载或跨设备复用。 */
  const handleProxyExport = async () => {
    if (!media) return
    try {
      if (proxyUrl) URL.revokeObjectURL(proxyUrl)
      setProxyUrl(URL.createObjectURL(await createProxyFile(media)))
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

  /** 导入 OTIO 交换文件，按其视频轨重建时间轴（素材仍用当前已导入媒体）。 */
  const handleOtioImport = async (file: File | undefined) => {
    if (!session || !file) return
    setErrorText(null)
    try {
      const clips = otioImportToClips(await file.text(), session.adapter)
      if (clips.length === 0) {
        setErrorText('OTIO 文件没有可用的视频轨片段（Gap 或空轨道不会导入）')
        return
      }
      setElements(clips)
      setOriginalElements(clips)
      setSelectedId(null)
      setAdjustments([])
      setFrameIndex(0)
      setPlaying(false)
      setSourceName(file.name)
      clipHistory.record(clips, '导入 OTIO')
      setFrameCount(plannedFrameCount(clips, session.adapter, session.profile))
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }

  /** 把当前剪辑导出为 OTIO 交换文件（仅视频轨的剪辑决策）。 */
  const handleOtioExport = async () => {
    if (!session) return
    try {
      const text = clipsToOtioText(elements, sourceName, session.fps, media?.name ?? null, session.adapter)
      if (otioUrl) URL.revokeObjectURL(otioUrl)
      setOtioUrl(URL.createObjectURL(new Blob([text], { type: 'application/json' })))
    } catch (error) { setErrorText(formatCoreError(error)) }
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
      await readFile(await createDemoVideoFile())
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setMediaStatus('演示素材生成失败')
    }
  }

  const activeClip = clipAtTime(elements, frameIndex * (session?.ticksPerFrame ?? 0))?.id ?? (session ? '空档' : '—')
  const selectedElement = elements.find((element) => element.id === selectedId) ?? null

  return (
    <main style={SURFACE_STYLE} className="classic-ui-root">
      <TopBar
        projectName={session?.project.name ?? '未加载'}
        projectVersion={session?.project.version ?? 0}
        sceneCount={session?.project.sceneCount ?? 0}
        trackCount={session?.projectTrackCount ?? 0}
        actions={[
          { label: '撤销', disabled: !clipHistory.canUndo, onClick: clipHistory.undo },
          { label: '重做', disabled: !clipHistory.canRedo, onClick: clipHistory.redo },
          { label: '保存项目', disabled: !session, onClick: handleSaveSnapshot },
          { label: '加载快照', disabled: !session, onClick: () => snapshotFileRef.current?.click() },
        ]}
        onExport={() => void handleExport()}
        exportDisabled={!session || exportState.status === 'running'}
        onToggleSettings={() => setSettingsOpen((value) => !value)}
        settingsOpen={settingsOpen}
        exportState={exportState}
        otioUrl={otioUrl}
      />
      <input ref={snapshotFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
        onChange={(event) => void handleLoadSnapshot(event.target.files?.[0])} />
      <ExportSettingsPanel
        open={settingsOpen}
        settings={exportSettings}
        onChange={setExportSettings}
        onExport={() => void handleExport()}
        exportDisabled={!session || exportState.status === 'running'}
        resolution={`${PREVIEW_WIDTH}×${PREVIEW_HEIGHT}`}
      />

      {!session && !errorText && <div style={{ ...PANEL_STYLE, color: TEXT_MAIN }}>正在加载项目与 Rust core WASM…</div>}
      {errorText && <div style={{ ...PANEL_STYLE, color: '#fecaca' }}>{errorText}</div>}

      {session && (
        <>
          <div style={WORKSPACE_STYLE}>
            <MediaPanel
              projectFileRef={projectFileRef}
              videoFileRef={videoFileRef}
              otioFileRef={otioFileRef}
              onDropFile={(file) => void readFile(file)}
              onOtioFile={(file) => void handleOtioImport(file)}
              onDemo={() => void handleDemoClip()}
              sourceName={sourceName}
              mediaStatus={mediaStatus}
            />
            <PreviewSection
              canvasRef={canvasRef}
              playing={playing}
              onTogglePlay={() => setPlaying((value) => !value)}
              frameIndex={frameIndex}
              frameCount={frameCount}
              onSeek={(frame) => { setPlaying(false); setFrameIndex(frame) }}
              timecode={`帧 ${frameIndex + 1}/${frameCount} · ${(frameIndex * session.ticksPerFrame / TICKS_PER_SECOND).toFixed(2)}s · 片段 ${activeClip}`}
            />
            <PropertiesPanel selected={selectedElement} onChange={applyPropertyPatch} />
          </div>

          <TimelineSection
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            adjustments={adjustments}
            frameIndex={frameIndex}
            frameCount={frameCount}
            ticksPerFrame={session.ticksPerFrame}
            ticksPerSecond={TICKS_PER_SECOND}
            onSeek={(frame) => { setPlaying(false); setFrameIndex(frame) }}
            onMoveClip={(id, start) => applyClipEdit('片段被相邻片段挡住，无法移动到该位置', (cs) => moveClipClamped(cs, id, start), id, '拖拽片段')}
            onResizeClip={(id, edge, delta) => applyClipEdit('片段已到时长边界', (cs) => resizeClipEdge(cs, id, edge, delta, session?.ticksPerFrame ?? 4000), id, '边缘裁剪')}
            statusText={`${selectedId ? `已选中 ${selectedId}` : '未选中片段'} · 剩余 ${elements.length} 个`}
            actions={[
              { label: '删除选中片段', disabled: !selectedId || elements.length < 2, onClick: deleteSelected },
              { label: '在播放头分割', disabled: !selectedId,
                onClick: () => applyClipEdit('播放头不在选中片段内部，无法分割', (cs, ctx) => splitClipAt(cs, ctx.clipId, ctx.playhead)) },
              { label: '入点设到播放头', disabled: !selectedId,
                onClick: () => applyClipEdit('播放头不在选中片段内部，无法设置入点', (cs, ctx) => trimClipInAt(cs, ctx.clipId, ctx.playhead)) },
              { label: '出点设到播放头', disabled: !selectedId,
                onClick: () => applyClipEdit('播放头不在选中片段内部，无法设置出点', (cs, ctx) => trimClipOutAt(cs, ctx.clipId, ctx.playhead)) },
              { label: '左移一帧', disabled: !selectedId,
                onClick: () => applyClipEdit('片段已在时间轴起点', (cs, ctx) => moveClipBy(cs, ctx.clipId, -ctx.ticksPerFrame)) },
              { label: '右移一帧', disabled: !selectedId,
                onClick: () => applyClipEdit('片段无法再右移', (cs, ctx) => moveClipBy(cs, ctx.clipId, ctx.ticksPerFrame)) },
            ]}
          />

          <DiagnosticsPanel
            items={[
              { label: '代理帧缓存', value: cacheInfo },
              { label: '剪辑历史', value: clipHistory.label },
              { label: '4K scrub 基准', value: benchmarkInfo || '未运行' },
              { label: '帧耗时', value: `${frameCost.toFixed(2)}ms（阈值 ${SCRUB_THRESHOLD_MS}ms ${frameCost <= SCRUB_THRESHOLD_MS ? '达标' : '超标'}）` },
              { label: 'core', value: `API ${session.info.apiVersion} / ${session.info.backendId} · WebCodecs ${session.codecs.available ? '可用' : '不可用'}` },
              { label: '兼容提示', value: `${session.project.warnings.length} 条` },
            ]}
            proxyUrl={proxyUrl}
          />
        </>
      )}
    </main>
  )
}
