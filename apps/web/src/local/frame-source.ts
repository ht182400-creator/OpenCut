/**
 * 预览帧源策略（W-07 验证台 / 批 8 UI 收官）。
 *
 * core 的 `render_frame` / `composite_frame` 会在画面中央绘制程序化演示矩形（褐色块），
 * 该色块仅供 W-07 golden master 做像素定位。正式 UI 必须显示真实素材或纯色空白帧，
 * 因此把「验证模式判定 + 帧源决策」抽成纯函数，既便于单测，也避免演示色块污染正式界面。
 */
import type { EditorAdapter } from './editor-adapter'
import { DEMO_PARAMS, blankFrame } from './editor-ui'

/** 验证演示帧的 URL 查询参数名。 */
export const VERIFY_FRAME_QUERY = 'verifyDemoFrame'
/** 查询参数开启值（严格匹配，其余取值一律视为关闭）。 */
export const VERIFY_FRAME_ENABLED = '1'

/**
 * 正式 UI 的 core 回退参数：Opacity=0 让 core 不叠加任何前景。
 * 正常路径由 `frameSource` 直接提供像素，不会走到这里；保留仅为兼容导出接口的必填字段。
 */
export const PRODUCTION_FRAME_PARAMS = {
  backgroundRgba: [0, 0, 0, 255],
  accentRgba: [0, 0, 0, 255],
  opacity: 0,
  positionX: 0.5,
  positionY: 0.5,
}

/** 帧请求公共字段（预览与导出共用）。 */
export interface PreviewFrameRequest {
  /** 项目帧索引。 */
  frameIndex: number
  /** 时间刻度。 */
  timeTicks: number
  /** 每帧刻度数。 */
  durationTicks: number
  /** 帧宽。 */
  width: number
  /** 帧高。 */
  height: number
}

/**
 * 判定当前是否启用验证演示帧。
 *
 * 仅当 URL 查询串包含 `?verifyDemoFrame=1` 时开启；默认关闭，保证正式 UI 不出现演示色块。
 * 用 try-catch 兜住 SSR / 单测环境读取 `window` 的异常，失败时按关闭处理。
 *
 * @param search 可选的 URL 查询串；缺省时读取 `window.location.search`
 * @returns 是否启用验证演示帧
 */
export function isVerificationFrameMode(search?: string): boolean {
  try {
    const source = search ?? (typeof window === 'undefined' ? '' : window.location.search)
    return new URLSearchParams(source).get(VERIFY_FRAME_QUERY) === VERIFY_FRAME_ENABLED
  } catch {
    return false
  }
}

/**
 * 生成预览/导出帧像素：正式模式原样返回底图，验证模式交给 core 叠加演示定位块。
 *
 * - 正式模式：有底图像素（真实素材帧或空白帧）时原样返回；底图缺失时生成纯黑空白帧。
 * - 验证模式：有底图时调用 `compositeFrameRgba` 叠加演示块；无底图时调用
 *   `renderFrameRgba` 生成「深蓝底 + 演示块」，供 golden master 逐像素定位。
 *
 * 本函数不吞异常：core 调用出错由调用方（`editor.tsx` 的 useEffect/handler）统一提示。
 *
 * @param adapter core 适配器
 * @param profile 导出配置（验证模式且无底图时传给 `renderFrameRgba`）
 * @param basePixels 已解析的底图 RGBA8 像素；`null` 表示当前帧无可用素材
 * @param request 帧请求公共字段
 * @param verificationMode 是否启用验证演示帧
 * @returns RGBA8 帧像素
 */
export function resolvePreviewPixels(
  adapter: EditorAdapter,
  profile: unknown,
  basePixels: Uint8Array | null,
  request: PreviewFrameRequest,
  verificationMode: boolean,
): Uint8Array {
  const { frameIndex, timeTicks, durationTicks, width, height } = request
  if (!verificationMode) {
    // 正式 UI：底图即最终画面，不叠加任何程序化演示图层
    return basePixels ?? blankFrame(width, height)
  }
  if (basePixels) {
    // 验证模式 + 真实素材：把演示定位块按 opacity 叠加到解码帧上
    return adapter.compositeFrameRgba(basePixels, {
      width,
      height,
      frameIndex,
      timeTicks,
      durationTicks,
      params: DEMO_PARAMS,
    })
  }
  // 验证模式 + 无素材：core 生成确定性演示帧（深蓝底 + 中央矩形）
  return adapter.renderFrameRgba({
    frameIndex,
    timeTicks,
    durationTicks,
    profile,
    params: DEMO_PARAMS,
  })
}
