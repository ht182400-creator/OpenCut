# W-12 第一批：插件 host 契约用例

执行：`cargo test -p ocx-plugin-host --test stability`（13 项）；WASM 侧 `apps/web/src/local/editor-wasm.contract.mjs` 用真实产物验证 `plugin_register`。

## 契约要点

- manifest 字段（camelCase，additive-only）：`name` / `version` / `apiVersion` / `schemaVersion` / `capabilities` / `effects` / `commands`。除 `name` 外均可缺省；缺版本字段按当前 v1 兼容，未知字段忽略。
- host 可授予权限 `PLUGIN_PERMISSIONS`：`command` / `undo-redo` / `snapshot` / `discover`（W-11 core 能力）+ `effect` / `media-read` / `export`（插件专有）。
- 版本校验复用 W-11 冻结的 `ocx-editor-api::negotiate`（`requiredCapabilities` 传空，只协商 API/schema 版本）。
- 校验顺序：结构 → 版本 → 权限白名单 → 越权 → 注册项所需能力。注册 `effects` 必须声明 `effect`，注册 `commands` 必须声明 `command`。

## 稳定错误码

| 错误码 | 触发 |
| --- | --- |
| `INVALID_MANIFEST` | 非法 JSON |
| `MISSING_NAME` | `name` 为空 |
| `EMPTY_REGISTRATION` | 未声明任何 effect/command |
| `API_VERSION_MISMATCH` | `apiVersion` 与 core 不符 |
| `SCHEMA_VERSION_MISMATCH` | 无共同 schema 版本 |
| `UNKNOWN_PERMISSION` | 声明了 `PLUGIN_PERMISSIONS` 之外的权限 |
| `PERMISSION_DENIED` | 声明了 host 未授予的权限（`denied` 列出越权项） |
| `CAPABILITY_NOT_GRANTED` | 注册项缺少必需能力声明 |
| `DUPLICATE_PLUGIN` | 同名插件重复注册 |
| `UNKNOWN_PLUGIN` | 给未注册插件绑定处理器 |
| `UNKNOWN_EFFECT` / `UNKNOWN_COMMAND` | 调用/绑定未注册项 |
| `HANDLER_FAILED` | 处理器返回 Err |

## 用例

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| P01 | 示例 manifest + 完整授予 | 注册成功，effects=`brightness`、commands=`ping` |
| P02 | 授予清单缺 `effect` | `PERMISSION_DENIED`，`denied=["effect"]` |
| P03 | 声明 `root-access` | `UNKNOWN_PERMISSION` |
| P04 | 有 effects 但未声明 `effect` 能力 | `CAPABILITY_NOT_GRANTED` |
| P05 | `apiVersion=9.9.9` / `schemaVersion=999` | 两种版本不匹配错误码 |
| P06 | 非法 JSON / 缺 name / 空注册 | 三种结构错误码 |
| P07 | 旧 manifest 无版本字段 | 按 v1 兼容成功 |
| P08 | 带未知字段 | 忽略并成功 |
| P09 | 同名注册两次 | `DUPLICATE_PLUGIN`，registry 仍 1 项 |
| P10 | 绑定真实处理器并调用 | `brightness(0.25)→0.5`、`ping(7)→pong:7` |
| P11 | 未注册插件/effect/command | 三种未注册错误码 |
| P12 | host 未授予 `effect` 时调用 | `PERMISSION_DENIED`（权限是 host 实例级） |
| P13 | 处理器返回 Err | `HANDLER_FAILED` |

## W-12 第三批：wasmi 运行时 + 细粒度权限

执行：`cargo test -p ocx-plugin-host --test runtime`（7 项）；示例 wasm 为 `apps/web/public/fixtures/sample-plugin.wasm`（116,313B，与浏览器侧同一产物）。

### 新增稳定错误码

