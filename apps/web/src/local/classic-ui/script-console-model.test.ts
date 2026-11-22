import { describe, expect, it } from 'vitest'

import {
  SCRIPT_TOOLS,
  findScriptTool,
  formatScriptError,
  formatScriptResult,
  parseScriptArgs,
} from './script-console-model'

/** 脚本控制台纯逻辑回归：工具目录、参数校验、结果/错误格式化。 */
describe('script-console-model', () => {
  it('工具目录对齐 MCP 八工具并标记浏览器等价', () => {
    expect(SCRIPT_TOOLS).toHaveLength(8)
    expect(SCRIPT_TOOLS.filter((tool) => tool.available)).toHaveLength(6)
    expect(findScriptTool('ocx.render.frame')?.available).toBe(true)
    expect(findScriptTool('ocx.render.batch')?.available).toBe(false)
    expect(findScriptTool('ocx.not-exist')).toBeUndefined()
  })

  it('parseScriptArgs 覆盖空值、正常对象、非对象与非法 JSON', () => {
    expect(parseScriptArgs('')).toEqual({ ok: true, value: {} })
    expect(parseScriptArgs('   ')).toEqual({ ok: true, value: {} })
    expect(parseScriptArgs('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseScriptArgs('[]')).toEqual({ ok: false, error: '参数必须是 JSON 对象' })
    expect(parseScriptArgs('null')).toEqual({ ok: false, error: '参数必须是 JSON 对象' })
    expect(parseScriptArgs('{bad').ok).toBe(false)
  })

  it('formatScriptResult 覆盖 Uint8Array、字符串、对象与超长截断', () => {
    expect(formatScriptResult('ocx.render.frame', new Uint8Array(12))).toEqual({
      source: 'ocx.render.frame', level: 'ok', text: 'Uint8Array(12 bytes)',
    })
    expect(formatScriptResult('t', 'plain').text).toBe('plain')
    expect(formatScriptResult('t', { a: 1 }).text).toBe('{"a":1}')
    expect(formatScriptResult('t', 'x'.repeat(600)).text.endsWith('…（已截断）')).toBe(true)
  })

  it('formatScriptError 同时处理 Error 与非 Error', () => {
    expect(formatScriptError('t', new Error('boom'))).toEqual({
      source: 't', level: 'error', text: '失败：boom',
    })
    expect(formatScriptError('t', 'oops').text).toBe('失败：oops')
  })
})
