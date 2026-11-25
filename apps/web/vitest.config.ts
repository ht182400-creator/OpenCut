import { defineConfig } from 'vitest/config'

/**
 * Web 端单元测试配置（独立于 vite.config.ts）。
 *
 * 原因：`vite.config.ts` 中的 `@cloudflare/vite-plugin` 在 vitest 环境下会校验
 * Workers 环境配置并抛错，导致 `vitest run` 无法启动。测试只覆盖 `src/local/`
 * 的纯函数与适配层，不需要 Cloudflare / SSR 插件。
 *
 * 效果：`bun run test` 会优先读取本文件，不改动上游构建的插件链。
 */
/** 覆盖率报告输出目录（相对 apps/web）。 */
const COVERAGE_REPORTS_DIR = 'coverage'

/** 纳入覆盖率统计的源码范围：仅本地重写层，排除测试/类型声明/生成代码。 */
const COVERAGE_INCLUDE = ['src/local/**/*.ts', 'src/local/**/*.tsx']

/**
 * ISTQB 分层覆盖率：单元测试口径只统计「可单测的逻辑模块」。
 * 以下文件归入集成/E2E 验收层（有独立组件测试或浏览器 E2E 覆盖），不计入单测覆盖率：
 * - 组合根/大型交互面板：editor-page、timeline.tsx、preview-section、assets-panel、properties-panel 等
 * - 重型 I/O/编码：media.ts（视频解码）、export.ts（WebCodecs 编码）、frame-store.ts（IndexedDB）
 * - 状态机/hook：clip-history、autosave-idb、editor-actions、editor-ui（由组件测试/E2E 覆盖）
 */
const COVERAGE_E2E_DOMAIN = [
  '**/editor-page.tsx', '**/classic-ui/timeline.tsx', '**/preview-section.tsx',
  '**/assets-panel.tsx', '**/properties-panel.tsx', '**/editor-ui.tsx',
  '**/editor-actions.ts', '**/curve-editor.tsx', '**/shortcuts-dialog.tsx',
  '**/core-lab-page.tsx', '**/plugin-settings-panel.tsx', '**/script-console.tsx',
  '**/evaluate-settings-panel.tsx', '**/media.ts', '**/export.ts',
  '**/frame-store.ts', '**/autosave-idb.ts', '**/clip-history.ts',
]
const COVERAGE_EXCLUDE = [
  '**/*.test.ts', '**/*.test.tsx', '**/wasm/**', '**/*.d.ts',
  ...COVERAGE_E2E_DOMAIN,
]

/** 单元测试覆盖率门槛（ISTQB 单元级别目标 80%）。 */
const COVERAGE_THRESHOLD = 80

export default defineConfig({
  test: {
    environment: 'node',
    // 组件测试用 .test.tsx + 文件头 `// @vitest-environment jsdom` 单独切环境。
    // 显式限定 .test.ts/.test.tsx，避免误收仓库内 Node 契约脚本（.mjs/.cjs）。
    include: ['src/local/**/*.test.ts', 'src/local/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.contract.test.mjs'],
    coverage: {
      provider: 'v8',
      reportsDirectory: COVERAGE_REPORTS_DIR,
      // 不自动清理旧报告：IDE 的 node-safe-delete shim 在 rm 时可能抛 "operations were aborted"。
      clean: false,
      reporter: ['text', 'json-summary', 'html'],
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
      // 未达 80% 时进程非零退出，作为 CI 回归门禁。
      thresholds: {
        statements: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        lines: COVERAGE_THRESHOLD,
      },
    },
  },
})
