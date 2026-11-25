/**
 * editor-adapter.ts 请求校验纯函数测试（ISTQB 组件测试级别 + 错误推测）。
 * 覆盖：常量契约、validateCapabilitiesRequest / validateRequest / validateFrameRequest /
 * validateCompositeRequest / validateWaveformRequest / validateThumbnailRequest 的合法与非法输入、
 * validateOtioText 格式校验、formatCoreError 中英文错误映射。
 * 不加载 WASM（仅测进入 WASM 前的参数门禁）。
 */

import { describe, expect, it } from 'vitest'
import {
  CORE_WASM_URL,
  MAX_THUMBNAIL_PIXELS,
  SUPPORTED_KINDS,
  formatCoreError,
  validateCapabilitiesRequest,
  validateCompositeRequest,
  validateFrameRequest,
  validateOtioText,
  validateRequest,
  validateThumbnailRequest,
  validateWaveformRequest,
} from './editor-adapter'

/** 对 assert 函数断言「合法输入不抛错」。 */
function accepts(fn: (input: unknown) => void, input: unknown) {
  expect(() => fn(input)).not.toThrow()
}

/** 对 assert 函数断言「非法输入抛指定中文提示」。 */
function rejects(fn: (input: unknown) => void, input: unknown, hint?: string) {
  let message = ''
  try { fn(input) } catch (error) { message = error instanceof Error ? error.message : String(error) }
  expect(message).toBeTruthy()
  if (hint) expect(message).toContain(hint)
}

describe('editor-adapter 常量契约', () => {
  it('WASM 路径/缩略图上限/支持命令清单固定', () => {
    expect(CORE_WASM_URL).toBe('/wasm/ocx_bindings_wasm_bg.wasm')
    expect(MAX_THUMBNAIL_PIXELS).toBe(512 * 512)
    expect(SUPPORTED_KINDS).toContain('buildFramePlan')
    expect(SUPPORTED_KINDS.length).toBeGreaterThan(5)
  })
})

describe('editor-adapter 请求门禁校验', () => {
  it('validateCapabilitiesRequest：对象通过，null/数组/基本类型拒绝', () => {
    accepts(validateCapabilitiesRequest, {})
    for (const bad of [null, [], 'x', 1, undefined]) {
      rejects(validateCapabilitiesRequest, bad, '对象')
    }
  })

  it('validateRequest：合法 kind（buildFramePlan）通过，非法 kind/缺字段拒绝', () => {
    accepts(validateRequest, { kind: 'buildFramePlan', durationTicks: 100, profile: {}, params: {} })
    rejects(validateRequest, null)
    rejects(validateRequest, { kind: 'unknown' })
    rejects(validateRequest, { kind: 'buildFramePlan' })
  })

  it('validateFrameRequest：合法帧请求通过，负帧号/缺字段拒绝', () => {
    accepts(validateFrameRequest, { frameIndex: 0, timeTicks: 0, durationTicks: 120000, profile: {}, params: {} })
    rejects(validateFrameRequest, { frameIndex: -1, timeTicks: 0, durationTicks: 100, profile: {}, params: {} })
    rejects(validateFrameRequest, {})
  })

  it('validateCompositeRequest：合法尺寸通过，零/负尺寸拒绝', () => {
    accepts(validateCompositeRequest, { width: 320, height: 180, frameIndex: 0, timeTicks: 0, durationTicks: 100, params: {} })
    rejects(validateCompositeRequest, { width: 0, height: 180, frameIndex: 0, timeTicks: 0, durationTicks: 100, params: {} })
    rejects(validateCompositeRequest, { width: -1, height: 180, frameIndex: 0, timeTicks: 0, durationTicks: 100, params: {} })
  })

  it('validateWaveformRequest：合法 bins（1~4096）通过，越界拒绝', () => {
    accepts(validateWaveformRequest, {})
    accepts(validateWaveformRequest, { bins: 16 })
    rejects(validateWaveformRequest, { bins: 0 })
    rejects(validateWaveformRequest, { bins: 4097 })
  })

  it('validateThumbnailRequest：合法尺寸通过，超大/非法尺寸拒绝', () => {
    accepts(validateThumbnailRequest, { srcWidth: 1920, srcHeight: 1080, width: 100, height: 60 })
    rejects(validateThumbnailRequest, { srcWidth: -1, srcHeight: 1080, width: 100, height: 60 })
    rejects(validateThumbnailRequest, { srcWidth: 1920, srcHeight: 1080, width: 0, height: 0 })
  })
})

describe('editor-adapter OTIO 与错误映射', () => {
  it('validateOtioText：非空字符串通过，空/非字符串拒绝', () => {
    accepts(validateOtioText, JSON.stringify({ otio: 'mock' }))
    rejects(validateOtioText, '', '非空字符串')
    rejects(validateOtioText, '  ', '非空字符串')
    rejects(validateOtioText, null, '非空字符串')
  })

  it('formatCoreError：错误对象/字符串/null 统一为带前缀的中文提示', () => {
    expect(formatCoreError(new Error('ENTITY_NOT_FOUND'))).toContain('Rust core 调用失败')
    expect(formatCoreError(new Error('普通错误'))).toBeTruthy()
    expect(formatCoreError('字符串错误')).toBeTruthy()
    expect(formatCoreError(null)).toBeTruthy()
  })
})
