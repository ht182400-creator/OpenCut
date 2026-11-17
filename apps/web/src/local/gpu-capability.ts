/**
 * P2 GPU/编解码能力探测（纯 TS，无后端）：给诊断面板提供真实的能力提示，
 * 不伪造 GPU 型号，只报告 WebGL2/WebGPU/WebCodecs 硬件编码可用性。
 *
 * 每项探测独立 try-catch，任一失败返回 "unavailable" 与可读原因，不抛异常。
 */

/** 单个能力项的状态。 */
export interface CapabilityItem {
  available: boolean
  label: string
  detail: string
}

/** 汇总能力报告。 */
export interface GpuCapabilityReport {
  webgl2: CapabilityItem
  webgpu: CapabilityItem
  hardwareVideoEncoder: CapabilityItem
  summary: string
}

/** 探测配置常量（避免硬编码）。 */
export const GPU_PROBE_LABELS = {
  webgl2: 'WebGL2',
  webgpu: 'WebGPU',
  hardwareEncoder: '硬件视频编码',
} as const

/**
 * 探测 WebGL2 可用性（创建一个临时上下文后释放）。
 * @returns {CapabilityItem} 探测结果
 */
export function probeWebGL2(): CapabilityItem {
  try {
    const scope = globalThis as unknown as {
      document?: { createElement(tag: string): { getContext(kind: string): object | null } }
    }
    if (!scope.document) {
      return { available: false, label: GPU_PROBE_LABELS.webgl2, detail: '非浏览器环境' }
    }
    const context = scope.document.createElement('canvas').getContext('webgl2')
    return context
      ? { available: true, label: GPU_PROBE_LABELS.webgl2, detail: '可用于 GPU 加速渲染' }
      : { available: false, label: GPU_PROBE_LABELS.webgl2, detail: '浏览器未提供 WebGL2 上下文' }
  } catch (error) {
    return {
      available: false, label: GPU_PROBE_LABELS.webgl2,
      detail: `探测失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * 探测 WebGPU 适配器是否存在（不请求设备，轻量）。
 * @returns {CapabilityItem} 探测结果
 */
export function probeWebGPU(): CapabilityItem {
  try {
    const scope = globalThis as unknown as { navigator?: { gpu?: { requestAdapter(): Promise<unknown> } } }
    if (!scope.navigator?.gpu) {
      return { available: false, label: GPU_PROBE_LABELS.webgpu, detail: '浏览器未提供 WebGPU API' }
    }
    // 同步返回「API 存在」；真实适配器查询是异步且可能阻塞，诊断只需提示可能性。
    return { available: true, label: GPU_PROBE_LABELS.webgpu, detail: 'WebGPU API 可用（适配器需异步查询）' }
  } catch (error) {
    return {
      available: false, label: GPU_PROBE_LABELS.webgpu,
      detail: `探测失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * 根据 WebCodecs 探测结果推导硬件编码提示（不重复探测）。
 * @param configSupported WebCodecs isConfigSupported 结果
 * @param reason WebCodecs 探测原因文本
 * @returns {CapabilityItem} 探测结果
 */
export function probeHardwareEncoder(configSupported: boolean, reason: string): CapabilityItem {
  return {
    available: configSupported,
    label: GPU_PROBE_LABELS.hardwareEncoder,
    detail: configSupported
      ? `WebCodecs 编码配置受支持（${reason}）`
      : `编码可能走软件降级或不可用（${reason}）`,
  }
}

/**
 * 汇总生成 GPU 能力报告。
 * @param webgl2 WebGL2 项
 * @param webgpu WebGPU 项
 * @param encoder 硬件编码项
 * @returns {GpuCapabilityReport} 汇总报告
 */
export function summarizeCapability(
  webgl2: CapabilityItem,
  webgpu: CapabilityItem,
  encoder: CapabilityItem,
): GpuCapabilityReport {
  const enabled = [webgl2, webgpu, encoder].filter((item) => item.available).map((item) => item.label)
  return {
    webgl2, webgpu, hardwareVideoEncoder: encoder,
    summary: enabled.length > 0
      ? `可用能力：${enabled.join(' / ')}`
      : '未检测到可用加速能力，导出与预览将走软件路径',
  }
}
