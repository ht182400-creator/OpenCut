//! W-12 native I/O 的 CLI 编排层（W-12 第八、九批上层入口）。
//!
//! 把 `ocx-plugin-host` 的受控文件读取 / 网络抓取能力接到 headless CLI：
//! manifest 校验 → 授予 scope → 绑定宿主目录 / 网络开关 → 加载真实 wasm 插件 →
//! 调用 effect → 输出 JSON 摘要。所有 core 调用集中在宿主侧，插件仍是零信任。

use std::collections::BTreeMap;
use std::path::PathBuf;

use ocx_plugin_host::{
    check_manifest,
    runtime::{HostState, load_plugin_with_resources},
};
use serde::Serialize;
use serde_json::Value;

/// 文件根目录绑定：`namespace=绝对路径`。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRootBinding {
    pub namespace: String,
    pub path: String,
}

/// 插件 I/O 调用摘要（stdout JSON）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginIoSummary {
    pub plugin: String,
    pub effect: String,
    /// 插件 effect 返回的 JSON 原样透传。
    pub result: Value,
}

/**
 * 解析 `namespace=path` 形式的目录绑定参数（支持重复传入多个）。
 * @param specs `--file-root` 的原始值列表
 * @returns {Result<Vec<FileRootBinding>, String>} 解析结果；格式非法给中文错误
 */
pub fn parse_file_roots(specs: &[String]) -> Result<Vec<FileRootBinding>, String> {
    specs
        .iter()
        .map(|spec| {
            let (namespace, path) = spec
                .split_once('=')
                .ok_or_else(|| format!("目录绑定格式错误：{spec}（应为 namespace=路径）"))?;
            if namespace.trim().is_empty() || path.trim().is_empty() {
                return Err(format!("目录绑定 namespace 与路径都不能为空：{spec}"));
            }
            Ok(FileRootBinding {
                namespace: namespace.to_owned(),
                path: path.to_owned(),
            })
        })
        .collect()
}

/**
 * 从 manifest JSON 提取已授予的权限列表（capabilities 即 host 授予清单）。
 * @param manifest_json 插件清单 JSON
 * @returns {Result<Vec<String>, String>} 能力列表；解析失败给中文错误
 */
pub fn granted_from_manifest(manifest_json: &str) -> Result<Vec<String>, String> {
    let value: Value =
        serde_json::from_str(manifest_json).map_err(|error| format!("解析 manifest 失败：{error}"))?;
    let capabilities = value
        .get("capabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| "manifest 缺少 capabilities 数组".to_owned())?;
    let mut granted = Vec::with_capacity(capabilities.len());
    for item in capabilities {
        granted.push(
            item.as_str()
                .ok_or_else(|| "manifest capabilities 含非字符串项".to_owned())?
                .to_owned(),
        );
    }
    Ok(granted)
}

/**
 * 加载并调用一个真实 wasm 插件的 effect，返回受控 I/O 结果摘要。
 * @param wasm_bytes 插件 wasm 二进制
 * @param manifest_json 插件清单 JSON（capabilities 即授予权限，permissionScopes 为授予 scope）
 * @param file_roots 命名空间 → 宿主目录绑定（file-read 能力用）
 * @param network 是否显式开启真实网络（network-fetch 能力用）
 * @param effect 调用的导出函数名（须在 manifest 声明且 host 授予对应权限）
 * @param payload 输入 JSON
 * @returns {Result<PluginIoSummary, String>} 摘要；任一环节失败给含稳定错误码的中文错误
 */
pub fn run_plugin_io(
    wasm_bytes: &[u8],
    manifest_json: &str,
    file_roots: &[FileRootBinding],
    network: bool,
    effect: &str,
    payload: &Value,
) -> Result<PluginIoSummary, String> {
    let granted = granted_from_manifest(manifest_json)?;
    let granted_refs: Vec<&str> = granted.iter().map(String::as_str).collect();
    let checked = check_manifest(&granted_refs, manifest_json);
    if !checked.ok {
        return Err(format!(
            "插件注册被拒：{}（越权项：{}）",
            checked.error.unwrap_or_else(|| "UNKNOWN".to_owned()),
            checked.denied.join(", ")
        ));
    }
    let registration = checked
        .registration
        .ok_or_else(|| "插件注册成功但缺少注册项".to_owned())?;
    let plugin_name = registration.name.clone();

    // 授予 scope 来自 manifest.permissionScopes（已通过 check_manifest 校验）。
    let state = HostState::new(registration.permission_scopes.clone(), BTreeMap::new());
    let mut state = state;
    for binding in file_roots {
        state = state.with_file_root(&binding.namespace, PathBuf::from(&binding.path));
    }
    if network {
        state = state.with_network();
    }

    let mut plugin = load_plugin_with_resources(wasm_bytes, registration, &granted, state)
        .map_err(|error| format!("加载插件失败：{}", error))?;
    let result = plugin
        .call(effect, payload, true)
        .map_err(|error| format!("调用插件失败：{}", error))?;
    Ok(PluginIoSummary {
        plugin: plugin_name,
        effect: effect.to_owned(),
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 目录绑定解析：合法、缺等号、空 namespace / 空路径。 */
    #[test]
    fn parse_file_roots_validates_shape() {
        let parsed = parse_file_roots(&["assets=/tmp/a".to_owned(), "docs=C:\\docs".to_owned()])
            .expect("合法绑定应解析成功");
        assert_eq!(parsed[0].namespace, "assets");
        assert_eq!(parsed[0].path, "/tmp/a");
        assert_eq!(parsed[1].namespace, "docs");
        for bad in ["no-equals", "=path", "ns="] {
            assert!(parse_file_roots(&[bad.to_owned()]).is_err(), "{bad} 应拒绝");
        }
    }

    /** 从 manifest 提取授予能力；缺 capabilities / 非字符串项拒绝。 */
    #[test]
    fn granted_from_manifest_parses_capabilities() {
        let ok = r#"{"name":"p","capabilities":["file-read","effect"],"effects":["brightness"]}"#;
        assert_eq!(
            granted_from_manifest(ok).unwrap(),
            vec!["file-read".to_owned(), "effect".to_owned()]
        );
        assert!(granted_from_manifest(r#"{"name":"p"}"#).is_err());
        assert!(granted_from_manifest(r#"{"name":"p","capabilities":[1]}"#).is_err());
    }
}
