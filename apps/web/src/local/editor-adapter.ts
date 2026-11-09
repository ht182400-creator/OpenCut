/**
 * OpenCut Web 端 `editor-api` 适配层（W-06）。
 *
 * 不变量 I-01：业务代码只能经本模块访问 Rust core，
 * 禁止在其它文件直接 import `./wasm/ocx_bindings_wasm.js`。
 * 上游官方 Editor API 落地后，只需替换本模块内部实现，调用方无需改动。
 */

/** WASM 静态资源路径（由 wasm-bindgen 生成后放入 public/wasm/）。 */
export const CORE_WASM_URL = '/wasm/ocx_bindings_wasm_bg.wasm';

/** core 支持的请求类型，与 Rust `domain_eval` 的分支一一对应。 */
export const SUPPORTED_KINDS = [
  'rippleAdjustments',
  'rippleApply',
  'placementResolve',
  'animationScalar',
  'editorExecute',
] as const;

export type CoreRequestKind = (typeof SUPPORTED_KINDS)[number];

/** 跨边界请求：版本化 JSON 信封，字段只增不改。 */
export interface CoreRequest {
  kind: CoreRequestKind;
  [field: string]: unknown;
}

/** 能力发现结果（对齐 MCP `server/discover`）。 */
export interface DiscoverResult {
  apiVersion: string;
  schemaVersion: string;
  backendId: string;
  capabilities: string[];
}

/** 每种请求的必填字段，用于在进入 WASM 前拦截明显错误。 */
const REQUIRED_FIELDS: Record<CoreRequestKind, readonly string[]> = {
  rippleAdjustments: ['before', 'after'],
  rippleApply: ['tracks', 'adjustments'],
  placementResolve: ['tracks', 'subject', 'timeSpans', 'strategy'],
  animationScalar: ['channel', 'time', 'fallbackValue'],
  editorExecute: ['command'],
};

/**
 * 校验请求的 kind 与必填字段；非法时抛出带中文提示的错误。
 * @param request 待校验的未知输入
 * @returns {void}
 */
export function validateRequest(request: unknown): asserts request is CoreRequest {
  if (!request || typeof request !== 'object') {
    throw new Error('请求必须是对象；请检查调用参数后重试。');
  }
  const candidate = request as Record<string, unknown>;
  const kind = candidate.kind;
  if (typeof kind !== 'string' || !SUPPORTED_KINDS.includes(kind as CoreRequestKind)) {
    throw new Error(
      `不支持的请求类型：${String(kind)}。可用类型：${SUPPORTED_KINDS.join('、')}。`,
    );
  }
  for (const field of REQUIRED_FIELDS[kind as CoreRequestKind]) {
    if (!(field in candidate)) {
      throw new Error(`请求类型 ${kind} 缺少必填字段 ${field}；请补齐后重试。`);
    }
  }
}

/**
 * 把 core 抛出的异常整理成用户可理解的中文提示。
 * @param error 未知异常
 * @returns {string} 友好错误文案
 */
export function formatCoreError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Rust core 调用失败：${detail}`;
}

type Glue = typeof import('./wasm/ocx_bindings_wasm.js');

/** 业务侧唯一可见的 core 接口。 */
export interface EditorAdapter {
  /** core 的 Editor API 版本。 */
  version(): string;
  /** 能力发现。 */
  discover(): DiscoverResult;
  /** 统一领域求值入口。 */
  evaluate<T = unknown>(request: CoreRequest): T;
}

let adapterPromise: Promise<EditorAdapter> | null = null;

/**
 * 创建并缓存适配层实例（同一页面只初始化一次 WASM）。
 * 初始化失败会清空缓存，允许下次调用重试。
 * @returns {Promise<EditorAdapter>} 适配层实例
 */
export async function createEditorAdapter(): Promise<EditorAdapter> {
  if (adapterPromise) {
    return adapterPromise;
  }
  adapterPromise = (async (): Promise<EditorAdapter> => {
    try {
      const glue: Glue = await import('./wasm/ocx_bindings_wasm.js');
      await glue.default({ module_or_path: CORE_WASM_URL });
      return {
        version: () => glue.api_version(),
        discover: () => JSON.parse(glue.discover()) as DiscoverResult,
        evaluate: <T = unknown>(request: CoreRequest): T => {
          validateRequest(request);
          return JSON.parse(glue.domain_eval(JSON.stringify(request))) as T;
        },
      };
    } catch (error) {
      adapterPromise = null;
      throw new Error(formatCoreError(error));
    }
  })();
  return adapterPromise;
}
