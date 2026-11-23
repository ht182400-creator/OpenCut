/**
 * evaluate 能力自检面板的纯逻辑（第一档 C）。
 *
 * 把 5 个此前只在契约测试出现的 core evaluate kind 提升为可执行样例请求，
 * 提供结果格式化与自检断言；组件只负责渲染与回调注入。
 * 样例逐字对齐 `editor-wasm.contract.mjs`，断言对齐对应 check 用例，
 * 因此面板通过即代表 WASM 桥与契约基线一致。
 */

import type { CoreRequest } from '../editor-adapter'

/** 每秒 ticks，对齐契约脚本的 TICKS_PER_SECOND。 */
const TICKS_PER_SECOND = 120000

/** animationScalar 线性插值期望值（契约：中点值）。 */
const EXPECTED_ANIMATION_VALUE = 5
/** placementResolve 期望命中的结果类型。 */
const EXPECTED_PLACEMENT_KIND = 'existingTrack'
/** editorExecute 期望产生的事件数（单次调用不累计状态）。 */
const EXPECTED_EXECUTE_EVENT_COUNT = 1
/** keyframeQuery 期望返回的关键帧数。 */
const EXPECTED_KEYFRAME_COUNT = 2
/** keyframeQuery 首帧期望插值。 */
const EXPECTED_KEYFRAME_INTERPOLATION = 'linear'
/** 不兼容编码期望错误码。 */
const EXPECTED_INCOMPATIBLE_CODE = 'INCOMPATIBLE_CODEC'

/**
 * 样例导出配置（契约基线：mp4 + avc 合法）。
 * 字面量即 fixture 语义，非业务魔法值。
 */
const SAMPLE_EXPORT_PROFILE = {
  container: 'mp4',
  codec: 'avc',
  width: 8,
  height: 4,
  frameRate: { numerator: 30, denominator: 1 },
  videoBitrateBps: 1000000,
  includeAudio: true,
  audioSampleRateHz: 48000,
  audioChannels: 2,
}

/** 自检用例稳定 id，同时作为按钮 data-testid 后缀。 */
export type EvalSampleId =
  | 'animationScalar'
  | 'placementResolve'
  | 'editorExecute'
  | 'validateExportProfile'
  | 'validateExportProfile-incompatible'
  | 'keyframeQuery'

/** 单个自检用例：中文标签 + 可直接跨边界的请求。 */
export interface EvalSample {
  id: EvalSampleId
  label: string
  request: CoreRequest
}

/** 自检判定结果：是否达标 + 人类可读的判定依据。 */
export interface SelfCheckOutcome {
  pass: boolean
  note: string
}

/**
 * 5 种 kind 的可执行样例（validateExportProfile 额外给一个不兼容反例以验证错误码可见）。
 * 全部为纯数据，UI 按 id 逐个发起并自检。
 */
