# Runtime contract (US-008)

Pinned HQ Desktop OS runtime and setup dependency preflight.

Source of truth: [`runtime/manifest.json`](../runtime/manifest.json).  
Verifier: `pnpm prepare:runtime` → [`scripts/prepare-runtime.mjs`](../scripts/prepare-runtime.mjs).

## Sync engine

| Pin | Value |
| --- | --- |
| Package | `@indigoai-us/hq-cloud` |
| Version | **6.16.35** (exact; reviewed 6.16 minor line) |
| Integrity | `sha512-NX9i2mBVCsWesjeX0zyzBs3I3q9XRhn0aP/ptOqlKOAh7dgJc/HUQtUdJTWzuU8NlNAiaQDxtUjXghBxNX/L6w==` |
| License | MIT |
| Access | Public npm — no private source checkout required at runtime |

The companion loads the sync runner from the packaged dependency tree (`src/main/sync-child.ts`) under Electron with `ELECTRON_RUN_AS_NODE=1`. Launch does **not** call `npx`, does **not** download floating tags, and does **not** require a system-global Node binary.

Contributor engines remain `node >=22.12.0 <25` and `pnpm@10.28.2`. Electron 40 embeds its own Node (observed `v24.11.1` on this host) which stays inside that window.

## Setup toolchain (guided Linux x64)

Fresh setup installs a **private** toolchain under the app userData directory:

| Tool | Version | Provenance | License |
| --- | --- | --- | --- |
| Node | 22.17.0 | nodejs.org linux-x64 tarball + sha256 | MIT |
| HQ CLI | 5.109.6 (`@indigoai-us/hq-cli`) | public npm (cloud `~6.16.28`) | MIT |
| qmd | 2.5.3 (`@tobilu/qmd`) | public npm | MIT |
| yq | 4.47.1 | GitHub release binary + sha256 | MIT |
| jq | 1.8.1 | GitHub release binary + sha256 | MIT |
| Git | system | distro package / installer `Depends: git` | GPL-2.0 (system) |
| HQ Core template | 15.0.126 | GitHub release tarball + sha256 | see release archive |

Checksum verification runs before extract/install (`verifiedDownload` in `src/main/setup.ts`). Staging directories are app-owned and removed on failure. Automatic setup currently targets **linux/x64** only; other platforms can attach an existing HQ folder.

## Adapter audit (create-hq / hq-onboarding)

Before choosing the desktop setup adapter, public package metadata was audited:

| Package | Audited version | `hq-cloud` dependency | Decision |
| --- | --- | --- | --- |
| `create-hq` | 10.12.11 | `^5.19.1` | **Reject** — major 5 line, incompatible with 6.16.35 |
| `@indigoai-us/hq-onboarding` | 0.1.2 | `^5.1.0` | **Reject** — same major-5 conflict |
| `@indigoai-us/hq-cli` | 5.109.6 | `~6.16.28` | Compatible pin for CLI tools inside private toolchain |
| Owned guided setup | this repo | exact `6.16.35` | **Chosen** |

Resolution: do not embed `create-hq` or `hq-onboarding` as the companion setup path. Use owned guided setup (`setup.ts` / `setup-dependencies.ts`) plus the bundled `@indigoai-us/hq-cloud@6.16.35` sync engine so one compatible engine serves setup tools and realtime sync. Private Indigo source trees are not required to prepare or run the packaged app.

## Third-party notices (direct pins)

Application license: MIT (`LICENSE`).

Direct runtime/dev pins used by this companion (name → license):

- `@indigoai-us/hq-cloud` — MIT  
- `electron` — MIT  
- `react` / `react-dom` — MIT  
- `tar` — BlueOak-1.0.0  
- `jose` — MIT  
- `tailwindcss` / `@tailwindcss/vite` — MIT  
- `radix-ui` — MIT  
- `lucide-react` — ISC  
- `class-variance-authority` — Apache-2.0  
- Playwright / TypeScript / ESLint toolchain — Apache-2.0 / MIT as published  

Setup download licenses are listed in the toolchain table above. A fuller installer notices file for NSIS/AppImage/deb release packaging remains US-018.

## Child-process IPC and shutdown

### Linux (accepted for this story)

- Unit coverage: `tests/unit/sync-supervisor.test.ts` — private token IPC, stop-before-token-leak, ownership until close, bounded restart/backoff, pause clears pending restart.
- Runtime supervisor contract: `tests/runtime/supervisor.test.ts` — PRD modules, watch/both/event-push argv, NDJSON outcomes, exclusive lock constants.
- Packaged probe: `scripts/verify-sync-child.mjs` — Electron Node starts the shared engine, requires private token IPC, excludes concurrent CLI writers, cancels and releases the operation lock with no orphaned journal/token state.
- App shutdown gate: `src/main/shutdown.ts` blocks quit until owned cleanup finishes.
- Runtime payload test: `tests/runtime/payload.test.ts` forks an Electron-as-Node child, exchanges structured IPC events, stops it, and asserts exit with no leftover handle.
- Canonical modules: `src/main/sync/supervisor.ts`, `src/main/sync/protocol.ts`, `src/main/sync/ownership.ts`, `src/shared/sync.ts` (compat re-exports remain at `sync-supervisor.ts` / `sync-state.ts`).

### Windows / WSL2 (recorded, not blocking Linux AC)

Native Windows and WSL2 child IPC/shutdown matrix proof remains deferred (see `runtime/manifest.json` → `platformEvidence`). WSL2 runtime ownership is tracked under US-014. Linux evidence is sufficient to close the Linux slice of US-008; do not claim Windows/WSL passes from fixtures alone.

## Measured payload and idle memory

Recorded on the Linux development host during US-008 preflight (orders of magnitude; budgets enforced in `tests/runtime/payload.test.ts` and `runtime/manifest.json`):

| Artifact | Observed | Budget |
| --- | --- | --- |
| Installed `@indigoai-us/hq-cloud` tree | ~14.1 MiB | ≤ 25 MiB |
| `src/main/sync-child.ts` source | ~4.4 KiB | ≤ 20 KiB |
| Idle Electron-as-Node probe RSS | host-measured in test | ≤ 200 MiB |

Widen scope only after these budgets remain green on the target matrix.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm prepare:runtime
pnpm exec vitest run tests/runtime/payload.test.ts __tests__/stories/US-008.test.ts
pnpm typecheck
```
