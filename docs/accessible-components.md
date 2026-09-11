# Accessible shadcn component foundation

Pinned CLI: `pnpm dlx shadcn@4.21.0`. Source primitives live under `src/renderer/components/ui/` and rest on the official `radix-ui` package plus shared HQ tokens from `tokens.css` / `styles.css`.

## Primitives (US-004)

| Component | Path |
| --- | --- |
| Button | `src/renderer/components/ui/button.tsx` |
| Input | `src/renderer/components/ui/input.tsx` |
| Label | `src/renderer/components/ui/label.tsx` |
| Dialog | `src/renderer/components/ui/dialog.tsx` |
| Select | `src/renderer/components/ui/select.tsx` |
| Tooltip | `src/renderer/components/ui/tooltip.tsx` |
| Progress | `src/renderer/components/ui/progress.tsx` |

## Design contract

- Square corners (`rounded-none` / `--radius: 0`)
- Sans weight ≤ 500
- Canvas text 13px (`text-hq-canvas`); dialog/page titles 20px (`text-hq-title`)
- Selection and checked states use background highlight only — never a left accent bar
- Semantic status color is paired with text (errors, pending, progress labels)

## Focus restoration

Dialog close calls `restoreFocusSafely` (`src/renderer/lib/focus-restore.ts`): prefer the still-connected opener, then a caller-supplied `focusReturnSelector`, then `[data-focus-shell]`. This keeps keyboard focus predictable when the opener unmounts, without introducing an app-wide modal framework.

## CSP and Radix positioning

Production CSP keeps `script-src 'self'` and already allows `style-src 'self' 'unsafe-inline'`. Dialog, Select, Tooltip, and Progress rely on Radix inline styles for portal positioning and the progress fill transform. That matches the existing style allowlist — we do not add `unsafe-inline` to `script-src` or widen `connect-src` for these primitives.

## Development gallery

Exact URL (parent-owned preview on port 4173):

`http://127.0.0.1:4173/dev/components`

Mounted only when `import.meta.env.DEV` is true and the pathname is `/dev/components`. The gallery module is dynamically imported behind that gate, so the production renderer graph does not include it and there is no production debug escape.