export const EVAL_SAMPLES: readonly EvalSample[] = [
  {
    id: 'animationScalar',
    label: '动画标量插值',
    request: {
      kind: 'animationScalar',
      channel: {
        keys: [
          { id: 'a', time: 0, value: 0, segmentToNext: 'linear' },
          { id: 'b', time: TICKS_PER_SECOND, value: 10 },
        ],
      },
      time: TICKS_PER_SECOND / 2,
      fallbackValue: -1,
    },
  },
  {
    id: 'placementResolve',
    label: '轨道放置解析',
    request: {
      kind: 'placementResolve',
      tracks: {
        overlay: [],
        main: { id: 'main', trackType: 'video', elements: [] },
        audio: [],
      },
      subject: { elementType: 'video' },
      timeSpans: [],
      strategy: { type: 'explicit', trackId: 'main' },
    },
  },
  {
    id: 'editorExecute',
    label: '编辑器命令执行',
    request: {
      kind: 'editorExecute',
      command: {
        apiVersion: '0.1.0',
        schemaVersion: '1',
        commandId: 'cmd-selftest-1',
        kind: 'addClip',
        payload: { label: 'selftest', durationTicks: TICKS_PER_SECOND },
      },
    },
  },
  {
    id: 'validateExportProfile',
    label: '导出配置校验（通过）',
    request: {
      kind: 'validateExportProfile',
      profile: SAMPLE_EXPORT_PROFILE,
    },
  },
  {
    id: 'validateExportProfile-incompatible',
    label: '导出配置校验（编码不兼容）',
    request: {
      kind: 'validateExportProfile',
      profile: { ...SAMPLE_EXPORT_PROFILE, codec: 'vp9' },
    },
  },
  {
    id: 'keyframeQuery',
    label: '关键帧查询',
    request: {
      kind: 'keyframeQuery',
      op: 'getElementKeyframes',
      animations: {
        opacity: {
          keys: [
            { id: 'k1', time: 0, value: 0, segmentToNext: 'linear' },
            { id: 'k2', time: TICKS_PER_SECOND, value: 1 },
          ],
        },
      },
    },
  },
]

/**
 * 把 core 返回的任意结果格式化为可展示文本。
 *
 * @param result evaluate 返回值
 * @returns {string} JSON 文本，循环引用回退为 String
 */
export function formatEvalResult(result: unknown): string {
  try {
    return JSON.stringify(result) ?? 'undefined'
  } catch {
    return String(result)
  }
}

/**
 * 把未知值安全转为对象，非对象返回空对象，避免断言处解引用崩溃。
 *
 * @param value 待收窄的值
 * @returns {Record<string, unknown>} 对象视图
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 按用例 id 自检 core 返回是否命中契约基线。
 *
 * @param id 自检用例 id
 * @param result core evaluate 返回值
 * @returns {SelfCheckOutcome} 判定与依据
 */
export function checkEvalResult(id: EvalSampleId, result: unknown): SelfCheckOutcome {
  const record = asRecord(result)
  switch (id) {
    case 'animationScalar': {
      const value = record.value
      return {
        pass: value === EXPECTED_ANIMATION_VALUE,
        note: `value=${String(value)}（期望 ${EXPECTED_ANIMATION_VALUE}）`,
      }
    }
    case 'placementResolve': {
      const kind = asRecord(record.result).kind
      return {
        pass: kind === EXPECTED_PLACEMENT_KIND,
        note: `kind=${String(kind)}（期望 ${EXPECTED_PLACEMENT_KIND}）`,
      }
    }
    case 'editorExecute': {
      const events = record.events
      const count = Array.isArray(events) ? events.length : -1
      return {
        pass: count === EXPECTED_EXECUTE_EVENT_COUNT,
        note: `events=${count}（期望 ${EXPECTED_EXECUTE_EVENT_COUNT}）`,
      }
    }
    case 'validateExportProfile':
      return {
        pass: record.ok === true,
        note: `ok=${String(record.ok)}`,
      }
    case 'validateExportProfile-incompatible': {
      const code = record.code
      return {
        pass: record.ok === false && code === EXPECTED_INCOMPATIBLE_CODE,
        note: `ok=${String(record.ok)} · code=${String(code)}（期望 ${EXPECTED_INCOMPATIBLE_CODE}）`,
      }
    }
    case 'keyframeQuery': {
      const frames = record.result
      const list = Array.isArray(frames) ? frames : []
      const interpolation = list.length > 0 ? asRecord(list[0]).interpolation : undefined
      return {
        pass: list.length === EXPECTED_KEYFRAME_COUNT && interpolation === EXPECTED_KEYFRAME_INTERPOLATION,
        note: `frames=${list.length} · 首帧插值=${String(interpolation)}（期望 ${EXPECTED_KEYFRAME_COUNT} / ${EXPECTED_KEYFRAME_INTERPOLATION}）`,
      }
    }
  }
}
