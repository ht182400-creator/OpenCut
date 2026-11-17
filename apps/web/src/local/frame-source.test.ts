import { describe, expect, it, vi } from 'vitest';

import type { EditorAdapter } from './editor-adapter';
import { DEMO_PARAMS } from './editor-ui';
import {
  PRODUCTION_FRAME_PARAMS,
  VERIFY_FRAME_ENABLED,
  VERIFY_FRAME_QUERY,
  isVerificationFrameMode,
  resolvePreviewPixels,
  type PreviewFrameRequest,
} from './frame-source';

/** 固定帧请求，避免测试间共享可变对象。 */
function makeRequest(): PreviewFrameRequest {
  return { frameIndex: 7, timeTicks: 7000, durationTicks: 1000, width: 4, height: 4 };
}

/** 构造仅含帧入口的适配器桩，并记录调用。 */
function makeAdapter() {
  return {
    compositeFrameRgba: vi.fn((base: Uint8Array) => new Uint8Array(base.length).fill(9)),
    renderFrameRgba: vi.fn(() => new Uint8Array(4 * 4 * 4).fill(7)),
  } as unknown as EditorAdapter & {
    compositeFrameRgba: ReturnType<typeof vi.fn>;
    renderFrameRgba: ReturnType<typeof vi.fn>;
  };
}

describe('验证演示帧模式判定（正式 UI 默认关闭）', () => {
  it('空串与其它参数一律关闭', () => {
    expect(isVerificationFrameMode('')).toBe(false);
    expect(isVerificationFrameMode('?foo=bar')).toBe(false);
    expect(isVerificationFrameMode(`?${VERIFY_FRAME_QUERY}=0`)).toBe(false);
    expect(isVerificationFrameMode(`?${VERIFY_FRAME_QUERY}=true`)).toBe(false);
  });

  it('仅显式 verifyDemoFrame=1 开启（含多参数场景）', () => {
    expect(isVerificationFrameMode(`?${VERIFY_FRAME_QUERY}=${VERIFY_FRAME_ENABLED}`)).toBe(true);
    expect(isVerificationFrameMode(`?foo=bar&${VERIFY_FRAME_QUERY}=1`)).toBe(true);
  });
});

describe('预览帧源决策（正式 UI 无褐色演示块 / 验证版本保留定位块）', () => {
  it('正式模式有底图：原样返回，不调用 core 合成', () => {
    const adapter = makeAdapter();
    const base = new Uint8Array(4 * 4 * 4).fill(42);
    const result = resolvePreviewPixels(adapter, {}, base, makeRequest(), false);
    expect(result).toBe(base);
    expect(adapter.compositeFrameRgba).not.toHaveBeenCalled();
    expect(adapter.renderFrameRgba).not.toHaveBeenCalled();
  });

  it('正式模式无底图：返回纯黑空白帧（RGB=0、alpha=255），无橙色像素', () => {
    const adapter = makeAdapter();
    const result = resolvePreviewPixels(adapter, {}, null, makeRequest(), false);
    expect(result).toHaveLength(4 * 4 * 4);
    let hasAccent = false;
    for (let i = 0; i < result.length; i += 4) {
      expect([result[i], result[i + 1], result[i + 2]]).toEqual([0, 0, 0]);
      expect(result[i + 3]).toBe(255);
      // DEMO_PARAMS 的橙色 (249,115,22) 不应出现
      if (result[i] === 249 && result[i + 1] === 115 && result[i + 2] === 22) hasAccent = true;
    }
    expect(hasAccent).toBe(false);
    expect(adapter.renderFrameRgba).not.toHaveBeenCalled();
  });

  it('验证模式有底图：走 core 合成，传入 DEMO_PARAMS 定位块', () => {
    const adapter = makeAdapter();
    const base = new Uint8Array(4 * 4 * 4).fill(42);
    resolvePreviewPixels(adapter, {}, base, makeRequest(), true);
    expect(adapter.compositeFrameRgba).toHaveBeenCalledWith(
      base,
      expect.objectContaining({ width: 4, height: 4, frameIndex: 7, timeTicks: 7000, params: DEMO_PARAMS }),
    );
    expect(adapter.renderFrameRgba).not.toHaveBeenCalled();
  });

  it('验证模式无底图：走 core 渲染，传入 DEMO_PARAMS + profile', () => {
    const adapter = makeAdapter();
    const profile = { width: 4, height: 4 };
    resolvePreviewPixels(adapter, profile, null, makeRequest(), true);
    expect(adapter.renderFrameRgba).toHaveBeenCalledWith(
      expect.objectContaining({ frameIndex: 7, timeTicks: 7000, profile, params: DEMO_PARAMS }),
    );
    expect(adapter.compositeFrameRgba).not.toHaveBeenCalled();
  });

  it('边界：尺寸为 1×1 时正式模式仍返回合法 4 字节 RGBA', () => {
    const adapter = makeAdapter();
    const result = resolvePreviewPixels(adapter, {}, null, { frameIndex: 0, timeTicks: 0, durationTicks: 1, width: 1, height: 1 }, false);
    expect(Array.from(result)).toEqual([0, 0, 0, 255]);
  });

  it('异常：core 合成抛错时向上抛出，不吞异常', () => {
    const adapter = makeAdapter();
    adapter.compositeFrameRgba.mockImplementation(() => { throw new Error('core 合成故障'); });
    expect(() => resolvePreviewPixels(adapter, {}, new Uint8Array(4 * 4 * 4), makeRequest(), true))
      .toThrow('core 合成故障');
  });

  it('正式 UI 回退参数不含演示前景（opacity 为 0）', () => {
    expect(PRODUCTION_FRAME_PARAMS.opacity).toBe(0);
    expect(PRODUCTION_FRAME_PARAMS.accentRgba).toEqual([0, 0, 0, 255]);
  });
});
