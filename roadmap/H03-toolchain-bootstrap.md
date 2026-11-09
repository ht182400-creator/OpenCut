# H03 · 工具链安装与验证结果（已完全关闭，2026-11-08）

> **最终结论**：`bun 1.3.11` / `moon 2.3.3` / `rust 1.97.0` 全部由 `proto 0.63.2` 统一管理，`proto use` 秒级完成；**`MOON_TOOLCHAIN_FORCE_GLOBALS` 已不再需要**，不设任何旁路变量时 `moon ci`、`web:dev`、`api:dev`、`desktop:check` 全部通过。
> 关键突破：本机 `github.com/.../releases/download` 被重置，但 **`api.github.com` 的 release asset 端点可用**；proto 与 moon 的官方二进制均由此下载并通过 SHA-256 校验。

## 1. 最终状态

| 工具 | 版本 | 管理方式 |
| --- | --- | --- |
| proto | `0.63.2` | 官方 zip → `~/.proto/bin` → `proto setup --no-modify-profile` 固化 PATH |
| moon | `2.3.3` | 官方 zip → `~/.proto/tools/moon/2.3.3/` + `manifest.json` → shims 生成 `moon.exe` / `moonx.exe` |
| bun | `1.3.11` | `proto use` 纳管 + 全局 npm 备份 |
| Rust | `1.97.0` | `rustup` + 项目级 override + `~/.cargo/bin` 置 PATH 最前 + rustfmt/clippy 组件 |
| 项目依赖 | 578 / 51 包 | `apps/web`、`apps/api` 分别 `bun install`（根目录**没有** `package.json`） |

## 2. 网络限制与绕行方案

| 通道 | 结果 |
| --- | --- |
| `github.com/moonrepo/{proto,moon}/releases/download/...` | HTTPS 持续 `Connection was reset`（`curl --retry 4` 也失败） |
| `moonrepo.dev/install/proto.ps1` | GET 可成功（需重试），但脚本内部仍走上面的下载域名 → 失败 |
| `gh release download` | 需要 `gh auth login` / `GH_TOKEN`，未引导交互登录 |
| npm `proto-cli@2.0.0` | 无关第三方包（marquee/proto），**不可顶替** |
| **`api.github.com/repos/<owner>/<repo>/releases/assets/<id>`** | **可达**，请求头 `Accept: application/octet-stream` |

标准流程（两次均验证）：

1. 从 `releases/latest` 或 `releases/tags/<tag>` 读取资产的 **id / size / `digest`**；
2. 请求 asset 端点下载到系统临时目录。速率约 60–80 KB/s，15 MB 需 3–5 分钟；**用后台进程下载并轮询文件大小**，不要因工具调用超时而重下；
3. `Get-FileHash` 与官方 `digest` 逐字节比对，一致才解压；
4. 按目标工具的目录约定安装。

| 包 | asset id | size (B) | 官方 digest | 实测结果 |
| --- | --- | --- | --- | --- |
| `proto_cli-x86_64-pc-windows-msvc.zip` (v0.63.2) | 664938838 | 14,854,248 | `sha256:4f391772…86aff93` | `4F39177289667DE29AFE062DC982249475F838FB6A8101654B79D1BB086AFF93` ✅ |
| `moon_cli-x86_64-pc-windows-msvc.zip` (v2.3.3) | 444099103 | 15,466,786 | `sha256:5dafe242…ab37e6f` | `5DAFE242F0ED923CB6F76ADA8757AD5800CED13DF606EAF2399BC80DAAB37E6F` ✅ |

## 3. proto 补装

解压后把 `proto.exe` / `proto-shim.exe` 复制到 `~/.proto/bin`；`proto.exe setup --no-modify-profile` → `SUCCESS`，用户 PATH 已含 `~/.proto/bin` 与 `~/.proto/shims`；`proto --version` = `0.63.2`。`proto use` 当场纳管 bun 1.3.11 与 rust 1.97.0，但卡在 moon 的预编译包下载。

## 4. moon 2.3.3 补装（本轮完成）

1. 下载并校验官方 zip（见 §2），解压得到 `moon.exe`（34,676,224 B）、`moonx.exe`、`README.md`、`LICENSE`、`CHANGELOG.md`。
2. **二进制交叉校验**：官方 zip 内的 `moon.exe` 与 npm 全局包 `@moonrepo/cli@2.3.3` 中的 `moon.exe` SHA-256 **完全相同**，均为 `6C664329A2DC2520E8D73DD2EACCAD148CA38A8DC9C9DBE877934A7FDC14777A`——两条独立通道拿到同一份官方二进制。
3. 按已成功安装的 `~/.proto/tools/bun/manifest.json` 结构，把文件放到 `~/.proto/tools/moon/2.3.3/` 并写 `manifest.json`（`installed_versions` / `shim_version` / `versions.<v>.lock.{os,arch,checksum,source}`）。
4. **踩坑**：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 **BOM**，proto 报 `json::parse_file: expected value at line 1 column 1`。改用 `[System.IO.File]::WriteAllText(path, json, (New-Object System.Text.UTF8Encoding($false)))` 写无 BOM UTF-8，首字节为 `{`(123) 即正确。
5. 重跑 `proto use` → **`Installed bun, rust, and moon in 1 second!` / SUCCESS**，不再触发任何下载；`~/.proto/shims/` 生成 `moon.exe`、`moonx.exe`。

