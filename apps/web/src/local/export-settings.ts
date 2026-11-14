/**
 * 经典版 UI 同步第三批：导出设置的纯计算层。
 *
 * 容器决定使用哪个导出实现与文件名；音轨开关与码率覆盖 core 的导出 profile。
 * 分辨率固定为预览/代理基准 320×180（帧源由 core 按该尺寸合成，改分辨率需要同步改帧源，
 * 留待后续批次），因此设置面板只显示当前分辨率、不提供可改项。
 */

export type ExportContainerChoice = 'mp4' | 'webm' | 'webm-av1';

export interface ExportSettings {
  container: ExportContainerChoice;
  includeAudio: boolean;
  bitrateBps: number;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  container: 'mp4',
  includeAudio: true,
  bitrateBps: 1_000_000,
};

export const CONTAINER_LABELS: Record<ExportContainerChoice, string> = {
  mp4: 'MP4（H.264 + AAC）',
  webm: 'WebM（VP9 + Opus）',
  'webm-av1': 'WebM（AV1 + Opus）',
};

/**
 * 把设置合并进 core 的导出 profile（不修改原对象，additive-only）。
 * @param base 会话基线 profile
 * @param settings 用户在面板选择的设置
 * @returns {Record<string, unknown>} 新 profile
 */
export function buildExportProfile(
  base: Record<string, unknown>,
  settings: ExportSettings,
): Record<string, unknown> {
  return {
    ...base,
    includeAudio: settings.includeAudio,
    videoBitrateBps: Math.max(1, Math.round(settings.bitrateBps)),
  };
}

/** 按容器返回下载文件名。 */
export function exportFilename(settings: ExportSettings): string {
  if (settings.container === 'mp4') return 'opencut-export.mp4';
  if (settings.container === 'webm-av1') return 'opencut-export-av1.webm';
  return 'opencut-export.webm';
}

/** 下载链接上显示的容器短名。 */
export function containerShortName(settings: ExportSettings): string {
  if (settings.container === 'mp4') return 'MP4';
  return settings.container === 'webm-av1' ? 'AV1 WebM' : 'WebM';
}
