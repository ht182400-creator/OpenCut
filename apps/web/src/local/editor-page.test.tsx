// @vitest-environment jsdom
/**
 * Editor 页面挂载测试（ISTQB 系统/组件集成级别）。
 * 目标：让 editor-page.tsx 在 jsdom 中挂载，覆盖其顶层状态初始化、hooks 接线、
 * 面板组装与空项目渲染分支。重依赖（WASM 适配/IndexedDB/导出/媒体解码/UI 组件）用 vi.mock 替换，
 * 只保留 editor-page 自身逻辑的执行。交互流程由 E2E 验收覆盖。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { Editor } from './editor-page'

/** mock CSS 导入（jsdom 无法解析 CSS 模块）。 */
vi.mock('./classic-ui/theme.css', () => ({}))

/** mock 重依赖：WASM 适配器（Proxy 兜底任意方法，避免逐个列举接口）。 */
vi.mock('./editor-adapter', () => ({
  createEditorAdapter: vi.fn(async () => new Proxy({
    version: () => '0.1.0',
    discover: () => ({ ok: true }),
    readClassicProject: () => ({
      ok: true,
      project: {
        name: '测试项目',
        fps: { numerator: 30, denominator: 1 },
        scenes: [{
          id: 's1', name: '主场景',
          tracks: [{
            id: 'main', name: '主轨', trackType: 'video', elementCount: 1,
            elements: [{
              id: 'v1', name: '测试片段', elementType: 'video',
              startTime: 0, duration: 120000, trimStart: 0,
              mediaId: 'm1', params: { opacity: 1, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotate: 0 },
            }],
          }],
        }],
      },
    }),
    writeClassicProject: () => ({ ok: true }),
    otioImport: () => ({ ok: true, tracks: [] }),
    evaluate: () => ({ ok: true }),
    renderFrameRgba: () => new Uint8Array(320 * 180 * 4),
    compositeFrameRgba: (_: unknown, pixels: Uint8Array) => pixels,
    waveformPeaksFromPcm: () => new Float32Array(100),
    makeThumbnail: () => new Uint8Array(4),
  }, {
    get(target: Record<string, unknown>, prop: string) {
      if (prop in target) return target[prop]
      return () => ({ ok: true })
    },
  })),
  formatCoreError: vi.fn((e: unknown) => String(e)),
}))

/** mock 自动保存：读为空，写为成功。 */
vi.mock('./project-autosave', () => ({
  AUTOSAVE_DEBOUNCE_MS: 500,
  defaultAutosaveStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  persistAutosaveAsync: vi.fn(async () => {}),
  readAutosaveAsync: vi.fn(async () => null),
}))
vi.mock('./autosave-idb', () => ({
  defaultAutosaveBackend: { get: vi.fn(async () => null), put: vi.fn(async () => {}), clear: vi.fn(async () => {}), stats: vi.fn(async () => ({ entries: 0, bytes: 0 })) },
  migrateLegacyAutosave: vi.fn(async () => null),
}))

/** mock 媒体/导出/缩略图（需 HTMLVideoElement/WebCodecs）。 */
vi.mock('./media', () => ({
  clearFrameCache: vi.fn(async () => {}),
  decodeVideoFile: vi.fn(async () => ({ frames: [], width: 320, height: 180, audio: null })),
  getFrameCacheStats: vi.fn(() => ({ hits: 0, misses: 0 })),
  getPersistedCacheStats: vi.fn(async () => ({ entries: 0, bytes: 0 })),
  mediaFrameAt: vi.fn(() => new Uint8Array(4)),
  createProxyFile: vi.fn(async () => new Blob(['x'])),
  isVideoFile: vi.fn(() => true),
  frameTimeSeconds: vi.fn(() => 0),
  createDemoVideoFile: vi.fn(async () => new File(['x'], 'demo.mp4')),
  createBenchmarkVideoFile: vi.fn(async () => new File(['x'], 'bench.mp4')),
  MAX_DECODE_FRAMES: 90,
  BENCHMARK_4K_CODEC: 'avc1.640033',
}))
vi.mock('./export', () => ({
  exportProjectToMp4: vi.fn(),
  exportProjectToWebM: vi.fn(),
  exportProjectToAv1WebM: vi.fn(),
  isExportAborted: vi.fn(() => false),
  isExportSupported: vi.fn(() => true),
  isOpusEncodingSupported: vi.fn(async () => true),
  exportProgressPercent: vi.fn(() => 0),
  validateExportOptions: vi.fn(() => null),
}))
vi.mock('./thumbnail', () => ({
  ASSET_THUMBNAIL_HEIGHT: 60,
  ASSET_THUMBNAIL_WIDTH: 100,
  buildThumbnailCacheKey: vi.fn(() => 'k'),
  makeThumbnailDataUrl: vi.fn(() => ''),
  thumbnailCache: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
}))

