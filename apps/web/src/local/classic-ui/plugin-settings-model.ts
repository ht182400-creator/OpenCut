/**
 * 插件与能力协商面板的纯逻辑（第一档 B）。
 *
 * 把 `EditorAdapter.negotiate` / `pluginRegister` 的结果格式化为中文日志，
 * 组件只负责渲染与回调注入；常量集中避免散落硬编码。
 */

import type { NegotiationResult, PluginRegisterResult } from '../editor-adapter'

/** 示例插件 manifest（对齐 `ocx-plugin-host/tests/fixtures/sample_plugin.json`）。 */
export const SAMPLE_PLUGIN_MANIFEST = JSON.stringify({
  name: 'sample-effects',
  version: '1.0.0',
  apiVersion: '0.1.0',
  schemaVersion: '1',
  capabilities: ['effect', 'command'],
  effects: ['brightness'],
  commands: ['ping'],
})

/** 默认协商请求（对齐 `editor-wasm.contract.mjs` 的基线用例）。 */
export const DEFAULT_NEGOTIATION_REQUEST = {
  apiVersion: '0.1.0',
  schemaVersions: ['1'],
  requiredCapabilities: ['command', 'snapshot'],
}

/** 示例插件授予的能力（deny-by-default，仅授予声明项）。 */
export const SAMPLE_PLUGIN_GRANTS = ['effect', 'command']

/** 示例插件 wasm 静态路径（`public/fixtures/` 直接对外提供）。 */
export const SAMPLE_PLUGIN_URL = '/fixtures/sample-plugin.wasm'

/**
 * 把能力协商结果格式化为逐行中文日志。
 *
 * @param result core 协商结果
 * @returns {string[]} 可展示的日志行
 */
export function formatNegotiation(result: NegotiationResult): string[] {
  const lines = [
    `[协商] ${result.compatible ? '兼容' : '不兼容'} · schema ${result.schemaVersion ?? '无'} · ${result.reason}`,
  ]
  if (result.missingCapabilities.length > 0) {
    lines.push(`[协商] 缺失能力：${result.missingCapabilities.join('、')}`)
  }
  return lines
}

/**
 * 把插件注册结果格式化为逐行中文日志。
 *
 * @param result core 注册结果
 * @returns {string[]} 可展示的日志行
 */
export function formatRegistration(result: PluginRegisterResult): string[] {
  if (!result.ok) {
    return [`[注册] 失败：${result.error ?? '未知错误'}`]
  }
  const registration = result.registration
  if (!registration) return ['[注册] 成功（无注册详情）']
  return [
    `[注册] 成功：${registration.name}@${registration.version} · schema ${registration.schemaVersion}`,
    `[注册] 能力：${registration.capabilities.join('、') || '无'}`,
    `[注册] effects：${registration.effects.join('、') || '无'} · commands：${registration.commands.join('、') || '无'}`,
  ]
}

/**
 * 格式化受控插件调用结果（effect/command 共用）。
 *
 * @param kind 调用类别（effect / command）
 * @param result 返回值
 * @returns {string} 单行日志
 */
export function formatPluginCall(kind: string, result: unknown): string {
  let text: string
  try {
    text = JSON.stringify(result)
  } catch {
    text = String(result)
  }
  return `[${kind}] ${text ?? 'undefined'}`
}
