# Platform boundary

HQ Desktop OS keeps privileged work in the Electron main process. The renderer talks to the host only through a small typed `PlatformClient`.

## Security defaults

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`
- Permission requests and permission checks are denied
- New windows and webviews are blocked
- In-window navigation must stay on the renderer origin (the dev preview, or the packaged `app://hq-desktop-os` UI). `will-navigate` refuses the navigation, and a `did-navigate` fail-safe returns the window to the renderer entry for the cases Chromium commits without raising `will-navigate` (notably `about:blank`)
- Content-Security-Policy is applied in the HTML document and again from the main-process session
- Production packaged CSP drops the Vite HMR websocket allowlist
- The File System Access API (`showOpenFilePicker`, `showDirectoryPicker`, `showSaveFilePicker`) is switched off via `disableBlinkFeatures`, and the session denies every permission request and permission check

Installers land in US-018; this story does not ship installers.

## The packaged renderer origin

The packaged UI is served from a registered standard scheme, `app://hq-desktop-os`, not from `file://`.

This is a security boundary, not a cosmetic choice. For a `file:` document, CSP `'self'` resolves to the whole `file:` scheme, so a renderer with script execution can `fetch()` or `XMLHttpRequest` any absolute path on the host and read it — unmediated filesystem access that bypasses `PlatformClient` entirely, while `filesystemSelectDirectory` is deliberately failing closed. A standard, secure scheme gives the document a real origin, so `'self'` names exactly this app's assets.

`src/main/app-protocol.ts` maps an `app://` URL onto one file under the built renderer directory, or refuses. It refuses:

| Refusal | Example |
|---|---|
| `bad_scheme` | `file:///etc/passwd` |
| `bad_host` | `app://evil.example/index.html` |
| `has_credentials` | `app://user:pass@hq-desktop-os/index.html` |
| `has_query` | `app://hq-desktop-os/index.html?x=1` |
| `bad_encoding` | `app://hq-desktop-os/%2e%2e/main/index.js` |
| `escapes_root` | `../main/index.js`, `//unc-share/x.js`, `/C:/Windows/win.ini` |
| `unsupported_type` | anything outside the renderer bundle's file types |

Traversal checks run against the path **as requested**, because both `new URL()` and Chromium collapse `..` and `%2e%2e` before the handler would otherwise see them. Containment is re-checked after `realpath`, so a symlink inside the renderer directory cannot point outside it. Main, preload and every other packaged file live outside the renderer root and are therefore unreachable from the renderer.

`tests/electron/us-002-renderer-reachability.spec.ts` proves both halves against the staged production runtime: the app's own assets load, and local files, the app's own main/preload bundles, foreign `app://` hosts and all network egress are refused.

## Window chrome

The window keeps the native OS frame (`frame: true`). The platform supplies the titlebar, the minimize / maximize / close controls, dragging, edge and corner resize, snapping, the window menu and screen-reader window semantics; the app draws none of it and maintains no per-platform control glyphs.

Consequently the renderer repeats none of it: there is no in-app app-name title and no in-app window-control row. Appearance (system/light/dark) is the only chrome-adjacent control on the page; it does not duplicate OS window buttons. The `windowMinimize` / `windowMaximizeToggle` / `windowClose` channels remain part of the typed boundary and keep their native tests, so a custom titlebar remains possible later without re-deriving them.

Packaged builds ship an authored application menu (`src/main/menu.ts`) instead of Electron's default one. The default menu is an unreviewed surface that hands end users Reload and Toggle Developer Tools (F12, Ctrl+Shift+I) in production. The authored menu carries File (Relaunch, Quit), Edit and Help (Documentation), exposes no `reload`, `forcereload` or `toggledevtools` role, and is not labelled with the product name — the titlebar already carries that. Development keeps Electron's default menu so contributors retain Reload and DevTools against the localhost dev server.

## Running the production runtime locally

