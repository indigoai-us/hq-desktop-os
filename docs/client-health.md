# Client health (scaffold)

HQ Desktop OS implements a **local** client-health adapter compatible with the
shared support contract shapes. This document describes what is scaffolded
today and what is **not** claimed yet.

## Attribution

- Client name: `hq-desktop-os` (`x-hq-client-name`)
- Not `hq-desktop-app` (macOS desktop) and not `hq-sync` (runner)
- Platform values stay in the closed set: `macos` | `windows` | `linux`
  (WSL reports as `linux` with isolated install state)

## What this scaffold includes

| Piece | Path | Behavior |
| --- | --- | --- |
| Contract + validation | `src/main/health/contract.ts` | Closed enums, bounded heartbeat/receipt parsing |
| Install id + sequence | `src/main/health/state.ts` | Persisted under app `userData` only |
| Heartbeat builder | `src/main/health/reporter.ts` | Builds validated payloads; transport **default off** |
| Nine probes | `src/main/health/probes.ts` | auth, runner, CLI, Core, updater, sync, conflicts, storage, permissions — 10s bound each |
| CHECK_NOW ledger | `src/main/health/commands.ts` | ack → running → terminal; rejects expired/invalid; no mutating repairs |
| Settings UI | `src/renderer/components/health-checks.tsx`, `src/renderer/screens/settings.tsx` | checking / healthy / degraded / stale / retry / unavailable |
| Preview scenarios | `?scenario=health-healthy\|health-degraded\|health-stale\|health-checking` | UI fixtures only |

Unsupported or absent components return **skip/unknown**, never a fake pass.
The permissions probe may create and remove a temporary marker file only.

## Explicit non-claims

- **No live support CHECK_NOW round trip** is claimed by this scaffold.
- **No production heartbeats** are sent unless reporting is explicitly enabled
  **and** a valid auth token is present (tests keep both off).
- Browser/preview fixtures are **UI evidence only**; native Windows / Ubuntu /
  WSL2 live verification remains a release gate for US-022 / US-023.
- `prd.passes` for US-022 / US-023 stays false until that live evidence exists.

## Privacy

Heartbeats and receipts carry only validated closed facts. They must not include
tokens, raw logs, customer paths, or file contents. Failed transport must never
block setup or sync.
