/**
 * 脚本控制台执行派发器（W-13）：把 MCP 风格工具名映射到 EditorAdapter 浏览器等价调用。
 *
 * EditorAdapter 是 I-01 唯一 core 入口，所有方法均为同步；此处统一包成 Promise，
 * 与 ScriptConsole 的异步 onExecute 契约对齐。浏览器无等价的工具显式抛错，
 * 不伪造结果。参数缺失/类型错误给出中文友好提示。
 */
import type { EditorAdapter } from '../editor-adapter'

/** 脚本执行回调签名（与 ScriptConsoleProps.onExecute 一致）。 */
export type ScriptExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** 参数错误统一前缀，便于上层识别为可修正的输入问题。 */
const ARG_ERROR_PREFIX = '参数错误：'

/**
 * 读取必需的字符串参数。
 * @param args 已解析的参数对象
 * @param key 参数名
 * @returns {string} 参数值
 * @throws {Error} 参数缺失或类型不符时抛中文提示
 */
function requireStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${ARG_ERROR_PREFIX}${key} 必须是非空字符串`)
  }
  return value
}

/**
 * 读取必需的对象参数。
 * @param args 已解析的参数对象
 * @param key 参数名
 * @returns {Record<string, unknown>} 参数值
 * @throws {Error} 参数缺失或类型不符时抛中文提示
 */
function requireObjectArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${ARG_ERROR_PREFIX}${key} 必须是 JSON 对象`)
  }
  return value as Record<string, unknown>
}

/**
 * 派发单个脚本工具调用。
 * @param adapter 当前会话的 EditorAdapter 实例
 * @param name MCP 风格工具名
 * @param args 已解析的参数对象
 * @returns {Promise<unknown>} 工具结果（Uint8Array / 结构化对象）
 */
export async function executeScriptTool(
  adapter: EditorAdapter,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case 'ocx.capabilities':
        return { version: adapter.version(), discover: adapter.discover() }
      case 'ocx.project.read':
        return adapter.readClassicProject(requireStringArg(args, 'projectJson'))
      case 'ocx.project.write':
        return adapter.writeClassicProject(
          requireStringArg(args, 'original'),
          // 字段完整性由 core 侧 writeClassicProject 校验，此处仅保证是 JSON 对象
          requireObjectArg(args, 'view') as unknown as Parameters<EditorAdapter['writeClassicProject']>[1],
        )
      case 'ocx.otio.import':
        return adapter.otioImport(requireStringArg(args, 'otioJson'))
      case 'ocx.otio.export':
        return adapter.otioExport(requireStringArg(args, 'timelineJson'))
      case 'ocx.render.frame':
        return adapter.renderFrameRgba(
          // 帧请求必填字段由 adapter.validateFrameRequest 校验并给出中文提示
          requireObjectArg(args, 'request') as unknown as Parameters<EditorAdapter['renderFrameRgba']>[0],
        )
      case 'ocx.render.batch':
      case 'ocx.render.status':
        throw new Error('该工具需要 MCP stdio 批量通道，浏览器侧无等价实现')
      default:
        throw new Error(`未知工具：${name}`)
    }
  } catch (error) {
    console.error('[script-console] 工具执行异常', { name, error })
    throw error
  }
}

/**
 * 为当前会话创建脚本执行器。
 * @param adapter 当前会话的 EditorAdapter 实例
 * @returns {ScriptExecutor} 可直接注入 ScriptConsole 的回调
 */
export function createScriptExecutor(adapter: EditorAdapter): ScriptExecutor {
  return (name: string, args: Record<string, unknown>): Promise<unknown> =>
    executeScriptTool(adapter, name, args)
}