## 5. 决定性验证（**未设置 `MOON_TOOLCHAIN_FORCE_GLOBALS`**）

| 检查 | 结果 |
| --- | --- |
| `proto --version` / `moon --version` / `bun --version` / `rustc --version` | `0.63.2` / `2.3.3` / `1.3.11` / `1.97.0` |
| `proto use` | SUCCESS，1 秒，三个工具全部已安装 |
| `moon ci --base HEAD~1 --head HEAD <三个 Rust 任务>` | 退出码 0（缓存命中 / 无受影响任务） |
| `moon run web:dev` | Vite 8.3.6 ready → `localhost:5173` **HTTP 200** |
| `moon run api:dev` | wrangler 4.158.0 ready → `localhost:8787` **HTTP 200 `{"status":"ok"}`** |
| `moon run desktop:check` | `cargo check` 退出码 0（22 个上游 GPUI 警告） |
| `cargo fmt --check` / `clippy -D warnings` / `cargo test` | 三个 `ocx-*` crate 全绿 |

## 6. 复现命令（PowerShell，仓库根目录）

```powershell
$env:PATH = "$env:USERPROFILE\.proto\shims;$env:USERPROFILE\.proto\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"

proto use                         # 全部秒级完成
moon ci --base HEAD~1 --head HEAD
moon run web:dev                  # 另开终端，约 30 秒后访问 5173
moon run api:dev                  # 另开终端，访问 8787
moon run desktop:check
```

**不再需要** `MOON_TOOLCHAIN_FORCE_GLOBALS=true`；若曾设置过，取消即可。

## 7. 历史踩坑（保留供排障）

| 现象 | 处理 |
| --- | --- |
| 系统另有一套独立 Rust 1.96 抢占 PATH | 把 `~/.cargo/bin` 置于 PATH 最前，rustup override 才生效 |
| 根目录没有 `package.json` | `bun install` 必须在两个 app 目录分别执行 |
| `moon ci` 默认 base=`master`，本仓库是 `main` | 显式 `--base HEAD~1 --head HEAD` |
| `local/crates/NOTICE.md` 被 moon 报「项目根是文件」 | glob 改 `local/crates/*/`，文件移到 `local/NOTICE.md` |
| Vite 8 首次启动约 6 秒 + 依赖预构建 | 冒烟等待 30 秒再请求 |
| dev 冒烟产生生成文件与运行时状态 | 还原 `routeTree.gen.ts`、忽略 `.wrangler/`（`.codebuddy/` 按用户决定仍不忽略） |
| PowerShell 5.1 写 JSON 带 BOM | 用 `UTF8Encoding($false)` 写无 BOM 文件 |

## 8. 结论

H03 **无遗留项**：四件套版本与 `.prototools` 完全对齐，`moon ci` 与三端冒烟均不依赖任何旁路变量；上游同步与日常开发按 `README.md` §7 正常进行。

## 9. 追加：W-06 的 WASM 工具链（2026-11-09）

Web 绑定薄层需要把 Rust core 编译到 `wasm32-unknown-unknown`，再用 `wasm-bindgen` 生成 Web glue。本机原先只有 `x86_64-pc-windows-msvc` target，也没有 CLI。

| 步骤 | 做法 |
| --- | --- |
| target | `rustup target add wasm32-unknown-unknown`（rust-std 组件，本机一次装好） |
| CLI | 版本必须与 crate 依赖**严格一致**；`local/crates/ocx-bindings-wasm/Cargo.toml` 固定 `wasm-bindgen = "=0.2.130"`，CLI 用同版本官方 Windows 预编译包。经 §2 已验证的 `api.github.com` release asset 端点下载，校验 SHA-256 与官方 digest 一致后解压到 `~/.cargo/bin`；未从源码编译、未用第三方同名包 |
| 构建 | `cargo build -p ocx-bindings-wasm --target wasm32-unknown-unknown --release` |
| 生成 glue | `wasm-bindgen --target web --out-dir apps/web/src/local/wasm target/wasm32-unknown-unknown/release/ocx_bindings_wasm.wasm` |
| 静态资源 | 把 `ocx_bindings_wasm_bg.wasm` 复制到 `apps/web/public/wasm/`；适配层用 `init({ module_or_path })` 显式指定该 URL |

**产物与更新约定**：`apps/web/src/local/wasm/` 存放 glue JS、`.d.ts` 与 wasm（供类型检查和 Node 契约测试），`apps/web/public/wasm/` 存放浏览器实际加载的 wasm；两份内容相同，Git 按内容去重。改动 `ocx-bindings-wasm` 的 Rust 源码后必须重跑上述两条命令并重新提交产物，否则前端仍加载旧 core。

**CI 边界**：`ocx-bindings-wasm/moon.yml` 只定义 native 的 `check` / `test` 任务，不把 wasm 构建放进 `moon ci`，避免 CI 机器缺少 wasm target 与 CLI 而失败；wasm 构建是显式命令，由 `editor-wasm.contract.mjs` 对产物做端到端校验。

**前端验证环境的两个上游既存问题**（非本次引入）：`vite.config.ts` 的 Cloudflare 插件在 vitest 环境下会校验 Workers 配置并报错，因此新增独立的 `apps/web/vitest.config.ts`（`bun run test` 会优先读取，不影响 `vite build`）；`tsc --noEmit` 全量检查另有 3 个错误位于 `apps/web/src/components/ui/*`，本次新增文件 0 错误。
