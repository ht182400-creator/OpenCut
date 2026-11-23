import { describe, expect, it } from 'vitest'

import {
  MP4_TO_OPUS_NOTICE,
  NO_WEBCODECS_MESSAGE,
  OPUS_TO_AAC_NOTICE,
  SILENT_AUDIO_NOTICE,
  resolveExportPlan,
  type ExportCapabilityInput,
} from './export-fallback'

/** 测试输入基线：MP4 + 请求音频 + 有音轨 + 两种编码都支持。 */
const BASE: ExportCapabilityInput = {
  webCodecsSupported: true,
  aacSupported: true,
  opusSupported: true,
  container: 'mp4',
  includeAudio: true,
  hasMediaAudio: true,
}

/**  Firefox 音频兼容回归：降级链 `avc+aac → vp9+opus → 仅视频 → 明确报错`。 */
describe('resolveExportPlan 导出能力降级', () => {
  it('能力齐备时按用户选择原样导出 MP4+AAC，无提示', () => {
    expect(resolveExportPlan(BASE)).toEqual({
      container: 'mp4', withAudio: true, notice: null, error: null,
    })
  })

  it('无 WebCodecs 时明确报错，不尝试导出', () => {
    expect(resolveExportPlan({ ...BASE, webCodecsSupported: false })).toEqual({
      container: 'mp4', withAudio: false, notice: null, error: NO_WEBCODECS_MESSAGE,
    })
  })

  it('Firefox 场景：MP4 不支持 AAC 但支持 Opus 时自动切 WebM 保留音轨', () => {
    expect(resolveExportPlan({ ...BASE, aacSupported: false })).toEqual({
      container: 'webm', withAudio: true, notice: MP4_TO_OPUS_NOTICE, error: null,
    })
  })

  it('MP4 两种音频编码都不可用：无声视频 + 明确提示，不静默', () => {
    expect(resolveExportPlan({ ...BASE, aacSupported: false, opusSupported: false })).toEqual({
      container: 'mp4', withAudio: false, notice: SILENT_AUDIO_NOTICE, error: null,
    })
  })

  it('WebM 容器 Opus 可用时原样导出，无提示', () => {
    expect(resolveExportPlan({ ...BASE, container: 'webm' })).toEqual({
      container: 'webm', withAudio: true, notice: null, error: null,
    })
    expect(resolveExportPlan({ ...BASE, container: 'webm-av1' })).toEqual({
      container: 'webm-av1', withAudio: true, notice: null, error: null,
    })
  })

  it('WebM 不支持 Opus 但支持 AAC 时自动切 MP4 保留音轨', () => {
    expect(resolveExportPlan({ ...BASE, container: 'webm', opusSupported: false })).toEqual({
      container: 'mp4', withAudio: true, notice: OPUS_TO_AAC_NOTICE, error: null,
    })
    expect(resolveExportPlan({ ...BASE, container: 'webm-av1', opusSupported: false })).toEqual({
      container: 'mp4', withAudio: true, notice: OPUS_TO_AAC_NOTICE, error: null,
    })
  })

  it('WebM 两种音频编码都不可用：原容器无声视频 + 明确提示', () => {
    expect(resolveExportPlan({
      ...BASE, container: 'webm', aacSupported: false, opusSupported: false,
    })).toEqual({
      container: 'webm', withAudio: false, notice: SILENT_AUDIO_NOTICE, error: null,
    })
  })

  it('用户关闭音频或素材无音轨：原容器无声且无提示', () => {
    expect(resolveExportPlan({ ...BASE, includeAudio: false })).toEqual({
      container: 'mp4', withAudio: false, notice: null, error: null,
    })
    expect(resolveExportPlan({ ...BASE, hasMediaAudio: false })).toEqual({
      container: 'mp4', withAudio: false, notice: null, error: null,
    })
  })

  it('无 WebCodecs 优先于其它输入（即使用户关闭音频也明确报错）', () => {
    expect(resolveExportPlan({
      ...BASE, webCodecsSupported: false, includeAudio: false, aacSupported: false,
    }).error).toBe(NO_WEBCODECS_MESSAGE)
  })
})
