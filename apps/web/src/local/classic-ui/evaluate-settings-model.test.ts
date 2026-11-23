import { describe, expect, it } from 'vitest'

import type { CoreRequest } from '../editor-adapter'
import {
  EVAL_SAMPLES,
  checkEvalResult,
  formatEvalResult,
  type EvalSampleId,
} from './evaluate-settings-model'

/** 第一档 C：evaluate 自检面板纯逻辑回归（常量基线 + 格式化 + 全分支断言）。 */
describe('evaluate-settings-model', () => {
  it('样例覆盖 5 种 kind 且带一个不编码反例', () => {
    const ids = EVAL_SAMPLES.map((sample) => sample.id)
    expect(ids).toEqual([
      'animationScalar',
      'placementResolve',
      'editorExecute',
      'validateExportProfile',
      'validateExportProfile-incompatible',
      'keyframeQuery',
    ])
    expect(new Set(EVAL_SAMPLES.map((sample) => sample.request.kind)).size).toBe(5)
    expect(EVAL_SAMPLES.every((sample) => sample.label.length > 0)).toBe(true)
  })

  it('样例请求逐字对齐契约测试关键字段', () => {
    const byId = Object.fromEntries(
      EVAL_SAMPLES.map((sample) => [sample.id, sample.request]),
    ) as Record<string, CoreRequest>
    expect((byId.animationScalar.channel as { keys: unknown[] }).keys).toHaveLength(2)
    expect(byId.animationScalar.time).toBe(60000)
    expect((byId.placementResolve.strategy as { type: string }).type).toBe('explicit')
    expect((byId.editorExecute.command as { kind: string }).kind).toBe('addClip')
    expect((byId.validateExportProfile.profile as { codec: string }).codec).toBe('avc')
    expect((byId['validateExportProfile-incompatible'].profile as { codec: string }).codec).toBe('vp9')
    expect(byId.keyframeQuery.op).toBe('getElementKeyframes')
  })

  it('结果序列化为 JSON，null/undefined 与循环引用安全回退', () => {
    expect(formatEvalResult({ value: 5 })).toBe('{"value":5}')
    expect(formatEvalResult(null)).toBe('null')
    expect(formatEvalResult(undefined)).toBe('undefined')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatEvalResult(circular)).toBe('[object Object]')
  })

  it('animationScalar：命中期望值通过，偏差值与非对象不达标', () => {
    expect(checkEvalResult('animationScalar', { value: 5 }).pass).toBe(true)
    expect(checkEvalResult('animationScalar', { value: -1 }).pass).toBe(false)
    expect(checkEvalResult('animationScalar', null).pass).toBe(false)
    expect(checkEvalResult('animationScalar', { value: 5 }).note).toContain('value=5')
  })

  it('placementResolve：existingTrack 通过，newTrack 与非对象不达标', () => {
    expect(checkEvalResult('placementResolve', { result: { kind: 'existingTrack' } }).pass).toBe(true)
    expect(checkEvalResult('placementResolve', { result: { kind: 'newTrack' } }).pass).toBe(false)
    expect(checkEvalResult('placementResolve', null).pass).toBe(false)
  })

  it('editorExecute：单事件通过，空/非数组/非对象不达标', () => {
    expect(checkEvalResult('editorExecute', { events: [1] }).pass).toBe(true)
    expect(checkEvalResult('editorExecute', { events: [] }).pass).toBe(false)
    expect(checkEvalResult('editorExecute', { events: 'x' }).pass).toBe(false)
    expect(checkEvalResult('editorExecute', null).pass).toBe(false)
  })

  it('validateExportProfile 正反两例判定互斥', () => {
    expect(checkEvalResult('validateExportProfile', { ok: true }).pass).toBe(true)
    expect(checkEvalResult('validateExportProfile', { ok: false, code: 'INVALID_DIMENSION' }).pass).toBe(false)
    expect(checkEvalResult('validateExportProfile-incompatible', { ok: false, code: 'INCOMPATIBLE_CODEC' }).pass).toBe(true)
    expect(checkEvalResult('validateExportProfile-incompatible', { ok: true }).pass).toBe(false)
    expect(checkEvalResult('validateExportProfile-incompatible', null).pass).toBe(false)
  })

  it('keyframeQuery：双线性帧通过，帧数/插值/非数组异常均不达标', () => {
    const okResult = {
      result: [{ interpolation: 'linear' }, { interpolation: 'linear' }],
    }
    expect(checkEvalResult('keyframeQuery', okResult).pass).toBe(true)
    expect(checkEvalResult('keyframeQuery', { result: [{ interpolation: 'linear' }] }).pass).toBe(false)
    expect(checkEvalResult('keyframeQuery', { result: [{ interpolation: 'step' }, {}] }).pass).toBe(false)
    expect(checkEvalResult('keyframeQuery', { result: 'x' }).pass).toBe(false)
    expect(checkEvalResult('keyframeQuery', null).pass).toBe(false)
  })

  it('switch 覆盖所有已声明 id，无遗漏分支', () => {
    const ids: EvalSampleId[] = EVAL_SAMPLES.map((sample) => sample.id)
    for (const id of ids) {
      expect(typeof checkEvalResult(id, {}).pass).toBe('boolean')
    }
  })
})
