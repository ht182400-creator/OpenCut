import { describe, expect, it } from 'vitest';

import {
  AV1_VIDEO_CODEC,
  DEFAULT_EXPORT_BITRATE,
  EXPORT_CODEC,
  KEY_FRAME_INTERVAL,
  WEBM_AUDIO_BITRATE,
  WEBM_AUDIO_CODEC,
  WEBM_VIDEO_CODEC,
  exportProjectToAv1WebM,
  exportProjectToMp4,
  exportProjectToWebM,
  profileBitrate,
  isExportSupported,
  isOpusEncodingSupported,
  validateExportOptions,
} from './export';

/** 导出模块的纯函数回归：不启动浏览器编码，覆盖正常、边界与异常分支。 */
describe('export 纯函数', () => {
  const valid = { width: 320, height: 180, fps: 30, frameCount: 90 };
  const options = { ...valid, ticksPerFrame: 4000, profile: {}, params: {} };

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

  it('WebM 容器 codec 常量固定', () => {
    expect(WEBM_VIDEO_CODEC).toBe('vp09.00.10.08');
    expect(WEBM_AUDIO_CODEC).toBe('opus');
    expect(WEBM_AUDIO_BITRATE).toBe(96_000);
  });

  it('Node/无 WebCodecs 环境返回不可用', () => {
    expect(isExportSupported()).toBe(false);
  });

  it('无 AudioEncoder 时 Opus 能力探测返回 false', async () => {
    expect(await isOpusEncodingSupported()).toBe(false);
  });

  it('AV1 容器 codec 常量固定', () => {
    expect(AV1_VIDEO_CODEC).toBe('av01.0.04M.08');
  });

  it('导出设置的码率可覆盖且非法值回退', () => {
    expect(profileBitrate({ videoBitrateBps: 2_500_000 })).toBe(2_500_000);
    expect(profileBitrate({ videoBitrateBps: 1234.6 })).toBe(1235);
    expect(profileBitrate({ videoBitrateBps: -1 })).toBeNull();
    expect(profileBitrate(null)).toBeNull();
    expect(profileBitrate({})).toBeNull();
  });

  it('三种容器在无 WebCodecs 环境都给出中文降级提示', async () => {
    await expect(exportProjectToMp4(options)).rejects.toThrow(/不支持 WebCodecs 导出/);
    await expect(exportProjectToWebM(options)).rejects.toThrow(/不支持 WebCodecs 导出/);
    await expect(exportProjectToAv1WebM(options)).rejects.toThrow(/不支持 WebCodecs 导出/);
  });
});