`pnpm build && pnpm stage:runtime` assembles `dist-runtime/`: the Electron binary renamed to `hq-desktop-os`, with the compiled app under `resources/app`. Because the executable is no longer named `electron`, `app.isPackaged` is genuinely true and the app takes its production branches — the `app://` renderer, the authored menu and the packaged CSP — with no overrides. Native acceptance tests launch this artifact; they never patch `webPreferences` or pass `--no-sandbox`.

## IPC

Preload exposes `window.hqDesktop` with `kind: 'electron'` and an `invoke` function limited to the frozen `hq:platform:*` channel list.

The preload ships as a single self-contained CommonJS bundle (`vite.preload.config.ts`). A sandboxed preload only receives a small polyfilled `require`, so a relative `require` for shared code silently fails, leaves `window.hqDesktop` undefined, and pins the app to its unavailable state. Keep `electron` as the only runtime require in `dist/preload/index.js`.

Main handlers:

1. Reject destroyed senders, non-main frames, and frames whose URL is outside the renderer entry
2. Validate payloads (for example `openExternal` requires `{ url: string }` within length bounds)
3. Perform the native action or return a structured failure

Malformed or untrusted invokes return `{ ok: false, error }` rather than throwing across the boundary. A *rejected* invoke is contained the same way: `createElectronPlatformClient` catches it and returns `{ ok: false, error: { code: 'unavailable' } }`, so nothing escapes the `PlatformResult` contract. The UI shows a pending state before each action for the same reason — a slow or failing action can never leave an earlier success on screen.

`tsconfig.preload.json` is typecheck-only and sets `noEmit`. If it could emit, a bare `tsc -p tsconfig.preload.json` would overwrite `dist/preload/index.js` with a build containing `require('../shared/platform.js')` — a require a sandboxed preload cannot resolve, which silently drops `window.hqDesktop`.

## External links

`shell.openExternal` and window-open requests accept **exact** reviewed HTTPS hrefs from `REVIEWED_HTTPS_LINKS` in `src/shared/platform.ts`. Add a link only after review. Schemes other than `https:`, credentials in the URL, and hashes are refused.

## Fail closed without preload

If the preload bridge is missing, `resolvePlatformClient` returns an `availability: 'unavailable'` client. Every method fails with `code: 'unavailable'`. The renderer shows that state, disables every native control, and answers a requested native action ("Check native connection") with the unavailable error instead of a simulated success. A plain browser behaves the same way because it has no preload; `pnpm test:e2e` proves it against the production build on port 4319.

## Reserved native surfaces

Filesystem, credentials, managed processes, and updater methods exist on the interface so later stories can fill them in. In this build they return `not_implemented` from main (or `unavailable` without preload). They must not report success until a real implementation exists.

## Test surfaces

| Command | Proves |
| --- | --- |
| `pnpm test` | Platform boundary behaviour and built-artifact contracts (vitest) |
| `pnpm test:e2e` | Production renderer with no preload, in a real browser on port 4319 |
| `pnpm test:electron` | The staged production runtime: security preferences, IPC validation, external links, window lifecycle |
| `pnpm test:acceptance` | Both default acceptance suites |
| `pnpm test:host-acceptance` | Physical pointer drag and edge resize, on a provisioned isolated host only |

`pnpm test:host-acceptance` is deliberately not part of `pnpm test:acceptance`. It injects real pointer input at real screen coordinates, so it must never run against a live user desktop. On a host that cannot apply injected input it fails with the measured reason instead of skipping.

The Electron sandbox is never disabled to make a test pass.

## Outstanding platform proof

None of the following is claimed as passing anywhere in this repo.

