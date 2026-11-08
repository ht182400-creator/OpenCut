# H03 · 工具链安装与验证结果（已关闭，2026-11-08）

> 用户授权后由助手实际安装并跑通全部验证。**2026-11-08 追加：`proto 0.63.2` 也已装上**（经 GitHub API asset 端点下载官方二进制并通过 SHA-256 校验），`proto setup` 已固化 PATH，`proto use` 已纳管 bun/rust。唯一残留：proto 管理的 moon 2.3.3 预编译包仍受 GitHub Releases 限制，故 JS 任务继续建议使用 `MOON_TOOLCHAIN_FORCE_GLOBALS=true`。

## 1. 实际安装

| 工具 | 安装方式 | 结果 |
| --- | --- | --- |
| Bun 1.3.11 | `npm install -g bun@1.3.11` | `bun 1.3.11` |
| moon 2.3.3 | `npm install -g @moonrepo/cli@2.3.3` | `moon 2.3.3` |
| Rust 1.97.0 | `rustup toolchain install 1.97.0 --profile minimal` + 项目级 `rustup override` + 补装 rustfmt/clippy | `rustc 1.97.0` |
| **proto 0.63.2** | **GitHub API release asset 端点**下载官方 zip → SHA-256 校验 → 解压到 `~/.proto/bin` → `proto setup --no-modify-profile` | `proto 0.63.2`，PATH 已含 `~/.proto/bin` 与 `~/.proto/shims` |
| 项目依赖 | `apps/web`、`apps/api` 分别 `bun install` | 578 / 51 个包 |

**修正两处此前的文档错误**：根目录**没有 `package.json`**（依赖须在两个 app 分别安装）；`moon ci` 默认 base 为 `master`，本仓库是 `main`，手动运行需 `--base HEAD~1 --head HEAD`。

## 2. proto 是怎么装上的

前几轮失败的原因：官方 `install/proto.ps1` 内部从 `github.com/moonrepo/proto/releases/.../proto_cli-...zip` 下载，本机对该域名的 HTTPS 持续 `Connection was reset`；`gh release download` 还要求 `gh auth login`（未引导交互登录）；npm 的 `proto-cli` 是无关第三方包。

**成功路径**：

1. `api.github.com` 在本机可达（`Invoke-RestMethod /repos/moonrepo/proto/releases/latest` 返回 `v0.63.2`）；
2. 从 API 拿到 Windows 资产的 **asset id 与官方 digest**（`sha256:4f391772…aff93`，大小 14,854,248 字节）；
3. 请求 `https://api.github.com/repos/moonrepo/proto/releases/assets/<id>`，请求头 `Accept: application/octet-stream`，下载到临时目录（速率约 16–30 KB/s，耗时数分钟，工具调用超时但**后台进程继续下载**）；
4. 轮询文件到目标大小后，`Get-FileHash` 得到 `4F39177289667DE29AFE062DC982249475F838FB6A8101654B79D1BB086AFF93`，**与官方 digest 完全一致**；
5. `Expand-Archive` 解压，把 `proto.exe`、`proto-shim.exe` 复制到 `~/.proto/bin`；
6. `proto.exe setup --no-modify-profile` → `SUCCESS`，用户 PATH 固化；
7. `proto --version` → `proto 0.63.2`。

> 关键经验：`github.com` 被重置时，`api.github.com` 的 release asset 端点仍可能可用；**必须校验官方 SHA-256**，不能只凭文件大小判断完整。后台下载时工具可能返回空结果，应轮询产物而不是重下。

## 3. `proto use` 的结果

```
[rust] Rust 1.97.0 installed (1s)
[bun]  Bun 1.3.11 installed (1s)
[moon] Installing moon 2.3.3
[moon] Downloading pre-built archive moon_cli-x86_64-pc-windows-msvc.zip   ← 卡住
```

bun/rust 由 proto 秒级纳管（走可达的 registry/backend）；moon 的预编译包仍要 GitHub Releases，持续无响应，已终止该后台进程。因此：

- `~/.proto/tools/` 下已有 `bun`、`rust`、`proto`，`moon` 目录仅有 `remote-versions.json`；
- **JS 任务（web:dev / api:dev）仍建议设置 `MOON_TOOLCHAIN_FORCE_GLOBALS=true`**，让 moon 直接用全局 bun；不带该变量时 `web:dev` 会卡在下载；
- Rust 任务不受影响（不带该变量时 `moon run ocx-time:test` 退出码 0）。

## 4. 关键环境要点

| 现象 | 处理 |
| --- | --- |
| 系统另有一套独立 Rust 1.96 抢占 PATH | 把 `~/.cargo/bin` 置于 PATH 最前，rustup override 才生效 |
| moon JS toolchain 默认经 proto 拉 bun | JS 任务用 `MOON_TOOLCHAIN_FORCE_GLOBALS=true` |
| `local/crates/NOTICE.md` 被 moon 报「项目根是文件」 | glob 改 `local/crates/*/`，文件移到 `local/NOTICE.md` |
| Vite 8 首次启动约需 6 秒 + 依赖预构建 | 冒烟等待 30 秒再请求 |
| dev 冒烟会生成运行时状态 | 还原 `routeTree.gen.ts`、忽略 `.wrangler/`（`.codebuddy/` 按用户决定仍不忽略） |

## 5. 验证结果（全部实跑）

| 检查 | 结果 |
| --- | --- |
| `proto --version` / `proto setup` | `proto 0.63.2` / SUCCESS，PATH 已固化 |
| `moon ci --base HEAD~1 --head HEAD <三个 Rust 任务>` | `3 completed`，退出码 0 |
| `moon run web:dev` | Vite 8.3.6 ready，`localhost:5173` → **HTTP 200** |
| `moon run api:dev` | wrangler ready，`localhost:8787` → **HTTP 200 `{"status":"ok"}`** |
| `moon run desktop:check` | `cargo check` 退出码 0（22 个上游 GPUI 警告） |
| `cargo fmt --check` / `clippy -D warnings` / `cargo test` | 三个 `ocx-*` crate 全绿 |
| `moon query projects` | 退出码 0，无项目发现警告 |

## 6. 复现命令（PowerShell，仓库根目录）

```powershell
$env:PATH = "$env:USERPROFILE\.proto\shims;$env:USERPROFILE\.proto\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:MOON_TOOLCHAIN_FORCE_GLOBALS = 'true'   # JS 任务需要

proto --version
moon ci --base HEAD~1 --head HEAD
moon run web:dev        # 另开终端，约 30 秒后访问 5173
moon run api:dev        # 另开终端，访问 8787
moon run desktop:check
```

## 7. 剩余（不阻塞开发）

- proto 管理的 **moon 2.3.3** 未落盘；若 GitHub Releases 恢复，重跑 `proto use` 即可补齐，之后可移除 `MOON_TOOLCHAIN_FORCE_GLOBALS`。
- 也可寻找 proto 的 npm/cargo backend 配置来安装 moon（官方博客提到 0.57+ 支持，但本项目当前未配置）。
- `.prototools` 仍作为版本基准保留；CI 中的 `moonrepo/setup-toolchain@v0` 按原配置工作。
