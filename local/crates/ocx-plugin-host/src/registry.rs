//! 插件注册器：校验 manifest、拒绝越权、保存注册项并分派处理器（W-12 第一批）。
//!
//! 暂不加载真实 WASM 插件：示例插件由 Rust 侧把处理器绑定到已注册的 effect/command，
//! host 通过 `run_effect` / `run_command` 真实调用，便于先把权限与契约闭环验证清楚。

use std::collections::HashMap;

use ocx_editor_api::{
    API_VERSION, CapabilitiesRequest, NEGOTIATE_API_MISMATCH, SCHEMA_VERSION, negotiate,
};
use serde_json::Value;

use crate::model::{
    PERMISSION_COMMAND, PERMISSION_EFFECT, PLUGIN_PERMISSIONS, PluginError, PluginManifest,
    RegisterResult, Registration,
};

/// 插件处理器：输入 JSON、输出 JSON，失败给一段中文原因。
pub type Handler = Box<dyn Fn(&Value) -> Result<Value, String> + Send + Sync>;

/**
 * 校验一份插件 manifest 与 host 授予的权限（纯函数，跨语言入口共用）。
 * 校验顺序：结构 → 版本协商（复用 W-11）→ 权限白名单 → 越权 → 注册项所需能力。
 * @param granted host 实际授予的权限
 * @param manifest_json 插件清单 JSON
 * @returns {RegisterResult} 成功带 registration，失败带稳定错误码与越权清单
 */
pub fn check_manifest(granted: &[&str], manifest_json: &str) -> RegisterResult {
    let manifest: PluginManifest = match serde_json::from_str(manifest_json) {
        Ok(value) => value,
        Err(_) => return RegisterResult::failure(&PluginError::InvalidManifest),
    };
    match validate(&manifest, granted) {
        Ok(()) => RegisterResult::success(Registration {
            name: manifest.name,
            version: manifest.version,
            schema_version: if manifest.schema_version.is_empty() {
                SCHEMA_VERSION.to_owned()
            } else {
                manifest.schema_version
            },
            capabilities: manifest.capabilities,
            effects: manifest.effects,
            commands: manifest.commands,
        }),
        Err(error) => RegisterResult::failure(&error),
    }
}

/** manifest 结构、版本、权限与注册项校验。 */
fn validate(manifest: &PluginManifest, granted: &[&str]) -> Result<(), PluginError> {
    if manifest.name.trim().is_empty() {
        return Err(PluginError::MissingName);
    }
    if manifest.effects.is_empty() && manifest.commands.is_empty() {
        return Err(PluginError::EmptyRegistration);
    }

    // 复用 W-11 冻结的能力协商契约（requiredCapabilities 为空，只协商版本）
    let api_version = if manifest.api_version.is_empty() {
        API_VERSION.to_owned()
    } else {
        manifest.api_version.clone()
    };
    let schema_version = if manifest.schema_version.is_empty() {
        SCHEMA_VERSION.to_owned()
    } else {
        manifest.schema_version.clone()
    };
    let negotiated = negotiate(&CapabilitiesRequest {
        api_version,
        schema_versions: vec![schema_version],
        required_capabilities: Vec::new(),
    });
    if !negotiated.compatible {
        return Err(if negotiated.reason == NEGOTIATE_API_MISMATCH {
            PluginError::ApiVersionMismatch
        } else {
            PluginError::SchemaVersionMismatch
        });
    }

    let unknown: Vec<String> = manifest
        .capabilities
        .iter()
        .filter(|item| !PLUGIN_PERMISSIONS.contains(&item.as_str()))
        .cloned()
        .collect();
    if !unknown.is_empty() {
        return Err(PluginError::UnknownPermission(unknown));
    }
    let denied: Vec<String> = manifest
        .capabilities
        .iter()
        .filter(|item| !granted.contains(&item.as_str()))
        .cloned()
        .collect();
    if !denied.is_empty() {
        return Err(PluginError::PermissionDenied(denied));
    }

    let mut missing = Vec::new();
    if !manifest.effects.is_empty()
        && !manifest
            .capabilities
            .iter()
            .any(|item| item == PERMISSION_EFFECT)
    {
        missing.push(PERMISSION_EFFECT.to_owned());
    }
    if !manifest.commands.is_empty()
        && !manifest
            .capabilities
            .iter()
            .any(|item| item == PERMISSION_COMMAND)
    {
        missing.push(PERMISSION_COMMAND.to_owned());
    }
    if !missing.is_empty() {
        return Err(PluginError::CapabilityNotGranted(missing));
    }
    Ok(())
}

