//! 声明式权限：资源 scope 校验与匹配（W-12 第五批）。
//!
//! 遵循 capability-based security 的 deny-by-default 原则：
//! - manifest 用 `permissionScopes`（能力名 → 资源 scope 列表）显式声明需要的资源；
//! - 能力必须已在 `capabilities` 声明且属于资源型能力，否则拒绝；
//! - scope 形如 `namespace:resource`，`namespace:*` 为前缀通配；
//! - host 只为已授予的 scope 注入受控能力函数，函数内按 scope 再次校验具体资源。
//!
//! 本模块只做纯函数（校验 + 匹配），不依赖 wasmi，便于跨语言契约复用与单测。

use std::collections::BTreeMap;

use crate::model::{
    MAX_SCOPE_LEN, MAX_SCOPES_PER_CAPABILITY, PluginError, PluginManifest,
    SCOPE_CAPABILITY_MEDIA_READ, SCOPE_SEPARATOR, SCOPE_WILDCARD,
};

/// 支持资源 scope 的能力集合（资源型能力）。
/// 目前仅 `media-read` 有资源概念；`effect` / `command` 是工作类型非资源，不接受 scope。
const SCOPE_CAPABILITIES: &[&str] = &[SCOPE_CAPABILITY_MEDIA_READ];

/**
 * 校验单个 scope 字符串：非空、长度受限、含命名空间、`*` 只能作为资源段的唯一通配。
 * @param scope 待校验 scope（如 `clip:*` / `asset:bg.mp4`）
 * @returns {Result<(), PluginError>} 非法返回 `INVALID_SCOPE`
 */
pub fn validate_scope(scope: &str) -> Result<(), PluginError> {
    if scope.is_empty() || scope.len() > MAX_SCOPE_LEN {
        return Err(PluginError::InvalidScope(scope.to_owned()));
    }
    let (namespace, resource) = scope
        .split_once(SCOPE_SEPARATOR)
        .ok_or_else(|| PluginError::InvalidScope(scope.to_owned()))?;
    // 命名空间不能含通配符且非空。
    if namespace.is_empty() || namespace.contains(SCOPE_WILDCARD) {
        return Err(PluginError::InvalidScope(scope.to_owned()));
    }
    // 资源段非空；`*` 只允许单独出现（整段通配），不支持 `pre*fix` 部分通配。
    if resource.is_empty() || (resource.contains(SCOPE_WILDCARD) && resource != SCOPE_WILDCARD) {
        return Err(PluginError::InvalidScope(scope.to_owned()));
    }
    Ok(())
}

/**
 * 校验 manifest 的 permissionScopes：能力已声明、属于资源型、scope 数量与格式合法。
 * 在 `check_manifest` 的能力校验之后调用；缺省空映射直接通过（deny-by-default）。
 * @param manifest 插件清单
 * @returns {Result<(), PluginError>} 越权/非法返回稳定错误码
 */
pub fn validate_permission_scopes(manifest: &PluginManifest) -> Result<(), PluginError> {
    for (capability, scopes) in &manifest.permission_scopes {
        if !manifest.capabilities.iter().any(|item| item == capability) {
            return Err(PluginError::UnknownScopeCapability(capability.clone()));
        }
        if !SCOPE_CAPABILITIES.contains(&capability.as_str()) {
            return Err(PluginError::UnknownScopeCapability(capability.clone()));
        }
        if scopes.len() > MAX_SCOPES_PER_CAPABILITY {
            return Err(PluginError::InvalidScope(capability.clone()));
        }
        for scope in scopes {
            validate_scope(scope)?;
        }
    }
    Ok(())
}

/**
 * 判断一个资源是否被授予的 scope 列表允许。
 * 匹配规则：精确相等，或 namespace 相同且授权资源为 `*`。
 * @param scopes 能力对应的已授予 scope 列表
 * @param resource 请求访问的资源（如 `clip:intro`）
 * @returns {bool} 命中返回 true；空列表或均不匹配返回 false（deny-by-default）
 */
pub fn scope_allows(scopes: &[String], resource: &str) -> bool {
    let (resource_ns, _) = match resource.split_once(SCOPE_SEPARATOR) {
        Some(parts) => parts,
        None => return false,
    };
    scopes.iter().any(|scope| {
        // 精确匹配优先（也覆盖 resource 本身就是 `ns:*` 的调用）。
        if scope == resource {
            return true;
        }
        match scope.split_once(SCOPE_SEPARATOR) {
            Some((scope_ns, scope_res)) => scope_ns == resource_ns && scope_res == SCOPE_WILDCARD,
            None => false,
        }
    })
}

/**
 * 判断 host 授予清单是否覆盖请求的资源（跨能力查找）。
 * @param granted 已授予 scope 映射（能力名 → 列表）
 * @param capability 能力名
 * @param resource 资源标识
 * @returns {bool} 该能力已授权且资源命中 scope 返回 true
 */
pub fn granted_allows(
    granted: &BTreeMap<String, Vec<String>>,
    capability: &str,
    resource: &str,
) -> bool {
    granted
        .get(capability)
        .is_some_and(|scopes| scope_allows(scopes, resource))
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 合法 scope：精确资源与整段通配。 */
    #[test]
    fn valid_scopes_are_accepted() {
        assert!(validate_scope("clip:intro").is_ok());
        assert!(validate_scope("clip:*").is_ok());
        assert!(validate_scope("asset:bg.mp4").is_ok());
    }

    /** 非法 scope：空、无分隔符、空命名空间、空资源、部分通配、超长。 */
    #[test]
    fn invalid_scopes_are_rejected() {
        for bad in [
            "",
            "no-separator",
            ":intro",
            "clip:",
            "clip:pre*fix",
            &"c".repeat(MAX_SCOPE_LEN + 1),
        ] {
            assert_eq!(
                validate_scope(bad).unwrap_err().code(),
                "INVALID_SCOPE",
                "{bad} 应拒绝"
            );
        }
    }

    /** 精确与通配匹配，跨命名空间拒绝，空列表拒绝。 */
    #[test]
    fn scope_matching_is_deny_by_default() {
        let scopes = vec!["clip:intro".to_owned(), "asset:*".to_owned()];
        assert!(scope_allows(&scopes, "clip:intro"));
        assert!(scope_allows(&scopes, "asset:bg.mp4"));
        assert!(!scope_allows(&scopes, "clip:body"));
        assert!(!scope_allows(&scopes, "secret:key"));
        assert!(!scope_allows(&[], "clip:intro"));
        assert!(!scope_allows(&scopes, "no-separator"));
    }

    /** granted_allows 只查指定能力的 scope。 */
    #[test]
    fn granted_lookup_is_capability_scoped() {
        let mut granted = BTreeMap::new();
        granted.insert(
            SCOPE_CAPABILITY_MEDIA_READ.to_owned(),
            vec!["clip:*".to_owned()],
        );
        assert!(granted_allows(
            &granted,
            SCOPE_CAPABILITY_MEDIA_READ,
            "clip:intro"
        ));
        assert!(!granted_allows(&granted, "export", "clip:intro"));
        assert!(!granted_allows(
            &granted,
            SCOPE_CAPABILITY_MEDIA_READ,
            "secret:key"
        ));
    }
}
