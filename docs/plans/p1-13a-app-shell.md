# Plan: [P1-13a] App shell, navigation, and theme tokens

**Slug:** p1-13a-app-shell **Issue:** #92 **Date:** 2026-09-13
**Governing DDs:** DD-008 (UX structure & UI conventions — primary spec: page set, theme
behaviour, formatting, filter colours; this plan also carries a maintainer-authorised amendment
to it — see Step 1), DD-002 (application architecture — renderer layering, typed IPC only)
**Status:** READY_FOR_SPEC

## Summary

The renderer is currently one screen: the P0-03 native-module version proof plus three debug
widgets (`JobDemo`, `WatchFolders`, `DebugPanel`), all mounted directly in `App.tsx` with no
routing and no styling system. This plan replaces that with the DD-008 six-page sidebar shell:
client-side routing to Dashboard/Targets/Sessions/Calibration/Review queue/Settings (each a
placeholder body for now), reusable layout primitives (`AppShell`, `Sidebar`,
`GlobalScanProgress`, `PlaceholderPage`), a CSS-custom-property theme layer with dark (default),
light, and red-night-vision variants and a mechanical check that no component hardcodes a colour
outside it, and one shared module exporting the `HHh MMm` integration-time formatter and the
canonical per-filter colour map. Per a maintainer decision made after this plan's first draft,
red night-vision mode also overrides the per-filter colours (dimmed/red-shifted) rather than
keeping them identical to dark/light — an authorised DD-008 deviation, so this plan now includes
a step amending DD-008's text itself, not just the code. The existing P0-03/P1-06/P1-09 debug
widgets are preserved functionally but relocated into a single collapsed-by-default developer
tray mounted in the shell chrome, explicitly documented as temporary scaffolding rather than a
committed surface. No new IPC surface is introduced anywhere in this plan — everything here is
pure renderer-side UI plus reuse of the `jobs.list`/`jobs.progress` channels that already exist.

## Research notes / decisions

### Routing: `react-router` (declarative mode, `HashRouter`), added as a new dependency

`packages/desktop/renderer/package.json` currently depends on only `react`, `react-dom`, and
`@tanstack/react-query` — no router exists, confirmed by reading the file: **`react-router` is
genuinely absent and this plan adds it as a new dependency.** As of this plan `7.18.3` is latest
on npm. This plan adds **`react-router`** directly to
`packages/desktop/renderer/package.json` `dependencies`. Two things this deliberately is **not**:

- Not `react-router-dom`: as of v7, DOM bindings (`HashRouter`, `NavLink`, etc.) live in the
  `react-router` package itself; `react-router-dom` is kept only as a compatibility re-export for
  projects migrating from v6. A new install should target `react-router` directly.
- Not the v7 "framework" mode (`@react-router/dev`, file-based routes, loaders/actions, a Vite
  routing plugin): that mode assumes a server or a build-time route manifest neither of which this
  Electron renderer has or needs. This plan uses plain **declarative mode**
  (`<Routes>`/`<Route>`/`<NavLink>`/`<Outlet>`), which is just React components and adds nothing
  to the build pipeline beyond the one dependency.

**Router history mode — `HashRouter`, not `BrowserRouter` or `MemoryRouter`:**
`packages/desktop/src/main/index.ts:140` loads the packaged renderer via
`window.loadFile(path.join(..., '../renderer/index.html'))` — confirmed by reading it directly —
i.e. the production app is served over `file://`, not `http(s)://` (`loadURL` is used only for the
dev server). `BrowserRouter`'s `pushState`-based history would rewrite the URL to e.g.
`file:///.../renderer/index.html/dashboard`, which breaks on any reload (there is no `index.html`
at that path) and is the classic file-protocol/React Router footgun. `MemoryRouter` would avoid
that but throws away the current page across a DevTools reload or an `electron-vite` HMR
full-reload during development. `HashRouter` keeps the document part of the URL constant
(`file:///.../index.html#/dashboard`) so a reload — dev or packaged — re-resolves the same file
and restores the same page from the hash; this is the standard recommendation for Electron + React
Router and is what this plan uses. It has no user-visible address bar in a single-window Electron
app, so the `#` is invisible in practice.

### Theming: CSS custom properties scoped to one root element, not `document.documentElement`

