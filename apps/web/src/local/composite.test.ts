import { describe, expect, it } from 'vitest';

import { validateCompositeRequest } from './editor-adapter';

/** 真实素材合成请求的校验回归（W-08）：纯函数，不加载 WASM。 */
describe('validateCompositeRequest', () => {
  const valid = {
    width: 320,
    height: 180,
    frameIndex: 0,
    timeTicks: 0,
    durationTicks: 4000,
    params: {},
  };

  it('合法请求通过', () => {
    expect(() => validateCompositeRequest(valid)).not.toThrow();
  });

  it('缺失字段被点名拒绝', () => {
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.params;
    expect(() => validateCompositeRequest(missing)).toThrow(/缺少必填字段 params/);
  });

  it('宽高非正或非整数被拒绝', () => {
    expect(() => validateCompositeRequest({ ...valid, width: 0 })).toThrow(/正整数/);
    expect(() => validateCompositeRequest({ ...valid, height: 1.5 })).toThrow(/正整数/);
  });

  it('非对象输入被拒绝', () => {
    expect(() => validateCompositeRequest(null)).toThrow(/必须是对象/);
  });
});
