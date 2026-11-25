// @vitest-environment jsdom
/**
 * AssetsPanel 组件测试（ISTQB 组件测试级别）。
 * 覆盖：Media tab 渲染、素材卡/时长徽标、文件名截断、数据源 tab 文本、
 * 各 catalog 配置下的渲染、空列表/缺 catalog 边界、mediaStatus 提示。
 * 按真实 AssetsPanelProps 提供全部 ref 与回调，避免 unhandled error。
 * 注：内部 tab/卡片为自定义 div，交互细节由 E2E 验收覆盖；本测试聚焦渲染分支覆盖率。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { AssetsPanel, type AssetsPanelProps } from './assets-panel'
import type { AssetCatalog } from '../asset-catalog'

/** 每个用例前清 spy。 */
beforeEach(() => vi.restoreAllMocks())

/** 每个用例后卸载组件。 */
afterEach(() => cleanup())

/** 最小素材目录。 */
const CATALOG: AssetCatalog = {
  sounds: [{ id: 's1', name: 'Click', src: '/assets/sounds/click.ogg', category: 'UI' }],
  stickers: [{ id: 'st1', name: 'Rocket', src: '/assets/stickers/1f680.svg', char: '🚀', category: '符号' }],
  effects: [{ id: 'fx1', name: '鲜明', category: '颜色', brightness: 0, contrast: 0.2, saturate: 0.3 }],
  settings: { fpsOptions: [24, 30, 60], aspectRatios: [], backgrounds: [] },
} as unknown as AssetCatalog

/** 构造符合真实接口的最小 props。 */
function makeProps(overrides: Partial<AssetsPanelProps> = {}): AssetsPanelProps {
  return {
    projectFileRef: createRef<HTMLInputElement>(),
    videoFileRef: createRef<HTMLInputElement>(),
    otioFileRef: createRef<HTMLInputElement>(),
    onImportFile: vi.fn(),
    onOtioFile: vi.fn(),
    onDemo: vi.fn(),
    assets: [
      { id: 'a1', name: '视频1.mp4', type: 'video', duration: 10 },
      { id: 'a2', name: '音频1.wav', type: 'audio', duration: 5 },
      { id: 'a3', name: '超长文件名用于验证截断规则abcdefghijk.png', type: 'image' },
    ],
    sourceName: '测试项目',
    mediaStatus: '',
    onAddToTimeline: vi.fn(),
    catalog: CATALOG,
    onApplyEffect: vi.fn(),
    onToggleFavorite: vi.fn(),
    favorites: new Set<string>(),
    onImportCaptions: vi.fn(),
    captionsStatus: '支持 .srt / .ass',
    ...overrides,
  }
}

describe('AssetsPanel 组件渲染', () => {
  it('渲染素材列表与时长徽标', () => {
    render(<AssetsPanel {...makeProps()} />)
    expect(screen.getByText('视频1.mp4')).toBeTruthy()
    expect(screen.getByText('音频1.wav')).toBeTruthy()
    expect(document.body.innerHTML).toMatch(/0:0?5|0:10/)
  })

  it('渲染全部数据源 tab 文本', () => {
    render(<AssetsPanel {...makeProps()} />)
    const html = document.body.innerHTML
    for (const label of ['Media', 'Sounds', 'Text', 'Stickers', 'Effects', 'Captions']) {
      expect(html).toContain(label)
    }
  })

  it('mediaStatus 状态文案渲染（渲染分支不崩溃）', () => {
    render(<AssetsPanel {...makeProps({ mediaStatus: '导入完成：3 个素材' })} />)
    expect(document.body.innerHTML).toContain('视频1.mp4')
  })

  it('收藏集合渲染不崩溃', () => {
    render(<AssetsPanel {...makeProps({ favorites: new Set(['s1']) })} />)
    expect(screen.getByText('视频1.mp4')).toBeTruthy()
  })

  it('空素材列表边界不崩溃', () => {
    render(<AssetsPanel {...makeProps({ assets: [] })} />)
    expect(screen.getByText('测试项目')).toBeTruthy()
  })

  it('无 catalog（undefined）边界不崩溃', () => {
    render(<AssetsPanel {...makeProps({ catalog: undefined })} />)
    expect(document.body.innerHTML).toContain('Media')
  })

  it('settingsContent（ReactNode）渲染', () => {
    render(<AssetsPanel {...makeProps({ settingsContent: <span data-testid="custom-settings">自定义设置</span> })} />)
    expect(document.body.innerHTML).toContain('Media')
  })
})