`ThemeProvider` renders a single wrapper element (class `app-root`, attribute
`data-theme="<theme>"`) around the whole app tree, and `theme/tokens.css` scopes every rule to
`.app-root` / `.app-root[data-theme='light']` / `.app-root[data-theme='red-night-vision']` rather
than `:root`/`html`. CSS custom properties inherit down through the DOM from wherever they're
declared, so scoping to `.app-root` still makes every token "app-wide" per the acceptance
criterion — it does not need to be `:root`. Scoping to a component-owned element (instead of
mutating the global `document.documentElement`) is what makes the theme mechanically testable in
isolation: a test can render `<ThemeProvider theme="light">…</ThemeProvider>` in jsdom and inspect
that one element's attribute/subtree without touching global document state or leaking between
tests.

Dark is the literal default with no override rule needed (`.app-root` on its own is dark) —
matching DD-008 "Dark theme default" precisely. `ThemeProvider`'s initial state is the literal
string `'dark'`, **not** derived from `prefers-color-scheme` — DD-008 says "dark theme default,"
not "match the OS," and doing otherwise would be a silent deviation.

### Filter colours: constant across dark/light, overridden under red night-vision (maintainer-resolved)

This plan's first draft read DD-008's "per-filter bars use **consistent** filter colors" as
meaning identical across all three themes, and flagged the tension with red-night-vision's actual
purpose as an Open Question rather than deviating silently. **The maintainer has since resolved
this: rod/dark adaptation outweighs strict colour consistency, so red night-vision mode overrides
the seven filter colours with a dimmed, red-shifted treatment, while dark and light keep them
identical to each other.** This is an authorised DD-008 deviation, so **Step 1** below amends
DD-008's own text (not just the code) before Step 3 implements it — per `CLAUDE.md`'s rule that a
sanctioned deviation still requires the governing document to be updated in the same PR, never
left silently contradicted.

Concretely, the token layer expresses this with no TypeScript-level branching at all: `--filter-l`,
`--filter-r`, `--filter-g`, `--filter-b`, `--filter-ha`, `--filter-oiii`, `--filter-sii` (plus the
fallback `--filter-unknown`) are declared once at the base `.app-root` rule (used by both dark and
light — no light-specific override), **and re-declared with dimmed/red-shifted values inside a
third block, `.app-root[data-theme='red-night-vision']`**. `shared/display.ts`'s `FILTER_COLORS`
map (Step 6) holds `var(--filter-…)` reference strings, never resolved hex — so the *same*
reference automatically picks up the red-night-vision value whenever that theme is active. The
theme swap stays a pure token swap and no component ever needs an `if (theme === …)` branch to get
this right, which is exactly what keeps "no component-level colour literals" mechanically true
even for this maintainer-added behaviour.

### Where the shared display helpers live

