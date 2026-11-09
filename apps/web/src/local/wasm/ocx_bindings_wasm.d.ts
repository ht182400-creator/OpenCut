/* tslint:disable */
/* eslint-disable */

/**
 * core 的接口版本（供前端展示与能力协商）。
 */
export function api_version(): string;

/**
 * 通道类型探测（供前端在提交请求前校验 fallback 类型，避免无谓的 WASM 调用）。
 */
export function channel_kind(channel_json: string): string;

/**
 * 能力发现结果（对齐 MCP `server/discover` 思路）。
 */
export function discover(): string;

/**
 * 统一领域求值入口：前端只传 `kind` + 各字段，避免暴露多个内部函数。
 *
 * 支持的 kind：`rippleAdjustments` / `rippleApply` / `placementResolve` /
 * `animationScalar` / `editorExecute` / `validateExportProfile` / `buildFramePlan`。
 */
export function domain_eval(request_json: string): string;

/**
 * 参数值类型探测（number / boolean / string）。
 */
export function param_kind(value_json: string): string;

/**
 * 生成确定性预览帧的 RGBA8 像素（行优先，长度为 `width * height * 4`）。
 *
 * 请求字段：`frameIndex` / `timeTicks` / `durationTicks` / `profile` / `params`。
 * 预览与导出共用同一份像素，因此后续接入真实合成器时前端无需改动。
 */
export function render_frame_rgba(request_json: string): Uint8Array;

/**
 * core 的 schema 版本。
 */
export function schema_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly api_version: () => [number, number];
    readonly channel_kind: (a: number, b: number) => [number, number, number, number];
    readonly discover: () => [number, number, number, number];
    readonly domain_eval: (a: number, b: number) => [number, number, number, number];
    readonly param_kind: (a: number, b: number) => [number, number, number, number];
    readonly render_frame_rgba: (a: number, b: number) => [number, number, number, number];
    readonly schema_version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
