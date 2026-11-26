# OpenCut Desktop

Built with [GPUI](https://www.gpui.rs).

> [!NOTE]
> 状态更新（2026-11-25）：桌面端已完成 W-14 批 1~10，不再是「只打开一个窗口」。
> 已实现：项目加载（`--project` / `OPENCUT_PROJECT`，失败回退内嵌 fixture 并友好提示）、
> 四面板联动（Browser / Inspector / Timeline / Preview 共享 `ProjectState`）、播放控制与快捷键
> （Space/←/→/Home/End）、Inspector 五字段编辑写回（F2~F6，秒输入校验）、另存为（Ctrl+Shift+S）、
> 撤销/重做快照栈（Ctrl+Z / Ctrl+Shift+Z，50 条）、时间轴编辑（删/分/入/出，Delete/S/I/O）、
> OTIO 导入导出（`--otio` / Ctrl+E）。详细实证与截图见 [`../../roadmap/PRIORITY.md`](../../roadmap/PRIORITY.md) §2 W-14 批 1~10。
>
> 诚实边界：fixture `params` 为空，不编造颜色/位置映射；GPUI 0.2.2 无内置输入框，编辑用键盘草稿；
> 键盘/按钮端到端受 Windows 焦点竞争与 DPI 虚拟化未稳定复现（业务逻辑已单测覆盖）；
> 帧仍为 CPU BGRA 直传的 core 演示合成（wgpu 后半段后置）。

## Running

Rust is pinned in `.prototools` at the repo root (`proto use` installs it).

```sh
moon run desktop:dev     # cargo run
moon run desktop:check   # cargo check
moon run desktop:build   # cargo build --release
```

The first build compiles GPUI from source and takes a while. The root `Cargo.lock` is committed.

## Platform requirements

- **macOS**: Xcode command line tools (Metal renderer).
- **Windows**: no extra dependencies (Win32 + DirectWrite).
- **Linux**: renders via Vulkan (Blade), windows via Wayland or X11 (both enabled by default). System packages (Debian/Ubuntu names): `libvulkan1` + working Vulkan drivers, `libwayland-dev`, `libx11-xcb-dev`, `libxkbcommon-x11-dev`, `libfontconfig-dev`, plus a C toolchain and `cmake`.
- **WSL2/WSLg**: uses XWayland automatically when available. GPUI 0.2.2 requires `xdg_wm_base` v2–5, while WSLg advertises v1.
