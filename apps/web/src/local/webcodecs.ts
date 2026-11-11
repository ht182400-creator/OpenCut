/**
 * WebCodecs 能力探测（W-07 前置能力检查，不依赖 Rust core）。
 *
 * 目的：在导出前判断浏览器是否具备硬件编码能力，并给出可读的降级原因。
 * 本模块只做探测，不创建编码器、不封装容器：真实 MP4（H.264+AAC）与
 * WebM（VP9+Opus）导出由 `export.ts` 实现，两种容器共用同一帧源与音源。
 */

/** 默认探测配置：H.264 baseline、720p、30fps。 */
export const DEFAULT_ENCODER_CONFIG = {
  codec: 'avc1.42001f',
  width: 1280,
  height: 720,
  bitrate: 2_000_000,
  framerate: 30,
} as const;

/** 探测结果：字段只增不改，便于 UI 直接展示。 */
export interface WebCodecsSupport {
  available: boolean;
  videoEncoder: boolean;
  videoFrame: boolean;
  configSupported: boolean;
  codec: string;
  reason: string;
}

interface EncoderConfigResult {
  supported?: boolean;
}

interface EncoderConstructor {
  isConfigSupported(config: unknown): Promise<EncoderConfigResult>;
}

/**
 * 探测 WebCodecs 可用性；任何异常都会转成可用结果而非抛出。
 * @param config 编码配置，默认 H.264 720p
 * @returns {Promise<WebCodecsSupport>} 探测结果
 */
export async function probeWebCodecsSupport(
  config: { codec: string; width: number; height: number; bitrate: number; framerate: number } = DEFAULT_ENCODER_CONFIG,
): Promise<WebCodecsSupport> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const encoder = scope.VideoEncoder as EncoderConstructor | undefined;
  const hasVideoFrame = typeof scope.VideoFrame !== 'undefined';
  const base = {
    configSupported: false,
    codec: config.codec,
  };

  if (!encoder || !hasVideoFrame) {
    return {
      ...base,
      available: false,
      videoEncoder: typeof encoder !== 'undefined',
      videoFrame: hasVideoFrame,
      reason: '当前环境不提供 WebCodecs API（需要支持 WebCodecs 的浏览器）',
    };
  }

  try {
    const result = await encoder.isConfigSupported({
      codec: config.codec,
      width: config.width,
      height: config.height,
      bitrate: config.bitrate,
      framerate: config.framerate,
    });
    const supported = result.supported === true;
    return {
      ...base,
      available: supported,
      videoEncoder: true,
      videoFrame: true,
      configSupported: supported,
      reason: supported
        ? '编码配置受支持，可进入真实导出阶段'
        : '当前编码配置不被支持，需降级 codec 或分辨率',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      available: false,
      videoEncoder: true,
      videoFrame: true,
      reason: `能力探测失败：${detail}`,
    };
  }
}
