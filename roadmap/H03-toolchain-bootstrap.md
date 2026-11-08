# H03 · 工具链安装与验证清单

> 热点 H03（本机缺 `bun`/`moon`/`proto`、`rustc 1.96` 低于 `.prototools` 的 1.97）尚未关闭。
> 本文件给出**可复现的安装与验证步骤**。按你的偏好，大体积工具链由你自行下载执行，助手不擅自改全局环境。

## 1. 现状实测（2026-11-08）

| 项 | 结果 |
| --- | --- |
| `rustc` / `cargo` | 1.96.0（可编译 edition 2024，`cargo test` 已验证通过） |
| `bun` / `moon` / `proto` | NOT FOUND |
| `winget` / `rustup` | 可用 |
| `node` | v24.13.0 |
| `https://moonrepo.dev/install/proto.ps1` | **HEAD 超时**（当前网络不可达） |
| `https://bun.sh/install` | 200 |
| `https://static.rust-lang.org/dist/channel-rust-1.97.0.toml` | 200 |
| `https://registry.npmjs.org` | 200 |

**结论**：Rust 与 Bun 的下载源可达，唯一阻塞是 `moonrepo.dev` 安装脚本超时。可先用 `rustup` 独立升级 Rust，再等 proto 源恢复或用 winget 装 moon。

## 2. 安装命令（PowerShell，在仓库根目录执行）

```powershell
# ① 定点升级 Rust（不改动默认工具链，项目内由 proto shim 覆盖）
rustup toolchain install 1.97.0 --profile minimal

# ② 安装 proto（若安装源恢复）
irm https://moonrepo.dev/install/proto.ps1 | iex
# 若 shim 无法执行：
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# ③ 按 .prototools 固定版本安装 moon 2.3.3 / bun 1.3.11 / rust 1.97.0
proto use

# ④ 安装各 package.json 的依赖
bun install
```

`moonrepo.dev` 持续不可达时的替代路径：

- 用 `winget search moonrepo` / `winget search Oven-sh.Bun` 查找可用包；
- 或从 <https://moonrepo.dev/docs/proto/install> 与 <https://bun.sh/docs/installation> 获取官方离线包，手动放置到 `~/.proto` 后执行 `proto use`；
- `moon` 可独立安装，但版本必须与 `.prototools` 的 `2.3.3` 一致，否则任务图行为可能不同。

## 3. 验证清单

```sh
moon --version          # 期望 2.3.3
bun --version           # 期望 1.3.11
rustc --version         # 期望 1.97.0（proto shim 生效时）
moon ci                 # 三平台任务图，含三个 ocx-* crate 的 check/test
moon run web:dev        # localhost:5173
moon run api:dev        # localhost:8787
moon run desktop:dev    # GPUI 窗口
```

`moon ci` 应执行 `local/crates/ocx-{time,bridge,editor-api}/moon.yml` 的 `check` 与 `test` 任务；这三个任务目前**只经过 `cargo` 直接验证，尚未经 moon 实跑**。

## 4. H03 关闭标准

- [ ] 四个版本命令输出与 `.prototools` 一致；
- [ ] `moon ci` 全绿，且日志中出现三个 `ocx-*` 的 `check`/`test` 任务；
- [ ] 三个 dev 命令可访问；
- [ ] `HOTSPOTS.md` H03 状态改为「已完成」，`PRIORITY.md` 进度快照同步；
- [ ] 本文件标记为已完成并保留为复现文档。

## 5. 对当前进度的影响

H03 未关闭**不影响**已交付代码的可用性：`cargo test` / `fmt --check` / `clippy` 已用本机 1.96 全绿，契约与看板的 Node 测试也可运行。它只影响 `moon ci` 编排验证与 Web/API/桌面三端的启动冒烟，属于 W-01 的收尾项，不阻塞 W-03/W-05 的 Rust 侧开发。
