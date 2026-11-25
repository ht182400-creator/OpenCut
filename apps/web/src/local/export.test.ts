/**
 * export.ts 纯逻辑测试（ISTQB 组件测试级别）。
 * 覆盖：编码常量契约、isExportAborted、exportProgressPercent 边界、
 * validateExportOptions 合规/非法分支、profileBitrate、isExportSupported/isOpusEncodingSupported。
 * 实际编码（WebCodecs/MP4 muxer）由 E2E/MCP 契约覆盖，这里不执行重型编码。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AV1_VIDEO_CODEC,
  DEFAULT_EXPORT_BITRATE,
  EXPORT_ABORTED_MESSAGE,
  EXPORT_CODEC,
  KEY_FRAME_INTERVAL,
  WEBM_AUDIO_BITRATE,
  WEBM_AUDIO_CODEC,
  WEBM_VIDEO_CODEC,
  YIELD_EVERY_FRAMES,
  exportProgressPercent,
  isExportAborted,
  isExportSupported,
  isOpusEncodingSupported,
  profileBitrate,
  validateExportOptions,
} from './export'

/** 每个用例后恢复全局 stub。 */
afterEach(() => vi.unstubAllGlobals())

describe('export.ts 常量契约', () => {
  it('编码/码率/关键帧间隔为固定契约值', () => {
    expect(EXPORT_CODEC).toBe('avc1.42001f')
    expect(KEY_FRAME_INTERVAL).toBe(30)
    expect(YIELD_EVERY_FRAMES).toBe(8)
    expect(DEFAULT_EXPORT_BITRATE).toBe(2_000_000)
    expect(WEBM_VIDEO_CODEC).toBe('vp09.00.10.08')
    expect(WEBM_AUDIO_CODEC).toBe('opus')
    expect(WEBM_AUDIO_BITRATE).toBe(96_000)
    expect(AV1_VIDEO_CODEC).toBe('av01.0.04M.08')
    expect(EXPORT_ABORTED_MESSAGE).toBe('导出已取消')
  })
})

describe('export.ts 进度与取消判定', () => {
  it('isExportAborted：消息等于「导出已取消」为真，其它为假', () => {
    expect(isExportAborted(new Error(EXPORT_ABORTED_MESSAGE))).toBe(true)
    expect(isExportAborted(new Error('other'))).toBe(false)
    expect(isExportAborted(null)).toBe(false)
    expect(isExportAborted(EXPORT_ABORTED_MESSAGE)).toBe(false)
  })

  it('exportProgressPercent：0/总数/越界/NaN 边界', () => {
    expect(exportProgressPercent(0, 100)).toBe(0)
    expect(exportProgressPercent(50, 100)).toBe(50)
    expect(exportProgressPercent(100, 100)).toBe(100)
    expect(exportProgressPercent(150, 100)).toBeLessThanOrEqual(100)
    expect(exportProgressPercent(5, 0)).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(exportProgressPercent(Number.NaN, 100))).toBe(true)
  })
})

describe('export.ts 选项校验与编码能力', () => {
  it('validateExportOptions：合法宽高/帧率/帧数返回 null', () => {
    expect(validateExportOptions({ width: 1920, height: 1080, fps: 30, frameCount: 100 })).toBeNull()
  })

  it('validateExportOptions：奇数宽高/非法帧率/非法帧数返回中文错误', () => {
    expect(validateExportOptions({ width: 101, height: 100, fps: 30, frameCount: 10 })).toContain('正偶数')
    expect(validateExportOptions({ width: 100, height: 100, fps: 0, frameCount: 10 })).toContain('帧率')
    expect(validateExportOptions({ width: 100, height: 100, fps: 30, frameCount: 0 })).toContain('帧数')
  })

  it('profileBitrate：videoBitrateBps 合法数字、非法返回 null', () => {
    expect(profileBitrate({ videoBitrateBps: 5_000_000 })).toBe(5_000_000)
    expect(profileBitrate({ videoBitrateBps: -1 })).toBeNull()
    expect(profileBitrate({ bitrate: 5_000_000 })).toBeNull()
    expect(profileBitrate(null)).toBeNull()
  })

  it('isExportSupported：VideoEncoder/VideoFrame 同时存在才 true', () => {
    vi.stubGlobal('VideoEncoder', undefined)
    vi.stubGlobal('VideoFrame', undefined)
    expect(isExportSupported()).toBe(false)
    vi.stubGlobal('VideoEncoder', class {})
    vi.stubGlobal('VideoFrame', class {})
    expect(isExportSupported()).toBe(true)
  })

  it('isOpusEncodingSupported：AudioEncoder + AudioData 都支持时返回 true', async () => {
    vi.stubGlobal('AudioEncoder', {
      isConfigSupported: vi.fn(async () => ({ supported: true })),
    })
    vi.stubGlobal('AudioData', class {})
    await expect(isOpusEncodingSupported()).resolves.toBe(true)
  })

  it('isOpusEncodingSupported：AudioEncoder 缺失时 false', async () => {
    vi.stubGlobal('AudioEncoder', undefined)
    await expect(isOpusEncodingSupported()).resolves.toBe(false)
  })
})
