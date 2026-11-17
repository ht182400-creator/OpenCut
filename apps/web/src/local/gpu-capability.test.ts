/**
 * gpu-capability.ts 单元测试（P2）：能力探测的可用/不可用/异常分支与汇总。
 * 覆盖：非浏览器环境、WebGL2 有/无上下文、WebGPU API 有/无、硬件编码推导、汇总文案。
 */

import { describe, expect, it } from 'vitest'
import {
  GPU_PROBE_LABELS,
  probeHardwareEncoder,
  probeWebGL2,
  probeWebGPU,
  summarizeCapability,
} from './gpu-capability'

describe('probeWebGL2', () => {
  it('Node 环境无 document 返回不可用', () => {
    const result = probeWebGL2()
    expect(result.available).toBe(false)
    expect(result.label).toBe(GPU_PROBE_LABELS.webgl2)
    expect(result.detail).toContain('非浏览器环境')
  })
})

describe('probeWebGPU', () => {
  it('Node 环境无 navigator.gpu 返回不可用', () => {
    const result = probeWebGPU()
    expect(result.available).toBe(false)
    expect(result.label).toBe(GPU_PROBE_LABELS.webgpu)
  })
})

describe('probeHardwareEncoder', () => {
  it('configSupported=true 推导可用', () => {
    const result = probeHardwareEncoder(true, '编码配置受支持')
    expect(result.available).toBe(true)
    expect(result.detail).toContain('编码配置受支持')
  })

  it('configSupported=false 推导不可用', () => {
    const result = probeHardwareEncoder(false, '不支持')
    expect(result.available).toBe(false)
    expect(result.detail).toContain('软件降级')
  })
})

describe('summarizeCapability', () => {
  const item = (label: string, available: boolean) => ({ label, available, detail: '' })

  it('有可用能力列出标签', () => {
    const report = summarizeCapability(
      item('WebGL2', true), item('WebGPU', false), item('硬件视频编码', true),
    )
    expect(report.summary).toContain('WebGL2')
    expect(report.summary).toContain('硬件视频编码')
    expect(report.summary).not.toContain('WebGPU')
  })

  it('全不可用给出软件路径提示', () => {
    const report = summarizeCapability(
      item('WebGL2', false), item('WebGPU', false), item('硬件视频编码', false),
    )
    expect(report.summary).toContain('软件路径')
  })
})
