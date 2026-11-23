import { describe, expect, it } from 'vitest'

import type { NegotiationResult, PluginRegisterResult } from '../editor-adapter'
import {
  DEFAULT_NEGOTIATION_REQUEST,
  SAMPLE_PLUGIN_GRANTS,
  SAMPLE_PLUGIN_MANIFEST,
  SAMPLE_PLUGIN_URL,
  formatNegotiation,
  formatPluginCall,
  formatRegistration,
} from './plugin-settings-model'

/** 第一档 B：插件面板纯逻辑回归（格式化 + 常量基线）。 */
describe('plugin-settings-model', () => {
  it('常量对齐 core 契约基线', () => {
    const manifest = JSON.parse(SAMPLE_PLUGIN_MANIFEST)
    expect(manifest.name).toBe('sample-effects')
    expect(manifest.effects).toEqual(['brightness'])
    expect(manifest.commands).toEqual(['ping'])
    expect(DEFAULT_NEGOTIATION_REQUEST.requiredCapabilities).toEqual(['command', 'snapshot'])
    expect(SAMPLE_PLUGIN_GRANTS).toEqual(['effect', 'command'])
    expect(SAMPLE_PLUGIN_URL).toBe('/fixtures/sample-plugin.wasm')
  })

  it('协商成功格式化含兼容/schema/reason', () => {
    const result: NegotiationResult = {
      compatible: true, schemaVersion: '1', missingCapabilities: [], reason: 'OK',
    }
    expect(formatNegotiation(result)).toEqual(['[协商] 兼容 · schema 1 · OK'])
  })

  it('协商缺能力时单独列出，schema 为 null 显示为无', () => {
    const result: NegotiationResult = {
      compatible: false, schemaVersion: null, missingCapabilities: ['gpu-render'], reason: 'MISSING_CAPABILITIES',
    }
    expect(formatNegotiation(result)).toEqual([
      '[协商] 不兼容 · schema 无 · MISSING_CAPABILITIES',
      '[协商] 缺失能力：gpu-render',
    ])
  })

  it('注册成功格式化含名称/版本/能力/处理器', () => {
    const result: PluginRegisterResult = {
      ok: true,
      registration: {
        name: 'sample-effects', version: '1.0.0', schemaVersion: '1',
        capabilities: ['effect', 'command'], effects: ['brightness'], commands: ['ping'],
      },
      denied: [],
    }
    expect(formatRegistration(result)).toEqual([
      '[注册] 成功：sample-effects@1.0.0 · schema 1',
      '[注册] 能力：effect、command',
      '[注册] effects：brightness · commands：ping',
    ])
  })

  it('注册失败与拒绝格式化', () => {
    expect(formatRegistration({ ok: false, error: 'PERMISSION_DENIED', denied: ['effect'] }))
      .toEqual(['[注册] 失败：PERMISSION_DENIED'])
    expect(formatRegistration({ ok: true, denied: [] }))
      .toEqual(['[注册] 成功（无注册详情）'])
  })

  it('插件调用结果序列化，循环引用回退为字符串', () => {
    expect(formatPluginCall('effect', { brightness: 0.5 })).toBe('[effect] {"brightness":0.5}')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatPluginCall('command', circular)).toBe('[command] [object Object]')
  })
})
