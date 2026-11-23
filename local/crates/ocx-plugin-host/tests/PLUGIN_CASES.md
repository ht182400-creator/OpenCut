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

## W-12 core 扩展：`ocx.resource_read` 受控资源读取

执行：`cargo test -p ocx-plugin-host --test resource_read`（3 项，测试期用 `wat` 生成最小 core wasm 插件）。

### 能力 ABI

- `ocx.resource_len(key_ptr, key_len) -> i64`：查授予资源字节数（既有），不存在返回 -1。
- `ocx.resource_read(key_ptr, key_len, out_ptr, out_cap) -> i64`：**新增**，按 `media-read` scope 校验后把资源内容写入插件线性内存，返回写入字节数；不存在返回 -1；目标缓冲不足/超大资源返回稳定 trap。
- 两者共用 `SCOPE_DENIED_MARKER` → `PluginError::ScopeDenied(resource)`（deny-by-default，未授予 scope 的 key 直接拒绝）。

### 运行用例

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| RR01 | 授予 `clip:intro` + 资源表含该 key（内容为 JSON） | `resource_read` 成功，插件输出即资源内容 JSON |
| RR02 | 仅授予 `asset:*`，请求 `clip:intro` | `SCOPE_DENIED`，错误文本含 `clip:intro` |
| RR03 | 授予 `clip:intro` 但资源表为空 | 返回 -1 → 输出长度 0 → `INVALID_OUTPUT`（区分「无权」与「无此资源」） |

## 诚实边界

第一批只做契约与处理器绑定（不加载 wasm）；第三批补上 wasmi 真实运行时与细粒度权限，前后两批的错误码与校验顺序保持不变。**WIT 组件模型下一批**：当前 ABI 仍为手写 `(ptr,len)→i64`（与浏览器侧一致），未引入 WIT/component-model；WASM glue 与 TS 侧尚未暴露 wasmi 运行时入口（本批只交付 Rust core 能力，避免重复重编 wasm）。

## W-12 第二批：原生 WASM 插件运行时

- 插件实现：`local/crates/ocx-plugin-sample`（cdylib，`wasm32-unknown-unknown`，产物 116,313 字节，提交在 `apps/web/public/fixtures/sample-plugin.wasm`）。ABI：`ocx_alloc(len) → ptr`、`ocx_dealloc(ptr, len)`，以及 `effect_*` / `command_*` 导出函数 `(ptr, len) → i64`，返回值打包 `(ptr << 32) | len` 指向插件内分配的 JSON 输出。
- 宿主：`apps/web/src/local/plugin-runtime.ts`，用浏览器与 Node **原生**的 `WebAssembly` API 加载调用，宿主不传任何导入对象——插件无法触网、无法读写文件（P02/P12 的权限校验仍由第一批 `pluginRegister` 负责）。
- 错误映射（与 core 稳定错误码对齐）：未知 effect/command → `UNKNOWN_EFFECT` / `UNKNOWN_COMMAND`；插件返回 `{"error": ...}` → `HANDLER_FAILED`；缺 ABI 导出 → `INVALID_PLUGIN_ABI`。
- 回归：`plugin-runtime.test.ts` 6 项（vitest 115/115），用真实产物而非 mock；Rust 侧第一批 13 项不变。
- 诚实边界更新：跨进程沙箱由「零导入对象」提供，但声明式权限（文件/网络）、Rust 侧运行时（wasmi）与 WIT 组件模型仍后置。

## W-12 第四批：WIT 契约层（IDL 单一事实来源）

执行：`cargo test -p ocx-plugin-host`（单元 6 项 + runtime 8 项 + stability 13 项全绿），`cargo clippy -p ocx-plugin-host --all-targets -- -D warnings` 零告警。

### 调研结论（官方一手资料，不凭感觉）

- wasmi 官方仓库 `wasmi-labs/wasmi` 的 README 特性表：WASI 仅写 `wasip1`（经 `wasmi_wasi` crate），**未列 component model / WASI Preview 2 / WASI 0.2**；
- 组件模型 issue `wasmi-labs/wasmi#897`「Implement the Wasm component-model proposal」仍开放；
- 第三方 `wcmp-wasm-core-wasmi` 以「Component Model Polyfill 的 wasmi 后端」形态存在，反证 wasmi 核心不原生运行组件。

**判定**：wasmi 2.0 原生只执行 core WebAssembly module。本批把 WIT 作为**接口契约（IDL）单一事实来源**，不引入 wasm-tools / wit-bindgen / cargo-component（本机均未安装，目标仅 `wasm32-unknown-unknown`），**不谎称完整组件运行时**；完整 component model 后置。

### 交付与契约

| 项 | 内容 |
| --- | --- |
| `wit/ocx-plugin.wit` | 内嵌契约：`package opencut:plugin@1.0.0`、`interface effects { brightness }`、`interface commands { ping }`、`world plugin { export effects; export commands; }`，按官方 WIT 语法（kebab-case、`///` 文档注释）书写 |
| `src/wit.rs` | 零第三方依赖的轻量解析器：`strip_comments`（`//` / `/* */`）、`normalize_braces`（支持官方合法的单行块）、kebab-case 标识符校验、导出名映射 `get-info → effect_get_info` |
| `runtime.rs` | `LoadedPlugin` 内嵌 `WitContract`；`authorize()` 在「manifest 白名单 + 权限」之外增加**第二层 WIT 契约白名单**，导出名必须能在内嵌 `.wit` 的 effects/commands 接口找到 |
| 错误码 | 新增 `INVALID_WIT`（契约无法解析）与 `WIT_EXPORT_NOT_DECLARED`（导出名不在契约）两个稳定码，additive-only 追加 |

### 新增稳定错误码

