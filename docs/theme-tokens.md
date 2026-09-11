# Theme tokens

HQ Desktop OS styles the renderer with Tailwind CSS via the official Vite plugin (`@tailwindcss/vite`) and semantic CSS variables. `components.json` records the shadcn source layout (path aliases, CSS entry, CSS variables) so later stories can add Radix primitives without re-deriving the setup.

## Contract

- Square corners (`--radius: 0`)
- Sans weight at most 500
- Monochrome accents; chroma only for semantic status (`success`, `warning`, `danger`, `info`)
- Selection and active states use a background highlight only — never a left accent bar
- Canvas text 13px; page titles 20px
- Stroke icons (inline SVG); no emoji icons
- System / light / dark preference persists in `localStorage` under `hq-desktop-os.theme-preference`

## Flash-free start without weakening CSP

Production CSP keeps `script-src 'self'` (no inline scripts). `src/renderer/public/theme-init.js` is a classic same-origin script referenced from `index.html` before the module graph. It reads storage, falls back to system when storage is missing or corrupt, and sets `data-theme` plus `color-scheme` on `<html>` before first paint. Fonts are the local system stack in `src/renderer/assets/fonts.css` — no remote `@font-face` or CDN.

## Files

| Path | Role |
| --- | --- |
| `components.json` | shadcn CLI / source configuration |
| `src/renderer/styles.css` | Tailwind import + component classes |
| `src/renderer/tokens.css` | Light / dark / system semantic tokens |
| `src/renderer/theme.tsx` | React provider and appearance control |
| `src/renderer/lib/theme.ts` | Preference parse / resolve / persist |
| `src/renderer/lib/utils.ts` | `cn()` helper for shadcn components |
| `src/renderer/lib/focus-restore.ts` | Safe overlay focus return when the opener unmounts |
| `src/renderer/components/ui/*` | Pinned shadcn/Radix primitives (see `docs/accessible-components.md`) |
| `src/renderer/dev/components.tsx` | Development-only component gallery |
| `src/renderer/assets/fonts.css` | Bundled system font stack |
| `src/renderer/public/theme-init.js` | Pre-paint theme bootstrap |