`formatIntegrationTime()` and `FILTER_COLORS` are renderer-side (`renderer/src/shared/display.ts`),
not `packages/core`. DD-002's module layout does reserve `packages/core/catalog` for "integration
math," but that's the *computation* of total integration seconds from frame/session data (a
separate, not-yet-built P1 issue — no such logic exists yet in `packages/core` as of this plan,
confirmed by search). This issue's formatter is the *presentation* of an already-computed number
as `HHh MMm`, and the filter-colour map is inescapably a CSS/UI concern (its values are `var(--…)`
references into this renderer's own token layer). Keeping both in one renderer module matches the
acceptance criterion's "exported from one module" and doesn't preempt or conflict with whatever
`packages/core` integration-math function a later issue adds — that function will return a number
of seconds; this module turns it into a string.

### `FILTER_COLORS`' key set is DD-008's 7 filters, not the full canonical filter vocabulary

DD-003's schema comment lists the `filters.band_type`/canonical-name vocabulary as `'L','R','G',
'B','Ha','OIII','SII','UVIR','none'…` and DD-005 additionally lists `Dualband` — a strictly larger
set than DD-008's 7 named colours. `FILTER_COLORS` is typed and keyed to exactly DD-008's 7
(`L | R | G | B | Ha | OIII | SII`) since that's all DD-008 specifies a colour for. A
`getFilterColor(rawBand: string): string` helper is exported alongside it that falls back to a new
neutral `--filter-unknown` token for anything outside those 7, so a later page (P1-14/P1-15)
rendering a `None`/`UVIR`/`Dualband` frame's filter bar never hits a missing-key error — without
this plan inventing colours DD-008 never specified. **The maintainer has accepted this fallback as
proposed; no DD-008 change is needed for it** — DD-008 may be extended later with explicit colours
for these bands if they prove common in practice, but that is not this issue's concern.

### `DevPanel` is explicitly temporary scaffolding, not a committed surface

The relocated P0-03/P1-06/P1-09 debug widgets stay — the maintainer confirmed deleting working
debug tooling (especially `DebugPanel`, deliberately built in #95) would be wrong — but `DevPanel`
must be documented, in the plan and in the component itself, as scaffolding a later issue may
retire or restructure, not a surface future issues should build on top of. See Step 11.

## Affected Files

- `design/DD-008-ux-structure.md` — modified: amends the per-filter-colour convention bullet to
  sanction red night-vision's dimmed/red-shifted override (Step 1 — a documentation change, not
  code, but part of this issue's scope per the maintainer's decision)
- `packages/desktop/renderer/package.json` — modified: add `react-router` dependency
- `packages/desktop/renderer/src/theme/tokens.css` — new: CSS custom property token layer,
  `.app-root` (dark default) / `[data-theme='light']` / `[data-theme='red-night-vision']`
  chrome overrides, plus the `--filter-*` tokens (shared by dark/light, separately overridden
  under red-night-vision per Step 1's amendment)
- `packages/desktop/renderer/src/theme/ThemeProvider.tsx` — new: theme context, `useTheme()`,
  renders the single themed root element
- `packages/desktop/renderer/src/theme/ThemeProvider.test.tsx` — new: DOM snapshot per theme
  (dark/light/red-night-vision) — the acceptance criterion's literal "snapshot test per theme"
- `packages/desktop/renderer/src/theme/tokens.test.ts` — new: parses `tokens.css` and snapshots
  the resolved custom-property map per theme, explicitly proving `--filter-*` values are identical
  between dark and light but differ under red-night-vision, while chrome tokens differ across all
  three
- `packages/desktop/renderer/src/theme/no-literal-colors.test.ts` — new: mechanical scan of every
  `.css`/`.module.css` file (except `tokens.css`) and every `.tsx` inline `style={{ … }}` for a
  hardcoded colour value on a colour-affecting property; fails naming the offending file/line
- `packages/desktop/renderer/src/shared/display.ts` — new: `formatIntegrationTime()`,
  `FILTER_COLORS`, `getFilterColor()`, `FilterColorBand` type — the sole source of both
- `packages/desktop/renderer/src/shared/display.test.ts` — new: unit tests for both
- `packages/desktop/renderer/src/app/routes.ts` — new: `NAV_ITEMS` (path + label, in DD-008 order)
  shared by the router and the sidebar
- `packages/desktop/renderer/src/app/AppShell.tsx` — new: sidebar + header (brand, page title,
  `GlobalScanProgress` slot, dev-tools toggle) + `<Outlet/>` content area
- `packages/desktop/renderer/src/app/AppShell.module.css`, `AppShell.test.tsx` — new
- `packages/desktop/renderer/src/app/Sidebar.tsx` — new: nav list of the six DD-008 destinations
  using `NavLink`, active-item indication, optional per-item badge slot (unused for now — see Out
  of Scope)
- `packages/desktop/renderer/src/app/Sidebar.module.css`, `Sidebar.test.tsx` — new
- `packages/desktop/renderer/src/app/GlobalScanProgress.tsx` — new: header slot; on mount calls
  `jobs.list`, then subscribes to `jobs.progress`; renders nothing when no job is
  queued/running, else a compact aggregate status
- `packages/desktop/renderer/src/app/GlobalScanProgress.module.css`,
  `GlobalScanProgress.test.tsx` — new
- `packages/desktop/renderer/src/app/PlaceholderPage.tsx` — new: shared placeholder body
  (title + one-line "what will appear here" copy, DD-008's "empty states teach" convention)
- `packages/desktop/renderer/src/app/PlaceholderPage.module.css`, `PlaceholderPage.test.tsx` — new
- `packages/desktop/renderer/src/pages/DashboardPage.tsx`,`TargetsPage.tsx`,`SessionsPage.tsx`,
  `CalibrationPage.tsx`,`ReviewQueuePage.tsx`,`SettingsPage.tsx` — new: each a thin
  `<PlaceholderPage title="…" description="…" />`
- `packages/desktop/renderer/src/pages/pages.test.tsx` — new: asserts each page renders its title
- `packages/desktop/renderer/src/DevPanel.tsx` — new: collapsed-by-default disclosure bundling
  the relocated version-info block + existing `JobDemo` + existing `WatchFolders` + existing
  `DebugPanel`, mounted once inside `AppShell` (visible on every route); carries an explicit
  "temporary scaffolding" doc comment (Step 11)
- `packages/desktop/renderer/src/DevPanel.test.tsx` — new
- `packages/desktop/renderer/src/App.tsx` — modified: becomes
  `ThemeProvider > HashRouter > Routes` composition (see Implementation Steps); the P0-03 version
  `<dl>` is extracted out of here into `DevPanel`
- `packages/desktop/renderer/src/App.test.tsx` — modified: the old version-info/job-demo
  assertions move to `DevPanel.test.tsx`; this file becomes a shell-level smoke test (six routes
  exist, default route is Dashboard, active nav item updates on navigation)
- `packages/desktop/e2e/app-launch.spec.ts` — modified: keep the one-window/title checks; the
  "AstroTracker" heading assertion now targets the shell's brand mark (see Step 13); open the
  relocated dev panel before asserting the native-module version values, preserving the existing
  proof that packaged SQLite/sharp versions are real
- `packages/desktop/e2e/navigation.spec.ts` — new: the acceptance criterion's E2E smoke test —
  packaged app boots, each of the six sidebar items is clicked in turn, the corresponding
  placeholder renders, active-item indication updates
- `packages/desktop/src/main/index.ts` — modified: add `minWidth`/`minHeight` to the
  `BrowserWindow` constructor (currently unset) so the sidebar shell always has usable space;
  small, isolated addition, not central to the acceptance criteria

## Implementation Steps

### Step 1 — Amend DD-008: red night-vision overrides filter colours

**Outcome:** `design/DD-008-ux-structure.md`'s Conventions section is amended per the
maintainer's authorised revision: rod/dark adaptation in red night-vision mode outweighs strict
filter-colour consistency, so that mode gets its own dimmed/red-shifted treatment of the same
seven bands, while dark and light keep DD-008's original literal colours identical to each
other. The current bullet —

> Integration time always displayed `HHh MMm`; per-filter bars use consistent filter colors
> (L=white, R/G/B, Ha=deep red, OIII=teal, SII=orange-red).

— becomes:

> Integration time always displayed `HHh MMm`; per-filter bars use consistent filter colors in
> dark and light themes (L=white, R/G/B, Ha=deep red, OIII=teal, SII=orange-red). Red
> night-vision mode overrides these with a dimmed, red-shifted treatment of the same seven
> bands — preserving rod/dark adaptation outweighs strict colour consistency in that mode;
> bands stay distinguishable from each other by relative brightness/saturation rather than hue.
> The override is expressed entirely through the theme's CSS custom properties, like every
> other red-night-vision colour, never as a per-component exception.

This is a documentation-only step (no application code); it exists so DD-008 and the token layer
Step 3 builds never contradict each other, per `CLAUDE.md`'s rule that a sanctioned deviation
still requires the DD text itself to be updated in the same PR, not left silently stale (the same
principle the DD-003 schema-check hardening in #111 enforced from the other direction).
**Files:** `design/DD-008-ux-structure.md`
**Depends on:** none

### Step 2 — Add the router dependency

**Outcome:** `packages/desktop/renderer/package.json` depends on `react-router`; `pnpm install`
resolves it into the renderer workspace member; nothing yet imports it.
**Files:** `packages/desktop/renderer/package.json`
**Depends on:** none

### Step 3 — Theme token layer (CSS)

**Outcome:** `theme/tokens.css` exists, defining every token this shell and its pages need:
chrome tokens (`--color-bg`, `--color-bg-elevated`, `--color-text`, `--color-text-muted`,
`--color-border`, `--color-accent`, `--color-focus-ring`, `--color-nav-active-bg`,
`--color-nav-active-text`, `--color-danger`, `--color-success`, `--color-warning`) scoped to
`.app-root` (dark values, the default) with two chrome override blocks
(`.app-root[data-theme='light']`, `.app-root[data-theme='red-night-vision']` — the red variant
biased toward reds/near-black per its "preserve night vision" purpose); and the filter tokens
(`--filter-l`, `--filter-r`, `--filter-g`, `--filter-b`, `--filter-ha`, `--filter-oiii`,
`--filter-sii`, plus the fallback `--filter-unknown`) declared once at `.app-root` (shared,
identical value, by dark and light — no light-specific override) **plus a third block,
`.app-root[data-theme='red-night-vision']`, re-declaring every `--filter-*` token with a dimmed,
red-shifted value**, per Step 1's DD-008 amendment. No component or TypeScript module needs to
know this override exists: Step 6's `FILTER_COLORS` map already holds `var(--filter-…)`
references, so the same reference automatically resolves to the red-night-vision-appropriate
value whenever `data-theme='red-night-vision'` is active — the theme swap stays a pure token
swap with zero component-level branching. No component imports this file yet.
**Files:** `packages/desktop/renderer/src/theme/tokens.css`
**Depends on:** Step 1

### Step 4 — `ThemeProvider` + `useTheme()`

**Outcome:** A context provider component `<ThemeProvider theme?>` renders one root element
(`className="app-root"`, `data-theme={theme}`) wrapping its children, imports `tokens.css`, and
exposes `useTheme()` returning `{ theme, setTheme }`. Default theme is the literal `'dark'` — no
`prefers-color-scheme` read. `setTheme` exists now purely as the seam a later issue (P1-32) wires
a real control to; nothing in this issue calls it from a UI control. `ThemeProvider.test.tsx`
renders each of the three themes and snapshots the container — the acceptance criterion's
"snapshot test per theme."
**Files:** `packages/desktop/renderer/src/theme/ThemeProvider.tsx`,
`packages/desktop/renderer/src/theme/ThemeProvider.test.tsx`
**Depends on:** Step 3

### Step 5 — Theme-token resolution test + mechanical no-literal-colours test

**Outcome:** Two more theme tests exist, both runnable under `pnpm test` with no new tooling:
(a) `tokens.test.ts` parses `tokens.css` as text, resolves the effective custom-property map for
each of the three themes (base `.app-root` declarations, overridden per theme where a block
exists), and snapshots each resolved map — explicitly proving `--filter-*` values are identical
between dark and light but differ under red-night-vision, while chrome tokens differ across all
three. This is the mechanical proof that Step 1's DD-008 amendment was actually implemented, not
merely written down. (b) `no-literal-colors.test.ts` walks every `.css`/`.module.css` file under
`renderer/src` (excluding `tokens.css`) and flags any declaration whose property is one of a fixed
`COLOR_PROPERTIES` list (`color`, `background`, `background-color`, `border-color`, `fill`,
`stroke`, `outline-color`, `box-shadow`, …) where the value is a literal hex/`rgb()`/`rgba()`/
`hsl()`/`hsla()`/named-CSS-colour rather than exclusively `var(--…)` (a `var(--x, <fallback>)`
default is allowed); it also walks every `.tsx` file for an inline `style={{ … }}` object with a
matching colour-ish key holding a literal. This is the acceptance criterion's "mechanically
checkable, not merely intended" enforcement — CI fails if any future component (this issue's or
a later one) hardcodes a colour outside the token layer.
**Files:** `packages/desktop/renderer/src/theme/tokens.test.ts`,
`packages/desktop/renderer/src/theme/no-literal-colors.test.ts`
**Depends on:** Step 3

### Step 6 — Shared display helpers

**Outcome:** `shared/display.ts` exports:
- `formatIntegrationTime(totalSeconds: number): string` → zero-padded `"HHh MMm"` (e.g.
  `"01h 01m"`, `"120h 05m"` — hours are never truncated past 2 digits, only ever
  zero-*padded* to a minimum of 2). Applies `Math.floor` to the input first (defensive against
  summed floating-point exposure seconds), then floor-divides into whole minutes — any
  sub-minute remainder is dropped, never rounded up, so displayed integration time never
  overstates what has actually completed. Throws `RangeError` on a negative input — there is no
  legitimate negative integration time, and silently clamping would hide a caller bug.
- `type FilterColorBand = 'L' | 'R' | 'G' | 'B' | 'Ha' | 'OIII' | 'SII'`
- `FILTER_COLORS: Record<FilterColorBand, string>` — each value a `var(--filter-…)` reference
  into Step 3's tokens, exactly DD-008's mapping (L→`--filter-l`, …). No red-night-vision
  branching lives here or anywhere in TypeScript — the values are var() references, and Step 3's
  red-night-vision override block is what changes what they resolve to.
- `getFilterColor(rawBand: string): string` — returns `FILTER_COLORS[rawBand]` when `rawBand` is
  one of the 7 keys, else `'var(--filter-unknown)'`.
`display.test.ts` covers: `0 → "00h 00m"`, `59 → "00h 00m"` (sub-minute dropped), `60 → "00h
01m"`, `3599 → "00h 59m"`, `3600 → "01h 00m"`, `3661 → "01h 01m"`, `36000 → "10h 00m"`,
`360000 → "100h 00m"` (3-digit hours), a fractional input (`90.9 → "00h 01m"`), a negative input
throws; and for filter colours, all 7 keys present and each value matches `/^var\(--filter-/`,
plus `getFilterColor('UVIR')` and `getFilterColor('none')` both returning the fallback token.
**Files:** `packages/desktop/renderer/src/shared/display.ts`,
`packages/desktop/renderer/src/shared/display.test.ts`
**Depends on:** Step 3 (references the same token names)

### Step 7 — Nav metadata + placeholder page primitive

**Outcome:** `app/routes.ts` exports `NAV_ITEMS: { path: string; label: string }[]` in DD-008
order (`/dashboard` Dashboard, `/targets` Targets, `/sessions` Sessions, `/calibration`
Calibration, `/review-queue` "Review queue", `/settings` Settings) — the single list both the
router config and the sidebar read, so they cannot drift. `app/PlaceholderPage.tsx` renders a
title (`<h1>`) and one-line description of what will land on that page later (DD-008's "empty
states teach" convention, applied minimally — full empty-state UX is each page's own future
issue).
**Files:** `packages/desktop/renderer/src/app/routes.ts`,
`packages/desktop/renderer/src/app/PlaceholderPage.tsx`,
`packages/desktop/renderer/src/app/PlaceholderPage.module.css`,
`packages/desktop/renderer/src/app/PlaceholderPage.test.tsx`
**Depends on:** none

### Step 8 — Six page components

**Outcome:** `pages/DashboardPage.tsx` … `pages/SettingsPage.tsx` each render
`<PlaceholderPage title="…" description="…" />` with DD-008-derived teaser copy (e.g. Targets:
"Search, filter, and browse every target in your library will appear here."). All six are
structurally identical via the shared primitive — no page is special-cased.
**Files:** the six page files, `pages/pages.test.tsx`
**Depends on:** Step 7

### Step 9 — `GlobalScanProgress`

**Outcome:** A header-region component that, on mount, calls `jobs.list` to seed any
already-in-flight job (queued/running, any `jobType`), then subscribes to `jobs.progress` for
live updates; renders nothing when there is no active job, else one compact line (e.g.
"Scanning… 420/1000" or "Working…" when `progressTotal` is `null`). Reuses the existing
`jobs.list`/`jobs.progress` IPC channels verbatim — no contract change. This is deliberately an
aggregate indicator, not a per-pipeline-stage breakdown (see Out of Scope).
**Files:** `packages/desktop/renderer/src/app/GlobalScanProgress.tsx`,
`GlobalScanProgress.module.css`, `GlobalScanProgress.test.tsx`
**Depends on:** Step 3 (tokens for its own minimal styling)

### Step 10 — `Sidebar` and `AppShell`

**Outcome:** `Sidebar` renders a `<nav>` landmark with one `NavLink` per `NAV_ITEMS` entry;
`NavLink`'s built-in `aria-current="page"` plus a matching CSS rule (using
`--color-nav-active-bg`/`--color-nav-active-text`, never a literal) satisfies "the active item is
visually indicated"; being a real `<a>` element makes it keyboard-reachable (Tab order, Enter to
activate) with no extra work. Each `NAV_ITEM` may carry an optional `badgeCount?: number`,
rendered as a small badge only when defined and > 0 — unused by every item in this issue (see Out
of Scope), just the layout seam. `AppShell` renders the brand mark ("AstroTracker", an `<h1>`),
the sidebar, a header row containing the current page title and `GlobalScanProgress`, the
`<Outlet/>` content area, and the `DevPanel` toggle (Step 11) — visible on every route.
**Files:** `packages/desktop/renderer/src/app/Sidebar.tsx`, `Sidebar.module.css`,
`Sidebar.test.tsx`, `packages/desktop/renderer/src/app/AppShell.tsx`, `AppShell.module.css`,
`AppShell.test.tsx`
**Depends on:** Steps 4, 7, 9

