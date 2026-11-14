import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadPluginModule, validatePluginBytes } from './plugin-runtime';

/**
 * W-12 第二批：用真实插件产物（ocx-plugin-sample 的 wasm32 cdylib）验证运行时。
 * manifest 的结构/权限校验由 core 的 pluginRegister 覆盖（见 editor-wasm.contract.mjs）。
 */
const WASM_PATH = new URL('../../public/fixtures/sample-plugin.wasm', import.meta.url);

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(WASM_PATH));
}

describe('plugin-runtime（W-12 第二批）', () => {
  it('加载示例插件并列出 effect / command', async () => {
    const plugin = await loadPluginModule(loadFixture());
    expect(plugin.effects).toEqual(['brightness']);
    expect(plugin.commands).toEqual(['ping']);
  });

  it('真实调用插件的 effect 与 command', async () => {
    const plugin = await loadPluginModule(loadFixture());
    await expect(plugin.runEffect('brightness', { amount: 0.25 })).resolves.toEqual({
      brightness: 0.5,
    });
    await expect(plugin.runCommand('ping', { value: 7 })).resolves.toEqual({ pong: 7 });
  });

  it('未知 effect / command 给出稳定错误码', async () => {
    const plugin = await loadPluginModule(loadFixture());
    await expect(plugin.runEffect('missing', {})).rejects.toThrow(/UNKNOWN_EFFECT/);
    await expect(plugin.runCommand('missing', {})).rejects.toThrow(/UNKNOWN_COMMAND/);
  });

  it('插件返回的错误信封映射为 HANDLER_FAILED', async () => {
    const plugin = await loadPluginModule(loadFixture());
    await expect(plugin.runEffect('brightness', {})).rejects.toThrow(/HANDLER_FAILED/);
  });

  it('损坏的二进制被拒绝', async () => {
    await expect(loadPluginModule(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('空二进制与非 Uint8Array 输入被拒绝', () => {
    expect(() => validatePluginBytes(new Uint8Array())).toThrow(/Uint8Array/);
    expect(() => validatePluginBytes(null)).toThrow(/Uint8Array/);
    expect(() => validatePluginBytes('x')).toThrow(/Uint8Array/);
  });
});
