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
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/local/**/*.test.ts'],
  },
})
