import { describe, expect, it } from 'vitest';

import {
  CORE_WASM_URL,
  SUPPORTED_KINDS,
  formatCoreError,
  validateRequest,
} from './editor-adapter';

/**
 * 适配层纯函数回归：不加载 WASM，覆盖正常、边界与异常分支。
 * 真实 WASM 端到端由 `editor-wasm.contract.mjs` 用 Node 单独验证。
 */
describe('editor-adapter 纯函数', () => {
  it('静态资源路径固定且指向 public/wasm', () => {
    expect(CORE_WASM_URL).toBe('/wasm/ocx_bindings_wasm_bg.wasm');
  });

  it('支持 5 种请求类型且无重复', () => {
    expect(SUPPORTED_KINDS).toHaveLength(5);
    expect(new Set(SUPPORTED_KINDS).size).toBe(SUPPORTED_KINDS.length);
  });

  it('每种合法请求带上必填字段时通过', () => {
    const valid: Record<string, Record<string, unknown>> = {
      rippleAdjustments: { before: {}, after: {} },
      rippleApply: { tracks: {}, adjustments: [] },
      placementResolve: { tracks: {}, subject: {}, timeSpans: [], strategy: {} },
      animationScalar: { channel: {}, time: 0, fallbackValue: 0 },
      editorExecute: { command: {} },
    };
    for (const kind of SUPPORTED_KINDS) {
      expect(() => validateRequest({ kind, ...valid[kind] })).not.toThrow();
    }
  });

  it('缺少必填字段时给出具体字段名', () => {
    expect(() => validateRequest({ kind: 'rippleAdjustments', before: {} })).toThrow(
      /缺少必填字段 after/,
    );
  });

  it('未知 kind、null 与非对象输入均被拒绝', () => {
    expect(() => validateRequest({ kind: 'unknown' })).toThrow(/不支持的请求类型/);
    expect(() => validateRequest(null)).toThrow(/请求必须是对象/);
    expect(() => validateRequest('ripple')).toThrow(/请求必须是对象/);
  });

  it('空对象与缺少 kind 的请求被拒绝', () => {
    expect(() => validateRequest({})).toThrow(/不支持的请求类型/);
  });

  it('错误提示保留原始信息并加前缀', () => {
    expect(formatCoreError(new Error('boom'))).toContain('boom');
    expect(formatCoreError('plain')).toContain('Rust core 调用失败');
    expect(formatCoreError(new Error('boom'))).toContain('Rust core 调用失败');
  });
});