/// 插件 host：单实例注册表，处理器只在进程内绑定。
pub struct PluginHost {
    granted: Vec<String>,
    registrations: Vec<Registration>,
    effects: HashMap<String, (String, Handler)>,
    commands: HashMap<String, (String, Handler)>,
}

impl PluginHost {
    /// 创建带授予权限清单的 host。
    pub fn new(granted: &[&str]) -> Self {
        Self {
            granted: granted.iter().map(|item| (*item).to_owned()).collect(),
            registrations: Vec::new(),
            effects: HashMap::new(),
            commands: HashMap::new(),
        }
    }

    /// host 授予的权限。
    pub fn granted(&self) -> &[String] {
        &self.granted
    }

    /// 已注册插件。
    pub fn registrations(&self) -> &[Registration] {
        &self.registrations
    }

    /// 注册一份 manifest；同名重复注册被拒。
    pub fn register(&mut self, manifest_json: &str) -> RegisterResult {
        let granted: Vec<&str> = self.granted.iter().map(String::as_str).collect();
        let result = check_manifest(&granted, manifest_json);
        if result.ok
            && let Some(registration) = &result.registration
        {
            if self
                .registrations
                .iter()
                .any(|item| item.name == registration.name)
            {
                return RegisterResult::failure(&PluginError::DuplicatePlugin);
            }
            self.registrations.push(registration.clone());
        }
        result
    }

    /**
     * 给已注册插件绑定 effect / command 处理器（示例插件路径）。
     * @param plugin 插件名
     * @param effects effect 名与处理器
     * @param commands command 名与处理器
     * @returns {Result<(), PluginError>} 插件未注册或注册项越界时失败
     */
    pub fn bind_handlers(
        &mut self,
        plugin: &str,
        effects: Vec<(&str, Handler)>,
        commands: Vec<(&str, Handler)>,
    ) -> Result<(), PluginError> {
        let registration = self
            .registrations
            .iter()
            .find(|item| item.name == plugin)
            .ok_or(PluginError::UnknownPlugin)?
            .clone();
        for (name, handler) in effects {
            if !registration.effects.iter().any(|item| item == name) {
                return Err(PluginError::UnknownEffect);
            }
            self.effects
                .insert(name.to_owned(), (plugin.to_owned(), handler));
        }
        for (name, handler) in commands {
            if !registration.commands.iter().any(|item| item == name) {
                return Err(PluginError::UnknownCommand);
            }
            self.commands
                .insert(name.to_owned(), (plugin.to_owned(), handler));
        }
        Ok(())
    }

    /// 已绑定的 effect 名（排序后，便于断言）。
    pub fn effect_names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.effects.keys().map(String::as_str).collect();
        names.sort_unstable();
        names
    }

    /// 已绑定的 command 名（排序后）。
    pub fn command_names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.commands.keys().map(String::as_str).collect();
        names.sort_unstable();
        names
    }

    /// 调用一个 effect；调用前再次校验 host 是否授予 `effect` 权限。
    pub fn run_effect(&self, name: &str, payload: &Value) -> Result<Value, PluginError> {
        self.ensure_granted(PERMISSION_EFFECT)?;
        let (_, handler) = self.effects.get(name).ok_or(PluginError::UnknownEffect)?;
        handler(payload).map_err(|_| PluginError::HandlerFailed)
    }

    /// 调用一个 command；调用前再次校验 host 是否授予 `command` 权限。
    pub fn run_command(&self, name: &str, payload: &Value) -> Result<Value, PluginError> {
        self.ensure_granted(PERMISSION_COMMAND)?;
        let (_, handler) = self.commands.get(name).ok_or(PluginError::UnknownCommand)?;
        handler(payload).map_err(|_| PluginError::HandlerFailed)
    }

    /** 防止 host 收回权限后仍能调用已绑定处理器。 */
    fn ensure_granted(&self, permission: &str) -> Result<(), PluginError> {
        if self.granted.iter().any(|item| item == permission) {
            Ok(())
        } else {
            Err(PluginError::PermissionDenied(vec![permission.to_owned()]))
        }
    }
}
