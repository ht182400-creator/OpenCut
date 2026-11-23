/**
 * Core 能力验证台（/core-lab）：集中 W-05~W-13 的 core 调试与验证入口。
 *
 * 与 /editor（经典版产品页）职责分离：本页只验证 Rust core → WASM → EditorAdapter
 * 链路，不承载产品化编辑 UI。evaluate / negotiate / pluginRegister / 脚本工具
 * 均为无项目依赖的 core 能力，因此本页无需加载项目即可自检。
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import './classic-ui/theme.css'
import { createEditorAdapter, formatCoreError, type EditorAdapter } from './editor-adapter'
import { createScriptExecutor } from './classic-ui/script-console-dispatch'
import { ScriptConsole } from './classic-ui/script-console'
import { PluginSettingsPanel } from './classic-ui/plugin-settings-panel'
import { EvaluateSettingsPanel } from './classic-ui/evaluate-settings-panel'
import {
  DEFAULT_NEGOTIATION_REQUEST,
  SAMPLE_PLUGIN_GRANTS,
  SAMPLE_PLUGIN_MANIFEST,
  SAMPLE_PLUGIN_URL,
} from './classic-ui/plugin-settings-model'
import { loadPluginModule, validatePluginBytes, type PluginInstance } from './plugin-runtime'

/** 页面标题（验证台标识）。 */
const PAGE_TITLE = 'OpenCut Core 验证台'
/** 页面用途说明。 */
const PAGE_DESCRIPTION = '仅用于验证 Rust core → WASM → EditorAdapter 链路；产品编辑请使用 /editor。'
/** Core 未就绪时的友好提示。 */
const CORE_NOT_READY = 'Core 尚未就绪，请稍候重试'
/** 初始化失败的友好提示前缀。 */
const INIT_ERROR_HINT = 'Core 初始化失败，请确认 WASM 资源已构建（public/wasm/）。'
/** 插件未注册时的友好提示。 */
const PLUGIN_NOT_REGISTERED = '请先注册示例插件'
/** 插件 wasm 加载失败的提示模板。 */
const PLUGIN_FETCH_FAILED = (status: number): string => `示例插件 wasm 加载失败（HTTP ${status}）`


/**
 * Core 验证台页面：初始化唯一 adapter，向三个验证面板注入 core 回调。
 * 所有 core 调用集中在页面层注入，面板保持纯 UI，符合 I-01 单一入口约束。
 * @returns {JSX.Element} 验证台页面
 */
export function CoreLabPage(): JSX.Element {
  const [adapter, setAdapter] = useState<EditorAdapter | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  /** 示例插件实例（注册成功后加载，供 effect/command 按钮调用）。 */
  const pluginInstanceRef = useRef<PluginInstance | null>(null)

  /** 初始化 WASM 适配层；失败时展示友好提示，不阻塞静态信息展示。 */
  useEffect(() => {
    void (async () => {
      try {
        setAdapter(await createEditorAdapter())
      } catch (error) {
        console.error('[core-lab] 初始化异常', error)
        setErrorText(`${INIT_ERROR_HINT}（${formatCoreError(error)}）`)
      }
    })()
  }, [])

  /**
   * 取得就绪的 adapter；未就绪时抛中文错误，供各面板回调复用。
   * @returns {EditorAdapter} 当前适配层
   * @throws {Error} 适配层尚未初始化
   */
  const requireAdapter = (): EditorAdapter => {
    if (!adapter) throw new Error(CORE_NOT_READY)
    return adapter
  }

  return (
    <div className="classic-ui-root" style={{ minHeight: '100vh', padding: 16, overflow: 'auto' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>{PAGE_TITLE}</h1>
      <p style={{ margin: '0 0 14px', color: 'var(--muted-foreground)', fontSize: 13 }}>
        {PAGE_DESCRIPTION}
      </p>
      {errorText !== null && (
        <div role="alert" style={{ marginBottom: 14, color: 'var(--destructive)', fontSize: 13 }}>
          {errorText}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 860 }}>
        <ScriptConsole
          onExecute={adapter
            ? createScriptExecutor(adapter)
            : async () => { throw new Error(CORE_NOT_READY) }}
          disabled={!adapter}
        />
        <PluginSettingsPanel
          disabled={!adapter}
          onNegotiate={() => requireAdapter().negotiate(DEFAULT_NEGOTIATION_REQUEST)}
          onRegister={async () => {
            // 注册通过后加载同一份 wasm 产物，供 effect/command 按钮真实调用。
            const result = requireAdapter().pluginRegister(SAMPLE_PLUGIN_MANIFEST, SAMPLE_PLUGIN_GRANTS)
            if (!result.ok) return result
            const response = await fetch(SAMPLE_PLUGIN_URL)
            if (!response.ok) throw new Error(PLUGIN_FETCH_FAILED(response.status))
            const bytes = new Uint8Array(await response.arrayBuffer())
            validatePluginBytes(bytes)
            pluginInstanceRef.current = await loadPluginModule(bytes)
            return result
          }}
          onRunEffect={async () => {
            const plugin = pluginInstanceRef.current
            if (!plugin) throw new Error(PLUGIN_NOT_REGISTERED)
            return plugin.runEffect('brightness', { amount: 0.25 })
          }}
          onRunCommand={async () => {
            const plugin = pluginInstanceRef.current
            if (!plugin) throw new Error(PLUGIN_NOT_REGISTERED)
            return plugin.runCommand('ping', { value: 7 })
          }}
          onScopeCheck={(request) => requireAdapter().pluginScopeCheck(request)}
        />
        <EvaluateSettingsPanel
          disabled={!adapter}
          onEvaluate={(request) => requireAdapter().evaluate(request)}
        />
      </div>
    </div>
  )
}
