# Local Debian test build

This is a development build of HQ for Linux. It is not a completed public release.

## Included

- HQ branding, neutral light and dark themes, one Appearance dropdown, and one native title bar.
- Guided fresh setup with a pinned HQ template, private Node/HQ CLI/search tools, checksum-verified downloads, cancellation, and recovery. Git is an installer dependency.
- Existing-folder selection and a persistent workspace list. Removing a folder from the app preserves its files.
- Browser sign-in with PKCE, signed identity verification, OS-encrypted token storage, refresh and sign-out. Linux requires an available secure keyring; plaintext storage is refused.
- Account-scoped work selection, shared HQ Cloud sync, pause/retry, saved choices, automatic reconnection, and truthful transfer status. Journals are isolated by account and folder; a shared operation gate protects the folder from concurrent CLI writes.
- Files and terminal shortcuts. The app's terminal can find its privately installed HQ tools.
- Optional background operation and startup at sign-in, plus a local support-report export that excludes account details, paths and credentials.

## Verification and remaining work

Real isolated Linux setup has downloaded and verified the template and all required managed tools. The actual Electron Node runtime has loaded the shared sync engine and passed private-IPC, competing-writer exclusion and cancellation checks without credentials or cloud writes. Unit and browser tests cover the implemented boundaries and recovery screens.

The packaged runtime passed 65 native Linux checks on an isolated display, including frame, lifecycle, navigation and security. Browser sign-in, OS keyring behavior, authenticated cross-client transfers, desktop tray behavior, native accessibility and physical window manipulation still need acceptance on the user’s graphical desktop. Browser fixtures do not establish these results.

Conflict resolution, Windows/WSL setup, verified updates, server health attribution, public release signing and CI workflows remain unfinished. The desktop app does not take over or terminate existing CLI sync processes.

## Install and try

Install the `.deb` with your system package manager and launch **HQ Desktop OS** from the application menu. The executable is `hq-desktop-os`.

1. Choose **Set up HQ**, or select your existing HQ folder.
2. Sign in through your browser. In **Sync**, choose your personal work or shared workspace, then start syncing.
3. Pause sync before switching workspaces. Sign-out stops the app's own sync process.
4. Try Appearance, file shortcuts, and the optional background setting in Settings.
5. Quit and reopen the app to check saved folders and account reconnection. Your sync choice is remembered. Previously running sync reconnects after account and membership checks; paused sync stays paused.

Closing the window quits unless background operation is enabled and a tray is available. Uninstalling the application preserves your HQ files and user data.

## Rebuild

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm package:deb
```

The package is written under `release/`. Artifacts are not published automatically.
