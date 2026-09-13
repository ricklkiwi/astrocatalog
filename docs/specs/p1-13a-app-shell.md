# Spec: [P1-13a] App shell, navigation, and theme tokens

**Slug:** p1-13a-app-shell **Issue:** #92 **Plan:** docs/plans/p1-13a-app-shell.md **Date:** 2026-09-13
**Governing DDs:** DD-008 (UX structure & UI conventions — page set, theme behaviour, `HHh MMm`
formatting, filter colours; **amended by this issue**, see DOC-1), DD-002 (renderer layering, typed
IPC only)

## How to read this spec

Every criterion carries two tags:

- **[MECH]** — a test, grep, or `git diff` invocation decides it; the Reviewer runs the named
  command and reads its output. **[REVIEW]** — the Reviewer must read the diff and judge.
- **[local]** — reproducible on the maintainer's machine with `pnpm test` / `pnpm lint` /
  `pnpm -r build`. **[CI-matrix]** — additionally exercised on ubuntu/windows/macos in `ci.yml`.
  **[CI-e2e]** — only proven by `.github/workflows/e2e.yml` (windows + macos, packaged app) or a
  local `pnpm --filter @astrotracker/desktop e2e`, which runs `pree2e` (electron-vite build →
  electron-rebuild → electron-builder --dir) first.

**The E2E workflow is not part of `ci.yml`'s required `ci-ok` aggregate** (see `e2e.yml`'s header
comment). A red E2E leg therefore does **not** block merge on its own — the Reviewer must open the
E2E check explicitly and confirm it is green before passing this issue. This matters more here than
usual: the real-watcher unit tests are skipped on Windows entirely and on macOS CI
(`packages/desktop/src/main/watch/chokidar-watcher.test.ts:138`), so E2E on the packaged app is the
only place several of this issue's relocations (DevPanel-hosted `WatchFolders`, `JobDemo`,
`DebugPanel`) are exercised at all on those platforms.