| Gap | State | What would close it |
| --- | --- | --- |
| Physical titlebar drag and edge/corner resize | Unproven on every host | `pnpm test:host-acceptance` on a provisioned isolated X11 host, or CI under Xvfb. The local desktop is a Wayland session where XTEST calls succeed but the events are discarded, and hijacking a live user's pointer is not acceptable. |
| Windows native behaviour | No evidence of any kind | A Windows run of `pnpm test:electron`, plus a Windows 11 desktop run for release. Hosted Windows Server in CI would not by itself establish Windows 11 desktop behaviour. |
| Windows external-link handoff | No fixture exists | A Windows equivalent of `tests/electron/us-002-external-handoff.spec.ts`. The Linux spec is selected by platform in `playwright.electron.config.ts`, so no Windows skip is reported as a pass. |
| Native Wayland windowing | Unproven | Everything measured so far is the X11/XWayland path. |
| Live WSL2 discovery / dual-ownership on Windows | Contract + parser tests only | Run `discoverWslDistributions` against real `wsl.exe` on Windows 11 with absent, stopped, WSL1, and WSL2 distros; prove alias conflict UX without a second watcher (US-014 owns runtime). |

## Workspace registry (US-009 Linux slice)

Linux attaches persist `root`, `environment`, `wslDistro` (null on native), and stable `installationId` atomically under `userData/workspaces.json` (`src/main/workspaces.ts`). Canonical aliases resolve through `realpath`; dual ownership of one physical root across environments is rejected. WSL listing lives in `src/main/platform/wsl-discovery.ts` and stays fail-closed on non-Windows hosts with an actionable unavailable state — it does not invent a Linux WSL runtime.

## Credential lifecycle (US-010 Linux slice)

Browser PKCE + bounded loopback (`src/main/auth.ts`) verifies Cognito identity before membership load and sync. Persisted credentials use Electron `safeStorage` via `CredentialStore` (`src/main/credential-store.ts`); Linux `basic_text` fails closed. Desktop storage is `userData/account.encrypted` and is proven isolated from the shared CLI token cache at `~/.hq/cognito-tokens.json`. Renderer snapshots expose only `PublicAccount` / credential availability (`src/shared/auth.ts`, `src/renderer/screens/account.tsx`) — never tokens. Sign-out stops sync and clears owned credentials without deleting workspace files. Windows Credential Manager / DPAPI acceptance stays deferred.

## Guided setup and company selection (US-011 Linux slice)

Owned guided setup journals step outcomes under `userData/setup.json` (`src/main/setup-state.ts`). App restart converts in-flight `working` steps to retryable `error` via `recoverInterruptedSetup` without clearing completed steps; cancel aborts owned processes and leaves the same resume path. Company selection loads authenticated memberships after sign-in; failed discovery sets `memberships.status = 'error'` with an explicit retry control and never presents as a successful empty company list. Create-company and accept-invite open the existing HQ console flows (`https://hq.computer/signup/team`, `https://hq.computer/onboarding`); returning window focus refreshes memberships. Windows guided setup / company selection stay deferred.

## Shared realtime sync supervisor (US-012 Linux slice)

The companion owns one `ELECTRON_RUN_AS_NODE` watcher child (`src/main/sync/supervisor.ts` + `src/main/sync-child.ts`) that launches the shared `@indigoai-us/hq-cloud` hq-sync-runner with `--watch`, `--direction both`, `--event-push`, and an explicit root/company scope (`--companies` / `--personal` / `--company <uid>`). Tokens move only over private IPC — never argv, env, stdout, or the shared CLI token cache. NDJSON protocol reduction (`src/main/sync/protocol.ts`) maps `setup-needed`, `auth-error`, partial/conflict abort, and malformed lines into UI-facing state; exit zero alone never marks success. An exclusive `desktop-sync` operation lock (`src/main/sync/ownership.ts`) excludes competing CLI writers. Unexpected exits use bounded exponential restart/backoff (`SYNC_RESTART_POLICY`); pause/resume and IPC `stop` clear pending restarts and prefer a graceful stop so `HQ_STATE_DIR` journals remain recoverable across restarts. Packaged probe: `scripts/verify-sync-child.mjs`. Authenticated live subscribe/exchange on a user desktop stays deferred — unit and runtime probes cover the contract without claiming a live cloud round trip. Windows / WSL2 supervisor matrix remains deferred.

CI is deferred by decision: no workflow file is committed on this branch yet, and no CI run has verified this work. The authored Windows/Linux native-acceptance workflow is preserved outside the repo and is restored in the final CI phase; until then every result above came from local runs on one Linux host.
