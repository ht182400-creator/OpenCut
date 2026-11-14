# ocx-cli — OpenCut Headless CLI

无浏览器的命令行入口（W-13 第二批）：用 Rust 原生 `ocx-render` 渲染确定性合成帧、
检查经典版项目结构。与 WASM core 使用**同一份** `render_frame` 实现，因此对同一输入
产出像素级一致的指纹（跨栈对比见 `apps/local-mcp/server.test.mjs`）。

## 子命令

| 子命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `frame` | 渲染单帧为 PPM（P6, RGB8） | `--profile` `--params` `--frame-index` `--time-ticks` `--duration-ticks` `--out` `[--name]` |
| `batch` | 批量渲染 N 帧（帧 i 时间 = i × duration-ticks） | `--profile` `--params` `--count` `--duration-ticks` `--out` `[--name]` |
| `project-info` | 输出经典版项目结构摘要（只读） | `--project` |

`--profile` / `--params` 是 JSON **文件**（camelCase，与 MCP `ocx.render.frame` 的字段一致）；
stdout 输出一行 JSON 摘要（`frameIndex` / `file` / `size` / `checksum`），错误输出中文到 stderr
并以非零码退出。

## 构建 / 运行 / 测试

```bash
cargo run -p ocx-cli -- project-info --project apps/web/public/fixtures/classic-project-v31.json
cargo test  -p ocx-cli
```

零第三方依赖（仅本仓库 crate 与 serde/serde_json）。