/** mock 重 UI 子面板（自身有独立组件测试）。 */
vi.mock('./classic-ui/assets-panel', () => ({ AssetsPanel: (props: { assets?: unknown[] }) => <div data-testid="mock-assets">{props.assets?.length ?? 0}</div> }))
vi.mock('./classic-ui/timeline', () => ({ ClassicTimeline: () => <div data-testid="mock-timeline" /> }))
vi.mock('./classic-ui/properties-panel', () => ({ PropertiesPanel: () => <div data-testid="mock-properties" /> }))
vi.mock('./classic-ui/preview-section', () => ({ PreviewSection: () => <div data-testid="mock-preview" /> }))
vi.mock('./classic-ui/curve-editor', () => ({ CurveEditor: () => <div data-testid="mock-curve" /> }))
vi.mock('./classic-ui/shortcuts-dialog', () => ({ ShortcutsDialog: () => null }))
vi.mock('./classic-ui/mobile-gate', () => ({
  MobileGate: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-mobile-gate">{children}</div>,
}))
vi.mock('./classic-ui/project-settings-panel', () => ({ ProjectSettingsPanel: () => <div data-testid="mock-settings" /> }))
vi.mock('../components/ui/resizable', () => ({
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-panel">{children}</div>,
  ResizableHandle: () => <div />,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-group">{children}</div>,
}))

/** mock 项目 JSON 文件（本地 public fixture）。 */
vi.mock('./demo-project', () => ({ DEMO_PROJECT_JSON: '{"v":31,"name":"测试"}' }))

/** 每个用例前 stub fetch（项目 fixture）/IndexedDB/canvas。 */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ v: 31, name: '测试项目', fps: { numerator: 30, denominator: 1 }, scenes: [] }),
    json: async () => ({ v: 31, name: '测试项目', fps: { numerator: 30, denominator: 1 }, scenes: [] }),
  })))
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      const req: Record<string, unknown> = {}
      setTimeout(() => (req.onsuccess as ((event: unknown) => void) | undefined)?.({ result: {
        transaction: () => ({ objectStore: () => ({ get: () => ({ onsuccess: null }), getAll: () => ({ onsuccess: null }) }) }),
        close: () => {},
      } }), 0)
      return req
    }),
  })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    canvas: { width: 320, height: 180 },
  })) as never
})

/** 每个用例后清理 DOM 与 stub。 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Editor 页面挂载', () => {
  it('挂载编辑器骨架（顶栏/主容器/移动门禁）', async () => {
    const { container } = render(<Editor />)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="classic-header"]')).toBeTruthy()
      expect(container.querySelector('.classic-ui-root')).toBeTruthy()
      expect(container.querySelector('[data-testid="mock-mobile-gate"]')).toBeTruthy()
    })
  })

  it('顶栏项目菜单/主题切换按钮可交互', async () => {
    const { getByTitle } = render(<Editor />)
    await waitFor(() => expect(getByTitle('项目菜单')).toBeTruthy(), { timeout: 5000 })
    // 触发主题切换与项目菜单，覆盖对应 handler 分支。
    const theme = getByTitle('切换亮/暗主题')
    const menu = getByTitle('项目菜单')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(theme)
    fireEvent.click(menu)
    expect(getByTitle('项目菜单')).toBeTruthy()
  })
})