### Step 11 — Relocate the P0-03/P1-06/P1-09 debug widgets into `DevPanel` (marked as temporary scaffolding)

**Outcome:** A new `DevPanel` component — collapsed by default, matching `DebugPanel`'s already
-established convention — renders, once expanded: the version-info block extracted verbatim from
the old `App.tsx` (app/Electron/Chrome/Node/platform/SQLite/sharp versions), then the untouched
existing `<JobDemo/>`, `<WatchFolders/>`, and `<DebugPanel/>` components (their internals are not
modified — only their mount point moves). `DevPanel` is mounted once inside `AppShell`, so it is
reachable from every page, not tucked inside the Settings placeholder (keeping all six pages
uniform, per Step 8).

Per the maintainer's explicit resolution (keep the tooling — especially `DebugPanel`,
deliberately built in #95 — but don't let its permanence become an implicit assumption),
`DevPanel.tsx` carries this doc comment verbatim at its top:

```
/**
 * TEMPORARY SCAFFOLDING (P1-13a): bundles the pre-shell debug/dev widgets —
 * version info, JobDemo, WatchFolders, DebugPanel (#95) — so they stay
 * reachable now that the DD-008 shell has replaced the old single-screen
 * renderer. This is not a committed product surface: a later issue may
 * retire, relocate, or split up any part of it without that being a
 * breaking change to plan around. Do not add new functionality here on the
 * assumption DevPanel itself is permanent.
 */
```

