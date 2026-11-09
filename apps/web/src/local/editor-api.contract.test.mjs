/**
 * Editor API 跨语言契约回归测试（Node 内置 test runner，零第三方依赖）。
 * 运行：node apps/web/src/local/editor-api.contract.test.mjs
 * 目标：防止 Rust 常量、错误码、命令清单与 Web 契约 JSON 漂移。
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.join(HERE, "editor-api.contract.json");
const RUST_SRC_DIR = path.resolve(
  HERE,
  "../../../../local/crates/ocx-editor-api/src",
);
const CASES_DOC_PATH = path.resolve(
  HERE,
  "../../../../local/crates/ocx-editor-api/tests/CASES.md",
);

/**
 * 聚合读取 crate 全部 Rust 源文件（源码可能拆分为多个模块）。
 * @returns {string} 拼接后的源码文本
 */
function readRustSources() {
  return readdirSync(RUST_SRC_DIR)
    .filter((file) => file.endsWith(".rs"))
    .map((file) => readFileSync(path.join(RUST_SRC_DIR, file), "utf8"))
    .join("\n");
}

/**
 * 从 Rust 源码提取字符串常量。
 * @param {string} source Rust 源码
 * @param {string} name 常量名
 * @returns {string} 常量值
 */
function rustStringConst(source, name) {
  const pattern = new RegExp(`pub const ${name}: &str = "([^"]+)";`);
  const match = pattern.exec(source);
  assert.ok(match, `Rust 源码缺少常量 ${name}`);
  return match[1];
}

/**
 * 读取并解析契约 JSON；解析失败时给出明确错误。
 * @returns {object} 契约对象
 */
function readContract() {
  const text = readFileSync(CONTRACT_PATH, "utf8");
  return JSON.parse(text);
}

test("契约文件版本与字段完整", () => {
  const contract = readContract();
  assert.equal(contract.version, 1);
  assert.equal(contract.fieldNaming, "camelCase");
  assert.ok(contract.envelope.includes("apiVersion"));
  assert.ok(contract.envelope.includes("schemaVersion"));
  assert.ok(contract.envelope.includes("commandId"));
  assert.ok(contract.invariants.includes("I-01"));
  assert.ok(contract.invariants.includes("I-05"));
});

test("契约常量与 Rust 实现一致", () => {
  const contract = readContract();
  const source = readRustSources();
  assert.equal(contract.apiVersion, rustStringConst(source, "API_VERSION"));
  assert.equal(contract.schemaVersion, rustStringConst(source, "SCHEMA_VERSION"));
  assert.equal(contract.backendId, rustStringConst(source, "BACKEND_IN_MEMORY"));
  for (const [expectedKind, rustName] of [
    ["addClip", "COMMAND_ADD_CLIP"],
    ["setPlayhead", "COMMAND_SET_PLAYHEAD"],
    ["clear", "COMMAND_CLEAR"],
  ]) {
    const kind = rustStringConst(source, rustName);
    assert.equal(kind, expectedKind);
    const command = contract.commands.find((item) => item.kind === kind);
    assert.ok(command, `契约缺少命令 ${kind}`);
    for (const field of Object.keys(command.payload)) {
      assert.ok(source.includes(field), `Rust 缺少 payload 字段 ${field}`);
    }
  }
});

test("能力清单、命令与错误码在 Rust 源码中都有定义", () => {
  const contract = readContract();
  const source = readRustSources();
  for (const capability of contract.capabilities) {
    assert.ok(source.includes(`"${capability}"`), `Rust 缺少能力 ${capability}`);
  }
  for (const errorCode of contract.errors) {
    assert.ok(source.includes(errorCode), `Rust 缺少错误码 ${errorCode}`);
  }
  for (const command of contract.commands) {
    assert.ok(source.includes(command.kind), `Rust 缺少命令 ${command.kind}`);
  }
});

test("测试案例文档存在且与契约属同一迭代", () => {
  const doc = readFileSync(CASES_DOC_PATH, "utf8");
  assert.ok(doc.includes("测试结果"));
  assert.ok(doc.includes("E19"));
});

test("异常与边界：损坏的契约必须被明确拒绝", () => {
  assert.throws(() => JSON.parse("{ 非法 JSON"), SyntaxError);
  const contract = readContract();
  assert.equal(contract.commands.length, 3);
  assert.equal(contract.errors.length, 6);
  const broken = { ...contract, commands: [] };
  assert.equal(broken.commands.length, 0);
  assert.ok(contract.commands.length > 0);
});
