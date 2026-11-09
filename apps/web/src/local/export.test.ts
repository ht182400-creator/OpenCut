import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPORT_BITRATE,
  EXPORT_CODEC,
  KEY_FRAME_INTERVAL,
  isExportSupported,
  validateExportOptions,
} from './export';

/** 导出模块的纯函数回归：不启动浏览器编码，覆盖正常、边界与异常分支。 */
describe('export 纯函数', () => {
  const valid = { width: 320, height: 180, fps: 30, frameCount: 90 };

  it('合法导出参数通过', () => {
    expect(validateExportOptions(valid)).toBeNull();
  });

  it('奇数宽高、零尺寸、非法帧率与帧数被拒绝', () => {
    expect(validateExportOptions({ ...valid, width: 321 })).toContain('正偶数');
    expect(validateExportOptions({ ...valid, width: 0 })).toContain('正偶数');
    expect(validateExportOptions({ ...valid, fps: 0 })).toContain('帧率');
    expect(validateExportOptions({ ...valid, fps: Number.NaN })).toContain('帧率');
    expect(validateExportOptions({ ...valid, frameCount: 0 })).toContain('帧数');
    expect(validateExportOptions({ ...valid, frameCount: 1.5 })).toContain('帧数');
  });

  it('常量固定，避免硬编码散落', () => {
    expect(EXPORT_CODEC).toBe('avc1.42001f');
    expect(KEY_FRAME_INTERVAL).toBe(30);
    expect(DEFAULT_EXPORT_BITRATE).toBe(2_000_000);
  });

  it('Node/无 WebCodecs 环境返回不可用', () => {
    expect(isExportSupported()).toBe(false);
  });
});
