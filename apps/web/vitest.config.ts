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
const COVERAGE_EXCLUDE = ['**/*.test.ts', '**/*.test.tsx', '**/wasm/**', '**/*.d.ts']

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
    },
  },
})