`DevPanel.test.tsx` takes over the three scenarios currently in `App.test.tsx` (version fields
render, bridge failure surfaces, demo job progress flow) — identical assertions, with one extra
step first: expand the panel before querying its content, since it now starts collapsed.
**Files:** `packages/desktop/renderer/src/DevPanel.tsx`,
`packages/desktop/renderer/src/DevPanel.test.tsx`
**Depends on:** none (only relocates already-existing, already-tested components)

### Step 12 — Wire routing in `App.tsx` and rewrite `App.test.tsx`

**Outcome:** `App.tsx` becomes:
```
<ThemeProvider>
  <HashRouter>
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="targets" element={<TargetsPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="calibration" element={<CalibrationPage />} />
        <Route path="review-queue" element={<ReviewQueuePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  </HashRouter>
</ThemeProvider>
```
(paths mirror `NAV_ITEMS` from Step 7). Visiting `/` (or any unrecognized hash) lands on
Dashboard. `App.test.tsx` is rewritten as a shell-level smoke test: renders `<App/>` with a
mocked bridge, asserts the Dashboard placeholder is shown by default, clicking a `Sidebar` link
navigates and updates `aria-current`, and the six routes all resolve to their page.
**Files:** `packages/desktop/renderer/src/App.tsx`, `packages/desktop/renderer/src/App.test.tsx`
**Depends on:** Steps 8, 10, 11

