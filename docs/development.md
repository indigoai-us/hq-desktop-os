# Development preview

## Shared renderer preview

`pnpm dev` starts the Vite renderer on **`http://127.0.0.1:4173`** with
`--strictPort`. If that port is already taken, the command fails instead of
binding elsewhere — so Electron (`pnpm dev:desktop`) and contributors always
share one known origin.

| Fact | Location |
| --- | --- |
| URL | `http://127.0.0.1:4173` |
| Process ownership record | `.scratch/dev-preview.json` (pid, vitePid, url, startedAt) |
| Session log | `.scratch/dev-preview.log` |
| Launcher | `scripts/dev-server.mjs` (invoked by `pnpm dev`) |

`.scratch/` is gitignored. Each `pnpm dev` session overwrites the ownership
file for the active process. Stop that process before another session claims
4173.

Companion preview (simulated adapter):

```text
http://127.0.0.1:4173/dev/companion
http://127.0.0.1:4173/dev/companion?scenario=syncing
```

Component gallery (separate story): `http://127.0.0.1:4173/dev/components`.

## Simulated platform adapter

Development-only. Gated by `import.meta.env.DEV` **and** path `/dev/companion`.
Production builds drop the dynamic import; URL query, hash, and localStorage
cannot select the simulated adapter, and a missing Electron preload fails
closed instead of simulating success.

Required deterministic scenarios (`src/renderer/dev/scenarios.ts`):

| `?scenario=` | State |
| --- | --- |
| *(omitted)* / `signed-out` | Signed out, no workspace |
| `setup` | Guided setup in progress |
| `syncing` | Connected account, sync connecting |
| `reconciling` | Initial reconciliation pass |
| `pending` | Pending planned file changes |
| `connected` | Idle with live updates + last confirmed sync |
| `polling` | Idle on fallback polling |
| `offline` | Connected, waiting for a connection |
| `conflict` | One conflicting file listed |
| `paused` | Sync paused |
| `failure` | Sync error phase with recovery copy |
| `revoked-scope` | Selected company no longer authorized |

Also available: `setup-error`, `memberships-error`, Settings health fixtures
`health-healthy`, `health-degraded`, `health-stale`, `health-checking`,
`health-unavailable`, `health-unknown` (unknown maps to the unavailable UI),
US-016 diagnostics fixtures `runtime-missing` / `runtime-failed`, and US-017
background fixtures `no-tray` / `wsl-startup`.

The preview banner is marked **Preview · Changes here are not saved.** Use
**Reset preview** (or reload `/dev/companion` without a scenario) to return to
signed-out. Preview actions never touch HQ credentials or the network.

## Layout notes (US-005)

| PRD path | Actual |
| --- | --- |
| `src/renderer/platform/{index,browser,electron}.ts` | `src/renderer/platform.ts` + `src/shared/platform.ts` (typed boundary); simulated adapter lives under `src/renderer/dev/` |
| `src/renderer/dev/scenarios.ts` | Present |
| `scripts/dev-server.mjs` | Present; wraps Vite with ownership + log |
| `docs/development.md` | This file |

## Quick checks

```sh
pnpm dev
# → writes .scratch/dev-preview.json and .scratch/dev-preview.log
# → serves http://127.0.0.1:4173 with HMR

pnpm typecheck
pnpm test
pnpm test:e2e   # production renderer on 4319; never reuses 4173
```
