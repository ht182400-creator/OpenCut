import { useEffect, useRef, useState } from 'react'
import './classic-ui/theme.css'
import { CLASSIC_PANEL_CONFIG, CLASSIC_PANEL_LIMITS } from './classic-ui/tokens'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable'
import { downsampleForWaveform, mixdownToMono } from './audio'
import {
  ASSET_THUMBNAIL_HEIGHT,
  ASSET_THUMBNAIL_WIDTH,
  buildThumbnailCacheKey,
  makeThumbnailDataUrl,
  thumbnailCache,
} from './thumbnail'
import { isVerificationFrameMode, resolvePreviewPixels } from './frame-source'
import { useClipHistory, EMPTY_HISTORY_PARTS, type HistoryParts } from './clip-history'
import { createEditorAdapter, formatCoreError } from './editor-adapter'
import { createEditorActions } from './editor-actions'
import { useSelection } from './use-selection'
import {
  DEFAULT_MEDIA_DURATION_SECONDS,
  DEFAULT_TEXT_CONTENT,
  GRAPHIC_ID_PREFIX,
  MEDIA_ID_PREFIX,
  TEXT_ID_PREFIX,
  TICKS_PER_SECOND as MODEL_TICKS_PER_SECOND,
  buildGraphicElement,
  buildMediaElement,
  buildTextElement,
  insertElement,
  makeElementId,
  moveElementToTrack,
  patchElementParams,
  resolveAutoPlacement,
  sampleParamsAtTime,
  type ElementKind,
} from './element-model'
import {
  applyVisualEffects,
  composeTransform,
  rasterizeText,
  readColorAdjust,
  readRectMask,
  resolveTextLayout,
  transformFromElement,
  type ElementTransform,
  type RectMask,
} from './element-composite'
import {
  AUTOSAVE_DEBOUNCE_MS,
  defaultAutosaveStorage,
  persistAutosaveAsync,
  readAutosaveAsync,
  type AsyncAutosaveStorage,
  type ExtraTrackState,
} from './project-autosave'
import { defaultAutosaveBackend, migrateLegacyAutosave } from './autosave-idb'
import {
  BASE_PROFILE,
  PANEL_STYLE,
  SCRUB_THRESHOLD_MS,
  SURFACE_STYLE,
  TEXT_MAIN,
  DiagnosticsPanel,
  ExportSettingsPanel,
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
} from './editor-ui'
import type { ProjectView } from './editor-adapter'
import { bookmarksFromProject, trackFlagsFromProject } from './project-write'
import { DEFAULT_RESOLUTION, resolutionLabel, PROXY_WIDTH } from './resolution'
import { ProjectSettingsPanel, type AspectRatioOption, type BackgroundOption } from './classic-ui/project-settings-panel'
import type { ResolutionPreset } from './resolution'
import {
  DEFAULT_EXPORT_SETTINGS,
  type ExportSettings,
} from './export-settings'
import { matchShortcut, resolveBindings } from './editor-shortcuts'
import type { Keybindings } from './editor-shortcuts'
import {
  jumpBackwardFiveSeconds,
  jumpForwardFiveSeconds,
  seekBackwardOneSecond,
  seekForwardOneSecond,
  splitAndRemoveLeft,
  splitAndRemoveRight,
  toggleBookmarkAt,
} from './shortcut-actions-model'
import { ClassicTimeline } from './classic-ui/timeline'
import type { ClassicTimelineTrack, TimelineAction } from './classic-ui/timeline'
import { AssetsPanel } from './classic-ui/assets-panel'
import type { AssetDragPayload, AssetItem } from './classic-ui/assets-panel'
import { loadAssetCatalog, type AssetCatalog, type CatalogEffect } from './asset-catalog'
import { PropertiesPanel } from './classic-ui/properties-panel'
import { PreviewSection } from './classic-ui/preview-section'
import { ShortcutsDialog } from './classic-ui/shortcuts-dialog'
import { MobileGate } from './classic-ui/mobile-gate'
import {
  MAX_DECODE_FRAMES,
  createDemoVideoFile,
  decodeVideoFile,
  getFrameCacheStats,
  getPersistedCacheStats,
  isVideoFile,
  mediaFrameAt,
  type DecodedMedia,
} from './media'
import { mapProjectFrameWithSpeed } from './speed-model'
import { alphaBlendInto, rasterizeGraphic, readGraphicParams } from './graphic-model'
import {
  TICKS_PER_SECOND,
  clipAtTime,
  moveClipBy,
  moveClipClamped,
  plannedFrameCount,
  resizeClipEdge,
  splitClipAt,
  timelineDuration,
  trimClipInAt,
  trimClipOutAt,
} from './timeline'
import { probeWebCodecsSupport } from './webcodecs'
import { probeHardwareEncoder, probeWebGL2, probeWebGPU, summarizeCapability, type GpuCapabilityReport } from './gpu-capability'


const PROJECT_FIXTURE_URL = '/fixtures/classic-project-v31.json'

/**
 * 从经典版项目视图提取时间轴三轨（顺序：overlay → main → audio，与 core 一致）。
 * 各轨元素转为编辑器通用的片段结构；main 轨的可编辑状态由页面另行覆盖。
 * @param project 项目只读视图
 * @returns {ClassicTimelineTrack[]} 按经典版顺序排列的轨道
 */
function buildTimelineTracks(
  project: import('./editor-adapter').ProjectView,
): ClassicTimelineTrack[] {
  const scene = project.scenes.find((item) => item.id === project.currentSceneId)
    ?? project.scenes[0]
  if (!scene) return []
  return scene.tracks.map((track) => ({
    id: track.id,
    trackType: track.trackType,
    label: track.trackType === 'video' ? '主轨' : track.trackType === 'audio' ? '音频' : track.id,
    elements: track.elements.map((element) => ({
      id: element.id,
      startTime: element.startTime,
      duration: element.duration,
      trimStart: element.trimStart,
    })),
  }))
}

/**
 * Web-first 编辑器：导入项目 JSON 与真实音视频素材 → 删除/分割片段 →
 * 逐帧预览（三级代理缓存 + 片段 trimStart 映射）→ 带 AAC 音轨导出 MP4，
 * 并支持 OTIO 交换格式双向导入导出（W-10）。
 * 所有 core 调用都经 `editor-adapter`（I-01），错误统一友好提示。
 * @returns {React.ReactElement} 页面
 */
