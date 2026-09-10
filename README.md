# HQ Desktop OS

HQ Desktop OS is an open-source desktop companion for Windows and Linux. It will handle workspace setup, authentication, and sync, with native Windows as the default and WSL2 support planned.

This repository currently contains the TypeScript build foundation and a minimal Electron window. Workspace setup, authentication, sync, installers, and native platform verification are still pending. It does not connect to HQ services yet.

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

The browser and Electron suites will be added in US-007. Both commands currently fail with “No tests found”; they do not certify browser or native behavior. Browser tests cannot substitute for an Electron smoke test. Install Playwright's browser with `pnpm exec playwright install chromium` when adding browser coverage.

## Build boundaries

`src/main` compiles to `dist/main`, `src/preload` to `dist/preload`, and `src/renderer` to `dist/renderer`. Each has its own TypeScript configuration. The renderer has no Node types or privileged API access. The preload exposes only a version string. Electron runs with context isolation, sandboxing, and Node integration disabled; permission requests and new windows are denied.

Dependency versions and pnpm are pinned. `pnpm-workspace.yaml` requires packages to be at least 1,440 minutes old before resolution and permits install scripts only for Electron and esbuild. Commit `pnpm-lock.yaml` with dependency changes, then verify a frozen install, typecheck, lint, unit tests, and build. Do not use private registry dependencies or commit credentials.
