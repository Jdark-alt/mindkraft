# design-sync notes — Mindkraft

Repo-specific gotchas for whoever runs the next sync. Read this before touching
anything under `.design-sync/`.

## What this repo is, and why there's a shim

Mindkraft is a vanilla HTML/CSS/JS PWA: no root `package.json`, no React, no
`dist/`, no Storybook. The design system lives in `style.css` (~15.7k lines,
~78 custom properties) and in the markup that `index.html` and the render
functions in `app.js` emit.

design-sync's converter targets React packages, so this sync introduces
**`.design-sync/shim/`** — a small typed React package (`mindkraft-ds`) whose
components emit the app's *exact* class names and DOM structure. It contains no
styling of its own. Every component was transcribed from a specific place in the
app; the pairing is recorded in each component's JSDoc.

- `shim/copy-assets.mjs` stages two files into `shim/dist/` at build time:
  `style.css` → `dist/mindkraft.css` (becomes `cfg.cssEntry`, so
  `_ds_bundle.css` is literally the app's stylesheet) and the repo-root
  `Mindkraft — Design Brief` → `dist/guidelines/design-brief.md`. Both paths
  must stay inside the package: the converter bounds `cssEntry` to `PKG_DIR`.
- `.design-sync/verify-classes.mjs` is the guard rail — it fails if the shim
  emits any class that is neither styled in `style.css` nor written by the app's
  own markup. **Run it after any shim edit**: `node .design-sync/verify-classes.mjs`.

## The shim can drift from the app

This is the standing risk. `app.js` and `index.html` are the source of truth; the
shim is a hand-maintained mirror. If a render function changes its markup, the
shim silently keeps emitting the old structure and every design built with the
DS inherits it. On each re-sync, spot-check the components whose app-side
markup changed (`git log -p -- app.js index.html` since the last sync) against
the shim source.

## First run on a fresh clone

`shim/node_modules` and `shim/dist` are gitignored, and the repo root has no
`package.json`, so the base skill's "install with the repo's package manager"
step finds nothing to do. **Install the shim's deps first or `cfg.buildCmd`
fails:**

```sh
npm --prefix .design-sync/shim ci      # or `install` if the lockfile drifted
npm --prefix .design-sync/shim run build
node .design-sync/verify-classes.mjs
```

Only then run the converter / driver. The render check additionally needs
playwright — see the Re-sync risks section for the version pinning.

## Config decisions

- `componentSrcMap` pins all 48 components. The shim groups components by domain
  (`src/chips.tsx` holds six), so the converter's `<Name>.tsx` fuzzy-find matches
  almost nothing. The pins are what make JSDoc extraction and grouping work.
- **Groups come from `@category` JSDoc tags**, not directory names — the shim's
  `src/` is flat. Adding a component without an `@category` tag lands it in
  `general`.
- `extraFonts: ["fonts/inter.css"]` ships Inter (latin + latin-ext, weights
  300–800) as woff2 under `shim/fonts/`, downloaded from Google Fonts and
  committed with `OFL.txt`. The app loads Inter from the Google Fonts CDN;
  shipping the files means designs render in the real face with no network.
- `overrides`: `Modal`/`ToastStack`/`NavTab`/`NavTabs` are `cardMode: single`
  with explicit viewports; the wide compositions are `cardMode: column`.

## Preview scaffolding (not part of the DS)

`previews/_page.tsx` and `previews/_stat-icons.tsx` are helpers, not components.

- **`Page`** — the card harness paints its own `body{background:#fff}`, which
  wins over `style.css`. Mindkraft is dark-first and many surfaces are
  translucent (`--surface-card-muted`, the `gc-done` states), so on white they
  composite into pale grey and the card lies. `Page` restores the app's real
  canvas. **Every preview must be wrapped in it.** Designs built with the DS
  don't need it — they get the canvas from `body`.
- **`Viewport`** — for the `position: fixed` components. The harness puts
  `transform: translateZ(0)` on the cell, which makes it the containing block for
  fixed descendants; the cell has no height, so a centred overlay lands on a
  zero-height line and gets cropped. `Viewport` takes the containing block back
  with a real height.
- No light-mode preview helper on purpose: `data-theme-mode` lives on the
  document element, so a light cell would flip every other cell on the card.

## Known render warns

- **`[FONT_MISSING] "JetBrains Mono"`** — expected, not a brand-font gap. It
  appears once in `style.css`, inside the fallback stack
  `'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace` on `.pf-code-chip`.
  The app never loads it either, so designs render exactly as the app does.
  Not resolved by design; ship the woff2 via `cfg.extraFonts` only if Mindkraft
  itself starts loading it.
- `ToolDivider` renders as a near-invisible hairline (≈4% white). That is the
  app's own treatment — the visible effect is the spacing it creates.
- `NavTab`/`NavTabs` have two treatments split at 768px: mobile is the floating
  island with the icon glowing (what the brief documents), desktop is a solid
  blue fill. Their previews are pinned to a 390px viewport so the mobile form is
  what the cards show.

## Findings worth fixing in the app (not in the shim)

These are real inconsistencies found while transcribing. The shim mirrors the
app as-is; fixing them belongs in `style.css` / `app.js`.

- `.btn-primary` / `.btn-secondary` have no `:disabled` rule, so a disabled
  button is pixel-identical to an enabled one.
- `.gc-ring-fill` strokes with a bare `var(--dim-color)` and no fallback, so a
  grid ring outside `.grid-card` draws its track and no arc. `.act-ring-fill`
  has the fallback; the grid one doesn't.
- Grid cards render the streak as a literal `🔥` emoji, which the design brief's
  anti-patterns section rejects ("Emoji as UI primitives"). The list view uses an
  SVG flame for the same thing.
- `.level-svg` is sized by JS measurement in the app. The shim approximates
  (29px per digit) since there's no measure pass; a 3-digit level collides with
  the progress bar at the app's fixed 68px default.

## Re-sync risks — what can go stale

- **The shim vs `app.js`** (above) — the big one.
- **Inter woff2 files** are committed; if the app switches families or weights,
  `shim/fonts/` must be regenerated (re-download from Google Fonts and rewrite
  `fonts/inter.css` with local `url()`s).
- **`cssEntry` is a build-time copy.** A `style.css` edit only reaches the DS
  after `npm --prefix .design-sync/shim run build` re-runs `copy-assets.mjs`.
  Always run `cfg.buildCmd` before the converter.
- **No `projectId` is pinned yet** — this sync was built and verified locally
  only; the session had no claude.ai/design authorization (`DesignSync` reported
  that `/design-login` needs an interactive terminal). The next sync that *can*
  authenticate will create the project and must record its id in
  `config.json`. Until then `ds-bundle/` is the deliverable.
- **Playwright/chromium**: chromium build 1194 is preinstalled at
  `/opt/pw-browsers`; the matching npm package is `playwright@1.56.0`. A
  different image will need the version whose `browsers.json` pins its cached
  build.