export function Editor() {
  const [session, setSession] = useState<Session | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [elements, setElements] = useState<CoreElement[]>([])
  /** 批 2：经典版三轨（overlay/main/audio）视图；main 轨元素在渲染时用可编辑 elements 覆盖。 */
  const [projectTracks, setProjectTracks] = useState<ClassicTimelineTrack[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adjustments, setAdjustments] = useState<RippleAdjustment[]>([])
  const [frameIndex, setFrameIndex] = useState(0)
  const [frameCount, setFrameCount] = useState(1)
  /** 第二档项3：时间轴吸附开关（受控，磁铁按钮与快捷键 n 共用）。 */
  const [snapping, setSnapping] = useState(true)
  const [frameCost, setFrameCost] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [media, setMedia] = useState<DecodedMedia | null>(null)
  const [mediaStatus, setMediaStatus] = useState('未加载素材')
  /** 批 7.3：元素 id → 真实 PCM 峰值数组，供时间轴绘制波形。 */
  const [waveforms, setWaveforms] = useState<ReadonlyMap<string, Uint8Array>>(() => new Map())
  /** 批 7.4：元素 id → 真实帧缩略图 data URL，供时间轴视频片段显示画面。 */
  const [videoThumbnails, setVideoThumbnails] = useState<ReadonlyMap<string, string>>(() => new Map())

  /**
   * P1：选择/剪贴板 hook。回调内引用 clipHistory/session 等后续 const 是安全的——
   * 这些 handler 只在用户交互时才执行，那时 render 已完成、const 均已初始化。
   */
  const selection = useSelection({
    elements, primaryId: selectedId,
    setPrimaryId: setSelectedId,
    setElements,
    recordHistory: (clips, label, selectedId) => clipHistory.record(
      clips, label, selectedId === undefined ? {} : { selectedId },
    ),
    recomputeFrameCount: (clips) => {
      if (session) setFrameCount(plannedFrameCount(clips, session.adapter, session.profile))
    },
    formatError: formatCoreError,
    setErrorText, setMediaStatus,
    canEdit: () => Boolean(session),
    playheadTicks: () => frameIndex * (session?.ticksPerFrame ?? 1),
  })

  /**
   * 批 7.3：素材音轨加载后，用 core 把真实 PCM 抽样成峰值，绑定到当前场景的音频/主轨元素。
   * 多声道先降混为单声道；超长素材（如 2 分钟视频）先峰值保真降采样到 core 上限，
   * 避免 TOO_MANY_PCM_SAMPLES；core 抽样失败或非 PCM 素材则清空波形并给出友好提示。
   */
  useEffect(() => {
    if (!session || !media?.audio) {
      setWaveforms(new Map())
      return
    }
    try {
      const mono = downsampleForWaveform(mixdownToMono(media.audio))
      const peaks = session.adapter.waveformPeaksFromPcm(mono, { bins: 16 })
      const scene = session.project.scenes.find((item) => item.id === session.project.currentSceneId)
        ?? session.project.scenes[0]
      const bindings = new Map<string, Uint8Array>()
      for (const track of scene?.tracks ?? []) {
        if (track.trackType === 'audio' || track.id === 'main') {
          for (const element of track.elements) bindings.set(element.id, peaks)
        }
      }
      setWaveforms(bindings)
    } catch (error) {
      setWaveforms(new Map())
      setErrorText(`波形抽样失败：${formatCoreError(error)}`)
    }
  }, [session, media])

  /**
   * 批 7.4：素材帧加载后，用 core 把首帧下采样成缩略图，绑定到当前场景的视频/主轨元素。
   * 缓存按素材指纹 + 帧索引 + 尺寸隔离；core 失败或代表性帧缺失时不绑定，时间轴保持占位。
   */
  useEffect(() => {
    if (!session || !media || media.frames.length === 0) {
      setVideoThumbnails(new Map())
      return
    }
    try {
      const scene = session.project.scenes.find((item) => item.id === session.project.currentSceneId)
        ?? session.project.scenes[0]
      const bindings = new Map<string, string>()
      const videoElements = (scene?.tracks ?? [])
        .filter((track) => track.trackType === 'video')
        .flatMap((track) => track.elements)
      if (videoElements.length > 0) {
        const url = makeThumbnailDataUrl(
          session.adapter, media.frames[0], media.width, media.height,
          ASSET_THUMBNAIL_WIDTH, ASSET_THUMBNAIL_HEIGHT,
        )
        if (url) for (const element of videoElements) bindings.set(element.id, url)
      }
      setVideoThumbnails(bindings)
    } catch (error) {
      setVideoThumbnails(new Map())
      setErrorText(`缩略图生成失败：${formatCoreError(error)}`)
    }
  }, [session, media])
  /** 批 3：素材面板网格数据；导入视频后追加，供 112px 卡片网格展示。 */
  const [assets, setAssets] = useState<AssetItem[]>([])
  /** D 档：本地素材目录（异步加载，失败降级空态）。 */
  const [catalog, setCatalog] = useState<AssetCatalog | null>(null)
  /** D 档：音效收藏（会话内持久化由 autosave 扩展承载，本批先内存态）。 */
  const [soundFavorites, setSoundFavorites] = useState<Set<string>>(new Set())
  const [cacheInfo, setCacheInfo] = useState('代理缓存 0 份')
  const [proxyUrl, setProxyUrl] = useState<string | null>(null)
  const [otioUrl, setOtioUrl] = useState<string | null>(null)
  const [benchmarkInfo, setBenchmarkInfo] = useState('')
  const [exportState, setExportState] = useState<ExportState>({
    status: 'idle', done: 0, total: 0, message: '', url: null, bytes: 0,
  })
  /** P4 批 5：导出取消控制器（每次开始导出重建，取消时 abort）。 */
  const exportAbortRef = useRef<AbortController | null>(null)
  /** P4 批 6：轨道静音/隐藏（第一档 A 起同时写回经典版 JSON）。 */
  const [trackFlags, setTrackFlags] = useState<{ muted: string[]; hidden: string[] }>({ muted: [], hidden: [] })
  /** P4 批 6 + UI 长尾：书签（autosave 持久化，note 可选备注）。 */
  const [bookmarks, setBookmarks] = useState<Array<{ id: string; ticks: number; name: string; note?: string }>>([])
  /** U-06：用户新增轨道（autosave 持久化，写回时经 allowNewTracks 落到经典版 JSON）。 */
  const [extraTracks, setExtraTracks] = useState<ExtraTrackState[]>([])
  /** U-02：历史快照的编辑器侧状态引用，供 record 读取，避免改动所有调用方签名。 */
  const historyPartsRef = useRef<HistoryParts>(EMPTY_HISTORY_PARTS)
  historyPartsRef.current = { bookmarks, trackFlags, selectedId, adjustments }
  const [sourceName, setSourceName] = useState('内置示例项目')
  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS)
  /** 批 7.2：当前帧分辨率，贯穿解码/合成/预览/导出；默认 320×180 保持回归。 */
  const [resolution, setResolution] = useState<ResolutionPreset>(DEFAULT_RESOLUTION)
  /** 批 1：亮/暗主题（对应经典版 ThemeToggle，作用域限定在编辑器外壳）。 */
  const [dark, setDark] = useState(false)
  /** 批 6：快捷键帮助对话框开关（经典版项目菜单 Shortcuts 入口）。 */
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** P2：GPU/编解码能力报告（只读探测，供诊断面板提示）。 */
  const [gpuCapability, setGpuCapability] = useState<GpuCapabilityReport | null>(null)
  /** U-02：撤销/重做恢复完整编辑器快照（片段 + 书签 + 轨道标志 + 选中态 + ripple）。 */
  const clipHistory = useClipHistory((snapshot) => {
    setElements(snapshot.clips as CoreElement[])
    setBookmarks(snapshot.bookmarks)
    setTrackFlags(snapshot.trackFlags)
    setSelectedId(snapshot.selectedId)
    setAdjustments(snapshot.adjustments)
    setPlaying(false)
    if (session) setFrameCount(plannedFrameCount(snapshot.clips, session.adapter, session.profile))
  }, () => historyPartsRef.current)
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
      /** U-07：把元素视图转成编辑器片段，非 main 轨带 trackId 以保留轨归属。 */
      const toCoreElement = (element: ProjectView['scenes'][number]['tracks'][number]['elements'][number], trackId?: string): CoreElement => ({
        id: element.id,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart,
        trimEnd: element.trimEnd,
        // 批 7.5：保留类型特化字段，使属性面板编辑与写回不丢原值。
        name: element.name,
        content: element.content,
        elementType: element.elementType,
        // P0：读取可视参数（不透明度/位置/缩放等），供预览与属性面板使用。
        params: (element.params ?? undefined) as CoreElement['params'],
        // U-07：非 main 轨元素带轨道归属，供分轨渲染与写回路由。
        ...(trackId && trackId !== 'main' ? { trackId } : {}),
      })
      const mainElements: CoreElement[] = (mainTrack?.elements ?? []).map((element) => toCoreElement(element))
      // U-07：overlay/audio 轨元素也纳入可编辑集合（带 trackId），否则无法编辑与写回。
      const otherElements: CoreElement[] = tracks
        .filter((track) => track.id !== 'main')
        .flatMap((track) => track.elements.map((element) => toCoreElement(element, track.id)))
      const allElements = [...mainElements, ...otherElements]
      if (mainElements.length === 0) throw new Error('项目中没有可编辑的主轨片段')

      const fps = project.fps.numerator / project.fps.denominator
      // 批 7.2：profile 宽高跟随当前分辨率，保证无素材时的 core 渲染帧与画布尺寸一致。
      const profile = {
        ...BASE_PROFILE, width: resolution.width, height: resolution.height, frameRate: project.fps,
      }
      const historySnapshot = clipHistory.reset(allElements, '导入项目', name)
      const historyClips = historySnapshot?.clips ?? allElements
      const plan = adapter.evaluate<FramePlanView>({
        kind: 'buildFramePlan', durationTicks: timelineDuration(historyClips), profile,
      })

      // U-03：先把旧 localStorage 自动保存一次性迁移到 IndexedDB，再走异步读取。
      const autosaveBackend = defaultAutosaveBackend()
      autosaveBackendRef.current = autosaveBackend
      await migrateLegacyAutosave(defaultAutosaveStorage(), autosaveBackend)
      // 同项目且有合法快照时恢复元素与编辑现场；否则用历史/项目基线。
      const saved = await readAutosaveAsync(autosaveBackend, name)
      const restored: CoreElement[] = saved ? saved.state.elements.map((item) => ({ ...item })) : historyClips
      const duration = timelineDuration(restored)
      const restoredPlan = saved
        ? adapter.evaluate<FramePlanView>({ kind: 'buildFramePlan', durationTicks: duration, profile })
        : plan
      const codecs = await probeWebCodecsSupport()
      setSession({
        adapter, project, info: adapter.discover(), codecs, fps,
        originalJson: text,
        ticksPerFrame: restoredPlan.ticksPerFrame, profile, projectTrackCount: tracks.length,
      })
      setElements(restored)
      setProjectTracks(buildTimelineTracks(project))
      setMediaStatus(saved
        ? `已恢复自动保存的编辑现场（${saved.state.elements.length} 个片段）`
        : restored === historyClips ? '未加载素材' : '已恢复上次编辑会话（可撤销）')
      setAdjustments(saved?.state.adjustments ?? historySnapshot?.adjustments ?? [])
      setSelectedId(saved?.state.selectedId ?? historySnapshot?.selectedId ?? null)
      selection.resetSelection()
      setFrameIndex(saved?.state.frameIndex ?? 0)
      setFrameCount(Math.max(restoredPlan.frameCount, 1))
      setSourceName(name)
      setResolution(saved?.state.resolution ?? resolution)
      // 优先级：autosave > 历史快照 > 项目 JSON 的 muted/hidden/bookmarks。
      setTrackFlags(saved?.state.trackFlags ?? historySnapshot?.trackFlags ?? trackFlagsFromProject(project))
      setBookmarks(saved?.state.bookmarks ?? historySnapshot?.bookmarks ?? bookmarksFromProject(project))
      // U-06：新增轨只从 autosave 恢复（旧数据无此字段则为空）。
      setExtraTracks(saved?.state.extraTracks ?? [])
    } catch (error) {
      setErrorText(formatCoreError(error))
      setSession(null)
    }
  }

  /** D 档：挂载时异步加载本地素材目录（CC0 音效 / CC BY 贴纸 / 效果预设 / 设置枚举）。 */
  useEffect(() => {
    void loadAssetCatalog().then(setCatalog)
  }, [])

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
    // P2：一次性能力探测（同步 WebGL2/WebGPU + WebCodecs 结果推导）。
    try {
      void probeWebCodecsSupport().then((codecs) => {
        setGpuCapability(summarizeCapability(
          probeWebGL2(), probeWebGPU(),
          probeHardwareEncoder(codecs.configSupported, codecs.reason),
        ))
      })
    } catch (error) {
      setGpuCapability(summarizeCapability(probeWebGL2(), probeWebGPU(),
        probeHardwareEncoder(false, formatCoreError(error))))
    }
  }, [])

  /**
   * P0 自动保存：编辑现场变化后防抖落盘。仅在会话就绪时写入，
   * 用 ref 保存最新状态以避免 effect 依赖状态导致每次按键都重设定时器开销。
   */
  /** U-03：异步自动保存后端句柄，项目加载时初始化（IndexedDB 优先）。 */
  const autosaveBackendRef = useRef<AsyncAutosaveStorage | null>(null)
  const autosaveStateRef = useRef({ elements, frameIndex, selectedId, adjustments, resolution, sourceName, trackFlags, bookmarks, extraTracks })
  autosaveStateRef.current = { elements, frameIndex, selectedId, adjustments, resolution, sourceName, trackFlags, bookmarks, extraTracks }
  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      // U-03：异步写入 IndexedDB；后端内部已做 localStorage 降级，失败返回 false 不阻断编辑。
      void persistAutosaveAsync(autosaveStateRef.current, sourceName, autosaveBackendRef.current)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [session, elements, frameIndex, selectedId, adjustments, resolution, sourceName, trackFlags, bookmarks, extraTracks])

  /** 删除选中片段，由 core 计算并应用 ripple。 */
  const deleteSelected = () => {
    if (!session || !selectedId || elements.length < 2) return
    try {
      // U-07：ripple 按轨分组——不同轨时间独立，禁止把跨轨片段当邻居。
      const trackIds = [...new Set(elements.map((item) => item.trackId ?? 'main'))]
      const allAdjustments: RippleAdjustment[] = []
      const built: CoreElement[] = []
      for (const trackId of trackIds) {
        const trackElements = elements.filter((item) => (item.trackId ?? 'main') === trackId)
        const after = trackElements.filter((item) => item.id !== selectedId)
        if (after.length === trackElements.length) {
          // 被删片段不在此轨，该轨无需 ripple，原样保留。
          built.push(...trackElements)
          continue
        }
        const before = { overlay: [], main: { id: 'main', elements: trackElements }, audio: [] }
        const ripple = session.adapter.evaluate<RippleResponse>({
          kind: 'rippleAdjustments', before,
          after: { overlay: [], main: { id: 'main', elements: after }, audio: [] },
        })
        const applied = session.adapter.evaluate<ApplyResponse>({
          kind: 'rippleApply', tracks: before, adjustments: ripple.adjustments,
        })
        const remainingIds = new Set(after.map((item) => item.id))
        const trimById = new Map(trackElements.map((item) => [item.id, item.trimStart]))
        const adjusted = applied.tracks.main.elements
          .filter((item) => remainingIds.has(item.id))
          .map((item) => ({
            ...item,
            trimStart: trimById.get(item.id) ?? 0,
            ...(trackId !== 'main' ? { trackId } : {}),
          }))
        built.push(...adjusted)
        allAdjustments.push(...ripple.adjustments)
      }
      const next = built
      setAdjustments(allAdjustments)
      setElements(next)
      clipHistory.record(next, '删除片段', { selectedId: null })
      setSelectedId(null)
      setFrameCount(plannedFrameCount(next, session.adapter, session.profile))
      setFrameIndex(0)
      setPlaying(false)
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }

  /**
   * 应用一次片段编辑：无变化时提示原因，有变化则重算帧计划并复位选中。
   * @param selectedAfter U-05：编辑后保持选中的 id（跨轨移动传入，避免片段换轨后失焦）
   */
  const applyClipEdit = (
    unchangedHint: string,
    edit: (clips: CoreElement[], ctx: { clipId: string; playhead: number; ticksPerFrame: number }) => CoreElement[],
    forcedId?: string,
    label = '片段编辑',
    selectedAfter: string | null = null,
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
    clipHistory.record(next, label, { selectedId: selectedAfter })
    setSelectedId(selectedAfter)
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
      if (patch.trimStart !== undefined || patch.trimEnd !== undefined
        || patch.name !== undefined || patch.content !== undefined || patch.params !== undefined) {
        next = next.map((item) => {
          if (item.id !== ctx.clipId) return item
          const base: CoreElement = {
            ...item,
            trimStart: patch.trimStart ?? item.trimStart,
            trimEnd: patch.trimEnd ?? item.trimEnd,
            // 批 7.5：name/content 为 undefined 时保留原值，仅覆盖显式传入的字段。
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.content !== undefined ? { content: patch.content } : {}),
          }
          // P0：文字内容同步进 params，保证预览栅格化与写回用同一来源。
          const paramsPatch = { ...patch.params }
          if (patch.content !== undefined && paramsPatch.content === undefined) {
            paramsPatch.content = patch.content
          }
          return Object.keys(paramsPatch).length > 0 ? patchElementParams(base, paramsPatch) : base
        })
      }
      return next
    }, selectedId, '编辑属性')
  }

  /**
   * 生成当前帧像素：正式 UI 显示真实素材或纯色空白帧，绝不出现演示色块；
   * P0 起按当前时间命中片段的 params 做真实变换（位移/缩放/旋转/透明度）与文字栅格化，
   * 预览与导出共用本函数，保证二者一致。验证模式仍交给 core 叠加定位块。
   */
  const frameSource = (index: number): Uint8Array => {
    if (!session) throw new Error('会话尚未就绪')
    const timeTicks = index * session.ticksPerFrame
    const verification = isVerificationFrameMode()
    let basePixels: Uint8Array | null = null
    const active = clipAtTime(elements, timeTicks) as CoreElement | null

    if (media) {
      // 第二档项 2：按命中片段的 speed 参数倍速取帧（speed=1 时与原映射一致）。
      const mapping = mapProjectFrameWithSpeed(elements, timeTicks, session.fps, media.frames.length)
      basePixels = mapping.sourceFrameIndex === null
        ? blankFrame(resolution.width, resolution.height)
        : mediaFrameAt(media, mapping.sourceFrameIndex)
    }

    let pixels = resolvePreviewPixels(
      session.adapter,
      session.profile,
      basePixels,
      {
        frameIndex: index,
        timeTicks,
        durationTicks: session.ticksPerFrame,
        width: resolution.width,
        height: resolution.height,
      },
      verification,
    )

    // 验证模式保持 golden 像素不变，只做定位；正式模式叠加用户参数。
    if (verification || !active?.params) return pixels

    // P2：先在播放头对关键帧求值（无动画则原样），再据此做变换/遮罩/效果/文字。
    const sampled: CoreElement = { ...active, params: sampleParamsAtTime(active, timeTicks) }
    const transform = transformFromElement(sampled)
    pixels = composeTransform(pixels, transform, resolution.width, resolution.height)
    pixels = applyVisualEffects(
      pixels, readRectMask(sampled), readColorAdjust(sampled),
      resolution.width, resolution.height,
    )

    // 文字元素：把 content 按参数栅格化后合成（alpha 叠加，保留底图）。
    if (sampled.elementType === 'text' || (sampled.content && sampled.params?.content)) {
      const layout = resolveTextLayout(sampled, resolution.width, resolution.height)
      if (layout.text) {
        const textLayer = rasterizeText(layout, transform, resolution.width, resolution.height)
        if (textLayer) {
          for (let offset = 0; offset < textLayer.length; offset += 4) {
            const alpha = textLayer[offset + 3] / 255
            if (alpha <= 0) continue
            pixels[offset] = Math.round(textLayer[offset] * alpha + pixels[offset] * (1 - alpha))
            pixels[offset + 1] = Math.round(textLayer[offset + 1] * alpha + pixels[offset + 1] * (1 - alpha))
            pixels[offset + 2] = Math.round(textLayer[offset + 2] * alpha + pixels[offset + 2] * (1 - alpha))
          }
        }
      }
    }

    // 第二档项 2：图形元素栅格化为图层并叠加（无素材时也能独立显示）。
    if (sampled.elementType === 'graphic') {
      const graphicParams = readGraphicParams(sampled)
      const graphicLayer = rasterizeGraphic(graphicParams, resolution.width, resolution.height, transform.opacity)
      if (graphicLayer) alphaBlendInto(pixels, graphicLayer)
    }
    return pixels
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
          new ImageData(new Uint8ClampedArray(pixels), resolution.width, resolution.height), 0, 0,
        )
      }
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }, [session, frameIndex, media, elements, resolution])

  /** 播放：按帧率推进播放头，循环播放。 */
  useEffect(() => {
    if (!playing || frameCount <= 1 || !session) return
    const timer = window.setInterval(() => {
      setFrameIndex((previous) => (previous + 1) % frameCount)
    }, Math.max(16, 1000 / session.fps))
    return () => window.clearInterval(timer)
  }, [playing, frameCount, session])

  /** P3 批 2：用户重绑定后由对话框回调刷新，keydown 用最新绑定表分发。 */
  const [keybindings, setKeybindings] = useState<Keybindings>(() => resolveBindings())
  const keybindingsRef = useRef(keybindings)
  keybindingsRef.current = keybindings

  /** UI 第三批：非修饰键快捷键；输入框聚焦与 Ctrl/Meta/Alt 组合由匹配层跳过。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        target: event.target as HTMLElement | null,
      }, keybindingsRef.current)
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'togglePlay':
          setPlaying((value) => !value)
          break
        case 'stopPlayback':
          setPlaying(false)
          setFrameIndex(0)
          break
        case 'seekForward':
          setPlaying(false)
          setFrameIndex((value) => seekForwardOneSecond(value, session?.fps ?? 30, frameCount))
          break
        case 'seekBackward':
          setPlaying(false)
          setFrameIndex((value) => seekBackwardOneSecond(value, session?.fps ?? 30, frameCount))
          break
        case 'prevFrame':
          setPlaying(false)
          setFrameIndex((value) => Math.max(0, value - 1))
          break
        case 'nextFrame':
          setPlaying(false)
          setFrameIndex((value) => Math.min(frameCount - 1, value + 1))
          break
        case 'jumpForward':
          setPlaying(false)
          setFrameIndex((value) => jumpForwardFiveSeconds(value, session?.fps ?? 30, frameCount))
          break
        case 'jumpBackward':
          setPlaying(false)
          setFrameIndex((value) => jumpBackwardFiveSeconds(value, session?.fps ?? 30, frameCount))
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
        case 'splitLeft':
          applyClipEdit('播放头不在选中片段内部，无法分割左侧',
            (cs, ctx) => splitAndRemoveLeft(cs, ctx.clipId, ctx.playhead), undefined, '分割并删除左侧')
          break
        case 'splitRight':
          applyClipEdit('播放头不在选中片段内部，无法分割右侧',
            (cs, ctx) => splitAndRemoveRight(cs, ctx.clipId, ctx.playhead), undefined, '分割并删除右侧')
          break
        case 'toggleSnapping':
          setSnapping((value) => !value)
          break
        case 'trimIn':
          applyClipEdit('播放头不在选中片段内部，无法设置入点',
            (cs, ctx) => trimClipInAt(cs, ctx.clipId, ctx.playhead))
          break
        case 'trimOut':
          applyClipEdit('播放头不在选中片段内部，无法设置出点',
            (cs, ctx) => trimClipOutAt(cs, ctx.clipId, ctx.playhead))
          break
        case 'copySelected':
          selection.handleCopy()
          break
        case 'pasteAtPlayhead':
          selection.handlePaste()
          break
        case 'duplicateSelected':
          selection.handleDuplicate()
          break
        case 'selectAll':
          selection.handleSelectAll()
          break
        case 'deselectAll':
          selection.handleClear()
          break
        case 'toggleBookmark': {
          const ticks = frameIndex * (session?.ticksPerFrame ?? 0)
          const id = `bm-shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          const next = toggleBookmarkAt(bookmarks, ticks, id, `书签 ${bookmarks.length + 1}`)
          setBookmarks(next)
          clipHistory.record(elements, '切换书签', { bookmarks: next })
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

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
          width: resolution.width,
          height: resolution.height,
          fps: session.fps,
          frameCount: Math.min(frameCount, MAX_DECODE_FRAMES),
          onProgress: (done, total) => setMediaStatus(`解码中 ${done}/${total}`),
        })
        const cost = decoded.fromCache
          ? `${decoded.cacheDetail}命中 · ${decoded.decodeMilliseconds}ms`
          : `解码 ${decoded.decodeMilliseconds}ms${decoded.persisted ? ' · 已持久化' : ''}`
        setMedia(decoded)
        // 批 7.4：用 core 把首帧下采样成素材卡缩略图（缓存 key 含指纹+帧+尺寸）。
        let thumbnailUrl: string | undefined
        if (session && decoded.frames.length > 0) {
          const fingerprint = `${file.name}|${file.size}|${file.lastModified}`
          const cacheKey = buildThumbnailCacheKey({
            fingerprint, frameIndex: 0, width: ASSET_THUMBNAIL_WIDTH, height: ASSET_THUMBNAIL_HEIGHT,
          })
          thumbnailUrl = thumbnailCache.get(cacheKey) ?? makeThumbnailDataUrl(
            session.adapter, decoded.frames[0], decoded.width, decoded.height,
            ASSET_THUMBNAIL_WIDTH, ASSET_THUMBNAIL_HEIGHT,
          )
          if (thumbnailUrl) thumbnailCache.set(cacheKey, thumbnailUrl)
        }
        setAssets((prev) => prev.some((item) => item.id === decoded.name)
          ? prev
          : [...prev, {
            id: decoded.name, name: decoded.name, type: 'video',
            duration: decoded.durationSeconds, thumbnailUrl,
          }])
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

  /**
   * P1 重构：导出/高级工具 handler 由工厂注入（依赖 readFile/frameSource 已就绪）。
   * 与原地定义行为等价，闭包捕获当期状态。
   */
  const {
    handleExport, handleBenchmark, handleProxyExport,
    handleClearCache, handleOtioImport, handleOtioExport,
    handleSaveSnapshot, handleSaveProject, handleLoadSnapshot,
  } = createEditorActions({
    session, elements, media, frameCount, resolution, exportSettings, exportState,
    trackFlags, bookmarks, extraTracks,
    proxyUrl, otioUrl, sourceName,
    setExportState, setErrorText, setMediaStatus, setProxyUrl, setOtioUrl, setBenchmarkInfo,
    setElements, setSelectedId, setAdjustments, setFrameIndex, setPlaying,
    setSourceName, setFrameCount,
    frameSource, readFile, refreshCacheInfo,
    recordHistory: (clips, label, selectedId) => clipHistory.record(
      clips, label, selectedId === undefined ? {} : { selectedId },
    ),
    getExportSignal: () => exportAbortRef.current?.signal,
    onExportSettled: () => { exportAbortRef.current = null },
  })

  /** P4 批 5：开始导出（每次新建取消控制器），供顶栏/设置面板/重试共用。 */
  const startExport = () => {
    if (exportAbortRef.current) exportAbortRef.current.abort()
    exportAbortRef.current = new AbortController()
    void handleExport()
  }
  /** P4 批 5：取消当前导出（导出循环检测 signal 后停止）。 */
  const cancelExport = () => exportAbortRef.current?.abort()

  /**
   * 批 7.2：切换帧分辨率。旧代理帧的像素尺寸与新分辨率不匹配，
   * 因此清空已解码素材并提示重新导入；缓存 key 含宽高，重导会按新尺寸重建。
   */
  const handleResolutionChange = (next: ResolutionPreset) => {
    if (next.width === resolution.width && next.height === resolution.height) return
    try {
      setResolution(next)
      // 同步 core profile 宽高：无素材时 renderFrameRgba 直接读 profile 生成帧。
      if (session) {
        setSession({ ...session, profile: { ...session.profile, width: next.width, height: next.height } })
      }
      setMedia(null)
      setPlaying(false)
      setFrameIndex(0)
      setMediaStatus(
        media
          ? `分辨率已切换为 ${resolutionLabel(next.width, next.height)}，请重新导入素材以按新尺寸抽帧`
          : `分辨率已切换为 ${resolutionLabel(next.width, next.height)}`,
      )
    } catch (error) {
      setErrorText(formatCoreError(error))
    }
  }

  /** D 档：切换 FPS——同步 session 帧率与 ticksPerFrame，清空帧缓存并提示重新导入。 */
  const handleFpsChange = (fps: number) => {
    if (!session || fps <= 0) return
    try {
      const ticksPerFrame = Math.round(MODEL_TICKS_PER_SECOND / fps)
      setSession({ ...session, fps, ticksPerFrame })
      setMedia(null)
      setPlaying(false)
      setFrameIndex(0)
      setMediaStatus(`帧率已切换为 ${fps} fps，请重新导入素材以按新帧率抽帧`)
    } catch (error) {
      setErrorText(`切换帧率失败：${formatCoreError(error)}`)
    }
  }

  /** D 档：切换宽高比——按基准宽度换算偶数高度，复用分辨率切换链路。 */
  const handleAspectChange = (ratio: AspectRatioOption) => {
    const rawHeight = PROXY_WIDTH * ratio.height / ratio.width
    const evenHeight = Math.max(2, Math.round(rawHeight / 2) * 2)
    const preset = {
      label: `${PROXY_WIDTH} × ${evenHeight}（${ratio.label}）`,
      width: PROXY_WIDTH,
      height: evenHeight,
    }
    handleResolutionChange(preset)
  }

  /** D 档：切换背景色——写入 core profile（additive-only 字段），驱动空帧与导出。 */
  const handleBackgroundChange = (background: BackgroundOption) => {
    if (!session) return
    try {
      const hex = background.value.replace('#', '')
      const rgba = hex.length === 6
        ? [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), 255]
        : [0, 0, 0, 0]
      setSession({ ...session, profile: { ...session.profile, backgroundRgba: rgba } })
      setMediaStatus(`背景已切换为：${background.label}`)
    } catch (error) {
      setErrorText(`切换背景失败：${formatCoreError(error)}`)
    }
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

  /**
   * P0：把素材载荷真正插入时间轴。placement 由 element-model 自动找空位，
   * 起点优先取投放位置（拖放）或播放头（点击卡片），插入后重算帧计划并记入撤销历史。
   * @param payload 素材载荷（Text/Media）
   * @param atTicks 可选的目标起点；缺省用播放头
   * @param targetTrackId U-05：目标轨 id，缺省 main
   */
  const handleAddAsset = (payload: AssetDragPayload, atTicks?: number, targetTrackId?: string) => {
    if (!session) {
      setErrorText('请先加载项目，再添加素材到时间轴')
      return
    }
    try {
      const desiredStart = atTicks ?? frameIndex * session.ticksPerFrame
      let element
      if (payload.kind === 'text') {
        element = buildTextElement({
          id: makeElementId(TEXT_ID_PREFIX),
          content: payload.content ?? DEFAULT_TEXT_CONTENT,
          startTime: desiredStart,
          ticksPerSecond: MODEL_TICKS_PER_SECOND,
        })
      } else if (payload.kind === 'graphic') {
        // 第二档项 2：图形元素走独立构建函数，形状由素材卡指定。
        element = buildGraphicElement({
          id: makeElementId(GRAPHIC_ID_PREFIX),
          name: payload.name,
          shape: payload.shape,
          startTime: desiredStart,
          ticksPerSecond: MODEL_TICKS_PER_SECOND,
        })
      } else if (payload.kind === 'audio') {
        // D 档：音效素材（静态 OGG）加入时间轴，作为 audio 元素记录路径，
        // 写回经典版 JSON 保真；预览播放受 core 解码链路限制（见台账边界）。
        element = buildMediaElement({
          id: makeElementId(MEDIA_ID_PREFIX),
          name: payload.name,
          elementType: 'audio',
          startTime: desiredStart,
          durationSeconds: DEFAULT_MEDIA_DURATION_SECONDS,
          ticksPerSecond: MODEL_TICKS_PER_SECOND,
          mediaId: payload.soundSrc ?? payload.id,
        })
      } else {
        const asset = assets.find((item) => item.id === payload.id)
        const durationSeconds = asset?.duration ?? DEFAULT_MEDIA_DURATION_SECONDS
        element = buildMediaElement({
          id: makeElementId(MEDIA_ID_PREFIX),
          name: payload.name,
          elementType: ((payload.mediaType === 'video' || payload.mediaType === 'audio' || payload.mediaType === 'image')
            ? payload.mediaType : 'video') as ElementKind,
          startTime: desiredStart,
          durationSeconds,
          ticksPerSecond: MODEL_TICKS_PER_SECOND,
          mediaId: payload.id,
        })
      }
      const start = resolveAutoPlacement(elements, desiredStart, element.duration)
      // D 档：音效元素默认落到第一条 audio 轨（除非拖放时显式指定目标轨）。
      const effectiveTrackId = targetTrackId
        ?? (payload.kind === 'audio'
          ? projectTracks.find((track) => track.trackType === 'audio')?.id
          : undefined)
      // U-05：非 main 轨用显式 trackId 标记；main 保持缺省以兼容旧数据。
      const placed = {
        ...element, startTime: start,
        ...(effectiveTrackId && effectiveTrackId !== 'main' ? { trackId: effectiveTrackId } : {}),
      }
      const next = insertElement(elements, placed)
      setElements(next)
      clipHistory.record(next, `新增${payload.kind === 'text' ? '文字' : payload.kind === 'graphic' ? '图形' : '媒体'}片段`, { selectedId: placed.id })
      setFrameCount(plannedFrameCount(next, session.adapter, session.profile))
      setSelectedId(placed.id)
      setErrorText(null)
      setMediaStatus(`已加入时间轴：${placed.name ?? placed.id}（起点 ${(start / MODEL_TICKS_PER_SECOND).toFixed(2)}s）`)
    } catch (error) {
      setErrorText(`添加素材失败：${formatCoreError(error)}`)
    }
  }

  /** U-05：时间轴拖放落点由组件换算 ticks 与目标轨，这里只做类型校验并插入。 */
  const handleTimelineDrop = (payload: AssetDragPayload, atTicks: number, targetTrackId: string) => {
    if (payload.kind !== 'text' && payload.kind !== 'media' && payload.kind !== 'graphic' && payload.kind !== 'audio') return
    handleAddAsset(payload, atTicks, targetTrackId)
  }

  const activeClip = clipAtTime(elements, frameIndex * (session?.ticksPerFrame ?? 0))?.id ?? (session ? '空档' : '—')
  const selectedElement = elements.find((element) => element.id === selectedId) ?? null

  /** D 档：把效果预设的参数写入选中元素（复用统一命令层，可撤销）。 */
  const handleApplyEffect = (effect: CatalogEffect) => {
    if (!selectedId) {
      setMediaStatus('请先选中一个片段，再应用效果')
      return
    }
    applyPropertyPatch({ params: effect.params as ClipPatch['params'] })
    setMediaStatus(`已应用效果：${effect.name}`)
  }

  /** D 档：切换音效收藏（会话内状态，后续可接入 autosave 持久化）。 */
  const handleToggleFavorite = (soundId: string) => {
    setSoundFavorites((current) => {
      const next = new Set(current)
      if (next.has(soundId)) next.delete(soundId)
      else next.add(soundId)
      return next
    })
  }

  /** P4 批 5：预览遮罩手柄变更写回元素 mask.* 参数（驱动预览与导出）。 */
  const handleMaskChange = (mask: RectMask) => {
    applyPropertyPatch({
      params: {
        'mask.enabled': mask.enabled,
        'mask.left': mask.left,
        'mask.top': mask.top,
        'mask.right': mask.right,
        'mask.bottom': mask.bottom,
      } as ClipPatch['params'],
    })
  }

  /** 第二档：预览选框变换写回元素 position/scale/rotate（驱动预览与导出）。 */
  const handleTransformChange = (transform: ElementTransform) => {
    applyPropertyPatch({
      params: {
        positionX: transform.positionX,
        positionY: transform.positionY,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        rotate: transform.rotate,
      } as ClipPatch['params'],
    })
  }

  const diagnosticsItems = session ? [
    { label: '代理帧缓存', value: cacheInfo },
    { label: '剪辑历史', value: clipHistory.label },
    { label: '4K scrub 基准', value: benchmarkInfo || '未运行' },
    { label: '帧耗时', value: `${frameCost.toFixed(2)}ms（阈值 ${SCRUB_THRESHOLD_MS}ms ${frameCost <= SCRUB_THRESHOLD_MS ? '达标' : '超标'}）` },
    { label: 'core', value: `API ${session.info.apiVersion} / ${session.info.backendId} · WebCodecs ${session.codecs.available ? '可用' : '不可用'}` },
    { label: 'GPU 能力', value: gpuCapability?.summary ?? '探测中…' },
    { label: '兼容提示', value: `${session.project.warnings.length} 条` },
  ] : []
  /** 批 1：诊断与导出设置收进素材面板的 settings tab，主框架不再有额外区块。 */
  /** D 档：把目录里的「16:9」字符串解析为宽高比选项（非法值跳过）。 */
  const aspectOptions: AspectRatioOption[] = (catalog?.settings.aspectRatios ?? []).flatMap((text) => {
    const match = /^(\d+):(\d+)$/.exec(text)
    return match ? [{ label: text, width: Number(match[1]), height: Number(match[2]) }] : []
  })
  const currentAspectLabel = `${resolution.width}:${resolution.height}`
  const currentBackgroundId = (() => {
    const rgba = session?.profile?.backgroundRgba
    if (!Array.isArray(rgba)) return 'black'
    const hex = `#${(rgba as number[]).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
    return catalog?.settings.backgrounds.find((b) => b.value.toLowerCase() === hex.toLowerCase())?.id ?? 'custom'
  })()

  const settingsContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      {catalog && (catalog.settings.fpsOptions.length > 0 || aspectOptions.length > 0) && (
        <ProjectSettingsPanel
          fpsOptions={catalog.settings.fpsOptions.length > 0 ? catalog.settings.fpsOptions : [30]}
          currentFps={session?.fps ?? 30}
          onFpsChange={handleFpsChange}
          aspectRatios={aspectOptions.length > 0 ? aspectOptions : [{ label: '16:9', width: 16, height: 9 }]}
          currentAspect={aspectOptions.some((r) => r.label === currentAspectLabel) ? currentAspectLabel : (aspectOptions[0]?.label ?? '16:9')}
          onAspectChange={handleAspectChange}
          backgrounds={catalog.settings.backgrounds}
          currentBackground={currentBackgroundId}
          onBackgroundChange={handleBackgroundChange}
        />
      )}
      <ExportSettingsPanel
        open
        settings={exportSettings}
        onChange={setExportSettings}
        onExport={startExport}
        exportDisabled={!session || exportState.status === 'running'}
        resolution={resolution}
        onResolutionChange={handleResolutionChange}
      />
      <DiagnosticsPanel
        items={diagnosticsItems}
        proxyUrl={proxyUrl}
        actions={[
          { label: '4K 基准', onClick: () => void handleBenchmark(), disabled: !session },
          { label: '导出代理 MP4', onClick: () => void handleProxyExport(), disabled: !media },
          { label: '清空缓存', onClick: () => void handleClearCache() },
          { label: '导出 OTIO', onClick: () => void handleOtioExport(), disabled: !session },
        ]}
      />
    </div>
  )

  /**
   * 批 2：渲染用三轨视图。main 轨始终用可编辑 elements 覆盖，保证删除/分割/拖拽后时间轴同步；
   * overlay/audio 轨为只读展示（core 编辑 API 仍只覆盖主轨，见 UI_REPLICA_PLAN 边界）。
   */
  // U-05：可编辑元素按 trackId 分配到对应轨；main 用缺省 trackId 表达，兼容旧数据。
  const baseTracks: ClassicTimelineTrack[] = projectTracks.length > 0
    ? projectTracks.map((track) => ({
        ...track,
        elements: track.id === 'main'
          ? elements.filter((element) => !element.trackId || element.trackId === 'main')
          // U-07：非 main 轨完全由可编辑 elements 派生，避免与 projectTracks 副本重复。
          : elements.filter((element) => element.trackId === track.id),
      }))
    : [{ id: 'main', trackType: 'video', label: '主轨',
      elements: elements.filter((element) => !element.trackId || element.trackId === 'main') }]
  // U-06：用户新增轨追加到时间轴末尾，可接收跨轨拖放（elements 来自 trackId 匹配）。
  const timelineTracks: ClassicTimelineTrack[] = [
    ...baseTracks,
    ...extraTracks.map((track) => ({
      id: track.id,
      trackType: track.trackType,
      label: track.trackType === 'audio' ? '音频' : track.id,
      elements: elements.filter((element) => element.trackId === track.id),
    })),
  ]

  const timelineActions: TimelineAction[] = [
    { label: '删除选中片段', icon: 'trash', disabled: !selectedId || elements.length < 2, onClick: deleteSelected },
    { label: '在播放头分割', icon: 'scissor', disabled: !selectedId,
      onClick: () => applyClipEdit('播放头不在选中片段内部，无法分割', (cs, ctx) => splitClipAt(cs, ctx.clipId, ctx.playhead)) },
    { label: '入点设到播放头', icon: 'alignLeft', disabled: !selectedId,
      onClick: () => applyClipEdit('播放头不在选中片段内部，无法设置入点', (cs, ctx) => trimClipInAt(cs, ctx.clipId, ctx.playhead)) },
    { label: '出点设到播放头', icon: 'alignRight', disabled: !selectedId,
      onClick: () => applyClipEdit('播放头不在选中片段内部，无法设置出点', (cs, ctx) => trimClipOutAt(cs, ctx.clipId, ctx.playhead)) },
    { label: '左移一帧', icon: 'move', disabled: !selectedId,
      onClick: () => applyClipEdit('片段已在时间轴起点', (cs, ctx) => moveClipBy(cs, ctx.clipId, -ctx.ticksPerFrame)) },
    { label: '右移一帧', icon: 'duplicate', disabled: !selectedId,
      onClick: () => applyClipEdit('片段无法再右移', (cs, ctx) => moveClipBy(cs, ctx.clipId, ctx.ticksPerFrame)) },
    // P1：剪贴板与复制品（按钮与 Ctrl/Cmd+C/V/D 等价）。
    { label: '复制', icon: 'duplicate', disabled: !selectedId && selection.selectedIds.length === 0, onClick: selection.handleCopy },
    { label: '粘贴到播放头', icon: 'duplicate', disabled: !session, onClick: selection.handlePaste },
    { label: '创建副本', icon: 'duplicate', disabled: !selectedId && selection.selectedIds.length === 0, onClick: () => selection.handleDuplicate() },
  ]

  return (
    <MobileGate>
    <main style={SURFACE_STYLE} className={`classic-ui-root classic-shell${dark ? ' dark' : ''}`}>
      <TopBar
        projectName={session?.project.name ?? '未加载'}
        projectVersion={session?.project.version ?? 0}
        sceneCount={session?.project.sceneCount ?? 0}
        trackCount={(session?.projectTrackCount ?? 0) + extraTracks.length}
        actions={[
          { label: '撤销', disabled: !clipHistory.canUndo, onClick: clipHistory.undo },
          { label: '重做', disabled: !clipHistory.canRedo, onClick: clipHistory.redo },
          { label: '保存项目', disabled: !session, onClick: handleSaveSnapshot },
          { label: '写回经典版 JSON', disabled: !session, onClick: handleSaveProject },
          { label: '加载快照', disabled: !session, onClick: () => snapshotFileRef.current?.click() },
          { label: 'Shortcuts', onClick: () => setShortcutsOpen(true) },
        ]}
        onExport={startExport}
        exportDisabled={!session || exportState.status === 'running'}
        onCancelExport={cancelExport}
        onRetryExport={startExport}
        dark={dark}
        onToggleTheme={() => setDark((value) => !value)}
        exportState={exportState}
        otioUrl={otioUrl}
      />
      <input ref={snapshotFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
        onChange={(event) => void handleLoadSnapshot(event.target.files?.[0])} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)}
        onBindingsChange={setKeybindings} />

      {!session && !errorText && <div style={{ ...PANEL_STYLE, color: TEXT_MAIN }}>正在加载项目与 Rust core WASM…</div>}
      {errorText && <div style={{ ...PANEL_STYLE, color: '#fecaca' }}>{errorText}</div>}

      {session && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResizablePanelGroup className="classic-split" data-orientation="vertical" orientation="vertical">
            {/* v4 把数字当作像素，百分比必须传字符串（经典版 PanelGroup 的 defaultSize 语义）。 */}
            <ResizablePanel className="classic-split-main"
              defaultSize={String(CLASSIC_PANEL_CONFIG.mainContent)}
              minSize={String(CLASSIC_PANEL_LIMITS.mainContent.min)}
              maxSize={String(CLASSIC_PANEL_LIMITS.mainContent.max)}>
              <ResizablePanelGroup className="classic-split" data-orientation="horizontal" orientation="horizontal">
                <ResizablePanel defaultSize={String(CLASSIC_PANEL_CONFIG.tools)}
                  minSize={String(CLASSIC_PANEL_LIMITS.tools.min)} maxSize={String(CLASSIC_PANEL_LIMITS.tools.max)}>
                  <AssetsPanel
                    projectFileRef={projectFileRef}
                    videoFileRef={videoFileRef}
                    otioFileRef={otioFileRef}
                    onImportFile={(file) => void readFile(file)}
                    onOtioFile={(file) => void handleOtioImport(file)}
                    onDemo={() => void handleDemoClip()}
                    assets={assets}
                    sourceName={sourceName}
                    mediaStatus={mediaStatus}
                    settingsContent={settingsContent}
                    onAddToTimeline={handleAddAsset}
                    catalog={catalog ?? undefined}
                    onApplyEffect={handleApplyEffect}
                    favorites={soundFavorites}
                    onToggleFavorite={handleToggleFavorite}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={String(CLASSIC_PANEL_CONFIG.preview)}
                  minSize={String(CLASSIC_PANEL_LIMITS.preview.min)}>
                  <PreviewSection
                    canvasRef={canvasRef}
                    playing={playing}
                    onTogglePlay={() => setPlaying((value) => !value)}
                    frameIndex={frameIndex}
                    frameCount={frameCount}
                    fps={session.fps}
                    selected={Boolean(selectedElement)}
                    frameWidth={resolution.width}
                    frameHeight={resolution.height}
                    onSeek={(frame) => { setPlaying(false); setFrameIndex(frame) }}
                    timecode={`片段 ${activeClip}`}
                    mask={selectedElement ? readRectMask(selectedElement) : undefined}
                    onMaskChange={handleMaskChange}
                    transform={selectedElement ? transformFromElement(selectedElement) : undefined}
                    onTransformChange={handleTransformChange}
                    textContent={selectedElement?.elementType === 'text'
                      ? (selectedElement.content ?? (typeof selectedElement.params?.content === 'string' ? selectedElement.params.content : ''))
                      : undefined}
                    onTextChange={selectedElement?.elementType === 'text'
                      ? (content) => applyPropertyPatch({ content }) : undefined}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={String(CLASSIC_PANEL_CONFIG.properties)}
                  minSize={String(CLASSIC_PANEL_LIMITS.properties.min)} maxSize={String(CLASSIC_PANEL_LIMITS.properties.max)}>
                  <PropertiesPanel selected={selectedElement}
                    selectedCount={selection.selectedIds.length || (selectedElement ? 1 : 0)}
                    playheadTicks={frameIndex * (session?.ticksPerFrame ?? 0)}
                    onChange={applyPropertyPatch} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel className="classic-split-timeline"
              defaultSize={String(CLASSIC_PANEL_CONFIG.timeline)}
              minSize={String(CLASSIC_PANEL_LIMITS.timeline.min)} maxSize={String(CLASSIC_PANEL_LIMITS.timeline.max)}>

          <ClassicTimeline
            tracks={timelineTracks}
            mainTrackId="main"
            sceneName={session.project.scenes.find((item) => item.id === session.project.currentSceneId)?.name ?? '主场景'}
            waveforms={waveforms}
            videoThumbnails={videoThumbnails}
            mutedTrackIds={trackFlags.muted}
            hiddenTrackIds={trackFlags.hidden}
            onToggleTrackFlag={(trackId, flag) => {
              const nextSet = new Set(trackFlags[flag])
              if (nextSet.has(trackId)) nextSet.delete(trackId)
              else nextSet.add(trackId)
              const nextFlags = { ...trackFlags, [flag]: [...nextSet] }
              setTrackFlags(nextFlags)
              clipHistory.record(elements, '切换轨道标志', { trackFlags: nextFlags })
            }}
            onAddTrack={(trackType) => {
              const next: ExtraTrackState = {
                id: `new-track-${Date.now()}`,
                trackType,
              }
              setExtraTracks((current) => [...current, next])
              setMediaStatus(`已新增轨道：${trackType}（写回经典版 JSON 后保存）`)
            }}
            bookmarks={bookmarks}
            onBookmarksChange={(next, commit = true) => {
              setBookmarks(next)
              // 拖动中间态不记历史，避免 pointermove 高频写入；由 timeline 结束时提交。
              if (commit) clipHistory.record(elements, '编辑书签', { bookmarks: next })
            }}
            snapping={snapping}
            onSnappingChange={setSnapping}
            selectedId={selectedId}
            selectedIds={selection.selectedIds}
            onSelect={selection.handleSelectClip}
            onBoxSelect={selection.handleBoxSelect}
            onDropAsset={handleTimelineDrop}
            adjustments={adjustments}
            frameIndex={frameIndex}
            frameCount={frameCount}
            ticksPerFrame={session.ticksPerFrame}
            ticksPerSecond={TICKS_PER_SECOND}
            fps={session.fps}
            onSeek={(frame) => { setPlaying(false); setFrameIndex(frame) }}
            onMoveClip={(id, start, targetTrackId) => applyClipEdit(
              '片段被相邻片段挡住，无法移动到该位置',
              (cs) => moveClipClamped(moveElementToTrack(cs, id, start, targetTrackId), id, start),
              id,
              targetTrackId !== 'main' ? '跨轨移动片段' : '拖拽片段',
              id,
            )}
            onResizeClip={(id, edge, delta) => applyClipEdit('片段已到时长边界', (cs) => resizeClipEdge(cs, id, edge, delta, session?.ticksPerFrame ?? 4000), id, '边缘裁剪')}
            statusText={selection.selectedIds.length > 1
              ? `已选中 ${selection.selectedIds.length} 个片段 · 剩余 ${elements.length} 个`
              : `${selectedId ? `已选中 ${selectedId}` : '未选中片段'} · 剩余 ${elements.length} 个`}
            actions={timelineActions}
          />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </main>
    </MobileGate>
  )
}
