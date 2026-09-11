# Local Debian test build

This is an early native Linux test build, not the completed HQ Desktop OS v1.

## Available

- Setup, Sync, Tools, and Settings navigation with persistent System, Light, and Dark themes.
- Native folder selection for an existing HQ workspace containing `core` and `companies`.
- A persistent workspace registry that resolves symlink aliases and preserves a stable installation ID.
- Workspace removal from the app without deleting its files.
- Launching the file manager, installed default terminal, and installed VS Code in the selected workspace.
- Local diagnostics and an explicit JSON export. The report excludes workspace paths, account identity, credentials, environment variables, and installation ID. It is not uploaded.
- Electron 40.0.0 with Node 24.11.1 and the public HQ Cloud 6.16.35 package bundled in the app. No global Node or HQ CLI is required to launch it.
- One native OS titlebar. The renderer adds no duplicate window controls.

## Still unfinished

Account sign-in, token persistence, membership selection, fresh workspace creation, managed sync/watch, conflict resolution, WSL integration, tray/background sync, login startup, updates, and server health reporting are not implemented in this build. The app does not manage an existing CLI or tray sync process. Its Sync page reports that it is not connected.

Windows installers, real Linux/Windows accessibility and 200% browser zoom, live cross-client sync, release signing, health attribution, and CI workflow verification remain acceptance work. Browser preview checks and unit tests do not establish native acceptance.

## Install and test

Install the `.deb` with your system package manager, then launch **HQ Desktop OS** from the application menu. The executable is `hq-desktop-os`.

1. In Setup, attach your existing HQ folder. A folder without `core` and `companies` should produce a clear error.
2. Quit and reopen the app. The workspace selection should persist.
3. In Tools, open Files, Terminal, and VS Code. Missing tools should report an error without installing anything.
4. In Settings, inspect and export diagnostics. Check the report contains no workspace path or account data.
5. Remove a workspace from the app and confirm its files remain on disk.
6. Check the native titlebar, resizing, keyboard focus, and themes on your Linux desktop.

Closing the window quits this build. Uninstalling the app preserves workspace folders and its per-user registry; it does not remove your HQ data.

## Rebuild

Use Node 22.12 or newer within the supported range and pnpm 10.28.2:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm package:deb
```

The package is written under `release/`. No artifacts are automatically published.
