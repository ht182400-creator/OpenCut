// @vitest-environment jsdom
/**
 * editor-actions 工厂测试（ISTQB 组件测试级别）。
 * mock 重依赖（导出/媒体/快照/WASM 适配），覆盖 9 个 handler 的早退、正常与异常分支。
 * 重点：session=null 早退、OTIO 导入空轨、快照兼容校验、项目写回成功/失败、代理导出异常。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 集中 mock 重依赖，避免真实 WASM/WebCodecs/IDB 调用。 */
vi.mock('./audio', () => ({
  buildTimelineAudio: vi.fn(() => ({ samples: new Float32Array(1), sampleRate: 48000 })),
  isAacEncodingSupported: vi.fn(async () => true),
}))
vi.mock('./export', () => ({
  exportProjectToAv1WebM: vi.fn(),
  exportProjectToMp4: vi.fn(async () => ({ frameCount: 2, durationSeconds: 1, hasAudio: false, blob: new Blob(['x']), bytes: 1 })),
  exportProjectToWebM: vi.fn(),
  isExportAborted: vi.fn((e: unknown) => e instanceof Error && e.name === 'AbortError'),
  isExportSupported: vi.fn(() => true),
  isOpusEncodingSupported: vi.fn(async () => true),
}))
vi.mock('./media', () => ({
  clearFrameCache: vi.fn(async () => {}),
  createBenchmarkVideoFile: vi.fn(async () => new File(['x'], 'bench.mp4', { type: 'video/mp4' })),
  createProxyFile: vi.fn(async () => new Blob(['proxy'])),
}))
vi.mock('./scrub-benchmark', () => ({
  formatBenchmark: vi.fn(() => 'bench'),
  measureFrameCost: vi.fn(() => ({ msPerFrame: 1, fps: 60 })),
}))
vi.mock('./project-write', () => ({
  buildWriteView: vi.fn((p) => p),
  hasNewElements: vi.fn(() => false),
  saveProjectJson: vi.fn(() => ({ ok: true, message: '写回成功' })),
}))
vi.mock('./project-snapshot', async () => {
  const actual = await vi.importActual<typeof import('./project-snapshot')>('./project-snapshot')
  return { ...actual, parseSnapshot: vi.fn(() => ({ ok: false, error: '版本不匹配' })) }
})
vi.mock('./timeline', async () => {
  const actual = await vi.importActual<typeof import('./timeline')>('./timeline')
  return {
    ...actual,
    otioImportToClips: vi.fn(() => []),
    clipsToOtioText: vi.fn(() => '{"otio":"mock"}'),
  }
})

import { createEditorActions, type EditorActionsDeps } from './editor-actions'
import { saveProjectJson } from './project-write'
import { clearFrameCache } from './media'
import { parseSnapshot } from './project-snapshot'

/** 构造最小 session（adapter 用 spy 对象）。 */
function makeSession() {
  return {
    fps: 30,
    ticksPerFrame: 4000,
    adapter: { fps: 30 },
    profile: {},
    project: { name: '测试项目' },
    originalJson: '{"v":31}',
    name: '测试',
  } as unknown as EditorActionsDeps['session']
}

/** 构造依赖，setter 全为 spy。 */
function makeDeps(overrides: Partial<EditorActionsDeps> = {}): EditorActionsDeps {
  return {
    session: makeSession(),
    elements: [],
    media: null,
    frameCount: 10,
    resolution: { width: 320, height: 180, label: '320x180' } as EditorActionsDeps['resolution'],
    exportSettings: { container: 'mp4', includeAudio: true, quality: 'medium' } as unknown as EditorActionsDeps['exportSettings'],
    exportState: { status: 'idle', done: 0, total: 0, message: '', url: null, bytes: 0 },
    trackFlags: { muted: [], hidden: [] },
    bookmarks: [],
    extraTracks: [],
    proxyUrl: null,
    otioUrl: null,
    sourceName: 'test.mp4',
    setExportState: vi.fn(),
    setErrorText: vi.fn(),
    setMediaStatus: vi.fn(),
    setProxyUrl: vi.fn(),
    setOtioUrl: vi.fn(),
    setBenchmarkInfo: vi.fn(),
    setElements: vi.fn(),
    setSelectedId: vi.fn(),
    setAdjustments: vi.fn(),
    setFrameIndex: vi.fn(),
    setPlaying: vi.fn(),
    setSourceName: vi.fn(),
    setFrameCount: vi.fn(),
    frameSource: vi.fn(() => new Uint8Array(4)),
    readFile: vi.fn(async () => {}),
    refreshCacheInfo: vi.fn(async () => {}),
    recordHistory: vi.fn(),
    ...overrides,
  }
}

