// @vitest-environment jsdom
/**
 * ProjectSettingsPanel 组件渲染测试（ISTQB 组件测试级别）。
 * 覆盖：三组选择器渲染 / FPS 选择回调 / 宽高比选择回调 / 背景选择回调 /
 * 选项为空的边界 / 未匹配到选项时不触发回调（异常输入）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  ProjectSettingsPanel,
  type AspectRatioOption,
  type BackgroundOption,
  type ProjectSettingsPanelProps,
} from './project-settings-panel'

/** 每个用例后卸载组件。 */
afterEach(() => cleanup())

/** 测试用 props：回调为 vi.fn，同时满足组件的回调签名。 */
interface TestProps extends ProjectSettingsPanelProps {
  onFpsChange: ((fps: number) => void) & { mock: { calls: unknown[][] } }
  onAspectChange: ((ratio: AspectRatioOption) => void) & { mock: { calls: unknown[][] } }
  onBackgroundChange: ((background: BackgroundOption) => void) & { mock: { calls: unknown[][] } }
}

/**
 * 构造标准 props，回调用 vi.fn 便于断言调用参数。
 * @returns {TestProps} 测试 props
 */
function makeProps(): TestProps {
  return {
    fpsOptions: [24, 30, 60],
    currentFps: 30,
    onFpsChange: vi.fn() as TestProps['onFpsChange'],
    aspectRatios: [
      { label: '16:9', width: 1920, height: 1080 },
      { label: '9:16', width: 1080, height: 1920 },
    ],
    currentAspect: '16:9',
    onAspectChange: vi.fn() as TestProps['onAspectChange'],
    backgrounds: [
      { id: 'dark', label: '暗色', value: '#000000' },
      { id: 'white', label: '白色', value: '#ffffff' },
    ],
    currentBackground: 'dark',
    onBackgroundChange: vi.fn() as TestProps['onBackgroundChange'],
  }
}

describe('ProjectSettingsPanel 组件渲染', () => {
  it('渲染三组选择器并回填当前值', () => {
    const props = makeProps()
    render(<ProjectSettingsPanel {...props} />)
    expect(screen.getByTestId('project-settings-panel')).toBeTruthy()
    expect((screen.getByTestId('project-fps') as HTMLSelectElement).value).toBe('30')
    expect((screen.getByTestId('project-aspect') as HTMLSelectElement).value).toBe('16:9')
    expect((screen.getByTestId('project-background') as HTMLSelectElement).value).toBe('dark')
    expect(screen.getByRole('option', { name: '60' })).toBeTruthy()
  })

  it('选择 FPS：回调收到 Number 转换后的数字而非字符串', () => {
    const props = makeProps()
    render(<ProjectSettingsPanel {...props} />)
    fireEvent.change(screen.getByTestId('project-fps'), { target: { value: '60' } })
    expect(props.onFpsChange).toHaveBeenCalledExactlyOnceWith(60)
  })

  it('选择宽高比：回调收到完整 option 对象', () => {
    const props = makeProps()
    render(<ProjectSettingsPanel {...props} />)
    fireEvent.change(screen.getByTestId('project-aspect'), { target: { value: '9:16' } })
    const expected: AspectRatioOption = { label: '9:16', width: 1080, height: 1920 }
    expect(props.onAspectChange).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('选择背景：回调收到完整 option 对象', () => {
    const props = makeProps()
    render(<ProjectSettingsPanel {...props} />)
    fireEvent.change(screen.getByTestId('project-background'), { target: { value: 'white' } })
    const expected: BackgroundOption = { id: 'white', label: '白色', value: '#ffffff' }
    expect(props.onBackgroundChange).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('边界：枚举为空时不抛错，无选项可选', () => {
    const props = makeProps()
    render(<ProjectSettingsPanel {...props} fpsOptions={[]} aspectRatios={[]} backgrounds={[]} />)
    expect((screen.getByTestId('project-fps') as HTMLSelectElement).options.length).toBe(0)
    fireEvent.change(screen.getByTestId('project-fps'), { target: { value: '30' } })
    expect(props.onFpsChange).not.toHaveBeenCalled()
  })

  it('异常：未知选项值不匹配任何枚举时不触发回调', () => {
    const props = makeProps()
    render(<ProjectSettingsPanel {...props} />)
    fireEvent.change(screen.getByTestId('project-fps'), { target: { value: '999' } })
    fireEvent.change(screen.getByTestId('project-aspect'), { target: { value: '不存在' } })
    fireEvent.change(screen.getByTestId('project-background'), { target: { value: '不存在' } })
    expect(props.onFpsChange).not.toHaveBeenCalled()
    expect(props.onAspectChange).not.toHaveBeenCalled()
    expect(props.onBackgroundChange).not.toHaveBeenCalled()
  })
})
