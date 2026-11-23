//! OpenCut 本地 core 的插件 host 契约层（W-12 第一批）。
//!
//! 目标：先把「manifest 结构、能力清单、越权拒绝、示例插件注册 effect/command」闭环，
//! 再接真实 WASM 插件运行时（Extism / WIT 后置批次）。本 crate 不引入第三方插件框架，
//! 版本协商直接复用 W-11 冻结的 `ocx-editor-api::negotiate`。
//!
//! - I-01：所有端只经本 host 访问插件能力；
//! - I-03：跨边界字段 additive-only，旧 manifest 缺字段按 v1 兼容；
//! - 稳定错误码由 `PluginError::code()` 提供，供 WASM / TS / MCP 映射。

pub mod io_scope;
pub mod model;
pub mod permissions;
pub mod registry;
pub mod runtime;
pub mod wit;

pub use model::{
    DEFAULT_FUEL_LIMIT, MAX_FILE_KEY_LEN, MAX_FILE_SCOPE_LEN, MAX_INPUT_BYTES, MAX_NETWORK_BYTES,
    MAX_OUTPUT_BYTES, MAX_SCOPE_LEN, MAX_SCOPES_PER_CAPABILITY, NETWORK_TIMEOUT_SECS,
    PERMISSION_COMMAND, PERMISSION_EFFECT, PLUGIN_MANIFEST_VERSION, PLUGIN_PERMISSIONS,
    PluginError, PluginManifest, RegisterResult, Registration, SCOPE_CAPABILITY_FILE_READ,
    SCOPE_CAPABILITY_MEDIA_READ, SCOPE_CAPABILITY_NETWORK_FETCH,
};
pub use permissions::{granted_allows, scope_allows, validate_permission_scopes, validate_scope};
pub use registry::{Handler, PluginHost, check_manifest};
pub use runtime::{HostState, load_plugin, load_plugin_with_fuel, load_plugin_with_resources};
pub use wit::{DEFAULT_WIT, WitContract, default_contract, parse as parse_wit};