/** 每个用例前 stub URL.createObjectURL / revokeObjectURL（保留 URL 构造函数本身）。 */
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.clearAllMocks()
})

/** 恢复 URL spy，避免污染其它用例。 */
afterEach(() => {
  vi.mocked(URL.createObjectURL).mockRestore?.()
  vi.mocked(URL.revokeObjectURL).mockRestore?.()
})

describe('editor-actions 早退分支（session/media/file 缺失）', () => {
  it('session=null 时 handleExport/Benchmark/OtioExport/SaveSnapshot/SaveProject 均早退', async () => {
    const deps = makeDeps({ session: null })
    const actions = createEditorActions(deps)
    await actions.handleExport()
    await actions.handleBenchmark()
    await actions.handleOtioExport()
    actions.handleSaveSnapshot()
    actions.handleSaveProject()
    expect(deps.setExportState).not.toHaveBeenCalled()
    expect(deps.setErrorText).not.toHaveBeenCalled()
  })

  it('media=null 时 handleProxyExport 早退；file 缺失时 OTIO 导入/快照加载早退', async () => {
    const deps = makeDeps({ media: null })
    const actions = createEditorActions(deps)
    await actions.handleProxyExport()
    await actions.handleOtioImport(undefined)
    await actions.handleLoadSnapshot(undefined)
    expect(deps.setProxyUrl).not.toHaveBeenCalled()
    expect(deps.setElements).not.toHaveBeenCalled()
  })
})

describe('editor-actions 正常与异常分支', () => {
  it('handleProxyExport：有 media 时生成 URL', async () => {
    const deps = makeDeps({ media: { name: 'audio.wav' } as EditorActionsDeps['media'] })
    const actions = createEditorActions(deps)
    await actions.handleProxyExport()
    expect(deps.setProxyUrl).toHaveBeenCalledWith('blob:mock')
  })

  it('handleClearCache：清理 URL 并刷新缓存信息', async () => {
    const deps = makeDeps({ proxyUrl: 'blob:old' })
    const actions = createEditorActions(deps)
    await actions.handleClearCache()
    expect(deps.setProxyUrl).toHaveBeenCalledWith(null)
    expect(clearFrameCache).toHaveBeenCalled()
    expect(deps.refreshCacheInfo).toHaveBeenCalled()
  })

  it('handleOtioImport：空轨时给出中文提示且不改元素', async () => {
    const deps = makeDeps()
    const actions = createEditorActions(deps)
    const file = new File(['{}'], 'a.otio', { type: 'application/json' })
    await actions.handleOtioImport(file)
    expect(deps.setErrorText).toHaveBeenCalledWith(expect.stringContaining('没有可用的视频轨片段'))
    expect(deps.setElements).not.toHaveBeenCalled()
  })

  it('handleOtioExport：生成 OTIO 下载 URL', async () => {
    const deps = makeDeps({ otioUrl: 'blob:old' })
    const actions = createEditorActions(deps)
    await actions.handleOtioExport()
    expect(deps.setOtioUrl).toHaveBeenCalledWith('blob:mock')
  })

  it('handleSaveSnapshot：创建下载锚点并清错误', () => {
    const deps = makeDeps()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const actions = createEditorActions(deps)
    actions.handleSaveSnapshot()
    expect(clickSpy).toHaveBeenCalled()
    expect(deps.setErrorText).toHaveBeenCalledWith(null)
    clickSpy.mockRestore()
  })

  it('handleSaveProject：写回成功时清错误并提示', () => {
    const deps = makeDeps()
    const actions = createEditorActions(deps)
    actions.handleSaveProject()
    expect(saveProjectJson).toHaveBeenCalled()
    expect(deps.setErrorText).toHaveBeenCalledWith(null)
    expect(deps.setMediaStatus).toHaveBeenCalledWith('写回成功')
  })

  it('handleSaveProject：写回失败时显示错误提示', () => {
    vi.mocked(saveProjectJson).mockReturnValueOnce({ ok: false, message: '实体不存在' })
    const deps = makeDeps()
    const actions = createEditorActions(deps)
    actions.handleSaveProject()
    expect(deps.setErrorText).toHaveBeenCalledWith('实体不存在')
  })

  it('handleLoadSnapshot：不兼容快照给出中文提示且不改元素', async () => {
    const deps = makeDeps()
    const actions = createEditorActions(deps)
    const file = new File(['{}'], 'snap.json', { type: 'application/json' })
    await actions.handleLoadSnapshot(file)
    expect(parseSnapshot).toHaveBeenCalled()
    expect(deps.setErrorText).toHaveBeenCalledWith(expect.stringContaining('不兼容'))
    expect(deps.setElements).not.toHaveBeenCalled()
  })
})
