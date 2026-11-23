# ocx-cli — OpenCut Headless CLI

无浏览器的命令行入口（W-13 第二批）：用 Rust 原生 `ocx-render` 渲染确定性合成帧、
检查经典版项目结构。与 WASM core 使用**同一份** `render_frame` 实现，因此对同一输入
产出像素级一致的指纹（跨栈对比见 `apps/local-mcp/server.test.mjs`）。

## 子命令

| 子命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `frame` | 渲染单帧为 PPM（P6, RGB8） | `--profile` `--params` `--frame-index` `--time-ticks` `--duration-ticks` `--out` `[--name]` |
| `batch` | 批量渲染 N 帧（帧 i 时间 = i × duration-ticks） | `--profile` `--params` `--count` `--duration-ticks` `--out` `[--name]` |
| `frame-png` | 渲染单帧为 PNG（RGBA8，保留 alpha；W-13 C 批） | 同 `frame` |
| `batch-png` | 批量渲染 N 帧为 PNG（RGBA8；W-13 C 批） | 同 `batch` |
| `audio-export` | planar f32 PCM → 16-bit PCM WAV（W-13 C 批） | `--pcm` `--out` |
| `project-info` | 输出经典版项目结构摘要（只读） | `--project` |
| `plugin-io` | 受控插件 I/O：加载 wasm 插件调用 effect（W-12 第八、九批上层入口） | `--wasm` `--manifest` `--payload` `[--file-root ns=路径 ...]` `[--network]` `[--effect]` |

`--profile` / `--params` 是 JSON **文件**（camelCase，与 MCP `ocx.render.frame` 的字段一致）；
stdout 输出一行 JSON 摘要（帧命令：`frameIndex` / `file` / `size` / `checksum`；音频命令：`frames` / `channels` / `sampleRateHz` / `size`），错误输出中文到 stderr
并以非零码退出。

PNG 为手写编码器（`src/_png.rs`，stored DEFLATE + CRC32/Adler32），WAV 为手写编码器
（`src/_wav.rs`，f32→i16 对称缩放），均无第三方图像/音频库；两者保留输入 alpha / 采样语义，
可与浏览器侧逐像素/逐采样对齐。同帧的 PNG 与 PPM 摘要一致（都取 RGBA 全字节的 FNV-1a）。
`--pcm` JSON 格式：`{"sampleRateHz":48000,"channels":[[0.0,0.5,...],[...]]}`（planar，采样归一到 [-1,1]）。

## 构建 / 运行 / 测试

```bash
cargo run -p ocx-cli -- project-info --project apps/web/public/fixtures/classic-project-v31.json
cargo run -p ocx-cli -- frame-png --profile <p.json> --params <a.json> --frame-index 0 --time-ticks 0 --duration-ticks 4000 --out <dir>
cargo run -p ocx-cli -- audio-export --pcm <pcm.json> --out <out.wav>
cargo run -p ocx-cli -- plugin-io --wasm <p.wasm> --manifest <manifest.json> --payload <input.json> --file-root assets=<dir> --effect effect_brightness
cargo test  -p ocx-cli
```

`plugin-io` 的 `--manifest` 中 `capabilities` 即 host 授予清单，`permissionScopes` 为授予 scope；
`--file-root ns=路径` 把 scope 命名空间绑定到宿主目录（可重复），`--network` 显式开启真实网络抓取。
未绑定目录 / 越权 scope 会由 `ocx-plugin-host` 以稳定错误码拒绝（如 `PATH_TRAVERSAL` / `SCOPE_DENIED`）。

零第三方图像/音频库（仅本仓库 crate 与 serde/serde_json）；PNG/WAV 均为手写编码。