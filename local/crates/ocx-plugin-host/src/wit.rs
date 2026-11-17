//! WIT 契约解析与导出白名单派生（W-12 第四批）。
//!
//! 调研结论（2026-11-17，官方一手资料）：wasmi 2.0 原生只执行 core WebAssembly
//! module——官方 README 的 WASI 支持仅 `wasip1`（经 `wasmi_wasi`），组件模型
//! issue `wasmi-labs/wasmi#897` 仍开放。因此本模块把 WIT 作为**接口契约的单一
//! 事实来源（IDL）**，而不是组件运行时：
//! - 解析 host 内嵌 `.wit`，提取 `effects` / `commands` 接口的导出函数名；
//! - 运行时 `authorize()` 从契约派生白名单，与 manifest 声明双重校验；
//! - 导出名仍沿用 core wasm ABI：`effect_<name>` / `command_<name>`。
//!
//! 解析范围限定为官方 WIT 语法子集：`package` / `interface` / `world` / `export` /
//! `func`、`//` 与 `/* */` 注释、kebab-case 标识符。不解析类型系统、`import`、
//! `include` / `use`，遇到这些结构忽略而非误判为函数。

use std::collections::HashMap;

use crate::model::PluginError;

/// host 内嵌的官方 WIT 契约（唯一契约来源）。
pub const DEFAULT_WIT: &str = include_str!("../wit/ocx-plugin.wit");
/// `effects` 接口名（契约中固定）。
const EFFECTS_INTERFACE: &str = "effects";
/// `commands` 接口名（契约中固定）。
const COMMANDS_INTERFACE: &str = "commands";
/// `package` 声明前缀（带空格避免误匹配标识符）。
const PACKAGE_PREFIX: &str = "package ";
/// `interface` 声明前缀。
const INTERFACE_PREFIX: &str = "interface ";
/// `world` 声明前缀。
const WORLD_PREFIX: &str = "world ";
/// `export` 声明前缀。
const EXPORT_PREFIX: &str = "export ";
/// 函数声明标记。
const FUNC_MARKER: &str = ": func(";
/// WIT kebab-case 分隔符。
const KEBAB_SEPARATOR: char = '-';
/// core wasm 导出名替换符（kebab-case → snake_case）。
const WASM_NAME_SEPARATOR: char = '_';
/// `str::replace` 用的替换字符串。
const WASM_NAME_REPLACEMENT: &str = "_";
/// 块结束标记。
const BLOCK_END: char = '}';
/// 块开始标记。
const BLOCK_START: char = '{';

/// 从 WIT 文本解析出的契约视图。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WitContract {
    /// `package` 声明（namespace:name@version）。
    pub package: String,
    /// `effects` 接口导出的逻辑名（kebab-case）。
    pub effects: Vec<String>,
    /// `commands` 接口导出的逻辑名（kebab-case）。
    pub commands: Vec<String>,
}

/// 解析中的块类型（用栈保证花括号平衡）。
enum Block {
    /// interface 块，携带接口名。
    Interface(String),
    /// world 块。
    World,
    /// 未知嵌套块（type / record 等），只用于平衡括号。
    Other,
}

