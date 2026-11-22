import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EditorAdapter } from '../editor-adapter'
import { createScriptExecutor, executeScriptTool } from './script-console-dispatch'

/**
 * 构造测试用 adapter：仅实现被派发的 6 个可用方法，其余以 spy 占位。
 * @returns {{ adapter: EditorAdapter; calls: Record<string, ReturnType<typeof vi.fn>> }} 测试替身
 */
function makeAdapter(): { adapter: EditorAdapter; calls: Record<string, ReturnType<typeof vi.fn>> } {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {
    version: vi.fn(() => 'v-test'),
    discover: vi.fn(() => ({ apiVersion: '1', schemaVersion: 'v31', backendId: 'test', capabilities: [] })),
    readClassicProject: vi.fn(() => ({ ok: true })),
    writeClassicProject: vi.fn(() => ({ ok: true })),
    otioImport: vi.fn(() => ({ ok: true })),
    otioExport: vi.fn(() => ({ ok: true })),
    renderFrameRgba: vi.fn(() => new Uint8Array(4)),
  }
  return { adapter: calls as unknown as EditorAdapter, calls }
}

/** 派发器回归：工具映射、参数校验、无等价工具与异常透传。 */
describe('script-console-dispatch', () => {
  /** 捕获异常路径的详细日志，避免污染测试输出并断言日志已记录。 */
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('ocx.capabilities 返回版本与发现结果，不调用其它方法', async () => {
    const { adapter, calls } = makeAdapter()
    const result = await executeScriptTool(adapter, 'ocx.capabilities', {})
    expect(result).toMatchObject({ version: 'v-test' })
    expect(calls.version).toHaveBeenCalledTimes(1)
    expect(calls.discover).toHaveBeenCalledTimes(1)
  })

  it('六个可用工具正确透传参数并调用对应方法', async () => {
    const { adapter, calls } = makeAdapter()
    await executeScriptTool(adapter, 'ocx.project.read', { projectJson: '{}' })
    expect(calls.readClassicProject).toHaveBeenCalledWith('{}')
    await executeScriptTool(adapter, 'ocx.project.write', { original: '{}', view: { id: 1 } })
    expect(calls.writeClassicProject).toHaveBeenCalledWith('{}', { id: 1 })
    await executeScriptTool(adapter, 'ocx.otio.import', { otioJson: 'otio' })
    expect(calls.otioImport).toHaveBeenCalledWith('otio')
    await executeScriptTool(adapter, 'ocx.otio.export', { timelineJson: 'tl' })
    expect(calls.otioExport).toHaveBeenCalledWith('tl')
    const frame = await executeScriptTool(adapter, 'ocx.render.frame', { request: { frameIndex: 0 } })
    expect(calls.renderFrameRgba).toHaveBeenCalledWith({ frameIndex: 0 })
    expect(frame).toBeInstanceOf(Uint8Array)
  })

  it('参数缺失或类型错误抛中文友好提示', async () => {
    const { adapter } = makeAdapter()
    await expect(executeScriptTool(adapter, 'ocx.project.read', {}))
      .rejects.toThrow('参数错误：projectJson 必须是非空字符串')
    await expect(executeScriptTool(adapter, 'ocx.render.frame', { request: [] }))
      .rejects.toThrow('参数错误：request 必须是 JSON 对象')
    expect(errorSpy).toHaveBeenCalledWith(
      '[script-console] 工具执行异常',
      expect.objectContaining({ name: 'ocx.project.read' }),
    )
  })

  it('无浏览器等价工具与未知工具抛错，不伪造结果', async () => {
    const { adapter } = makeAdapter()
    await expect(executeScriptTool(adapter, 'ocx.render.batch', {}))
      .rejects.toThrow('浏览器侧无等价实现')
    await expect(executeScriptTool(adapter, 'ocx.unknown', {}))
      .rejects.toThrow('未知工具：ocx.unknown')
  })

  it('createScriptExecutor 返回可直接注入的 Promise 回调', async () => {
    const { adapter, calls } = makeAdapter()
    const executor = createScriptExecutor(adapter)
    await expect(executor('ocx.capabilities', {})).resolves.toMatchObject({ version: 'v-test' })
    expect(calls.version).toHaveBeenCalledTimes(1)
  })
})
