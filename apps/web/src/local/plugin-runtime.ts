/**
 * W-12 第二批：Web 平台原生 WASM 插件运行时。
 *
 * 不引入 Extism / WIT 第三方框架，直接使用浏览器与 Node 都原生支持的
 * `WebAssembly` API 加载并调用插件模块。ABI 约定见
 * `local/crates/ocx-plugin-sample/src/lib.rs`：
 * - `ocx_alloc(len) -> ptr` / `ocx_dealloc(ptr, len)` 管理输入缓冲；
 * - `effect_*` / `command_*` 导出函数 `(ptr, len) -> i64`，返回 `(ptr << 32) | len`。
 *
 * 插件只做纯计算且不导入宿主函数，宿主也不传任何导入对象——插件无法触网、
 * 无法读写文件，这是本批的沙箱边界（WIT/Extism 与更细粒度权限后置）。
 * manifest 的结构/版本/权限校验仍由 core 的 `pluginRegister`（W-12 第一批）完成。
 */

/** 已加载的插件实例：列出并调用插件声明的 effect / command。 */
export interface PluginInstance {
  effects: string[];
  commands: string[];
  runEffect(name: string, payload: unknown): Promise<unknown>;
  runCommand(name: string, payload: unknown): Promise<unknown>;
}

/** 校验插件二进制是非空 Uint8Array。 */
export function validatePluginBytes(bytes: unknown): asserts bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new Error('插件二进制必须是非空 Uint8Array；请检查后重试。');
  }
}

/** 插件导出表的最小形状。 */
interface PluginExports {
  memory: WebAssembly.Memory;
  ocx_alloc(len: number): number;
  ocx_dealloc(ptr: number, len: number): void;
  [name: string]: WebAssembly.ExportValue;
}

/** 从导出表收集 effect / command 名。 */
function collectHandlerNames(exports: PluginExports): {
  effects: string[];
  commands: string[];
} {
  const names = Object.keys(exports);
  const strip = (prefix: string) =>
    names
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .sort();
  return { effects: strip('effect_'), commands: strip('command_') };
}

/** 校验必需导出存在，缺失时给出稳定错误码风格的中文错误。 */
function requireAbiExports(exports: PluginExports): void {
  const missing = (['memory', 'ocx_alloc', 'ocx_dealloc'] as const).filter(
    (name) => exports[name] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`INVALID_PLUGIN_ABI：插件缺少导出 ${missing.join('、')}`);
  }
}

/**
 * 调用一个插件导出函数：写输入 → 调用 → 读输出 → 归还内存。
 * @param instance 插件实例
 * @param exportName 完整导出名（含 `effect_` / `command_` 前缀）
 * @param payload JSON 负载
 * @returns {unknown} 插件返回的 JSON
 */
function invokeHandler(
  instance: WebAssembly.Instance,
  exportName: string,
  payload: unknown,
): unknown {
  const exports = instance.exports as unknown as PluginExports;
  const handler = exports[exportName];
  if (typeof handler !== 'function') {
    throw new Error(`UNKNOWN_HANDLER：插件未导出 ${exportName}`);
  }
  const input = new TextEncoder().encode(JSON.stringify(payload ?? null));
  const inputPtr = exports.ocx_alloc(input.length);
  if (!inputPtr) {
    throw new Error('PLUGIN_ALLOC_FAILED：插件内存分配失败');
  }
  new Uint8Array(exports.memory.buffer, inputPtr, input.length).set(input);
  const packed = BigInt.asUintN(
    64,
    BigInt((handler as (ptr: number, len: number) => bigint)(inputPtr, input.length)),
  );
  exports.ocx_dealloc(inputPtr, input.length);
  const outputPtr = Number(packed >> 32n);
  const outputLen = Number(packed & 0xffffffffn);
  if (!outputPtr || !outputLen) {
    throw new Error(`PLUGIN_RETURN_EMPTY：${exportName} 未返回结果`);
  }
  const output = new Uint8Array(exports.memory.buffer).slice(outputPtr, outputPtr + outputLen);
  exports.ocx_dealloc(outputPtr, outputLen);
  const decoded = JSON.parse(new TextDecoder().decode(output)) as { error?: string };
  if (typeof decoded.error === 'string') {
    throw new Error(`HANDLER_FAILED：${decoded.error}`);
  }
  return decoded;
}

/**
 * 把插件 WASM 字节加载为可调用的实例。
 * @param bytes 插件二进制（wasm32-unknown-unknown 的 cdylib）
 * @returns {Promise<PluginInstance>} 插件实例
 */
export async function loadPluginModule(bytes: Uint8Array): Promise<PluginInstance> {
  validatePluginBytes(bytes);
  // 拷贝为精确长度的 ArrayBuffer：既避免子视图把整段 buffer 传给编译器，
  // 也让 TS 匹配到返回 InstantiatedSource 的 instantiate 重载。
  const copy = new Uint8Array(bytes).buffer;
  const { instance } = await WebAssembly.instantiate(copy, {});
  const exports = instance.exports as unknown as PluginExports;
  requireAbiExports(exports);
  const { effects, commands } = collectHandlerNames(exports);
  return {
    effects,
    commands,
    runEffect: async (name: string, payload: unknown): Promise<unknown> => {
      if (!effects.includes(name)) {
        throw new Error(`UNKNOWN_EFFECT：插件未声明 effect ${name}`);
      }
      return invokeHandler(instance, `effect_${name}`, payload);
    },
    runCommand: async (name: string, payload: unknown): Promise<unknown> => {
      if (!commands.includes(name)) {
        throw new Error(`UNKNOWN_COMMAND：插件未声明 command ${name}`);
      }
      return invokeHandler(instance, `command_${name}`, payload);
    },
  };
}
