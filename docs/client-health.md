# Client health (US-022)

HQ Desktop OS implements a **local** client-health adapter compatible with the
shared support contract shapes. Production transport stays **gated off** until
release evidence lands.

## Attribution

- Client name: `hq-desktop-os` (`x-hq-client-name`)
- Not `hq-desktop-app` (macOS desktop) and not `hq-sync` (runner)
- Platform values stay in the closed set: `macos` | `windows` | `linux`
  (WSL reports as `linux` with an isolated install/sequence under
  `userData/client-health/wsl2/`)

## Modules

| Piece | Path | Behavior |
| --- | --- | --- |
| Contract + validation | `src/main/health/contract.ts` | Closed enums, bounded heartbeat/receipt parsing |
| Install id + sequence | `src/main/health/state.ts` | Persisted under app `userData` only; native/WSL isolated; outcome counters + engine watermark |
| Facts builder | `src/main/health/facts.ts` | Maps sync phase → health; keeps attempt / success / watermark distinct |
| Local-file facts | `src/main/health/local-files.ts` | Bounded metadata + TTL cache; no paths/content/tokens |
| Transport | `src/main/health/transport.ts` | `DisabledHealthTransport` default; HTTP POST only when gated |
| Heartbeat builder | `src/main/health/reporter.ts` | Builds validated payloads; send requires gate + auth token |
| Scheduler | `src/main/health/scheduler.ts` | Startup, every five minutes, debounced health changes |
| Nine probes | `src/main/health/probes.ts` | auth, runner, CLI, Core, updater, sync, conflicts, storage, permissions — 10s bound each (US-023) |
| CHECK_NOW ledger | `src/main/health/commands.ts` | ack → running → terminal; rejects expired/invalid (US-023) |
| Settings UI | `src/renderer/components/health-checks.tsx` | checking / healthy / degraded / stale / retry / unavailable |

## Reporting gate

Live POSTs to `/v1/client-health/heartbeat` require **both**:

1. `HQ_CLIENT_HEALTH_REPORTING=1`
2. A signed-in bearer token

Without the env gate the companion still builds and persists heartbeats locally.
Sign-out clears the auth token and stops authenticated reporting.

## Explicit non-claims

- **No live support-view proof** on Windows 11 / Ubuntu 24.04 / WSL2 yet.
- **No production heartbeats** unless the gate above is set (tests keep it off).
- Upstream support visibility / version floor for `hq-desktop-os` remains a
  release prerequisite in the owning backend repo.
- Browser/preview fixtures are **UI evidence only**.
- `prd.passes` for US-022 stays false until live support evidence exists.

## Privacy

Heartbeats and receipts carry only validated closed facts. They must not include
tokens, raw logs, customer paths, or file contents. Failed transport must never
block setup or sync. Local-file overview uses capped tail reads and a 15-minute
cache so ordinary heartbeats do not scan full journals on the UI thread.
