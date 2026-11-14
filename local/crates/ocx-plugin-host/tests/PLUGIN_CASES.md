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

## 诚实边界

本批**不加载真实 WASM 插件**：示例插件的处理器由 Rust 侧 `bind_handlers` 绑定到已注册项，host 能真实调用，但没有 Extism / WIT 运行时、没有插件沙箱、没有跨进程 ABI。manifest 只描述权限与注册项，插件代码本身不在仓库内。后续批次接 WIT 时，应保持本节的错误码与校验顺序不变。

## W-12 第二批：原生 WASM 插件运行时

- 插件实现：`local/crates/ocx-plugin-sample`（cdylib，`wasm32-unknown-unknown`，产物 116,313 字节，提交在 `apps/web/public/fixtures/sample-plugin.wasm`）。ABI：`ocx_alloc(len) → ptr`、`ocx_dealloc(ptr, len)`，以及 `effect_*` / `command_*` 导出函数 `(ptr, len) → i64`，返回值打包 `(ptr << 32) | len` 指向插件内分配的 JSON 输出。
- 宿主：`apps/web/src/local/plugin-runtime.ts`，用浏览器与 Node **原生**的 `WebAssembly` API 加载调用，宿主不传任何导入对象——插件无法触网、无法读写文件（P02/P12 的权限校验仍由第一批 `pluginRegister` 负责）。
- 错误映射（与 core 稳定错误码对齐）：未知 effect/command → `UNKNOWN_EFFECT` / `UNKNOWN_COMMAND`；插件返回 `{"error": ...}` → `HANDLER_FAILED`；缺 ABI 导出 → `INVALID_PLUGIN_ABI`。
- 回归：`plugin-runtime.test.ts` 6 项（vitest 115/115），用真实产物而非 mock；Rust 侧第一批 13 项不变。
- 诚实边界更新：跨进程沙箱由「零导入对象」提供，但声明式权限（文件/网络）、Rust 侧运行时（wasmi）与 WIT 组件模型仍后置。
