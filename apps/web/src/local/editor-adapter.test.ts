import { describe, expect, it } from 'vitest';

import {
  CORE_WASM_URL,
  SUPPORTED_KINDS,
  formatCoreError,
  validateFrameRequest,
  validateRequest,
} from './editor-adapter';
import { DEFAULT_ENCODER_CONFIG, probeWebCodecsSupport } from './webcodecs';

/**
 * 适配层与能力探测纯函数回归：不加载 WASM，覆盖正常、边界与异常分支。
 * 真实 WASM 端到端由 `editor-wasm.contract.mjs` 用 Node 单独验证。
 */
describe('editor-adapter 纯函数', () => {
  it('静态资源路径固定且指向 public/wasm', () => {
    expect(CORE_WASM_URL).toBe('/wasm/ocx_bindings_wasm_bg.wasm');
  });

  it('支持 8 种请求类型且无重复', () => {
    expect(SUPPORTED_KINDS).toHaveLength(8);
    expect(new Set(SUPPORTED_KINDS).size).toBe(SUPPORTED_KINDS.length);
    expect(SUPPORTED_KINDS).toContain('validateExportProfile');
    expect(SUPPORTED_KINDS).toContain('buildFramePlan');
    expect(SUPPORTED_KINDS).toContain('keyframeQuery');
  });

  it('每种合法请求带上必填字段时通过', () => {
    const valid: Record<string, Record<string, unknown>> = {
      rippleAdjustments: { before: {}, after: {} },
      rippleApply: { tracks: {}, adjustments: [] },
      placementResolve: { tracks: {}, subject: {}, timeSpans: [], strategy: {} },
      animationScalar: { channel: {}, time: 0, fallbackValue: 0 },
      editorExecute: { command: {} },
      validateExportProfile: { profile: {} },
      buildFramePlan: { durationTicks: 120000, profile: {} },
      keyframeQuery: { op: 'isAnimationPath' },
    };
    for (const kind of SUPPORTED_KINDS) {
      expect(() => validateRequest({ kind, ...valid[kind] })).not.toThrow();
    }
  });

  it('缺少必填字段时给出具体字段名', () => {
    expect(() => validateRequest({ kind: 'rippleAdjustments', before: {} })).toThrow(
      /缺少必填字段 after/,
    );
    expect(() => validateRequest({ kind: 'buildFramePlan', profile: {} })).toThrow(
      /缺少必填字段 durationTicks/,
    );
  });

  it('未知 kind、null 与非对象输入均被拒绝', () => {
    expect(() => validateRequest({ kind: 'unknown' })).toThrow(/不支持的请求类型/);
    expect(() => validateRequest(null)).toThrow(/请求必须是对象/);
    expect(() => validateRequest('ripple')).toThrow(/请求必须是对象/);
  });

  it('错误提示保留原始信息并加前缀', () => {
    expect(formatCoreError(new Error('boom'))).toContain('boom');
    expect(formatCoreError('plain')).toContain('Rust core 调用失败');
  });
});

describe('validateFrameRequest', () => {
  const valid = {
    frameIndex: 0,
    timeTicks: 0,
    durationTicks: 4000,
    profile: {},
    params: {},
  };

  it('合法帧请求通过', () => {
    expect(() => validateFrameRequest(valid)).not.toThrow();
  });

  it('缺失字段、负帧索引、非整数与非对象均被拒绝', () => {
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.params;
    expect(() => validateFrameRequest(missing)).toThrow(/缺少必填字段 params/);
    expect(() => validateFrameRequest({ frameIndex: 0 })).toThrow(/缺少必填字段/);
    expect(() => validateFrameRequest({ ...valid, frameIndex: -1 })).toThrow(/非负整数/);
    expect(() => validateFrameRequest({ ...valid, frameIndex: 1.5 })).toThrow(/非负整数/);
    expect(() => validateFrameRequest(null)).toThrow(/帧请求必须是对象/);
  });
});

describe('WebCodecs 能力探测', () => {
  it('默认配置固定为 H.264 720p', () => {
    expect(DEFAULT_ENCODER_CONFIG.codec).toBe('avc1.42001f');
    expect(DEFAULT_ENCODER_CONFIG.width).toBe(1280);
    expect(DEFAULT_ENCODER_CONFIG.framerate).toBe(30);
  });

  it('Node/无 WebCodecs 环境返回不可用且不抛异常', async () => {
    const support = await probeWebCodecsSupport();
    expect(support.available).toBe(false);
    expect(support.videoEncoder).toBe(false);
    expect(support.videoFrame).toBe(false);
    expect(support.configSupported).toBe(false);
    expect(support.reason).toContain('不提供 WebCodecs API');
    expect(support.codec).toBe(DEFAULT_ENCODER_CONFIG.codec);
  });
});
