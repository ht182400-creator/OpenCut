/**
 * E2E 验收脚本：SRT/ASS 字幕导入（ISTQB 验收测试级别）。
 * 运行前置：
 *   1. 已安装 ego-browser（ego lite）IDE 插件，且 `ego-browser` CLI 可用。
 *   2. 已构建 Web 产物（cd apps/web && bunx vite build）。
 * 运行：ego-browser nodejs -e "await import('file:///.../roadmap/e2e/caption-import.e2e.mjs')"
 * 验证点：上传真实 SRT → UI 状态「已导入 N 条字幕」→ autosave 中 caption 元素数量/时间正确。
 * 说明：脚本在自身进程内 spawn vite preview（用 localhost，避免服务被工具回收），结束后关闭。
 */

import { spawn } from 'node:child_process'

/** preview 服务地址（localhost 而非 127.0.0.1，后者在本机 fetch 失败）。 */
const BASE = 'http://localhost:4173'
/** 临时工作区脚本目录（ego-browser 的 taskSpace 需要可写目录）。 */
const EGO_DIR = 'C:/Users/ht182/ego/oc-captions-acceptance'
/** 验收用真实 SRT 文件（仓库内 fixture）。 */
const SRT_FIXTURE = 'e:/AI_Studio/OpenCut/roadmap/oc-captions-sample.srt'

/** 在脚本进程内启动 vite preview 并等待就绪。 */
const server = spawn('node', [
  'e:/AI_Studio/OpenCut/apps/web/node_modules/vite/bin/vite.js',
  'preview', '--port', '4173', '--strictPort',
], { cwd: 'e:/AI_Studio/OpenCut/apps/web', stdio: 'ignore' })

/** 轮询服务直到返回 200。 */
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try { if ((await fetch(BASE + '/')).ok) return true } catch { /* 服务未就绪，重试 */ }
  }
  return false
}

try {
  if (!await waitForServer()) throw new Error('vite preview 未就绪')
  const task = await taskSpace('opencut caption import E2E')
  const page = task.page('p1')
  await page.goto(BASE + '/')
  await page.waitForTimeout(1500)

  /** 绕过移动端门禁（默认视口窄）。 */
  async function bypassGate() {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Take a look anyway'))
      if (btn) btn.click()
    })
  }
  await bypassGate()
  await page.waitForSelector("button[title='项目菜单']", { timeout: 30000, state: 'visible' })

  /** 清除旧 autosave，保证基线干净。 */
  await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('opencut-autosave')
    req.onsuccess = () => resolve(true)
    req.onerror = () => resolve(false)
    req.onblocked = () => resolve(false)
  }))
  await page.reload()
  await page.waitForTimeout(1500)
  await bypassGate()
  await page.waitForSelector("button[title='项目菜单']", { timeout: 30000, state: 'visible' })

  /** 切到 Captions tab 并上传真实 SRT。 */
  await page.click("div:has-text('Captions')")
  await page.waitForTimeout(300)
  await page.setInputFiles('input[accept*=".srt"]', SRT_FIXTURE)
  await page.waitForTimeout(1500)

  const status = await page.evaluate(() => document.querySelector('[data-testid="captions-status"]')?.textContent)
  const autosave = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('opencut-autosave')
    req.onsuccess = () => {
      const tx = req.result.transaction('entries', 'readonly')
      const get = tx.objectStore('entries').getAll()
      get.onsuccess = () => {
        const texts = (get.result || []).map((r) => JSON.stringify(r.value ?? r))
        const found = texts.filter((t) => t?.includes('"elementType":"caption"'))
        resolve({ captionCount: found.length })
      }
      get.onerror = () => resolve({ captionCount: -1 })
    }
    req.onerror = () => resolve({ captionCount: -1 })
  }))

  const pass = status?.includes('已导入') && autosave.captionCount === 3
  console.log(JSON.stringify({ status, autosave, pass }, null, 2))
  if (!pass) process.exitCode = 1
} finally {
  server.kill('SIGTERM')
}
