/**
 * 插件与能力协商面板（第一档 B）：把 `EditorAdapter.negotiate` / `pluginRegister`
 * 与示例插件 effect/command 调用接进 Settings tab，让 W-11/W-12 能力在 UI 可见可用。
 *
 * 组件只做渲染与错误捕获；core 调用由页面层注入，格式化由 `plugin-settings-model` 提供。
 */
import { useState, type JSX } from 'react'

import type {
  NegotiationResult,
  PluginRegisterResult,
  PluginScopeCheckRequest,
  PluginScopeCheckResult,
} from '../editor-adapter'
import {
  formatNegotiation,
  formatPluginCall,
  formatRegistration,
} from './plugin-settings-model'

/** 日志条数上限，避免长时间使用占用内存。 */
const MAX_LOG_LINES = 50

/** 面板 props：所有 core 调用由页面层注入，组件保持纯 UI。 */
export interface PluginSettingsPanelProps {
  /** 能力协商（同步 core 方法）。 */
  onNegotiate: () => NegotiationResult
  /** 示例插件注册（含 manifest 与授予能力）。 */
  onRegister: () => Promise<PluginRegisterResult>
  /** 调用已加载插件的 brightness effect。 */
  onRunEffect?: () => Promise<unknown>
  /** 调用已加载插件的 ping command。 */
  onRunCommand?: () => Promise<unknown>
  /** W-12 WASM glue：用 core 同一份逻辑校验资源 scope。 */
  onScopeCheck?: (request: PluginScopeCheckRequest) => PluginScopeCheckResult
  /** 会话未就绪时禁用全部操作。 */
  disabled?: boolean
}

/**
 * 插件与能力协商折叠面板。
 *
 * @param props 注入的 core 回调与禁用状态
 * @returns {JSX.Element} 面板
 */
export function PluginSettingsPanel(props: PluginSettingsPanelProps): JSX.Element {
  const [logs, setLogs] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  /**
   * 追加日志并裁剪到上限。
   * @param lines 新日志行
   */
  const appendLogs = (lines: string[]): void => {
    setLogs((previous) => [...lines, ...previous].slice(0, MAX_LOG_LINES))
  }

  /** 执行能力协商。 */
  const negotiate = (): void => {
    if (props.disabled) return
    try {
      appendLogs(formatNegotiation(props.onNegotiate()))
    } catch (error) {
      appendLogs([`[协商] 失败：${error instanceof Error ? error.message : String(error)}`])
    }
  }

  /** 注册示例插件。 */
  const register = async (): Promise<void> => {
    if (props.disabled || running) return
    setRunning(true)
    try {
      appendLogs(formatRegistration(await props.onRegister()))
    } catch (error) {
      appendLogs([`[注册] 异常：${error instanceof Error ? error.message : String(error)}`])
    } finally {
      setRunning(false)
    }
  }

  /**
   * 调用插件处理器（effect / command 共用）。
   * @param kind 类别名
   * @param handler 页面层注入的调用
   */
  const call = async (kind: string, handler?: () => Promise<unknown>): Promise<void> => {
    if (props.disabled || running || !handler) return
    setRunning(true)
    try {
      appendLogs([formatPluginCall(kind, await handler())])
    } catch (error) {
      appendLogs([`[${kind}] 异常：${error instanceof Error ? error.message : String(error)}`])
    } finally {
      setRunning(false)
    }
  }

  /** 校验示例资源 scope（授予 clip:intro 时允许、越权命名空间拒绝）。 */
  const scopeCheck = (): void => {
    if (props.disabled || !props.onScopeCheck) return
    try {
      const allowedReq: PluginScopeCheckRequest = {
        capability: 'media-read', resource: 'clip:intro', scopes: ['clip:intro'],
      }
      const deniedReq: PluginScopeCheckRequest = {
        capability: 'media-read', resource: 'secret:key', scopes: ['clip:*'],
      }
      const allowed = props.onScopeCheck(allowedReq) as PluginScopeCheckResult
      const denied = props.onScopeCheck(deniedReq) as PluginScopeCheckResult
      appendLogs([
        `[scope] clip:intro 授予 clip:intro → ${allowed.allowed === true ? '允许' : '拒绝'}`,
        `[scope] secret:key 授予 clip:* → ${denied.allowed === false ? '拒绝（deny-by-default）' : '异常允许'}`,
      ])
    } catch (error) {
      appendLogs([`[scope] 异常：${error instanceof Error ? error.message : String(error)}`])
    }
  }

  return (
    <details className="classic-details" data-testid="plugin-settings-panel">
      <summary>插件与能力协商（W-11 / W-12）</summary>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <button type="button" className="classic-button" data-testid="plugin-negotiate"
          disabled={props.disabled} onClick={negotiate}>能力自检</button>
        <button type="button" className="classic-button" data-testid="plugin-register"
          disabled={props.disabled || running} onClick={() => void register()}>注册示例插件</button>
        <button type="button" className="classic-button" data-testid="plugin-run-effect"
          disabled={props.disabled || running || !props.onRunEffect}
          onClick={() => void call('effect', props.onRunEffect)}>brightness</button>
        <button type="button" className="classic-button" data-testid="plugin-run-command"
          disabled={props.disabled || running || !props.onRunCommand}
          onClick={() => void call('command', props.onRunCommand)}>ping</button>
        <button type="button" className="classic-button" data-testid="plugin-scope-check"
          disabled={props.disabled || !props.onScopeCheck}
          onClick={scopeCheck}>校验资源 scope</button>
      </div>
      <pre data-testid="plugin-log" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {logs.length === 0 ? '尚无记录' : logs.join('\n')}
      </pre>
    </details>
  )
}
