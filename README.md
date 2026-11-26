<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="https://assets.opencut.app/branding/symbol.svg" alt="OpenCut Logo" width="100" />
    </td>
    <td align="right">
      <h1>OpenCut</h1>
      <h3 style="margin-top: -10px;">A free and open source video editor for web, desktop, and mobile.</h3>
    </td>
  </tr>
</table>

[![Discord](https://img.shields.io/discord/1386309140057690133?label=Discord&logo=discord&logoColor=fff&color=5865F2&style=flat)](https://discord.gg/zmR9N35cjK)
[![X](https://img.shields.io/badge/follow-%40opencutapp-000?logo=x&logoColor=fff&style=flat)](https://x.com/opencutapp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

## Status

**OpenCut is being rewritten from the ground up.** What's coming:

- An Editor API
- First-class third party plugins (made possible by a plugin-first architecture)
- Desktop, mobile, and browser from one codebase (Rust core)
- MCP server (for AI agents)
- Headless mode (automation, batch rendering)
- A scripting console (already available on the `/core-lab` verification page; an in-editor scripting tab is still to come)

You can still find the previous version at [opencut-app/opencut-classic](https://github.com/opencut-app/opencut-classic), which is the one to reach for today. [opencut.app](https://opencut.app) still runs the classic version. The rewrite will live at [new.opencut.app](https://new.opencut.app) until it's ready to take over.

## Development

Install [proto](https://moonrepo.dev/proto) if you haven't already:

**Linux, macOS, WSL:**

```sh
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

**Windows (PowerShell):**

```powershell
irm https://moonrepo.dev/install/proto.ps1 | iex
```

If shims fail to run, allow local scripts for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

From the repo root:

```sh
proto use    # installs the tools pinned in .prototools
```

```sh
moon run web:dev       # localhost:5173
moon run api:dev       # localhost:8787
moon run desktop:dev   # see apps/desktop/README.md
```

On Windows you can also double-click `start-web.bat` in the repo root. It kills any leftover Vite processes from this project before starting a single server on `localhost:5173`, so repeated launches never pile up on 5174/5175. The cleanup is delegated to `clean-vite.ps1` (matches the project's `vite.js` path in the command line, port-independent). Keep the window open while the server runs; pressing Ctrl+C stops it.

## Testing

The project follows ISTQB test levels and ISO/IEC 29119 test processes. Run the full suite (7 suites, 1095 cases across TypeScript Web, Elysia API, Rust workspace, and Node cross-language contracts) with one command:

```powershell
.\run-tests.ps1                       # Windows (also collects coverage)
.\run-tests.ps1 -Only rust            # single layer: web | api | rust | node-contracts
.\run-tests.ps1 -SkipCoverage $true   # faster, no coverage
```

Individual layers (cross-platform):

```bash
cd apps/web && node node_modules/vitest/vitest.mjs run --coverage  # 696 cases, 80% coverage gate
cd apps/api && bun test src/index.test.mjs                         # 10 API route cases
cargo test --workspace                                              # 236 Rust cases
node roadmap/compat.test.cjs && node roadmap/dashboard.test.cjs    # Node contract suites
```

Coverage: the Web unit-test scope enforces an 80% threshold on statements/branches/functions/lines (currently 89.68% / 84.53% / 93.60% / 90.78%); integration/E2E-domain files (composition root, heavy I/O) are covered by component tests and the browser E2E script instead. Rust coverage is collected via `cargo llvm-cov test --workspace --summary-only` (72.79% lines).

See [roadmap/TEST_STANDARD.md](roadmap/TEST_STANDARD.md) for the standard mapping and [roadmap/TEST_REPORT_2026-11-26_覆盖率达标与遗留清理.md](roadmap/TEST_REPORT_2026-11-26_覆盖率达标与遗留清理.md) for the latest results. The browser E2E acceptance script lives at [roadmap/e2e/caption-import.e2e.mjs](roadmap/e2e/caption-import.e2e.mjs).

## Contributing

We're not set up to take outside contributions yet while the architecture is being designed. If you want to follow along, ask questions, or just hang out, [join the Discord](https://discord.gg/zmR9N35cjK) or [open an issue](https://github.com/opencut-app/opencut/issues).

## Sponsors

OpenCut is supported by companies that believe in open source creator tools.

- [**fal.ai**](https://fal.ai?utm_source=github-opencut&utm_campaign=oss): Generative image, video, and audio models all in one place.

Want your logo here? Reach out at [sponsor@opencut.app](mailto:sponsor@opencut.app).

## License

[MIT](LICENSE)