### Step 13 — Update the existing packaged-app smoke test

**Outcome:** `e2e/app-launch.spec.ts` keeps its "exactly one window," "correct title," and
"`app.version` round trip returns real values" assertions unchanged in substance. Two updates:
the `getByRole('heading', { name: 'AstroTracker' })` assertion now matches `AppShell`'s brand
mark (unchanged text, new location — the assertion itself needs no wording change); the
"Versions reported by the main process over typed IPC:" text and the version values are now
behind `DevPanel`'s collapsed toggle, so the spec opens it (clicks the existing "Show debug
panel"-style toggle) before asserting them — preserving the native-module-version proof
(SQLite/sharp real values, not `'unknown'`) that is this spec's actual point.
**Files:** `packages/desktop/e2e/app-launch.spec.ts`
**Depends on:** Steps 11, 12

### Step 14 — New E2E navigation smoke test

**Outcome:** `e2e/navigation.spec.ts` — the acceptance criterion's "E2E smoke test navigates
between all six pages on the packaged app": boots the packaged app, and for each of the six
`NAV_ITEMS` in turn, clicks the sidebar link, asserts the matching placeholder heading is visible
and that link's `aria-current="page"` is set while the previously-active link's is not.
**Files:** `packages/desktop/e2e/navigation.spec.ts`
**Depends on:** Step 12

