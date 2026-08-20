# Issue #1125: LP header: add a navigation item opening the Protocol Dashboard (Figma 2074-7187)

Source: https://github.com/eq-lab/pipeline/issues/1125

## Scope

Add a fifth item to the LP app's primary navigation — desktop `TopBar` and `MobileNavMenu` —
that navigates to the existing Protocol Dashboard route `/dashboard`, per Figma node
`2074-7187` (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2074-7187&m=dev).

Design inputs extracted from the Figma node via the local Figma Dev Mode MCP server
(frame `Hovers`, node `2074:7187`):

- **Label:** "Overview" (tooltip text node `5915:77676`).
- **Position:** last — after Activity — separated from it by a **vertical divider**
  (node `5915:77654`: a 20px line rotated 90°, stroke `#383735` at 18% opacity, i.e. the
  existing `--color-pipeline-line` token value).
- **Icon:** the `pie-chart` component (instance node `I5915:77655;9284:21252`, component
  `9284:21252`), 24px slot, glyph inset ~8.33%. Exported vector (3 paths — convert the
  hard-coded fills to `currentColor`; the export carries the inactive-state
  `#383735`/0.3 styling which the `IconButton` active/inactive classes own in code):

  ```svg
  <svg width="20" height="19.9697" viewBox="0 0 20 19.9697" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M9.25 9.96973C9.25 10.1686 9.32907 10.3593 9.46973 10.5L16.5186 17.5488C14.7678 19.056 12.4914 19.9697 10 19.9697C4.47715 19.9697 0 15.4926 0 9.96973C0 4.69923 4.07754 0.383617 9.25 0V9.96973Z"/>
  <path d="M19.0117 5.63184C19.6445 6.94409 20 8.4153 20 9.96973C20 12.4611 19.0863 14.7375 17.5791 16.4883L11.2207 10.1299L19.0117 5.63184Z"/>
  <path d="M10.75 0C13.8705 0.231434 16.5912 1.89331 18.2598 4.33398L10.75 8.66992V0Z"/>
  </svg>
  ```

- The new button uses the same `button-icon` component as the existing four (40×40 max,
  radius 8, hover fill `rgba(184,191,190,0.12)`, tooltip below) — i.e. the existing
  `IconButton` in `@pipeline/ui`, no new button styling.

In scope: new `NavIcon` glyph, `NAV_ITEMS`/`MENU_NAV_ITEMS` entries, the desktop divider,
active-route derivation for `/dashboard`, tests, spec updates.

Scope additions (user request during implementation, same PR — both navbar-local):

- **Mobile network switcher**: `NetworkSwitcher` was `hidden md:block`, so mobile had no
  network indicator at all. Its breakpoint/spacing classes move to the mounts; a "Network"
  row (`mobile-network-switcher`) is added to `MobileNavMenu` between the Pipeline Overview
  divider and the wallet section.
- **Fixed desktop gap**: the switcher previously sat outside the fixed `w-40 justify-end`
  wallet slot, so the visible gap to the wallet pill grew as the balance text shrank. The
  switcher now renders inside the slot (`min-w-40 justify-end gap-2`) — constant 8px gap
  (the Figma Buttons-group gap, node 2074:7196).

