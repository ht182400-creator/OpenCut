/**
 * 脚本控制台 UI（W-13 脚本标签页）：工具目录 + 参数编辑 + 执行 + 日志。
 *
 * 能力经 `EditorAdapter`（I-01 唯一入口）在浏览器进程内调用，不引入 HTTP sidecar；
 * 浏览器无等价的 MCP batch/status 工具在列表中明确标灰并给出提示。
 */
import { useState, type JSX } from 'react'

import {
  SCRIPT_TOOLS,
  findScriptTool,
  formatScriptError,
  formatScriptResult,
  parseScriptArgs,
  type ScriptLogEntry,
  type ScriptTool,
} from './script-console-model'

/** 脚本控制台属性。 */
export interface ScriptConsoleProps {
  /** 执行回调：工具名 + 已解析参数 → 结果（由 editor 注入 adapter 调用）。 */
  onExecute: (name: string, args: Record<string, unknown>) => Promise<unknown>
  /** 是否可执行（session 未就绪时禁用）。 */
  disabled?: boolean
}

/** 日志区最大行数（防止长期运行内存增长）。 */
const MAX_LOG_ENTRIES = 50

/**
 * 脚本控制台（Settings tab 内的可展开区，不影响经典版 9-tab 像素基线）。
 *
 * @param props 执行回调与禁用状态
 * @returns {JSX.Element} 控制台
 */
export function ScriptConsole(props: ScriptConsoleProps): JSX.Element {
  const [selectedName, setSelectedName] = useState<string>(SCRIPT_TOOLS[0].name)
  const [argsText, setArgsText] = useState<string>(SCRIPT_TOOLS[0].sampleArgs)
  const [logs, setLogs] = useState<ScriptLogEntry[]>([])
  const [running, setRunning] = useState(false)
  const selected = findScriptTool(selectedName) ?? SCRIPT_TOOLS[0]

  /**
   * 切换工具：同步参数文本为示例参数。
   * @param tool 选中的工具
   */
  const selectTool = (tool: ScriptTool): void => {
    setSelectedName(tool.name)
    setArgsText(tool.sampleArgs)
  }

  /**
   * 追加日志并裁剪到上限。
   * @param entry 日志条目
   */
  const appendLog = (entry: ScriptLogEntry): void => {
    setLogs((previous) => [...previous, entry].slice(-MAX_LOG_ENTRIES))
  }

  /**
   * 执行当前工具：解析参数 → 调 onExecute → 记录结果/错误。
   */
  const execute = async (): Promise<void> => {
    if (!selected.available || props.disabled || running) return
    const parsed = parseScriptArgs(argsText)
    if (!parsed.ok || !parsed.value) {
      appendLog({ source: selected.name, level: 'error', text: parsed.error ?? '参数错误' })
      return
    }
    setRunning(true)
    try {
      const result = await props.onExecute(selected.name, parsed.value)
      appendLog(formatScriptResult(selected.name, result))
    } catch (error) {
      appendLog(formatScriptError(selected.name, error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <details className="classic-details" data-testid="script-console">
      <summary>脚本控制台（W-13 · MCP 能力等价）</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>
          工具
          <select
            data-testid="script-tool-select"
            value={selectedName}
            onChange={(event) => {
              const tool = findScriptTool(event.target.value)
              if (tool) selectTool(tool)
            }}
            style={{ marginLeft: 6 }}
          >
            {SCRIPT_TOOLS.map((tool) => (
              <option key={tool.name} value={tool.name} disabled={!tool.available}>
                {tool.name}{tool.available ? '' : '（浏览器无等价）'}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>{selected.label}</div>
        <textarea
          data-testid="script-args"
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
          rows={3}
          style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}
        />
        <button
          type="button"
          className="classic-button"
          data-testid="script-execute"
          disabled={!selected.available || props.disabled || running}
          onClick={() => void execute()}
        >
          {running ? '执行中…' : '执行'}
        </button>
        <pre
          data-testid="script-log"
          style={{
            margin: 0,
            maxHeight: 140,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: 'var(--text-xs)',
            color: 'var(--muted-foreground)',
          }}
        >
          {logs.length === 0
            ? '尚无执行记录'
            : logs.map((entry, index) => `${index + 1}. [${entry.source}/${entry.level}] ${entry.text}`).join('\n')}
        </pre>
      </div>
    </details>
  )
}