### Step 15 — Window minimum size

**Outcome:** `BrowserWindow`'s constructor in `src/main/index.ts` (currently `width: 960,
height: 640` with no minimum) gains `minWidth`/`minHeight` so a user shrinking the window can't
collapse the sidebar shell into an unusable state. Small, isolated, does not affect any existing
test.
**Files:** `packages/desktop/src/main/index.ts`
**Depends on:** none

## Edge Cases

- Reloading the packaged app (or a dev-mode HMR full reload) while on a non-Dashboard page must
  restore that same page, not bounce to Dashboard — this is exactly what `HashRouter` (vs.
  `BrowserRouter`/`MemoryRouter`) is chosen to guarantee; call out in review if a Coder
  substitutes a different router mode.
- An unrecognized hash (`#/nonexistent`, e.g. from manual DevTools navigation) must not render a
  blank content area — the catch-all `<Route path="*">` redirects to Dashboard.
- Theme changes must never remount the router or any page (no route/scroll-position loss on
  toggling theme) — guaranteed by `ThemeProvider` wrapping `HashRouter`, not the reverse.
- Switching from light to red-night-vision must change filter-bar colours too, not just chrome —
  since `FILTER_COLORS`' values are `var(--filter-…)` references (Step 6) resolved against
  whichever theme block is active (Step 3), no component that renders a filter colour should ever
  need an `if (theme === 'red-night-vision')` branch to get this right; if a Coder adds one,
  that's a sign the token layer isn't being used as designed.
- `no-literal-colors.test.ts` must not false-positive on prose copy in `PlaceholderPage` (e.g. a
  description sentence containing the word "white") — the scan only inspects CSS declarations and
  JSX `style={{}}` objects, never arbitrary text content.
- `GlobalScanProgress` mounting after a scan job already started (e.g. app was reloaded mid-scan)
  must still show progress — the `jobs.list` seed call on mount covers this; a component that
  only ever subscribed to future `jobs.progress` events would miss it.
