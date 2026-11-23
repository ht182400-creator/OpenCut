/**
 * evaluate 能力自检面板（第一档 C）：把 5 个此前只在契约测试出现的
 * core evaluate kind 做成一键自检，验证 WASM 桥可执行且返回结构与契约基线一致。
 *
 * 组件只做渲染与错误捕获；core 调用由页面层注入，样例与断言由 model 提供。
 */
import { useState, type JSX } from 'react'

import type { CoreRequest } from '../editor-adapter'
import {
  EVAL_SAMPLES,
  checkEvalResult,
  formatEvalResult,
  type EvalSample,
} from './evaluate-settings-model'

/** 日志条数上限，避免长时间使用占用内存。 */
const MAX_LOG_LINES = 50

/** 面板 props：core 调用由页面层注入，组件保持纯 UI。 */
export interface EvaluateSettingsPanelProps {
  /** 同步 core 方法 evaluate；会话未就绪时由页面层抛错。 */
  onEvaluate: (request: CoreRequest) => unknown
  /** 会话未就绪时禁用全部操作。 */
  disabled?: boolean
}

/**
 * evaluate 一键自检折叠面板。
 *
 * @param props 注入的 core 回调与禁用状态
 * @returns {JSX.Element} 面板
 */
export function EvaluateSettingsPanel(props: EvaluateSettingsPanelProps): JSX.Element {
  const [logs, setLogs] = useState<string[]>([])

  /**
   * 追加一条日志并裁剪到上限。
   * @param line 新日志行
   */
  const appendLog = (line: string): void => {
    setLogs((previous) => [line, ...previous].slice(0, MAX_LOG_LINES))
  }

  /**
   * 执行单个自检用例：调用 core → 断言 → 记录结果，异常转中文日志。
   * @param sample 自检用例
   */
  const run = (sample: EvalSample): void => {
    if (props.disabled) return
    try {
      const result = props.onEvaluate(sample.request)
      const outcome = checkEvalResult(sample.id, result)
      const flag = outcome.pass ? '通过' : '未达标'
      appendLog(`[${sample.label}] ${flag} · ${outcome.note} · ${formatEvalResult(result)}`)
    } catch (error) {
      appendLog(`[${sample.label}] 异常：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <details className="classic-details" data-testid="evaluate-settings-panel">
      <summary>能力自检：evaluate 五种 kind（W-05 / W-06 / W-07）</summary>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {EVAL_SAMPLES.map((sample) => (
          <button
            key={sample.id}
            type="button"
            className="classic-button"
            data-testid={`eval-run-${sample.id}`}
            disabled={props.disabled}
            onClick={() => run(sample)}
          >
            {sample.label}
          </button>
        ))}
      </div>
      <pre data-testid="eval-log" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {logs.length === 0 ? '尚无记录' : logs.join('\n')}
      </pre>
    </details>
  )
}
