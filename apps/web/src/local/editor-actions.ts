/**
 * 编辑器动作工厂（P1 重构 · 行为零变化）：把 editor.tsx 中自包含的导出/高级工具 handler
 * 抽成工厂函数，使路由文件回落 1000 行上限内（用户约束）。
 *
 * 这些 handler 只依赖「状态值 + setter + 跨闭包回调」，本身不含 React Hook，
 * 因此用工厂而非自定义 hook，避免 hook 顺序约束；调用方在 render 中构造一次即可。
 * 所有跨函数调用（frameSource/readFile/refreshCacheInfo/clipHistory.record）以参数注入。
 */

import {
  buildTimelineAudio,
  isAacEncodingSupported,
  type PcmAudio,
} from './audio';
import {
  exportProjectToAv1WebM,
  exportProjectToMp4,
  exportProjectToWebM,
  isExportSupported,
  isOpusEncodingSupported,
} from './export';
import type { ResolutionPreset } from './resolution';
import {
  buildExportProfile,
  exportFilename,
  type ExportSettings,
} from './export-settings';
import { PRODUCTION_FRAME_PARAMS } from './frame-source';
import { formatCoreError } from './editor-adapter';
import { buildWriteView, saveProjectJson } from './project-write';
import { createSnapshot, parseSnapshot, snapshotToJson } from './project-snapshot';
import type { CoreElement, ExportState, RippleAdjustment, Session } from './editor-ui';
import {
  clearFrameCache,
  createBenchmarkVideoFile,
  createProxyFile,
  type DecodedMedia,
} from './media';
import { formatBenchmark, measureFrameCost } from './scrub-benchmark';
import {
  TICKS_PER_SECOND,
  clipsToOtioText,
  otioImportToClips,
  plannedFrameCount,
} from './timeline';
import type { Dispatch, SetStateAction } from 'react';

/** 工厂依赖：编辑器状态值 + setter + 留在路由文件的跨闭包回调。 */
export interface EditorActionsDeps {
  session: Session | null
  elements: CoreElement[]
  media: DecodedMedia | null
  frameCount: number
  resolution: ResolutionPreset
  exportSettings: ExportSettings
  exportState: ExportState
  proxyUrl: string | null
  otioUrl: string | null
  sourceName: string
  setExportState: Dispatch<SetStateAction<ExportState>>
  setErrorText: Dispatch<SetStateAction<string | null>>
  setMediaStatus: Dispatch<SetStateAction<string>>
  setProxyUrl: Dispatch<SetStateAction<string | null>>
  setOtioUrl: Dispatch<SetStateAction<string | null>>
  setBenchmarkInfo: Dispatch<SetStateAction<string>>
  setElements: Dispatch<SetStateAction<CoreElement[]>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  setAdjustments: Dispatch<SetStateAction<RippleAdjustment[]>>
  setFrameIndex: Dispatch<SetStateAction<number>>
  setPlaying: Dispatch<SetStateAction<boolean>>
  setSourceName: Dispatch<SetStateAction<string>>
  setFrameCount: Dispatch<SetStateAction<number>>
  frameSource: (index: number) => Uint8Array
  readFile: (file: File | undefined) => Promise<void>
  refreshCacheInfo: () => Promise<void>
  recordHistory: (clips: CoreElement[], label: string) => void
}

/** 工厂返回的 handler 集合。 */
export interface EditorActions {
  handleExport: () => Promise<void>
  handleBenchmark: () => Promise<void>
  handleProxyExport: () => Promise<void>
  handleClearCache: () => Promise<void>
  handleOtioImport: (file: File | undefined) => Promise<void>
  handleOtioExport: () => Promise<void>
  handleSaveSnapshot: () => void
  handleSaveProject: () => void
  handleLoadSnapshot: (file: File | undefined) => Promise<void>
}

/**
 * 构造导出/高级工具 handler。每次 render 重建，闭包捕获当期状态（与原地定义等价）。
 * @param deps 编辑器状态与跨回调依赖
 * @returns {EditorActions} handler 集合
 */
export function createEditorActions(deps: EditorActionsDeps): EditorActions {
  const {
    session, elements, media, frameCount, resolution, exportSettings, exportState,
    proxyUrl, otioUrl, sourceName,
    setExportState, setErrorText, setProxyUrl, setOtioUrl, setBenchmarkInfo,
    setElements, setSelectedId, setAdjustments, setFrameIndex, setPlaying,
    setSourceName, setFrameCount,
    frameSource, readFile, refreshCacheInfo, recordHistory,
  } = deps

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
        width: resolution.width, height: resolution.height,
        fps: session.fps, frameCount, ticksPerFrame: session.ticksPerFrame,
        profile: buildExportProfile(session.profile, exportSettings), params: PRODUCTION_FRAME_PARAMS,
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
      setSelectedId(null)
      setAdjustments([])
      setFrameIndex(0)
      setPlaying(false)
      setSourceName(file.name)
      recordHistory(clips, '导入 OTIO')
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

  /** 把当前剪辑决策保存为 OpenCut 工作区快照 JSON。 */
  const handleSaveSnapshot = () => {
    if (!session) return
    const snapshot = createSnapshot({
      name: session.project.name,
      fps: session.fps,
      ticksPerFrame: session.ticksPerFrame,
      ticksPerSecond: TICKS_PER_SECOND,
      frameCount,
      elements: elements.map((element) => ({ ...element, trimEnd: element.trimEnd ?? 0 })),
      savedAt: new Date().toISOString(),
    })
    const url = URL.createObjectURL(new Blob([snapshotToJson(snapshot)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'opencut-project.json'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setErrorText(null)
  }

  /** 把 UI 编辑的元素字段写回经典版 v31 项目 JSON 并下载。 */
  const handleSaveProject = () => {
    if (!session) return
    try {
      const view = buildWriteView(session.project, elements, resolution)
      const result = saveProjectJson(
        session.adapter, session.originalJson, view,
        `${session.project.name || 'project'}-v31.json`,
      )
      if (result.ok) setErrorText(null)
      else setErrorText(result.message)
      deps.setMediaStatus(result.message)
    } catch (error) {
      setErrorText(`项目写回异常：${formatCoreError(error)}`)
    }
  }

  /** 加载快照并恢复工作区（校验失败给中文提示，不改动现状）。 */
  const handleLoadSnapshot = async (file: File | undefined) => {
    if (!file || !session) return
    const parsed = parseSnapshot(await file.text())
    if (!parsed.ok) {
      setErrorText(`项目快照不兼容：${parsed.error}`)
      return
    }
    const restored: CoreElement[] = parsed.snapshot.elements.map((item) => ({ ...item }))
    setElements(restored)
    recordHistory(restored, '加载项目快照')
    setSelectedId(null)
    setAdjustments([])
    setPlaying(false)
    setFrameIndex(0)
    setFrameCount(plannedFrameCount(restored, session.adapter, session.profile))
    setSourceName(parsed.snapshot.name)
    setErrorText(null)
  }

  return {
    handleExport, handleBenchmark, handleProxyExport,
    handleClearCache, handleOtioImport, handleOtioExport,
    handleSaveSnapshot, handleSaveProject, handleLoadSnapshot,
  }
}
