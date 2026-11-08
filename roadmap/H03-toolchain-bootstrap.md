# H03 · 工具链安装与验证结果（已关闭，2026-11-08）

> 用户授权后已在本机实际安装并跑通全部验证。**唯一例外：`proto` 未装**（其二进制托管在 GitHub Releases，本机 HTTPS 连接持续被重置）；改用 moon 官方支持的 `MOON_TOOLCHAIN_FORCE_GLOBALS=true` 直接使用全局工具链，等价通过所有检查。

## 1. 实际安装

| 工具 | 安装方式 | 结果 |
| --- | --- | --- |
| Bun 1.3.11 | `npm install -g bun@1.3.11` | `bun 1.3.11` |
| moon 2.3.3 | `npm install -g @moonrepo/cli@2.3.3` | `moon 2.3.3` |
| Rust 1.97.0 | `rustup toolchain install 1.97.0 --profile minimal` + **项目级** `rustup override set 1.97.0` | `rustc 1.97.0` |
| 项目依赖 | 在 `apps/web`、`apps/api` 分别 `bun install` | 578 / 51 个包 |
| proto | 官方 PowerShell 脚本与 `curl` 直取 Release 包均失败 | **未安装（见 §2）** |

**修正两处此前的文档错误**：

1. 重写版仓库**根目录没有 `package.json`**，`bun install` 必须在 `apps/web` 与 `apps/api` 分别执行；
2. `moon ci` 默认以 `master` 为 base，本仓库分支是 `main`，手动运行需 `--base HEAD~1 --head HEAD`（或显式 `--base main`）。

## 2. proto 为何没装上（客观阻塞）

- `moonrepo.dev/install/proto.ps1` 的 GET 可成功（重试 2~3 次），但脚本内部要从 `github.com/moonrepo/proto/releases/.../proto_cli-x86_64-pc-windows-msvc.zip` 下载二进制；
- 该 Release 的 HTTPS 请求用 `curl.exe --retry 4` 仍返回 `Recv failure: Connection was reset`；
- `npm` 上名为 `proto-cli` 的包属于无关第三方项目，**不可作为替代**；`winget` 无 moonrepo 包。

因此不伪造 proto，也不把第三方包当官方 CLI 安装。

## 3. 关键环境要点

| 现象 | 处理 |
| --- | --- |
| 系统另有一套独立安装的 Rust 1.96，PATH 优先级高于 rustup shim，导致 `rustup override` 看似无效 | 把 `~/.cargo/bin` 置于 PATH 最前；验证 `rustc --version` = 1.97.0 |
| moon 的 JS toolchain 默认经 proto 安装 bun，日志卡在 `installing bun 1.3.11`，dev 服务起不来 | 设置 `MOON_TOOLCHAIN_FORCE_GLOBALS=true`，直接使用全局 bun |
| `local/crates/NOTICE.md` 被 moon 报「项目根是文件」 | glob 改为 `local/crates/*/`，并把该文件移到 `local/NOTICE.md`；警告消失 |
| Vite 8 首次启动约需 6 秒 + 依赖预构建 | 冒烟等待 30 秒后再请求，避免误判失败 |

## 4. 验证结果（全部实跑）

| 检查 | 结果 |
| --- | --- |
| `moon ci --base HEAD~1 --head HEAD ocx-time:test ocx-bridge:test ocx-editor-api:test` | `Tasks: 3 completed`，退出码 0 |
| `moon run ocx-time:test ocx-bridge:test` / `ocx-editor-api:test` | 均退出码 0 |
| `moon run web:dev` | Vite 8.3.6 ready，`http://localhost:5173` → **HTTP 200** |
| `moon run api:dev` | wrangler ready，`http://localhost:8787` → **HTTP 200 `{"status":"ok"}`** |
| `moon run desktop:check` | `cargo check` 退出码 0（22 个警告来自上游 GPUI 代码，非本次引入） |
| `cargo fmt --check` / `cargo clippy -D warnings` / `cargo test` | 三个 `ocx-*` crate 全绿 |
| `moon query projects` | 退出码 0，无项目发现警告 |

## 5. 复现命令（PowerShell，仓库根目录）

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"   # 让 rustup shim 优先
$env:MOON_TOOLCHAIN_FORCE_GLOBALS = 'true'             # 跳过 proto，使用全局工具

moon ci --base HEAD~1 --head HEAD
moon run web:dev        # 另开终端，等待约 30 秒后访问 5173
moon run api:dev        # 另开终端，访问 8787
moon run desktop:check
```

## 6. 后续（可选，不阻塞开发）

若 GitHub Releases 的 HTTPS 恢复，可补装官方 proto 并移除 `MOON_TOOLCHAIN_FORCE_GLOBALS`：

```powershell
irm https://moonrepo.dev/install/proto.ps1 | iex
& "$env:USERPROFILE\.proto\bin\proto.exe" setup
proto use     # 按 .prototools 固定 moon / bun / rust 版本
```

在此之前，`.prototools` 仍作为**版本基准文档**保留，实际版本由 npm 全局包与 rustup override 对齐，CI（GitHub Actions）中的 `moonrepo/setup-toolchain@v0` 仍按原配置工作。
