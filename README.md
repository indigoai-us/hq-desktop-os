# HQ Desktop OS

HQ Desktop OS is an open-source desktop companion for Windows and Linux. It will handle workspace setup, authentication, and sync, with native Windows as the default and WSL2 support planned.

This repository currently contains the TypeScript build foundation, a secure Electron shell, Tailwind + HQ theme tokens (system/light/dark), and a typed `PlatformClient` boundary. Workspace setup, authentication, sync, installers, and native platform verification are still pending. It does not connect to HQ services yet. See `docs/theme-tokens.md` for the styling contract.

## Develop

Use Node.js 22.12 or newer on the 22 or 24 release line, and pnpm **10.28.2**. Install that pnpm version with `npm install --global pnpm@10.28.2` if it is not already available. All dependencies come from the public npm registry; no organization credentials are required.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The renderer runs at `http://127.0.0.1:4173` with hot reload. The command fails if that port is occupied. In another terminal, run `pnpm dev:desktop` to compile the main and preload targets and open Electron against the running renderer. Restart this command after main or preload edits. A graphical desktop and Electron's OS libraries are required. Keep Electron's sandbox enabled.

## Commands

| Command | Contract |
| --- | --- |
| `pnpm dev` | Serve the renderer on loopback port 4173 with HMR. |
| `pnpm dev:desktop` | Compile main/preload, then launch Electron; requires `pnpm dev`. |
| `pnpm build` | Compile main and preload separately and build the renderer. This does not produce an installer. |
| `pnpm typecheck` | Check main, preload, and renderer independently. |
| `pnpm lint` | Run ESLint on source, tests, and configuration. |
| `pnpm test` | Run unit tests, including the desktop navigation boundary. Fails when no tests exist. |
| `pnpm test:e2e` | Run Playwright browser specs in `tests/e2e`; starts its own renderer server. |
| `pnpm test:electron` | Run Playwright native specs in `tests/electron`; requires a built app and graphical session. |
| `pnpm test:host-acceptance` | Physical pointer drag and resize, on a provisioned isolated host only. Not part of the default suites. |

`pnpm test:electron` builds and stages a real production runtime (`dist-runtime/`) and runs against it with the sandbox on, so `app.isPackaged` is genuinely true and no launch flag or `webPreferences` override is used to make a test pass. `pnpm test:e2e` runs the production renderer in a plain browser, which is the honest stand-in for “no Electron preload”. Browser tests cannot substitute for the native suite: window lifecycle, window chrome and renderer reachability are only proven natively. Install Playwright's browser with `pnpm exec playwright install chromium` before the browser suite.

CI is deferred: no workflow is committed on this branch and no CI run has verified this work. Physical titlebar drag, edge resize, native Wayland and all Windows behaviour remain unproven and are tracked in `docs/platform-boundary.md`.

## Build boundaries

`src/main` and `src/shared` compile into `dist/main` and `dist/shared`, `src/preload` into `dist/preload`, and `src/renderer` into `dist/renderer`. Each target has its own TypeScript configuration. The renderer has no Node types or privileged API access. The preload exposes `window.hqDesktop`, a small invoke-only bridge. Electron runs with context isolation, sandboxing, and Node integration disabled; permission requests and new windows are denied. IPC senders and payloads are validated in main. External links must match the reviewed HTTPS allowlist. Without preload, the UI fails closed and shows that native actions are unavailable instead of simulating success.

The packaged renderer is served from a confined `app://hq-desktop-os` origin rather than `file://`, so the renderer cannot read host files outside the `PlatformClient` boundary, and the File System Access API is switched off. The window keeps its native OS titlebar, controls, dragging and resize; the page repeats none of that, and Relaunch and Quit live in the application menu. See `docs/platform-boundary.md`.

Dependency versions and pnpm are pinned. `pnpm-workspace.yaml` requires packages to be at least 1,440 minutes old before resolution and permits install scripts only for Electron and esbuild. Commit `pnpm-lock.yaml` with dependency changes, then verify a frozen install, typecheck, lint, unit tests, and build. Do not use private registry dependencies or commit credentials.