**Design principle for every check below (the #111 lesson).** A guard that can only detect an
_absence_ is not accepted. Where a criterion could be satisfied by something merely existing, it is
written as a **set equality** or an **inequality-with-a-named-counterexample** so that adding the
wrong thing fails it too. Criteria written as `toContain`, "at least one", or "a test exists for X"
are deliberately avoided; if the Coder implements one that way, that is a spec violation regardless
of whether the suite is green. Section **Mutation Evidence** below requires the Coder to prove the
guards actually bite.

## Scope

Renderer-only UI: client-side routing over the six DD-008 destinations with placeholder bodies; a
CSS-custom-property token layer with dark (default) / light / red-night-vision variants and
mechanical enforcement that no colour literal exists outside it; one shared display module owning
the `HHh MMm` formatter and the per-filter colour map; relocation of the existing P0-03/P1-06/P1-09
debug widgets into a `DevPanel` labelled as temporary scaffolding; one new E2E navigation spec; a
`BrowserWindow` minimum size; and **an amendment to DD-008's own text** sanctioning red
night-vision's filter-colour override.

Not delivered: real page content, the user-facing theme switch or theme persistence (P1-32), the
review-queue badge count (P1-16), any IPC contract change, any `packages/core` / `packages/db`
change. See **Out of Scope**.

## Definition of Done

### A. DD-008 amendment — document and code must not drift (issue AC 2, plan Step 1)

- [ ] **DOC-1** `design/DD-008-ux-structure.md` line 24's bullet is replaced with the plan Step 1
      replacement text verbatim, including both sentences about the red night-vision override and
      the "expressed entirely through the theme's CSS custom properties … never as a per-component
      exception" clause. **[REVIEW][local]**
- [ ] **DOC-2** A test asserts the DD-008 text itself, not just the CSS: it reads
      `design/DD-008-ux-structure.md`, and asserts **both** that the amended sentence
      `Red night-vision mode overrides these with a dimmed, red-shifted treatment of the same seven bands`
      is present **and** that the superseded phrasing
      `per-filter bars use consistent filter colors (L=white` (the pre-amendment wording, with no
      "in dark and light themes" qualifier) is **absent**. Both directions are required: presence
      alone would pass if someone appended the new sentence without removing the old claim.
      Suggested home: `packages/desktop/renderer/src/theme/dd008-conformance.test.ts`.
      **[MECH][local][CI-matrix]**
- [ ] **DOC-3** The same test cross-checks the document against the implementation in one
      assertion: for every filter band named in DD-008's amended bullet, a corresponding
      `--filter-*` token exists in `theme/tokens.css`, **and** `tokens.css` contains a
      `.app-root[data-theme='red-night-vision']` block that re-declares them. Deleting either side
      fails this test. **[MECH][local][CI-matrix]**
- [ ] **DOC-4** DOC-2/DOC-3 normalise `\r\n` → `\n` before matching and resolve the document path
      from `import.meta.url` (never `process.cwd()`), so they pass on the Windows CI leg and under
      both `pnpm test` (root config, project root `packages/desktop/renderer`) and
      `pnpm --filter @astrotracker/renderer test`. **[MECH][CI-matrix]**
- [ ] **DOC-5** DD-008 is otherwise unmodified: `git diff main...HEAD -- design/` touches only the
      one bullet on line 24. No filter colour is added for `UVIR` / `None` / `Dualband` (context
      item 2 — the neutral `--filter-unknown` fallback is a code-side decision needing no DD
      change). **[MECH][local]**

### B. Theme token layer (issue AC 2)

- [ ] **TOK-1** `packages/desktop/renderer/src/theme/tokens.css` declares every chrome token named
      in plan Step 3 (`--color-bg`, `--color-bg-elevated`, `--color-text`, `--color-text-muted`,
      `--color-border`, `--color-accent`, `--color-focus-ring`, `--color-nav-active-bg`,
      `--color-nav-active-text`, `--color-danger`, `--color-success`, `--color-warning`) plus
      exactly eight filter tokens (`--filter-l`, `--filter-r`, `--filter-g`, `--filter-b`,
      `--filter-ha`, `--filter-oiii`, `--filter-sii`, `--filter-unknown`) on the base `.app-root`
      rule. **[MECH][local]**
- [ ] **TOK-2** `theme/tokens.test.ts` parses `tokens.css` as text and builds a resolved
      custom-property map per theme (base declarations, overridden by the matching
      `[data-theme='…']` block). It asserts the three maps have an **identical key set**
      (`expect(sortedKeys(light)).toEqual(sortedKeys(dark))` and likewise for red-night-vision) —
      set equality, so a token declared in only one theme block fails, in either direction.
      **[MECH][local][CI-matrix]**
- [ ] **TOK-3** The same test asserts the set of keys matching `/^--filter-/` **equals exactly**
      the eight names in TOK-1 (sorted array equality, not `toContain`) — an added or renamed
      filter token fails. **[MECH][local][CI-matrix]**
- [ ] **TOK-4** For **every** `--filter-*` key (iterated from the parsed map, not a hand-listed
      subset): `resolved.light[key] === resolved.dark[key]`. One divergent filter value between
      dark and light fails. **[MECH][local][CI-matrix]**
- [ ] **TOK-5** For **every** `--filter-*` key: `resolved.redNightVision[key] !== resolved.dark[key]`.
      This is the mechanical proof that DOC-1's amendment was implemented rather than only written
      down; a red-night-vision block that forgets one band fails. **[MECH][local][CI-matrix]**
- [ ] **TOK-6** `--color-bg` and `--color-text` are pairwise distinct across all three themes (three
      inequality assertions each), so "the themes differ" cannot be satisfied by a red-night-vision
      block that only touches filter tokens. **[MECH][local][CI-matrix]**
- [ ] **TOK-7** Each of the three resolved maps is snapshotted (`toMatchSnapshot`), snapshots
      committed — any future token value change surfaces in review as a snapshot diff.
      **[MECH][local]**
- [ ] **TOK-8** No selector in `tokens.css` targets `:root`, `html`, or `body`; every rule is
      scoped to `.app-root` or `.app-root[data-theme='…']` (plan's isolation rationale).
      **[MECH][local]** — Reviewer: `grep -nE '^\s*(:root|html|body)' packages/desktop/renderer/src/theme/tokens.css`
      returns nothing.

### C. No component-level colour literals (issue AC 2 — the mechanically-checkable half)

- [ ] **LIT-1** `theme/no-literal-colors.test.ts` exports a pure detector
      (e.g. `findLiteralColorViolations(source: string, filename: string): Violation[]`) that is
      itself table-driven unit-tested against **known-bad inputs**, not only against the repo. The
      bad-input table must include at least: `color: #fff`, `color: #ffffff`, `color: #ffffffcc`,
      `background: rgb(1,2,3)`, `background-color: rgba(1,2,3,.5)`, `border-color: hsl(0 0% 0%)`,
      `border: 1px solid #333` (shorthand), `outline: 2px solid red` (shorthand + named colour),
      `box-shadow: 0 0 4px #000`, `fill: white`, and a `.tsx` `style={{ backgroundColor: 'red' }}`
      — each asserted to produce exactly one violation naming the file and line.
      **[MECH][local][CI-matrix]**
- [ ] **LIT-2** The same table asserts the **allowed** forms produce zero violations:
      `color: var(--color-text)`, `color: var(--color-text, currentColor)` (a `var()` fallback is
      permitted per plan Step 5), `background: transparent`, `outline-color: currentColor`,
      `border-color: inherit`, and the plain-prose false-positive from the plan's Edge Cases (a
      `PlaceholderPage` description string containing the word "white" outside any `style` object).
      **[MECH][local][CI-matrix]**
- [ ] **LIT-3** The detector's colour-bearing property list includes the **shorthands**, not only
      the `-color` longhands: at minimum `color`, `background`, `background-color`, `border`,
      `border-top`/`-right`/`-bottom`/`-left`, `border-color`, `outline`, `outline-color`,
      `box-shadow`, `text-shadow`, `fill`, `stroke`, `caret-color`, `accent-color`,
      `text-decoration-color`, `column-rule-color`. A scanner that only inspects `color` and
      `background-color` is a blind check and fails this criterion even with a green suite.
      **[REVIEW][local]**
- [ ] **LIT-4** The accepted-value set is **closed**: a value passes only if every token in it is a
      `var(--…)` reference or one of `transparent`, `currentColor`, `inherit`, `initial`, `unset`,
      `none`. Anything else — including a named CSS colour and any numeric colour function — is a
      violation. **[REVIEW][local]**
- [ ] **LIT-5** The repo-scan half walks **every** `.css` / `.module.css` and `.tsx` file under
      `packages/desktop/renderer/src` (excluding `tokens.css`) and asserts zero violations.
      **[MECH][local][CI-matrix]**
- [ ] **LIT-6** The scan asserts its own file list is non-empty **and** contains every
      `.module.css` file this issue adds (`AppShell`, `Sidebar`, `GlobalScanProgress`,
      `PlaceholderPage` at minimum) — a glob that silently matches nothing must fail, not pass.
      **[MECH][local][CI-matrix]**
- [ ] **LIT-7** The walk uses `path.join`/`path.sep`-safe logic and resolves its root from
      `import.meta.url`, so it passes on the Windows leg and under both the root `pnpm test` and
      `pnpm --filter @astrotracker/renderer test` invocations. **[MECH][CI-matrix]**
- [ ] **LIT-8** No colour literal exists anywhere in the shipped diff outside `tokens.css` —
      including `index.html` and any inline `<style>`. Reviewer spot-check:
      `grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' packages/desktop/renderer/src packages/desktop/renderer/index.html`
      returns hits only in `src/theme/tokens.css` and in the detector's own test fixtures.
      **[MECH][local]**

### D. Themes apply purely by token swap — no TypeScript branching (issue AC 2)

- [ ] **THM-1** `ThemeProvider` renders exactly one element carrying `className="app-root"` and
      `data-theme="<theme>"`, wrapping its children; `useTheme()` returns `{ theme, setTheme }`.
      **[MECH][local]**
- [ ] **THM-2** The default theme is the literal `'dark'`: rendering `<ThemeProvider>` with no
      `theme` prop yields `data-theme="dark"`, **and** the test installs a spy
      `window.matchMedia` and asserts it was **never called** — proving no `prefers-color-scheme`
      read was smuggled in (plan's explicit DD-008 reading). **[MECH][local]**
- [ ] **THM-3** `ThemeProvider.test.tsx` contains one committed DOM snapshot **per theme** (three
      snapshots: dark, light, red-night-vision) — the issue AC's literal "snapshot test per theme".
      **[MECH][local]**
- [ ] **THM-4** **Theme-invariant DOM:** a test renders the same subtree (shell + a page) under all
      three themes, serialises each, replaces the `data-theme` attribute value with a placeholder,
      and asserts the three serialisations are **byte-identical**. This is what makes "themes apply
      purely by swapping custom property values" falsifiable — any component that branches on theme
      to emit a different class, element, or text fails it. **[MECH][local][CI-matrix]**
- [ ] **THM-5** The string `red-night-vision` appears under `packages/desktop/renderer/src` only in
      `theme/tokens.css`, `theme/ThemeProvider.tsx` (the theme union type), and `*.test.ts(x)`
      files. Reviewer:
      `grep -rln "red-night-vision" packages/desktop/renderer/src` set-equals that list. A
      component-level `if (theme === 'red-night-vision')` fails. **[MECH][local]**
- [ ] **THM-6** Switching theme never remounts the router: the rendered `.app-root` element is a
      **DOM ancestor** of the router-rendered `<nav>` (asserted with `.contains()`), proving
      `ThemeProvider` wraps `HashRouter` and not the reverse. **[MECH][local]**
- [ ] **THM-7** `setTheme` is exported as a seam only; no rendered control in this issue calls it.
      **[REVIEW][local]**

### E. Shared display module is the _only_ source (issue AC 3)

- [ ] **DSP-1** `packages/desktop/renderer/src/shared/display.ts` exports exactly
      `formatIntegrationTime`, `FILTER_COLORS`, `getFilterColor`, and the type `FilterColorBand`.
      **[MECH][local]**
- [ ] **DSP-2** `formatIntegrationTime` unit table asserts, exactly: `0 → "00h 00m"`,
      `59 → "00h 00m"`, `60 → "00h 01m"`, `3599 → "00h 59m"`, `3600 → "01h 00m"`,
      `3661 → "01h 01m"`, `36000 → "10h 00m"`, `360000 → "100h 00m"`, `90.9 → "00h 01m"`.
      Sub-minute remainders are dropped, never rounded up. **[MECH][local][CI-matrix]**
- [ ] **DSP-3** `formatIntegrationTime(-1)` throws `RangeError` (asserted by error class, not by
      message text); `-0.5` likewise. No silent clamp to zero. **[MECH][local]**
- [ ] **DSP-4** `Object.keys(FILTER_COLORS).sort()` **equals** `['B','G','Ha','L','OIII','R','SII']`
      — array equality, so an eighth key fails as loudly as a missing one. **[MECH][local][CI-matrix]**
- [ ] **DSP-5** Every `FILTER_COLORS` value matches `/^var\(--filter-[a-z]+\)$/` — no resolved hex
      anywhere in TypeScript. **[MECH][local]**
- [ ] **DSP-6** **Cross-file set equality:** a test parses `theme/tokens.css` and asserts the set of
      declared `--filter-*` token names **equals** the set of token names referenced by
      `display.ts` (the seven from `FILTER_COLORS` plus `--filter-unknown` from `getFilterColor`).
      An orphan token and a dangling reference each fail. **[MECH][local][CI-matrix]**
- [ ] **DSP-7** `getFilterColor` returns `'var(--filter-unknown)'` for each of `'UVIR'`, `'None'`,
      `'none'`, `'Dualband'`, `''`, and an arbitrary unknown string; and returns the exact
      `FILTER_COLORS` value for each of the seven known bands (all seven asserted, not a sample).
      **[MECH][local]**
- [ ] **DSP-8** **Single-source guard (colours):** the substring `var(--filter-` appears in exactly
      one non-test file under `packages/desktop/renderer/src` — `shared/display.ts`. A test asserts
      the matching-file set equals that one path. Any component inlining a filter var fails.
      **[MECH][local][CI-matrix]**
- [ ] **DSP-9** **Single-source guard (formatter):** the substring `3600` appears in no `.ts`/`.tsx`
      file under `packages/desktop/renderer/src` other than `shared/display.ts` and
      `shared/display.test.ts`, asserted as set equality — a component re-deriving hours from
      seconds fails. **[MECH][local][CI-matrix]**
- [ ] **DSP-10** No `HHh MMm`-shaped formatting exists outside `display.ts`: Reviewer confirms the
      diff introduces no other `padStart(2, '0')`-plus-`'h '` construction. **[REVIEW][local]**
- [ ] **DSP-11** `display.ts` is pure: no `fs`, no `electron`, no `window.astrotracker` access, no
      React import. **[MECH][local]** — `grep -nE "from '(node:)?fs|electron|astrotracker" packages/desktop/renderer/src/shared/display.ts`
      returns nothing.

### F. Navigation and routing (issue AC 1)

- [ ] **NAV-1** `app/routes.ts` exports `NAV_ITEMS` whose full array **deep-equals**, in order, the
      six entries below (`toEqual` on the whole array — a seventh entry, a reordering, or a relabel
      all fail). Matches DD-008 §"V1 Navigation" order exactly. **[MECH][local][CI-matrix]**

  ```ts
  [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/targets', label: 'Targets' },
    { path: '/sessions', label: 'Sessions' },
    { path: '/calibration', label: 'Calibration' },
    { path: '/review-queue', label: 'Review queue' },
    { path: '/settings', label: 'Settings' },
  ];
  ```

- [ ] **NAV-2** `Sidebar` renders a `<nav>` landmark containing **exactly six** links
      (`getAllByRole('link')` length asserted as `6`), whose accessible names deep-equal the six
      `NAV_ITEMS` labels in order. **[MECH][local]**
- [ ] **NAV-3** Each of the six routes renders its own placeholder: navigating to each `path` in
      turn asserts the page's `<h1>`/heading text, all six covered in one table-driven test
      (`pages.test.tsx` and/or `App.test.tsx`). **[MECH][local][CI-matrix]**
- [ ] **NAV-4** **Route/nav set equality:** a test asserts the set of `path="…"` values declared in
      `App.tsx` equals `NAV_ITEMS` paths plus exactly the index route and the `*` catch-all — so a
      route added without a nav entry (or a nav entry with no route) fails. Reading `App.tsx` as
      source text is acceptable. **[MECH][local][CI-matrix]**
- [ ] **NAV-5** Exactly **one** link carries `aria-current="page"` at any time: after navigating to
      each destination, the test asserts `container.querySelectorAll('[aria-current="page"]').length === 1`
      **and** that the marked link is the expected one. Two simultaneously-active items fail.
      **[MECH][local]**
- [ ] **NAV-6** Active indication is visual, not only semantic: the active-link CSS rule in
      `Sidebar.module.css` references `var(--color-nav-active-bg)` and `var(--color-nav-active-text)`
      and contains no literal (already covered mechanically by LIT-5; Reviewer confirms the rule
      exists and is keyed off `[aria-current='page']`). **[REVIEW][local]**
- [ ] **NAV-7** Nav items are keyboard reachable: each is a real anchor with a non-empty `href`, and
      a test tabs through the sidebar asserting the six links receive focus in `NAV_ITEMS` order.
      **[MECH][local]**
- [ ] **NAV-8** Focus remains visible: no `.css`/`.module.css` file in the diff contains
      `outline: none` or `outline: 0`; any focus rule uses `var(--color-focus-ring)`.
      **[MECH][local]** — Reviewer: `grep -rnE 'outline:\s*(none|0)' packages/desktop/renderer/src`
      returns nothing.
- [ ] **NAV-9** Default route: rendering `<App/>` with no hash shows the Dashboard placeholder.
      **[MECH][local]**
- [ ] **NAV-10** Unknown hash: navigating to `#/nonexistent` lands on Dashboard with a non-empty
      content area (never a blank `<Outlet/>`). **[MECH][local]**
- [ ] **NAV-11** Router mode: `App.tsx` imports `HashRouter` from `react-router`; the strings
      `BrowserRouter` and `MemoryRouter` appear in no non-test file under
      `packages/desktop/renderer/src`. A `MemoryRouter` used inside `*.test.tsx` for isolated
      component rendering is permitted. **[MECH][local]**
- [ ] **NAV-12** `badgeCount` exists as an optional `NAV_ITEMS`/`Sidebar` field rendered only when
      defined and `> 0`, and **no** item in this issue supplies one (P1-16 owns the real count).
      Test asserts zero badges render with the shipped `NAV_ITEMS`. **[MECH][local]**

### G. App shell and global scan progress

- [ ] **SHL-1** `AppShell` renders the brand mark "AstroTracker" as a heading, the sidebar, a header
      row containing the current page title and the `GlobalScanProgress` slot, and `<Outlet/>`.
      **[MECH][local]**
- [ ] **SHL-2** `GlobalScanProgress` renders **nothing** (no visible text node) when `jobs.list`
      resolves `[]` and no `jobs.progress` event has arrived. **[MECH][local]**
- [ ] **SHL-3** Seeded state: with `jobs.list` resolving one `status: 'running'` job
      (`progressCurrent: 420`, `progressTotal: 1000`), progress is visible **without any
      `jobs.progress` event** — the reload-mid-scan case from the plan's Edge Cases. A component
      that only subscribes fails. **[MECH][local]**
- [ ] **SHL-4** Live update: after a `jobs.progress` event the rendered text reflects the new
      counts. **[MECH][local]**
- [ ] **SHL-5** `progressTotal: null` renders an indeterminate label — the rendered text contains
      neither `NaN` nor `null` nor `/0`. Asserted as a negative match, not just a positive one.
      **[MECH][local]**
- [ ] **SHL-6** A terminal `jobs.progress` (`status: 'succeeded'`/`'failed'`) returns the component
      to rendering nothing. **[MECH][local]**
- [ ] **SHL-7** The `jobs.progress` subscription is torn down on unmount (the mocked `on()`'s
      returned unsubscribe is asserted called) — matching the existing `App.test.tsx` pattern.
      **[MECH][local]**
- [ ] **SHL-8** No IPC surface change: `git diff main...HEAD -- packages/desktop/src/ipc/` is
      **empty**. `GlobalScanProgress` uses only the pre-existing `jobs.list` request and
      `jobs.progress` event via `renderer/src/ipc.ts`; `window.astrotracker` is not touched
      directly by any new component. **[MECH][local]**

### H. DevPanel — relocation without mutation (context item 3)

- [ ] **DEV-1** `DebugPanel.tsx`, `JobDemo.tsx`, and `WatchFolders.tsx` are **byte-unchanged**:
      `git diff --stat main...HEAD -- packages/desktop/renderer/src/DebugPanel.tsx packages/desktop/renderer/src/JobDemo.tsx packages/desktop/renderer/src/WatchFolders.tsx`
      prints nothing. **[MECH][local]**
- [ ] **DEV-2** `DebugPanel.test.tsx` and `WatchFolders.test.tsx` are unchanged and still pass.
      **[MECH][local][CI-matrix]**
- [ ] **DEV-3** `DevPanel` is collapsed by default: before any interaction, none of the seven
      version values and none of the three widget headings ("Worker demo", "Watch folders", "Debug
      panel") are in the DOM. Asserted with `queryBy…` returning null, not by snapshot.
      **[MECH][local]**
- [ ] **DEV-4** After expanding, all three widgets and the full version `<dl>` (App, Electron,
      Chrome, Node, Platform, SQLite, sharp) render — the three scenarios formerly in
      `App.test.tsx` (version fields render, bridge failure surfaces via `role="alert"`, demo job
      progress reaches `running: 50%`) now live in `DevPanel.test.tsx` with identical assertions.
      **[MECH][local][CI-matrix]**
- [ ] **DEV-5** `DevPanel` is mounted once inside `AppShell`, so its toggle is present on all six
      routes (asserted on at least two different routes). **[MECH][local]**
- [ ] **DEV-6** `DevPanel.tsx`'s top-of-file doc comment is the plan Step 11 block verbatim.
      **[MECH][local]** — Reviewer:
      `grep -n "TEMPORARY SCAFFOLDING (P1-13a)" packages/desktop/renderer/src/DevPanel.tsx` matches,
      and the surrounding comment includes "not a committed product surface".
- [ ] **DEV-7** `App.tsx` no longer contains the version `<dl>` or a direct `<JobDemo/>` /
      `<WatchFolders/>` / `<DebugPanel/>` mount; those live only in `DevPanel.tsx`.
      **[MECH][local]**

### I. Dependency and build

- [ ] **DEP-1** `react-router` is added to `packages/desktop/renderer/package.json`
      **`dependencies`** (not `devDependencies`), and `react-router-dom` appears nowhere in that
      file. **[MECH][local]**
- [ ] **DEP-2** `pnpm-lock.yaml` is updated in the same commit and
      `pnpm install --frozen-lockfile` succeeds (CI's install step proves it).
      **[MECH][local][CI-matrix]**
- [ ] **DEP-3** No renderer file imports from `react-router-dom`; every router import is from
      `react-router`. **[MECH][local]**
- [ ] **DEP-4** No dependency beyond `react-router` is added anywhere (no icon library, no CSS
      framework, no `classnames`-style helper). `git diff main...HEAD -- '**/package.json'` shows
      exactly the one addition. **[MECH][local]**
- [ ] **DEP-5** `pnpm -r build` (the repo's typecheck) passes, including the renderer's
      `tsc --noEmit`; CSS-module imports typecheck under the existing `"types": ["vite/client"]`
      setting with no new ambient `.d.ts` beyond, at most, one CSS-modules declaration file.
      **[MECH][local][CI-matrix]**
- [ ] **DEP-6** `pnpm lint` passes, which includes root `prettier --check .` over the **new `.css`
      files** (they are not in `.prettierignore`, so they must be Prettier-formatted).
      **[MECH][local][CI-matrix]**
- [ ] **DEP-7** `BrowserWindow` in `packages/desktop/src/main/index.ts` gains `minWidth` and
      `minHeight`; both are positive and **not greater than** the existing `width: 960` /
      `height: 640` defaults (a minimum larger than the default size would open the window already
      clamped). Exact values are the Coder's call — see **Plan Gaps** #4. **[REVIEW][local]**

### J. Data Integrity

- [ ] **DAT-1** N/A — no table, column, migration, or query is introduced. Verified mechanically:
      `git diff --stat main...HEAD -- packages/db packages/core` prints nothing. **[MECH][local]**
- [ ] **DAT-2** N/A — no persisted value and no timestamp is written by this issue; nothing in the
      diff calls a `repos.*` write. **[MECH][local]**

### K. Core Invariants

- [ ] **INV-1** **Non-destructive guarantee:** no code path in the diff writes, moves, renames, or
      deletes any file. Reviewer:
      `grep -rnE "writeFile|appendFile|rename|unlink|rm\(|rmdir|mkdir|createWriteStream" packages/desktop/renderer/src`
      returns nothing (the theme/DD-008 tests are **read-only** `readFile`/`readdir` users).
      **[MECH][local]**
- [ ] **INV-2** **Layering (DD-002):** every new renderer file references `@astrotracker/desktop`
      only via `import type`; the scoped ESLint rule in `eslint.config.mjs:91` still applies to all
      new files and `pnpm lint` is green. No renderer file imports `fs`, `path`, `electron`, or
      `better-sqlite3` at **runtime** — the theme/DD-008 test files are the sole `node:fs`/
      `node:path` users and are `*.test.ts`, never imported by shipped code.
      **[MECH][local][CI-matrix]**
- [ ] **INV-3** **No new domain logic in the renderer that belongs in `packages/core`:**
      `display.ts` holds presentation only (seconds → string, band → CSS var). It does **not**
      compute integration totals from frames/sessions — that stays a future `packages/core` concern.
      **[REVIEW][local]**
- [ ] **INV-4** All persisted timestamps UTC — N/A, no timestamps handled. **[REVIEW][local]**
- [ ] **INV-5** Manual user overrides survive rescan — N/A, no assignment logic touched.
      **[REVIEW][local]**
- [ ] **INV-6** No `any` without a `// justified:` comment anywhere in the diff (CLAUDE.md).
      **[MECH][local]**

### L. Performance

- [ ] **PRF-1** N/A per plan's Invariant Checklist — placeholder pages hold no unbounded lists, so
      DD-008's virtualization convention is not triggered here; `pnpm bench` is unaffected and must
      show no regression (CI `bench` job). **[MECH][CI-matrix]**
- [ ] **PRF-2** The two filesystem-walking tests (`no-literal-colors`, `tokens`/`dd008-conformance`)
      read each file once and scan a bounded tree; they must not add more than a couple of seconds
      to `pnpm test`. **[REVIEW][local]**

### M. Tests

- [ ] **TST-1** `pnpm test` (root vitest across all projects) is green locally and on all three
      CI-matrix OSes. **[MECH][local][CI-matrix]**
- [ ] **TST-2** `pnpm --filter @astrotracker/renderer test` is green — the renderer suite must not
      depend on being run from the repo root (path-resolution trap, see LIT-7/DOC-4).
      **[MECH][local]**
- [ ] **TST-3** No test in the diff is `.skip`/`.todo`/`.skipIf`-gated. Reviewer:
      `grep -rnE "\.(skip|todo|skipIf|only)\(" packages/desktop/renderer/src packages/desktop/e2e/navigation.spec.ts`
      returns nothing. (The pre-existing `chokidar-watcher.test.ts` skip is untouched and out of
      scope.) **[MECH][local]**
- [ ] **TST-4** Every test file listed in the plan's Affected Files exists and contains at least the
      cases this spec names for it. **[REVIEW][local]**
- [ ] **TST-5** All pre-existing tests still pass unmodified except `App.test.tsx` (rewritten per
      plan Step 12) and `e2e/app-launch.spec.ts` (updated per Step 13). **[MECH][local][CI-matrix]**

### N. E2E on the packaged app (issue AC 4)

- [ ] **E2E-1** `packages/desktop/e2e/navigation.spec.ts` exists, imports `{ expect, test }` from
      `./fixtures.js` (never `_electron` directly — the scoped ESLint rule enforces this), and
      drives `electronApp.app.firstWindow()`. **[MECH][CI-e2e]**
- [ ] **E2E-2** The spec asserts the sidebar contains **exactly six** links before navigating
      (`await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(6)`) — so a
      seventh destination cannot slip past a hardcoded six-item loop. **[MECH][CI-e2e]**
- [ ] **E2E-3** For each of the six destinations in turn: click the sidebar link, assert the
      matching placeholder heading is visible. All six are visited in one run.
      **[MECH][CI-e2e]**
- [ ] **E2E-4** After each click, the spec asserts `aria-current="page"` is on the clicked link
      **and** that exactly one link in the nav carries it
      (`toHaveCount(1)` on `[aria-current="page"]`) — the previously-active item must have lost it.
      **[MECH][CI-e2e]**
- [ ] **E2E-5** `e2e/app-launch.spec.ts` keeps, unchanged in substance: exactly-one-window, the
      `AstroTracker` title, the `getByRole('heading', { name: 'AstroTracker' })` visibility check
      (now satisfied by the shell brand mark), and every `app.version` assertion **including** the
      `sqliteVersion`/`sharpVersion` `not.toBe('unknown')` native-module proof. **[REVIEW][CI-e2e]**
- [ ] **E2E-6** `app-launch.spec.ts` expands `DevPanel` before asserting the
      "Versions reported by the main process over typed IPC:" text and the version values, since
      they now start collapsed. **[MECH][CI-e2e]**
- [ ] **E2E-7** The E2E workflow is green on **both** the windows-latest and macos-latest legs. The
      Reviewer opens the check run explicitly — it is not part of the required `ci-ok` aggregate,
      and it is the only coverage of the relocated watch/job widgets on those platforms.
      **[REVIEW][CI-e2e]**
- [ ] **E2E-8** Reload resilience is preserved by `HashRouter` (plan Edge Case 1). If the Coder adds
      an E2E reload assertion it must navigate to a non-Dashboard page, reload, and assert the same
      page is still shown. If not added in E2E, NAV-11's router-mode grep is the standing proof.
      **[REVIEW][CI-e2e]**

## Mutation Evidence (the #111 lesson, made a deliverable)

A guard that has never been seen to fail is not known to work. The Coder must run each mutation
below against the finished branch, capture the failing test name and message, revert the mutation,
and paste the evidence in the PR description. The Reviewer checks that each mutation produced a
**named** failure in the **expected** test — not merely "the suite went red".

- [ ] **MUT-1** Add `color: #ff0000;` to `Sidebar.module.css` → `no-literal-colors.test.ts` fails,
      naming that file and line. (Proves LIT-5.)
- [ ] **MUT-2** Add `style={{ backgroundColor: 'red' }}` to any `.tsx` → the same test fails naming
      that file. (Proves the JSX half of LIT-5.)
- [ ] **MUT-3** Add `border: 1px solid #333;` to a `.module.css` → fails. (Proves the shorthand
      coverage of LIT-3, which a longhand-only scanner would miss.)
- [ ] **MUT-4** Change one `--filter-ha` value inside the red-night-vision block to equal the dark
      value → `tokens.test.ts` fails on TOK-5. (Proves the DD-008 amendment is really implemented.)
- [ ] **MUT-5** Add a `--color-extra` token to the light block only → `tokens.test.ts` fails on
      TOK-2's key-set equality. (Proves the check is bidirectional.)
- [ ] **MUT-6** Revert `design/DD-008-ux-structure.md:24` to its pre-amendment wording →
      `dd008-conformance.test.ts` fails. (Proves document/code drift is caught.)
- [ ] **MUT-7** Add a seventh `NAV_ITEMS` entry with no matching `<Route>` → NAV-4 fails; add a
      seventh `<Route>` with no `NAV_ITEMS` entry → NAV-4 fails too. Both directions demonstrated.
- [ ] **MUT-8** Add `const c = FILTER_COLORS.Ha` replaced by a literal `var(--filter-ha)` string in
      a component → DSP-8 fails.
- [ ] **MUT-9** Make one component render different text under `data-theme='light'` → THM-4 fails.

## Out of Scope (do not flag these as gaps)

- Real page content for any of the six pages — P1-14 … P1-32.
- The user-facing theme switch and theme persistence across restarts — P1-32. `setTheme` exists as
  an uncalled seam here by design (THM-7).
- The review-queue sidebar badge's real count — P1-16; only the `badgeCount` layout seam ships.
- Per-pipeline-stage breakdown in `GlobalScanProgress` — this issue ships a single aggregate line.
- Onboarding flow, `/` search focus, arrow-key grid navigation, `Cmd/Ctrl+K` palette — DD-008
  conventions scoped to later issues or v1.x.
- Icon assets for nav items — text labels only.
- Explicit DD-008 colours for `UVIR` / `None` / `Dualband` — the neutral `--filter-unknown`
  fallback covers them; DD-008 is deliberately unchanged there (context item 2, DOC-5).
- `packages/core`'s future integration-math function — this issue formats an already-computed
  number only.
- Any `filters` / `bandType` schema or P1-12 normalization change — `FilterColorBand` is a
  display-only type local to `display.ts`.
- Retiring or restructuring `DevPanel` — it is relocated and labelled, not redesigned (context
  item 3).
- Responsive/narrow-window layout beyond `minWidth`/`minHeight`.
- Virtualization — no unbounded list exists yet (plan Invariant Checklist).

## Test Hints

- **tokens parse**: read `theme/tokens.css` as text; split into rule blocks by selector; build
  `base` from `.app-root { … }`, then `dark = base`, `light = {...base, ...block("[data-theme='light']")}`,
  `red = {...base, ...block("[data-theme='red-night-vision']")}`. Assert on the three resolved maps,
  never on raw file text, so declaration order and formatting changes don't cause false failures.
- **no-literal-colors self-test**: keep the detector pure and export it; feed it the LIT-1/LIT-2
  string tables inline. The repo walk is then a thin second test over real files — the detector's
  correctness is proven by fixtures, its reach by the non-empty file-list assertion (LIT-6).
- **theme-invariant DOM (THM-4)**: `const html = container.innerHTML.replace(/data-theme="[^"]+"/, 'data-theme="T"')`
  for each theme; `expect(light).toBe(dark)`; `expect(red).toBe(dark)`.
- **matchMedia spy (THM-2)**: `const spy = vi.fn(); vi.stubGlobal('matchMedia', spy); … expect(spy).not.toHaveBeenCalled();`
  jsdom does not define `matchMedia`, so an accidental call would otherwise throw rather than be
  attributed.
- **bridge mock**: reuse the existing `App.test.tsx` shape —
  `{ invoke: vi.fn(channel => …), on: vi.fn(() => unsubscribe) }` cast to `AstroTrackerBridge`, with
  `jobs.list` returning `[]` by default so `GlobalScanProgress` renders nothing in shell tests.
- **seeded scan progress (SHL-3)**: `jobs.list` resolves one running job
  (`id: 'job-1'`, `jobType: 'scan'`, `status: 'running'`, `progressCurrent: 420`,
  `progressTotal: 1000`, `progressMessage: null`); assert `420` and `1000` appear with **no**
  `jobs.progress` event fired.
- **E2E nav loop**: hardcoding the six labels in the spec is fine **provided** E2E-2's
  `toHaveCount(6)` guard is present; otherwise the loop is blind to a seventh destination.
- **path resolution**: `const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))`
  from `renderer/src/theme/*.test.ts` — verify by asserting the resolved DD-008 path exists before
  reading, so a wrong depth fails with a clear message rather than an ENOENT stack.

## Plan Gaps (underspecified for testing — Reviewer should not treat the Coder's choice as a defect)

1. **The DD-008 text-conformance test is not in the plan.** Plan Step 5 only proves the _CSS_ side
   of the amendment (`tokens.test.ts`). DOC-2/DOC-3 add the document side, per the maintainer's
   requirement that DD-008 and the code cannot drift. The file name
   `theme/dd008-conformance.test.ts` is this spec's suggestion, not the plan's; any location that
   runs under `pnpm test` is acceptable.
2. **Concrete token values are unspecified.** The plan names every token but gives no hex values,
   and DD-008 names hues only qualitatively ("Ha=deep red, OIII=teal, SII=orange-red"). TOK-4/TOK-5
   therefore assert _relationships_ (identical dark↔light, different under red-night-vision) plus a
   committed snapshot, not literal values. The Reviewer should sanity-check the seven dark/light
   values against DD-008's named hues by eye (**[REVIEW]**) and not demand specific codes.
3. **"Chrome tokens differ across all three"** is asserted only for `--color-bg`/`--color-text`
   (TOK-6). Requiring _every_ chrome token to differ would be wrong — `--color-success` may
   legitimately be shared — so the snapshot carries the rest.
4. **`minWidth`/`minHeight` values are unspecified** by the plan. DEP-7 constrains them only
   relative to the existing 960×640 defaults.
5. **`GlobalScanProgress`'s exact copy is unspecified** ("Scanning… 420/1000" is the plan's
   example). SHL-3/SHL-4 assert the numbers are present and SHL-5 asserts the absence of `NaN`/
   `null`, not exact wording.
6. **E2E cannot easily import `NAV_ITEMS`** across the desktop/renderer workspace boundary, so
   E2E-2's count guard substitutes for a shared source of truth in the packaged-app spec.
7. **Vitest's default CSS handling** (`css: false`) means CSS-module class names in
   `ThemeProvider`/shell snapshots are proxy values, not real hashes. That is fine for THM-3/THM-4
   (which compare snapshots to each other), but the Reviewer should not expect real class names in
   the committed snapshots.

Spec written: docs/specs/p1-13a-app-shell.md — 96 criteria (80 mechanically enforced, 16
reviewer-judgement) plus 9 mutation-evidence items
