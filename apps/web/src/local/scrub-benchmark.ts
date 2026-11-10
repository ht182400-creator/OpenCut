/**
 * W-09 收尾：代理帧 scrub 的量化基准。
 *
 * 代理帧恒定 320×180，因此单帧预览合成耗时与源分辨率解耦；
 * 本模块用真实帧源连续取样，给出均值/峰值并与 60fps 阈值比较。
 */

/** 一次基准测量的结果。 */
export interface ScrubBenchmark {
  samples: number;
  avgMs: number;
  maxMs: number;
  thresholdMs: number;
  pass: boolean;
}

/**
 * 连续调用帧源并测量每次合成耗时。
 * @param frameSource 返回该帧 RGBA 像素的函数（预览/导出共用）
 * @param samples 采样次数
 * @param thresholdMs 单帧阈值（默认 16ms ≈ 60fps）
 * @returns {ScrubBenchmark} 均值、峰值与达标结论
 */
export function measureFrameCost(
  frameSource: (frameIndex: number) => Uint8Array,
  samples = 30,
  thresholdMs = 16,
): ScrubBenchmark {
  if (!Number.isFinite(samples) || samples <= 0) {
    throw new Error('采样次数必须是正数');
  }
  const costs: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    frameSource(index);
    costs.push(performance.now() - started);
  }
  const avgMs = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
  const maxMs = Math.max(...costs);
  return {
    samples,
    avgMs: Number(avgMs.toFixed(3)),
    maxMs: Number(maxMs.toFixed(3)),
    thresholdMs,
    pass: maxMs <= thresholdMs,
  };
}

/**
 * 把基准结果格式化为界面文案。
 * @param result 基准结果
 * @returns {string} 文案
 */
export function formatBenchmark(result: ScrubBenchmark): string {
  return `${result.samples} 帧 · 平均 ${result.avgMs}ms / 峰值 ${result.maxMs}ms · 阈值 ${result.thresholdMs}ms ${result.pass ? '达标' : '超标'}`;
}