/**
 * 去掉 WIT 的行注释（`//` / `///`）与块注释（`/* */`），保留换行以维持行结构。
 * @param text 原始 WIT 文本
 * @returns {String} 去注释后的文本
 */
fn strip_comments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    let mut in_block = false;
    while index < chars.len() {
        // 块注释内：遇到 */ 结束，换行原样保留
        if in_block {
            if chars[index] == '*' && index + 1 < chars.len() && chars[index + 1] == '/' {
                in_block = false;
                index += 2;
            } else {
                if chars[index] == '\n' {
                    out.push('\n');
                }
                index += 1;
            }
            continue;
        }
        // 块注释开始
        if chars[index] == '/' && index + 1 < chars.len() && chars[index + 1] == '*' {
            in_block = true;
            index += 2;
            continue;
        }
        // 行注释：跳到行尾
        if chars[index] == '/' && index + 1 < chars.len() && chars[index + 1] == '/' {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            continue;
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

/**
 * 把花括号换行归一化，使官方 WIT 合法的单行块（如 `world p { export e; }`）
 * 也能被逐行状态机解析：保留 `{` 在行尾供声明识别，把 `{` 后的内容与 `}` 拆到独立行。
 * @param text 已去注释的 WIT 文本
 * @returns {String} 归一化后的文本
 */
fn normalize_braces(text: &str) -> String {
    text.replace(BLOCK_START, &format!("{BLOCK_START}\n"))
        .replace(BLOCK_END, &format!("\n{BLOCK_END}"))
}

/**
 * 校验 WIT 标识符是否为官方 kebab-case 规则。
 * 规则：非空、无 `--`、不以 `-` 开头/结尾、每段仅 ASCII 字母数字、首段不以数字开头、
 * 每段全小写或全大写、不允许下划线。
 * @param name 待校验标识符
 * @returns {bool} 合法返回 true
 */
fn is_kebab_case(name: &str) -> bool {
    if name.is_empty()
        || name.starts_with(KEBAB_SEPARATOR)
        || name.ends_with(KEBAB_SEPARATOR)
        || name.contains("--")
        || name.contains(WASM_NAME_SEPARATOR)
    {
        return false;
    }
    name.split(KEBAB_SEPARATOR)
        .enumerate()
        .all(|(index, part)| {
            if part.is_empty() || !part.chars().all(|ch| ch.is_ascii_alphanumeric()) {
                return false;
            }
            // 首段不能以数字开头；后续段允许（如 h264-stream）。
            if index == 0 && part.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
                return false;
            }
            let all_lower = part
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit());
            let all_upper = part
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit());
            all_lower || all_upper
        })
}

/**
 * 校验 package ID 形态：至少含 `namespace:name`，版本可选。
 * @param name package 声明文本
 * @returns {bool} 形态合法返回 true
 */
fn is_package_id(name: &str) -> bool {
    !name.is_empty()
        && !name.chars().any(char::is_whitespace)
        && name
            .split_once(':')
            .is_some_and(|(namespace, rest)| !namespace.is_empty() && !rest.is_empty())
}

/**
 * 从接口内的一行解析函数名，形如 `brightness: func(payload: string) -> ...;`。
 * @param line 已 trim 的单行
 * @returns {Option<String>} 合法 kebab-case 函数名
 */
fn parse_func_line(line: &str) -> Option<String> {
    let (name, _) = line.split_once(FUNC_MARKER)?;
    let name = name.trim();
    if is_kebab_case(name) {
        Some(name.to_owned())
    } else {
        None
    }
}

/**
 * 解析 WIT 文本为契约视图。
 * 结构要求：恰有一个 `package`、至少一个 `interface`、`world` 至少 `export` 一个
 * 已定义的 `effects` / `commands` 接口；否则返回 `INVALID_WIT`。
 * @param text 官方 WIT 语法子集的文本
 * @returns {Result<WitContract, PluginError>} 契约视图
 */
pub fn parse(text: &str) -> Result<WitContract, PluginError> {
    // 去注释 + 花括号换行归一化，都是纯文本预处理。
    let clean = normalize_braces(&strip_comments(text));
    let mut package: Option<String> = None;
    let mut interfaces: HashMap<String, Vec<String>> = HashMap::new();
    let mut stack: Vec<Block> = Vec::new();
    let mut world_exports: Vec<String> = Vec::new();

    for raw_line in clean.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        // 块结束：弹出栈顶（多余 } 会被后续栈空检查间接忽略）
        if line.starts_with(BLOCK_END) {
            stack.pop();
            continue;
        }

        if stack.is_empty() {
            if let Some(rest) = line.strip_prefix(PACKAGE_PREFIX) {
                let name = rest.trim().trim_end_matches(';').trim();
                if !is_package_id(name) {
                    return Err(PluginError::InvalidWit);
                }
                package = Some(name.to_owned());
            } else if let Some(rest) = line.strip_prefix(INTERFACE_PREFIX) {
                let name = rest.trim().trim_end_matches(BLOCK_START).trim();
                if !is_kebab_case(name) {
                    return Err(PluginError::InvalidWit);
                }
                interfaces.entry(name.to_owned()).or_default();
                stack.push(Block::Interface(name.to_owned()));
            } else if let Some(rest) = line.strip_prefix(WORLD_PREFIX) {
                let name = rest.trim().trim_end_matches(BLOCK_START).trim();
                if !is_kebab_case(name) {
                    return Err(PluginError::InvalidWit);
                }
                stack.push(Block::World);
            }
            // 其它顶层结构（use / type 等）忽略
            continue;
        }

        // 块内声明
        match stack.last() {
            Some(Block::Interface(name)) => {
                if let Some(func) = parse_func_line(line) {
                    interfaces.entry(name.clone()).or_default().push(func);
                }
            }
            Some(Block::World) => {
                if let Some(rest) = line.strip_prefix(EXPORT_PREFIX) {
                    let target = rest.trim().trim_end_matches(';').trim();
                    // 只处理 `export <interface>;`；`export x: func(...)` 忽略
                    if !target.contains(':') && is_kebab_case(target) {
                        world_exports.push(target.to_owned());
                    }
                }
            }
            Some(Block::Other) | None => {}
        }

        // 嵌套块（record / variant 等）：用 Other 占位保持括号平衡
        if line.ends_with(BLOCK_START) {
            stack.push(Block::Other);
        }
    }

    let package = package.ok_or(PluginError::InvalidWit)?;
    if world_exports.is_empty() {
        return Err(PluginError::InvalidWit);
    }
    let mut effects = Vec::new();
    let mut commands = Vec::new();
    for export in &world_exports {
        match export.as_str() {
            EFFECTS_INTERFACE => {
                effects = interfaces
                    .get(EFFECTS_INTERFACE)
                    .cloned()
                    .ok_or(PluginError::InvalidWit)?;
            }
            COMMANDS_INTERFACE => {
                commands = interfaces
                    .get(COMMANDS_INTERFACE)
                    .cloned()
                    .ok_or(PluginError::InvalidWit)?;
            }
            // world export 了未知接口：契约不合法，拒绝而非静默忽略
            _ => return Err(PluginError::InvalidWit),
        }
    }
    if effects.is_empty() && commands.is_empty() {
        return Err(PluginError::InvalidWit);
    }
    Ok(WitContract {
        package,
        effects,
        commands,
    })
}

/**
 * 解析 host 内嵌的默认契约。
 * @returns {Result<WitContract, PluginError>} 内嵌 `.wit` 的契约视图
 */
pub fn default_contract() -> Result<WitContract, PluginError> {
    parse(DEFAULT_WIT)
}

impl WitContract {
    /**
     * 逻辑名是否在 `effects` 接口契约内。
     * @param name kebab-case 逻辑名
     * @returns {bool} 在契约内返回 true
     */
    pub fn has_effect(&self, name: &str) -> bool {
        self.effects.iter().any(|item| item == name)
    }

    /**
     * 逻辑名是否在 `commands` 接口契约内。
     * @param name kebab-case 逻辑名
     * @returns {bool} 在契约内返回 true
     */
    pub fn has_command(&self, name: &str) -> bool {
        self.commands.iter().any(|item| item == name)
    }

    /**
     * 把 WIT 逻辑名映射为 core wasm 导出名：`effect_get-info` → `effect_get_info`。
     * @param prefix 导出前缀（`effect_` / `command_`）
     * @param logical kebab-case 逻辑名
     * @returns {String} core wasm 导出名
     */
    pub fn to_export_name(prefix: &str, logical: &str) -> String {
        format!(
            "{}{}",
            prefix,
            logical.replace(KEBAB_SEPARATOR, WASM_NAME_REPLACEMENT)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /** 默认契约应解析出 package、brightness effect 与 ping command。 */
    #[test]
    fn default_contract_parses() {
        let contract = default_contract().expect("内嵌契约应可解析");
        assert_eq!(contract.package, "opencut:plugin@1.0.0");
        assert_eq!(contract.effects, vec!["brightness"]);
        assert_eq!(contract.commands, vec!["ping"]);
    }

    /** 注释（行注释与块注释）不得被误当作函数声明。 */
    #[test]
    fn comments_are_ignored() {
        let text = "package a:b;\n// fake: func(x: string);\n/* multi\n block: func(y: string); */\ninterface effects {\n  brightness: func(payload: string) -> result<string, string>;\n}\nworld plugin { export effects; }\n";
        let contract = parse(text).expect("带注释的契约应可解析");
        assert_eq!(contract.effects, vec!["brightness"]);
    }

    /** 缺 package / 缺 world export / world export 未知接口，均应拒绝。 */
    #[test]
    fn malformed_contracts_are_rejected() {
        let no_package = "interface effects { x: func(); }\nworld p { export effects; }";
        assert_eq!(parse(no_package).unwrap_err(), PluginError::InvalidWit);
        let no_export = "package a:b;\ninterface effects { x: func(); }\nworld p {}";
        assert_eq!(parse(no_export).unwrap_err(), PluginError::InvalidWit);
        let bad_export =
            "package a:b;\ninterface effects { x: func(); }\nworld p { export unknown; }";
        assert_eq!(parse(bad_export).unwrap_err(), PluginError::InvalidWit);
        let empty_interface = "package a:b;\ninterface effects {}\nworld p { export effects; }";
        assert_eq!(parse(empty_interface).unwrap_err(), PluginError::InvalidWit);
    }

    /** 非法标识符（下划线、连续连字符、首尾连字符、数字开头）应拒绝。 */
    #[test]
    fn invalid_identifiers_are_rejected() {
        for bad in ["bad_name", "bad--name", "-name", "name-", "1name"] {
            let text = format!(
                "package a:b;\ninterface effects {{ {bad}: func(); }}\nworld p {{ export effects; }}"
            );
            assert_eq!(
                parse(&text).unwrap_err(),
                PluginError::InvalidWit,
                "{bad} 应拒绝"
            );
        }
    }

    /** kebab-case 逻辑名到 core wasm 导出名的映射。 */
    #[test]
    fn export_name_mapping() {
        assert_eq!(
            WitContract::to_export_name("effect_", "brightness"),
            "effect_brightness"
        );
        assert_eq!(
            WitContract::to_export_name("command_", "get-info"),
            "command_get_info"
        );
    }

    /** 白名单查询只接受契约内的精确逻辑名。 */
    #[test]
    fn membership_is_exact() {
        let contract = default_contract().expect("内嵌契约应可解析");
        assert!(contract.has_effect("brightness"));
        assert!(!contract.has_effect("brightness-extra"));
        assert!(contract.has_command("ping"));
        assert!(!contract.has_command("brightness"));
    }
}
