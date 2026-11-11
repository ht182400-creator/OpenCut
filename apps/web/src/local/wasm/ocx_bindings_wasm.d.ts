/* tslint:disable */
/* eslint-disable */

/**
 * W-11：与客户端协商 API/schema 版本与必需能力。
 * 返回 `NegotiationResult` 的 JSON（camelCase），非法请求抛中文错误。
 */
export function api_negotiate(request_json: string): string;

/**
 * core 的接口版本（供前端展示与能力协商）。
 */
export function api_version(): string;

/**
 * 通道类型探测（供前端在提交请求前校验 fallback 类型，避免无谓的 WASM 调用）。
 */
export function channel_kind(channel_json: string): string;

/**
 * 把浏览器解码的底图 RGBA 与 core 程序化图层合成，返回最终帧像素（W-08）。
 *
 * `base_pixels` 直接以 `Uint8Array` 传入，避免 base64 膨胀；请求字段：
 * `width` / `height` / `frameIndex` / `timeTicks` / `durationTicks` / `params`。
 */
export function composite_frame_rgba(base_pixels: Uint8Array | number[], request_json: string): Uint8Array;

/**
 * 能力发现结果（对齐 MCP `server/discover` 思路）。
 */
export function discover(): string;

/**
 * 统一领域求值入口：前端只传 `kind` + 各字段，避免暴露多个内部函数。
 *
 * 支持的 kind：`rippleAdjustments` / `rippleApply` / `placementResolve` /
 * `animationScalar` / `editorExecute` / `validateExportProfile` / `buildFramePlan` /
 * `keyframeQuery`。
 */
export function domain_eval(request_json: string): string;

/**
 * 导出内部 `EditTimeline` 为 OTIO JSON 文本（W-10）。
 * 返回 `{"ok":true,"otio":"<JSON 文本>"}` 或 `{"ok":false,"error":"CODE"}`。
 */
export function otio_export(timeline_json: string): string;

/**
 * 导入 OTIO JSON 为内部 `EditTimeline`（W-10）。
 * 返回 `{"ok":true,"timeline":{...}}` 或 `{"ok":false,"error":"CODE"}`。
 */
export function otio_import(otio_json: string): string;

/**
 * 参数值类型探测（number / boolean / string）。
 */
export function param_kind(value_json: string): string;

/**
 * 读取经典版项目 JSON（原始文本），返回只读归一化视图或稳定错误码。
 *
 * 不修改输入、不写回；高于 v31 明确拒绝。字段缺失时补默认值并附 `warnings`。
 */
export function read_classic_project(project_json: string): string;

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

/**
 * 写回经典版项目 JSON（W-05 第五批）：按 id 合并视图、保留未知字段。
 */
export function write_classic_project(request_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly api_negotiate: (a: number, b: number) => [number, number, number, number];
    readonly api_version: () => [number, number];
    readonly channel_kind: (a: number, b: number) => [number, number, number, number];
    readonly composite_frame_rgba: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly discover: () => [number, number, number, number];
    readonly domain_eval: (a: number, b: number) => [number, number, number, number];
    readonly otio_export: (a: number, b: number) => [number, number, number, number];
    readonly otio_import: (a: number, b: number) => [number, number, number, number];
    readonly param_kind: (a: number, b: number) => [number, number, number, number];
    readonly read_classic_project: (a: number, b: number) => [number, number, number, number];
    readonly render_frame_rgba: (a: number, b: number) => [number, number, number, number];
    readonly schema_version: () => [number, number];
    readonly write_classic_project: (a: number, b: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
