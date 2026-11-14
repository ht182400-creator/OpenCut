import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CLASSIC_BREAKPOINT_XS,
  CLASSIC_FONT_SIZE,
  CLASSIC_GAPS,
  CLASSIC_HEADER,
  CLASSIC_PANEL_CONFIG,
  CLASSIC_PANEL_LIMITS,
  CLASSIC_RADIUS,
  CLASSIC_THEME_KEYS,
} from './tokens';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(path.join(HERE, 'theme.css'), 'utf8');
/** 参照物路径可用环境变量覆盖；源码不存在时退回内置期望值。 */
const CLASSIC_GLOBALS =
  process.env.OPENCUT_CLASSIC_GLOBALS ??
  'E:/AI_Studio/opencut-classic/apps/web/src/app/globals.css';

/** 从 CSS 文本里按选择器提取 `--变量: 值` 对。 */
function block(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!match) throw new Error(`CSS 块未找到: ${selector}`);
  const vars: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const found = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line);
    if (found) vars[found[1]] = found[2].trim();
  }
  return vars;
}

describe('经典版 UI 1:1 基线 · 尺寸 token（批 0）', () => {
  it('面板默认比例与经典版 PANEL_CONFIG 一致', () => {
    expect(CLASSIC_PANEL_CONFIG).toEqual({
      tools: 25, preview: 50, properties: 25, mainContent: 50, timeline: 50,
    });
  });

  it('面板尺寸约束与 EditorLayout 一致', () => {
    expect(CLASSIC_PANEL_LIMITS.tools).toEqual({ min: 15, max: 40 });
    expect(CLASSIC_PANEL_LIMITS.preview.min).toBe(30);
    expect(CLASSIC_PANEL_LIMITS.mainContent).toEqual({ min: 30, max: 85 });
  });

  it('间隙、顶栏、圆角、字号、断点逐项一致', () => {
    expect(CLASSIC_GAPS).toEqual({ vertical: 0.18, horizontal: 0.19, horizontalPadding: 0.75 });
    expect(CLASSIC_HEADER).toEqual({ height: 3.4, paddingX: 0.75, paddingTop: 0.125 });
    expect(CLASSIC_RADIUS).toEqual({ lg: 0.82, md: 0.65, sm: 0.35 });
    expect(CLASSIC_FONT_SIZE).toEqual({ xs: 0.72, sm: 0.79, base: 0.92 });
    expect(CLASSIC_BREAKPOINT_XS).toBe(30);
  });

  it('主题变量名清单覆盖经典版关键 token', () => {
    expect(CLASSIC_THEME_KEYS).toContain('background');
    expect(CLASSIC_THEME_KEYS).toContain('popover-hover');
    expect(CLASSIC_THEME_KEYS).toContain('secondary-border');
  });
});

describe('经典版 UI 1:1 基线 · 主题变量（批 0）', () => {
  const ours = {
    light: block(themeCss, '.classic-ui-root'),
    dark: block(themeCss, '.classic-ui-root.dark'),
    panel: block(themeCss, '.classic-ui-root .panel'),
    darkPanel: block(themeCss, '.classic-ui-root.dark .panel'),
  };

  // 内置期望兜底：即使经典版源码目录不存在（如 CI），关键变量仍被锁定。
  const expected = {
    light: { '--background': 'hsl(0, 0%, 100%)', '--primary': 'hsl(200, 90%, 52%)', '--border': 'hsl(0 0% 91%)' },
    dark: { '--background': 'hsl(0, 0%, 5%)', '--border': 'hsl(0 0% 16%)' },
    panel: { '--background': 'hsl(210, 20%, 98%)', '--border': 'hsl(0 0% 87%)' },
    darkPanel: { '--background': 'hsl(0 0% 10%)', '--border': 'hsl(0 0% 18%)' },
  };

  for (const scope of ['light', 'dark', 'panel', 'darkPanel'] as const) {
    it(`${scope} 关键变量与经典版一致（内置期望）`, () => {
      for (const [name, value] of Object.entries(expected[scope])) {
        expect(ours[scope][name], `${scope} ${name}`).toBe(value);
      }
    });
  }

  it('radius / 字号 / 字体 token 与 @theme inline 一致', () => {
    expect(ours.light['--radius-lg']).toBe('0.82rem');
    expect(ours.light['--radius-md']).toBe('0.65rem');
    expect(ours.light['--radius-sm']).toBe('0.35rem');
    expect(ours.light['--text-xs']).toBe('0.72rem');
    expect(ours.light['--text-sm']).toBe('0.79rem');
    expect(ours.light['--text-base']).toBe('0.92rem');
    expect(ours.light['--breakpoint-xs']).toBe('30rem');
    expect(ours.light['--font-sans']).toContain('var(--font-inter)');
  });

  // 决定性校验：经典版源码存在时，逐项比对整套变量，防止手抄偏差。
  it('与经典版 globals.css 逐项比对（源码可用时）', () => {
    if (!existsSync(CLASSIC_GLOBALS)) return; // 源码目录不在当前机器时由内置期望覆盖
    const classicCss = readFileSync(CLASSIC_GLOBALS, 'utf8');
    const pairs: Array<[string, string]> = [
      [':root', '.classic-ui-root'],
      ['.dark', '.classic-ui-root.dark'],
      ['.panel', '.classic-ui-root .panel'],
      ['.dark .panel', '.classic-ui-root.dark .panel'],
    ];
    for (const [classicSelector, ourSelector] of pairs) {
      const classicVars = block(classicCss, classicSelector);
      const ourVars = block(themeCss, ourSelector);
      for (const [name, value] of Object.entries(classicVars)) {
        expect(ourVars[name], `${ourSelector} ${name}`).toBe(value);
      }
      expect(Object.keys(classicVars).length, `${ourSelector} 变量数`).toBeGreaterThan(5);
    }
  });
});