| 错误码 | 触发 |
| --- | --- |
| `INVALID_WIT` | 内嵌契约结构/标识符非法（缺 package、world export 空、world export 未知接口、标识符非 kebab-case） |
| `WIT_EXPORT_NOT_DECLARED` | manifest 已声明且权限已授予，但导出名不在 host 内嵌 WIT 契约的 effects/commands 接口 |

### 用例

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| W01 | 解析内嵌 `.wit` 契约 | `package=opencut:plugin@1.0.0`、`effects=[brightness]`、`commands=[ping]` |
| W02 | 含 `//` 与 `/* */` 注释、单行 world 块 `world p { export effects; }` 的契约 | 注释被忽略、单行块可解析，仍得 `effects=[brightness]` |
| W03 | 缺 package / world export 空 / export 未知接口 / 接口空 | 四种结构均 `INVALID_WIT` |
| W04 | 标识符 `bad_name` / `bad--name` / `-name` / `name-` / `1name` | kebab-case 校验拒绝 `INVALID_WIT` |
| W05 | `to_export_name(effect_, brightness)` / `(command_, get-info)` | `effect_brightness` / `command_get_info` |
| W06 | 白名单查询 `has_effect(brightness)` / `has_effect(brightness-extra)` / `has_command(ping)` / `has_command(brightness)` | `true / false / true / false`（精确匹配） |
| W07 | WAT 模块真实导出 `effect_mystery`，Registration 声明 `mystery`、授予 `effect` | 加载成功，但调用被 `WIT_EXPORT_NOT_DECLARED` 拦截（证明 WIT 是独立于 manifest 的第二道闸） |

### 诚实边界

WIT 契约层是 **IDL + 双重导出白名单**，与现有 core wasm ABI（`ocx_alloc` / `(ptr,len)→i64`）完全兼容，浏览器侧 `plugin-runtime.ts` 与 wasmi 侧共用同一份契约语义。**未实现** WebAssembly component model 组件编解码、canonical ABI、wit-bindgen 生成绑定、WASI Preview 2/3（wasmi 不支持）；WASM glue / TS 未新增 wasmi 或 WIT 入口（本批只交付 Rust core 契约能力，避免重复重编 wasm）。

## W-12 第五批：声明式权限（resource scope）

执行：`cargo test -p ocx-plugin-host`（permissions 单元 4 + wit 单元 6 + declarative 6 + runtime 8 + stability 13 全绿），`cargo clippy -p ocx-plugin-host --all-targets -- -D warnings` 零告警。

### 调研结论（官方/社区资料）

capability-based security 共识：deny-by-default（manifest 显式声明能力）、host 仅注入授予的能力函数、函数内再次按 scope 校验具体资源；宿主不暴露原始文件句柄/套接字。据此本批不引入通用 WASI 文件/网络能力，只做资源级 scope + 一个受控能力函数示例。

### 交付与契约

| 项 | 内容 |
| --- | --- |
| `PluginManifest.permissionScopes` | additive-only：`BTreeMap<能力名, Vec<scope>>`，缺省空 → deny-by-default；缺省/未知字段兼容旧 JSON |
| `Registration.permissionScopes` | 透传已授予 scope |
| 资源型能力 | 当前仅 `media-read` 支持 scope；`effect`/`command` 是工作类型非资源，声明 scope 报 `UNKNOWN_SCOPE_CAPABILITY` |
| scope 语法 | `namespace:resource`，`namespace:*` 整段通配；不允许部分通配、空命名空间/资源、超长（256B）、超量（每项 64 条） |
| `load_plugin_with_resources` | 仅按授予 scope 注入受控能力函数 `ocx.resource_len(ptr,len)->i64`；未授予任何 scope 时保持零导入；旧 `load_plugin` 完全不变 |
| 能力函数 | 读插件内存中的资源 key → 按 scope 校验 → 返回 host 资源字节数；越权返回 `Result::Err(trap)`，映射 `SCOPE_DENIED`；资源不存在返回 -1 |

### 新增稳定错误码

| 错误码 | 触发 |
| --- | --- |
| `UNKNOWN_SCOPE_CAPABILITY` | permissionScopes 的能力未在 capabilities 声明，或不是资源型能力 |
| `INVALID_SCOPE` | scope 为空/超长/缺命名空间/空资源/部分通配，或单能力 scope 超量 |
| `SCOPE_DENIED` | 插件请求的资源 key 不在授予 scope 内（能力函数 trap） |

### 用例（`tests/declarative_permissions.rs`）

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| D01 | scope=`clip:intro`，插件请求 `clip:intro` | 能力函数放行，effect 返回合法 JSON |
| D02 | scope=`clip:intro`，请求 `secret:key` | `SCOPE_DENIED`（错误信息含资源名） |
| D03 | scope=`clip:*`，请求 `clip:any-name` | 通配命中放行 |
| D04 | 零导入模式加载含能力导入的模块 | `DISALLOWED_IMPORT`（不注入能力函数） |
| D05 | scope 声明 `export` 能力 / scope 格式 `no-separator` | `UNKNOWN_SCOPE_CAPABILITY` / `INVALID_SCOPE` |
| D06 | 旧 manifest 无 permissionScopes | 注册成功且 scope 映射为空（deny-by-default） |

### 诚实边界

本批是 **Rust core 侧的 capability 权限原型**：只验证"显式声明 → 按授予注入 → 函数内按 scope 校验"闭环，受控函数仅返回资源字节数（host 资源表由调用方注入），不提供真实文件/网络访问。未实现通用 WASI P1/P2 能力、文件系统/网络 scope、跨调用资源句柄；WASM glue / TS 未新增入口（避免重复重编 wasm）。能力函数用 wasmi `func_wrap` + `Result::Err` trap，未引入 Extism / Wasmtime / 第三方权限框架。
