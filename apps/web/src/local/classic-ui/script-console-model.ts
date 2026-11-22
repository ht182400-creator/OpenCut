/**
 * 脚本控制台纯逻辑（W-13 脚本标签页 UI）：工具目录 + 执行结果格式化。
 *
 * 工具名对齐 MCP `ocx.*`（stdio），浏览器侧由 `EditorAdapter` 进程内等价实现（I-01），
 * 不引入 HTTP sidecar。`ocx.render.batch/status` 无浏览器等价，明确标为不可用。
 */

/** 脚本工具定义。 */
export interface ScriptTool {
  /** MCP 对齐的工具名。 */
  name: string
  /** 中文用途说明。 */
  label: string
  /** 浏览器侧是否有等价实现。 */
  available: boolean
  /** 默认参数 JSON 文本（可编辑）。 */
  sampleArgs: string
}

/** 单帧示例时长：1 秒对应的 ticks（与 element-model 的 TICKS_PER_SECOND 同值）。 */
const SAMPLE_FRAME_DURATION_TICKS = 120000

/** 工具目录常量（避免散落硬编码）。 */
export const SCRIPT_TOOLS: readonly ScriptTool[] = [
  {
    name: 'ocx.capabilities',
    label: '查询 core 能力与版本',
    available: true,
    sampleArgs: '{}',
  },
  {
    name: 'ocx.project.read',
    label: '解析 v31 项目 JSON',
    available: true,
    sampleArgs: '{"projectJson":""}',
  },
  {
    name: 'ocx.project.write',
    label: '把编辑后的视图写回原 JSON',
    available: true,
    sampleArgs: '{"original":"","view":{}}',
  },
  {
    name: 'ocx.otio.import',
    label: '导入 OTIO 时间线',
    available: true,
    sampleArgs: '{"otioJson":""}',
  },
  {
    name: 'ocx.otio.export',
    label: '导出 OTIO 时间线',
    available: true,
    sampleArgs: '{"timelineJson":""}',
  },
  {
    name: 'ocx.render.frame',
    label: '渲染单帧（RGBA 字节数）',
    available: true,
    sampleArgs: `{"request":{"frameIndex":0,"timeTicks":0,"durationTicks":${SAMPLE_FRAME_DURATION_TICKS},"profile":{},"params":{}}}`,
  },
  {
    name: 'ocx.render.batch',
    label: '批量渲染（需 MCP stdio，浏览器无等价）',
    available: false,
    sampleArgs: '{}',
  },
  {
    name: 'ocx.render.status',
    label: '批量任务进度（需 MCP stdio，浏览器无等价）',
    available: false,
    sampleArgs: '{}',
  },
]

/**
 * 按工具名查目录项。
 * @param name 工具名
 * @returns {ScriptTool | undefined} 命中项
 */
export function findScriptTool(name: string): ScriptTool | undefined {
  return SCRIPT_TOOLS.find((tool) => tool.name === name)
}

/**
 * 校验参数 JSON 文本；空文本按 `{}` 处理。
 * @param text 参数文本
 * @returns {{ ok: boolean; value?: Record<string, unknown>; error?: string }} 解析结果
 */
export function parseScriptArgs(text: string): {
  ok: boolean
  value?: Record<string, unknown>
  error?: string
} {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: {} }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '参数必须是 JSON 对象' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: `参数 JSON 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 日志条目。 */
export interface ScriptLogEntry {
  /** 工具名或 'system'。 */
  source: string
  /** 成功/失败/提示。 */
  level: 'ok' | 'error' | 'info'
  /** 输出文本。 */
  text: string
}

/**
 * 把任意执行结果格式化为单行日志文本（超长截断，避免撑爆 UI）。
 * @param source 工具名
 * @param result 执行结果
 * @returns {ScriptLogEntry} 日志条目
 */
export function formatScriptResult(source: string, result: unknown): ScriptLogEntry {
  let text: string
  if (result instanceof Uint8Array) {
    text = `Uint8Array(${result.length} bytes)`
  } else if (typeof result === 'string') {
    text = result
  } else {
    try {
      text = JSON.stringify(result)
    } catch {
      text = String(result)
    }
  }
  const maxLength = 500
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…（已截断）`
  return { source, level: 'ok', text }
}

/**
 * 把错误格式化为日志条目。
 * @param source 工具名
 * @param error 错误对象
 * @returns {ScriptLogEntry} 日志条目
 */
export function formatScriptError(source: string, error: unknown): ScriptLogEntry {
  const message = error instanceof Error ? error.message : String(error)
  return { source, level: 'error', text: `失败：${message}` }
}