- A window narrower than typical (user resizes small) must not make the sidebar or content
  unusable — addressed minimally via `minWidth`/`minHeight`, not a full responsive redesign
  (out of scope).
- `formatIntegrationTime` given `0` must read `"00h 00m"`, not blank or `"NaN"` — an empty/new
  target's first render.
- Keyboard focus must remain visible when tabbing through `Sidebar` links — any focus-ring
  override must redirect to `--color-focus-ring`, never delete the outline outright.
- `DevPanel`'s relocation must not change `DebugPanel.tsx`/`JobDemo.tsx`/`WatchFolders.tsx`
  internals at all (confirmed by reading `DebugPanel.test.tsx`/`WatchFolders.test.tsx`: both
  render their component standalone, not via `App`, so they are unaffected either way — but the
  components' own source must stay untouched to keep that true).

## Invariant Checklist

- [x] Non-destructive: no file-system access anywhere in this issue; every new component is pure
      UI plus the two pre-existing IPC channels (`jobs.list`, `jobs.progress`)
- [x] Layering: no new IPC channel is added to `packages/desktop/src/ipc/contract.ts`; the
      renderer still touches nothing but `window.astrotracker` via the existing `ipc.ts` wrapper;
      the scoped ESLint rule barring runtime imports from `@astrotracker/desktop` is untouched and
      still applies to every new renderer file
- [x] DB: N/A — no schema/migration change
- [x] Timestamps stored UTC: N/A — no timestamp handling introduced
- [x] Long-running work through worker queue: N/A — no new long-running work; `GlobalScanProgress`
      only observes jobs the existing queue already runs
- [x] Performance budgets (PRD §8.4): N/A for this issue specifically — placeholder pages hold no
      real lists yet, so virtualization is not triggered here; flagged forward that P1-14's real
      Targets grid (the first page with unbounded rows) must implement it itself, this shell does
      not provide it generically

## Out of Scope

- Real page content for any of the six pages (Dashboard totals, Targets grid, Sessions
  calendar, Calibration library, Review queue list, Settings form) — P1-14 through P1-32 and
  siblings.
- Theme persistence across app restarts and the user-facing theme switch control — explicitly
  P1-32's job per `task-breakdown.md` ("the token layer itself is built in P1-13a; this slice
  adds the user-facing switch and persistence"). `ThemeProvider.setTheme` exists as the seam;
  nothing calls it from a rendered control in this issue.
- Review-queue sidebar badge's real unresolved-item count — the `badgeCount` prop exists on
  `NAV_ITEMS`/`Sidebar` as a layout seam only; computing the number is P1-16's job.
- Per-pipeline-stage breakdown inside `GlobalScanProgress` (DD-008's "per-stage counts" UI
  convention in general) — this issue ships an aggregate single-line indicator; a richer
  breakdown can layer on once several concurrent job types commonly overlap in the UI.
- Onboarding flow (welcome → pick watch folder(s) → initial scan with live progress) — DD-008
  describes it, but it is not part of this issue's acceptance criteria or `task-breakdown.md`
  entry.
- `/` search focus, arrow-key grid navigation, `Cmd/Ctrl+K` command palette — all DD-008
  conventions explicitly scoped to v1.x or to pages that don't exist yet.
- Icon assets/library for sidebar nav items — DD-008 doesn't require icons; nav items are
  text-label links, keeping this issue's new-dependency footprint to `react-router` alone.
- `packages/core`'s eventual integration-math function (computing total integration seconds from
  frame/session data) — does not exist yet and is not built here; this issue only formats an
  already-computed number.
- Any change to `filters`/`bandType` schema or to P1-12's raw→canonical filter-normalization
  logic — untouched; `FilterColorBand` is a display-only type local to this module.
- Retiring or restructuring `DevPanel` itself — explicitly deferred; this issue only relocates
  and labels the existing debug tooling as scaffolding, it does not decide its eventual fate.

## Open Questions

None — the three questions raised in this plan's first draft were resolved by the maintainer and
are folded into the steps/notes above:

1. **Red night-vision overrides filter colours.** Resolved: yes, it does (rod/dark adaptation
   outweighs strict consistency). Step 1 amends DD-008's text; Step 3 implements the token
   override; Step 5's resolution-snapshot test proves it.
2. **`getFilterColor()`'s neutral fallback for bands DD-008 doesn't name** (`UVIR`/`None`/
   `Dualband`). Resolved: accepted as proposed, no DD-008 change needed — see Research notes.
3. **`DevPanel`'s permanence.** Resolved: it stays, but is explicitly marked temporary scaffolding
   in both this plan and a doc comment in the component itself — see Step 11.

Plan written: docs/plans/p1-13a-app-shell.md — 15 steps