| 错误码 | 触发 |
| --- | --- |
| `INVALID_WASM` | 模块无法解析/校验，或缺少 `memory`/`ocx_alloc`/`ocx_dealloc` 导出 |
| `DISALLOWED_IMPORT` | 模块声明了宿主未提供的导入（沙箱要求零导入） |
| `EXPORT_NOT_DECLARED` | 调用的导出名无 `effect_`/`command_` 前缀，或去前缀后的逻辑名未在 manifest 声明 |
| `FUEL_EXHAUSTED` | 单次调用 fuel 耗尽（死循环/算力 DoS 防护） |
| `INVALID_OUTPUT` | 输出指针为 0、长度为 0 或超过 `MAX_OUTPUT_BYTES` |
| `INPUT_TOO_LARGE` | 输入 JSON 超过 `MAX_INPUT_BYTES` |
| `MEMORY_OUT_OF_BOUNDS` | ptr+len 越出插件线性内存 |

### 细粒度权限（沙箱层）

1. **零宿主导入**：`Linker` 不注册任何 host 函数，模块含 import 即实例化失败；
2. **导出白名单**：调用前按导出名前缀推导所需权限（`effect_`/`command_`），去前缀后校验 manifest 逻辑名 + host 授予权限（不信任调用方传入的 is_effect 标记）；
3. **fuel 上限**：默认 10,000,000，每次调用重置，耗尽即中断；
4. **内存边界**：所有 ptr/len 访问前校验 `offset+len <= memory.len()`；
5. **输入输出上限**：各 1 MiB，防巨型 payload OOM。

### 运行用例

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| R01 | 真实 wasm 调 `effect_brightness(amount=0.25)` / `command_ping(value=7)` | `brightness=0.5` / `pong=7`（wasmi 真实执行） |
| R02 | 注册后 granted 为空再调用 | `PERMISSION_DENIED` |
| R03 | 调内部 ABI `ocx_alloc` | `EXPORT_NOT_DECLARED` |
| R04 | fuel 上限设为 1 后调用 | `FUEL_EXHAUSTED` |
| R05 | 非 wasm 字节 | `INVALID_WASM` |
| R06 | WAT 模块含 `host.log` 导入 | `DISALLOWED_IMPORT` |
| R07 | 输入 JSON > 1 MiB | `INPUT_TOO_LARGE` |

## 诚实边界

第一批只做契约与处理器绑定（不加载 wasm）；第三批补上 wasmi 真实运行时与细粒度权限，前后两批的错误码与校验顺序保持不变。**WIT 组件模型下一批**：当前 ABI 仍为手写 `(ptr,len)→i64`（与浏览器侧一致），未引入 WIT/component-model；WASM glue 与 TS 侧尚未暴露 wasmi 运行时入口（本批只交付 Rust core 能力，避免重复重编 wasm）。

## W-12 第二批：原生 WASM 插件运行时

- 插件实现：`local/crates/ocx-plugin-sample`（cdylib，`wasm32-unknown-unknown`，产物 116,313 字节，提交在 `apps/web/public/fixtures/sample-plugin.wasm`）。ABI：`ocx_alloc(len) → ptr`、`ocx_dealloc(ptr, len)`，以及 `effect_*` / `command_*` 导出函数 `(ptr, len) → i64`，返回值打包 `(ptr << 32) | len` 指向插件内分配的 JSON 输出。
- 宿主：`apps/web/src/local/plugin-runtime.ts`，用浏览器与 Node **原生**的 `WebAssembly` API 加载调用，宿主不传任何导入对象——插件无法触网、无法读写文件（P02/P12 的权限校验仍由第一批 `pluginRegister` 负责）。
- 错误映射（与 core 稳定错误码对齐）：未知 effect/command → `UNKNOWN_EFFECT` / `UNKNOWN_COMMAND`；插件返回 `{"error": ...}` → `HANDLER_FAILED`；缺 ABI 导出 → `INVALID_PLUGIN_ABI`。
- 回归：`plugin-runtime.test.ts` 6 项（vitest 115/115），用真实产物而非 mock；Rust 侧第一批 13 项不变。
- 诚实边界更新：跨进程沙箱由「零导入对象」提供，但声明式权限（文件/网络）、Rust 侧运行时（wasmi）与 WIT 组件模型仍后置。