Out of scope: changes to the `/dashboard` page itself (epic #712), trustee app navigation,
footer links, and any redesign of the existing four items.

## Assumptions and Risks

- The `/dashboard` route exists and renders the Protocol Dashboard; this issue only links to it.
- The item is visible regardless of wallet connection, like the existing four (the primary
  nav renders unconditionally).
- The Figma node covers the **desktop** header only. The mobile menu mirrors the desktop
  order (Overview last, after Activity) with the same icon + label; the vertical divider is
  treated as desktop-only since the mobile menu design nodes (1989:9231 / 1993:6527) predate
  this item and show no dividers between nav rows. If a mobile Figma update lands later,
  ux-tester will catch the divergence.
- The icon export hard-codes `#383735` fills at 0.3 opacity (the design's inactive tint).
  `NavIcon` glyphs render with `fill="currentColor"` and `IconButton` owns active/inactive
  color — the coder must strip the export's fill/opacity, not copy it verbatim.
- Risk: five items + divider at narrow `md` widths could crowd the middle slot (`gap-8`).
  The Figma frame keeps the same 32px gap; no class change expected, but verify visually.

## Open Questions

_None_ — the three design inputs (label, order, icon) were unresolved at first write and have
been extracted from Figma node 2074:7187 via the local Figma Dev Mode MCP server (recorded
above, with node ids).

## Implementation Steps

1. ✅ **`packages/ui` — icon**:
   - Add `packages/ui/src/assets/icons/nav-overview.svg` with the exported glyph above
     (fills normalized to `currentColor`).
   - In `packages/ui/src/components/NavIcon/NavIcon.tsx`: extend
     `NavIconName` (`"home" | "deposit" | "stats" | "history"`) with `"overview"`, add
     `OVERVIEW_VIEWBOX = "0 0 20 19.9697"` + the three-path constant array (path data
     verbatim from the SVG, per the file's header convention), and the render branch.
2. ✅ **`packages/frontend/src/components/TopBar.tsx`**:
   - Extend `NavItem["key"]` with `"overview"`; append
     `{ key: "overview", label: "Overview", to: "/dashboard" }, // 5915:77655` to
     `NAV_ITEMS`.
   - Render the vertical divider between the Activity and Overview slots inside the
     primary `<nav>`: a `h-5 w-px bg-[var(--color-pipeline-line)]` element (Figma node
     `5915:77654`), `aria-hidden`, `data-testid="topbar-nav-divider"`. Since `NAV_ITEMS`
     is a flat map, insert it via the map (e.g. render before the `overview` item) rather
     than special-casing outside the loop.
   - Extend `derivedActive`: `pathname === "/dashboard"` → `"overview"` (keep the final
     `"home"` fallback).
3. **`packages/frontend/src/components/MobileNavMenu.tsx`** — ⚠ deviation (user
   clarification during implementation): the mobile menu **already renders a
   divider-separated "Pipeline Overview" row** (`mobile-overview-button`, Figma node
   `1989:9444`) that was non-clickable. Instead of appending a new `MENU_NAV_ITEMS` row, wire
   that existing button: `onClick={() => handleNavClick("/dashboard")}`. Keep the
   `MenuNavItem["key"]` union + `activeKey` extension for `/dashboard` → `"overview"` so no
   nav row is falsely highlighted while on the dashboard (no row carries that key).
   ✅ done
4. **Tests** — see Test Strategy. ✅ done (see deviation note in Test Strategy)
5. **Docs** — see Docs to Update. ✅ done
6. **Gate**: `npx tsx scripts/lint-docs.ts`; builds + `tsc --noEmit` for `packages/ui` (if
   applicable) and `packages/frontend`; `yarn vitest run` in `packages/frontend`; `/test-fast`.
   ✅ done — with the pre-existing `TopBar.test.tsx` environment failure (#1003) noted below.

## Test Strategy

- `packages/frontend/src/components/TopBar.test.tsx`:
  - Primary nav renders five items including `topbar-nav-overview` labeled "Overview".
  - Clicking it calls `navigate({ to: "/dashboard" })`.
  - With `pathname = "/dashboard"`, `overview` is active and the others are not (mirror the
    existing active-derivation tests).
  - The divider (`topbar-nav-divider`) renders between Activity and Overview.
- `packages/frontend/src/components/MobileNavMenu.test.tsx`:
  - Menu lists the existing "Pipeline Overview" row; clicking `mobile-overview-button` calls
    `onNavigate("/dashboard")` and closes the menu (22/22 passing).
- ⚠ Note: every test in `TopBar.test.tsx` (32 on a clean tree) fails in this environment with
  `localStorage` undefined — the pre-existing #1003 jsdom breakage, verified by stash-running
  the clean tree. The three new TopBar tests follow the file's existing patterns and will run
  once #1003 is fixed; behavior is additionally covered by the ux-tester Figma pass.
- Edge cases: unknown paths still fall back to `home` active; the four existing items'
  labels/targets unchanged.
- Visual/token verification against Figma node 2074:7187 is the ux-tester's pass (frontend
  flow), not a unit test.

## Docs to Update

- `docs/frontend/dashboard-components.md#topbar` — nav slot list (four → five items +
  divider), active-nav derivation, new Figma node ids (`5915:77655`, `5915:77654`).
- `docs/frontend/dashboard-components.md#mobilenavmenu` — the added Overview row.
- `docs/frontend/ui-components.md#navicon` — extended `NavIconName` union + the new glyph's
  source SVG.
