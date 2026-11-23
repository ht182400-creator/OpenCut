/**
 * 导出能力降级决策（W-08 第七批 / Firefox 音频兼容回归）。
 *
 * `PRIORITY.md` §4.5 定义降级链：`avc+aac → vp9+opus → 仅视频 → 明确报错`，
 * 且「禁止静默失败」。浏览器能力探测由调用方完成（本模块为纯函数，不碰 Web API），
 * 依据 `MDN WebCodecs Codec selection`：Firefox 全平台不支持 AAC 编码，Opus 广泛支持。
 * 因此 MP4+AAC 不可用时优先切换到 WebM+Opus 保留音轨，而不是静默导出无声视频。
 */

import type { ExportContainerChoice } from './export-settings';

/** 无 WebCodecs 时的阻断错误（与 `export.ts` 的文案一致）。 */
export const NO_WEBCODECS_MESSAGE = '当前浏览器不支持 WebCodecs 导出';
/** MP4 音频编码不可用但 Opus 可用时的降级提示。 */
export const MP4_TO_OPUS_NOTICE = '当前浏览器不支持 MP4 音频编码（AAC），已自动改用 WebM + Opus 保留音轨';
/** WebM/AV1 音频编码不可用但 AAC 可用时的降级提示。 */
export const OPUS_TO_AAC_NOTICE = '当前浏览器不支持 WebM 音频编码（Opus），已自动改用 MP4 + AAC 保留音轨';
/** 两种音频编码都不可用时的无声提示。 */
export const SILENT_AUDIO_NOTICE = '当前浏览器不支持音频编码（AAC/Opus），已导出无声视频';

/** 能力探测输入（由 `handleExport` 探测后传入）。 */
export interface ExportCapabilityInput {
  /** 是否支持 WebCodecs 视频编码（VideoEncoder + VideoFrame）。 */
  webCodecsSupported: boolean;
  /** 是否支持 AAC 编码（`mp4a.40.2`）。 */
  aacSupported: boolean;
  /** 是否支持 Opus 编码。 */
  opusSupported: boolean;
  /** 用户选择的容器。 */
  container: ExportContainerChoice;
  /** 用户是否勾选包含音频。 */
  includeAudio: boolean;
  /** 素材是否含音轨。 */
  hasMediaAudio: boolean;
}

/** 解析后的导出计划（供 `handleExport` 选择编码器与展示提示）。 */
export interface ExportPlan {
  /** 实际使用的容器（可能与用户选择不同，降级时已切换）。 */
  container: ExportContainerChoice;
  /** 是否生成音轨。 */
  withAudio: boolean;
  /** 用户可见的降级说明；`null` 表示按用户设置原样执行。 */
  notice: string | null;
  /** 阻断错误；非 `null` 时不得导出。 */
  error: string | null;
}

/**
 * 按能力探测结果决定实际导出方案。
 *
 * 决策顺序：
 * 1. 无 WebCodecs → 明确报错，不尝试导出；
 * 2. 用户未请求音频或素材无音轨 → 原容器、无声、无提示；
 * 3. 用户请求音频 → 优先原容器+NATIVE codec；不可用时尝试另一容器保留音轨；
 *    两者都不可用才降级为无声视频，并给出明确提示。
 *
 * @param input 能力探测结果与用户设置
 * @returns {ExportPlan} 导出计划
 */
export function resolveExportPlan(input: ExportCapabilityInput): ExportPlan {
  if (!input.webCodecsSupported) {
    return { container: input.container, withAudio: false, notice: null, error: NO_WEBCODECS_MESSAGE };
  }

  if (!input.includeAudio || !input.hasMediaAudio) {
    return { container: input.container, withAudio: false, notice: null, error: null };
  }

  if (input.container === 'mp4') {
    if (input.aacSupported) {
      return { container: 'mp4', withAudio: true, notice: null, error: null };
    }
    if (input.opusSupported) {
      return { container: 'webm', withAudio: true, notice: MP4_TO_OPUS_NOTICE, error: null };
    }
    return { container: 'mp4', withAudio: false, notice: SILENT_AUDIO_NOTICE, error: null };
  }

  // WebM / AV1 使用 Opus 音轨。
  if (input.opusSupported) {
    return { container: input.container, withAudio: true, notice: null, error: null };
  }
  if (input.aacSupported) {
    return { container: 'mp4', withAudio: true, notice: OPUS_TO_AAC_NOTICE, error: null };
  }
  return { container: input.container, withAudio: false, notice: SILENT_AUDIO_NOTICE, error: null };
}
