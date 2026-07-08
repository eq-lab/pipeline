# Issue #786: Trustee: implement the app shell (Figma 4116-8855)

Source: https://github.com/eq-lab/pipeline/issues/786

## Scope

Replace the placeholder topbar-based `TrusteeShell` (`packages/trustee/src/components/TrusteeShell.tsx`, from the #777 scaffold) with the persistent app shell from Figma node `4116:8855` ("Aside"): a **fixed 320px left sidebar navigation panel** plus a **flex-1 main content area** that renders the router `<Outlet/>`.

In scope:

- A new left-sidebar `Aside` navigation component, pixel/token-exact per the extracted Figma spec (see design context at `/tmp/figma-shell/get_design_context.txt`, screenshot `/tmp/figma-shell/get_screenshot_0.png`, metadata `/tmp/figma-shell/get_metadata.txt`).
- The overall shell frame: `flex-row` with a fixed `320px` sidebar + `flex-1` main region hosting `RouteGate`/`<Outlet/>`.
- Wiring the existing placeholder routes (`/type1-direct`, `/type2-mpc`, `/type3-council`, `/type4-monitoring`, `/`) into the sidebar nav (see Open Questions #1 for the label→route mapping — needs human confirmation before the nav labels are finalized).
- The bottom account chip (avatar, truncated address from `useTrusteeSession().address`, "Trustee · connected" subtitle, `⋯` affordance).
- Keeping `/sign-in` standalone (no sidebar) while unauthenticated, preserving the current `RouteGate` behavior.
- Mapping every raw hex/rgba from the Figma export to a theme token, or documenting a scoped one-off where no token exists (see Assumptions).
- Nav glyph SVGs (6 icons) — new inline SVGs, since `@pipeline/ui`'s `NavIcon` only ships `home | deposit | stats | history` (see Open Questions #3).

Out of scope:

- Per-flow logic (Types 1–4, issues #780–#782) — routes stay as placeholders.
- The sign-in section UI (#787, closed) and sign-in flow (#791, closed).
- Backend changes; count badges are **not** to be client-computed (see Open Questions #2).
- New shared `@pipeline/ui` components unless a nav-icon/account-chip extraction is explicitly agreed — default to keeping shell-specific pieces inside `packages/trustee`.

## Assumptions and Risks

- **Token mapping.** The Figma variable defs were empty (`{}`), so colors are raw hex/rgba. Confirmed mappings:
  - `#000080` (Aside bg, active label) → `--color-pipeline-brand` (exact, `theme.css:78`).
  - white text / white active surface → `--color-pipeline-on-dark` (#ffffff) / `--color-pipeline-surface` (#ffffff).
  - Font "Inter" in Figma → project body token `--font-body` (`"Graphik LC"…`, `theme.css:72`). Do NOT hardcode Inter.
  - The wordmark → the existing `Logo` component from `@pipeline/ui` (116×32 matches).
- **Token GAPS (scoped one-offs, must be documented inline like `SignInCard.tsx`/`sign-in.tsx` do):**
  - Divider `rgba(235,233,230,0.25)` — no token (235,233,230 = #EBE9E6, a warm off-white for dark surfaces; not in `theme.css`).
  - Account subtitle / `⋯` `rgba(235,233,230,0.7)` — no token.
  - Count-badge bg `rgba(191,189,187,0.24)` — `--color-pipeline-fill-muted` shares the rgb (191 189 187) but has alpha **0.12**, not 0.24 (`theme.css:87`). Not an exact match → treat as a documented one-off unless the reviewer prefers reusing the 0.12 token.
  Risk: introducing dark-sidebar rgba values as arbitrary Tailwind values is consistent with the existing `SignInCard`/`sign-in.tsx` precedent, but a reviewer may prefer adding named tokens to `theme.css`. Flagged, not decided (see Open Questions #7).
- **Sign-in height coupling.** `packages/trustee/src/routes/sign-in.tsx` currently uses `min-h-[calc(100vh-73px)]` (73px = the OLD topbar height). With a sidebar shell there is no topbar, so `/sign-in` should be full viewport height. The shell rework must update that value (to `min-h-screen` or `min-h-[100vh]`) or the sign-in overlay will be short by 73px. Risk of a regression if missed.
- **Nav taxonomy mismatch.** Figma labels (Overview/Origination/Loans/Cash Management/Risk Council/Audit Log) do not match the scaffold's `TRUSTEE_FLOW_TYPES` (Type-1..4). Resolving this touches `flowTypes.ts`, the route paths, and possibly route filenames — a larger blast radius than pure styling. Gated on Open Questions #1.
- **Tall sidebar in Figma.** The frame is 1583px tall because of the `flex-1` spacer (node 4116:8910) pushing the account chip to the bottom of a very tall artboard. In implementation the sidebar is `h-screen` (or `min-h-screen`) with `flex-1` spacer — do not hardcode 1583px.
- **Existing tests.** `packages/trustee/src/routes/-index.test.tsx` and the per-type route tests assert current shell/nav behavior; changing nav labels or structure will require updating them. No `TrusteeShell`-specific test file exists today, but route tests render through `__root.tsx` → shell.
- Dependency: builds on #777 (merged) and the #791 session flow (merged). No unfinished upstream work blocks this, but the nav-taxonomy decision (Open Q #1) is a human gate.

## Open Questions

1. **Nav taxonomy vs placeholder routes.** Figma nav (Overview / Origination / Loans / Cash Management / Risk Council / Audit Log) does not map 1:1 to `TRUSTEE_FLOW_TYPES` (Type-1 Direct / Type-2 MPC / Type-3 RISK_COUNCIL / Type-4 Monitoring). Proposed mapping for confirmation: Overview → `/` (index/landing); Origination/Loans/Cash Management → the Type-1/Type-2 direct-action surfaces; Risk Council → `/type3-council`; Audit Log → part of `/type4-monitoring`. This is a guess — please confirm which nav item routes to which existing path, what "Overview" points at, and whether the placeholder routes/`flowTypes.ts` labels should be renamed to the Figma taxonomy. **Human confirmation required before finalizing nav.**
2. **Count badges (1 / 4 / 3).** Where do these counts come from? Per the project rule [no frontend-computed metrics], they must be backend-served or rendered as nothing — never derived client-side. Is there an API field for these counts, or are badges out of scope for the shell (render the badge slot only when a backend count exists)? Recommend: omit badges in this issue (no backend source yet) and add them when a count endpoint exists. Confirm.
3. **Nav icons.** The 6 glyphs (pie-chart / lightbulb / dollar-in-circle / briefcase / shield / list) are new. `@pipeline/ui`'s `NavIcon` only ships `home | deposit | stats | history` (its `deposit` glyph is a dollar-in-circle and may be reusable for "Cash Management"). The other 5 need new inline SVGs. Should they be added to the shared `NavIcon` component, or kept as trustee-local inline SVGs? Recommend trustee-local for now (trustee-specific taxonomy); confirm. Also: the exact SVG path data lives on the Figma localhost asset server (not on disk) — the coder will need the Figma MCP `get_image`/asset fetch for the 6 SVGs, or a human to export them.
4. **Account chip `⋯` menu + address source.** The address renders from `useTrusteeSession().address` (truncated `0x…`). Does `⋯` open a menu, and does that menu host sign-out (`useTrusteeSession().signOut`)? The old shell had an explicit "Sign out" button; the Figma has only a `⋯`. Recommend `⋯` opens a small menu/popover containing "Sign out" so the affordance isn't lost. Confirm placement/behavior.
5. **Sidebar responsiveness / mobile.** The Figma frame is desktop-only (fixed 320px). Behavior below a breakpoint (collapse to icons? off-canvas drawer? hidden?) is unspecified. Recommend: fixed 320px sidebar on `md+`, and a documented fallback below `md` (e.g. sidebar hidden behind a hamburger, or stacked) — but the exact mobile spec needs confirmation.
6. **Shell vs sign-in route.** Confirm the shell renders the sidebar only for authenticated routes and `/sign-in` stays standalone (current `RouteGate` hides chrome while unauthenticated). This is the intended behavior; flagging only because the sign-in route's `min-h-[calc(100vh-73px)]` must change (see Risks).
7. **Tokens vs arbitrary values.** The three dark-sidebar rgba values (`rgba(235,233,230,0.25)`, `rgba(235,233,230,0.7)`, `rgba(191,189,187,0.24)`) have no theme token. Add named tokens to `packages/ui/src/styles/theme.css`, or keep them as documented scoped arbitrary values (the `SignInCard.tsx` precedent)? Recommend documented one-offs for this issue.

## Implementation Steps

1. **(Blocked on Open Q #1–#5)** Confirm the nav taxonomy→route mapping, badge policy, icon strategy, `⋯` menu behavior, and mobile behavior with the human before writing the nav. Do not guess the final labels.
2. Create the sidebar component `packages/trustee/src/components/TrusteeSidebar.tsx` (name TBD — could stay `TrusteeShell` or split shell vs. sidebar):
   - Root: `flex flex-col bg-[color:var(--color-pipeline-brand)] w-[320px] px-4 py-6 h-screen shrink-0` (16px = px-4, 24px = py-6; 320 = 288 content + 2×16 padding).
   - Wordmark block: `Logo` (width 116, h-32) in a `pb-[26px]` container.
   - Nav items (map from the confirmed taxonomy): each `h-14` (56px), `flex items-center gap-[14px] px-4 rounded-[4px] w-full`, 20px icon slot + label at `font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]`.
     - Active item: `bg-[color:var(--color-pipeline-surface)]` with label `text-[color:var(--color-pipeline-brand)]` — drive off TanStack Router `activeProps`, do not hardcode "Overview" as active.
     - Inactive items: transparent bg, `text-[color:var(--color-pipeline-on-dark)]`.
   - Optional count badge slot (per Open Q #2 — render only when a backend count is supplied; omit entirely if none): `h-5 min-w-5 rounded-[4px] px-[7.5px] bg-[rgba(191,189,187,0.24)]` (documented one-off), `text-[length:var(--text-pipeline-caption)] text-center text-[color:var(--color-pipeline-on-dark)]`.
   - Two dividers wrapped in `py-3` (12px): `border-t border-solid border-[rgba(235,233,230,0.25)]` (documented one-off). Placement: after Overview, and before the Risk Council / Audit Log group.
   - `flex-1` spacer to push the account chip down.
   - Account chip: `border-t border-[rgba(235,233,230,0.25)] flex items-center gap-3 px-2 pt-[11px] pb-[10px]`; 28px avatar circle (`rounded-full size-7 border border-solid border-white`) with a 15px avatar glyph; address `text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-on-dark)]` from `truncateAddress(address)`; subtitle "Trustee · connected" at `text-[length:var(--text-pipeline-caption)] text-[rgba(235,233,230,0.7)]` (documented one-off); `⋯` affordance (18px, `opacity-70`) — wire to a sign-out menu per Open Q #4.
   - Keep/relocate the existing `truncateAddress` helper.
3. Add the 6 nav-icon SVGs (per Open Q #3 decision) — new inline SVGs in `packages/trustee/src/components/` (e.g. `TrusteeNavIcons.tsx`) using verbatim Figma path data (fetched via Figma MCP asset export), `fill="currentColor"`, 20px, so they inherit the item's active/inactive color. Reuse `@pipeline/ui`'s `NavIcon name="deposit"` for the dollar glyph if it matches "Cash Management".
4. Rework the shell frame in `packages/trustee/src/components/TrusteeShell.tsx`:
   - Authenticated: `<div className="flex min-h-screen">` → `<TrusteeSidebar/>` + `<main className="flex-1 min-w-0">` wrapping `<RouteGate/>`/`<Outlet/>`. The main region hosts the routed page; per-flow route components already render their own `<main>`/heading, so reconcile the nesting (the shell's wrapper should be a plain `<div>` if route components own `<main>`, to avoid nested `<main>` landmarks).
   - Unauthenticated / `/sign-in`: render `<RouteGate/>` standalone with NO sidebar (preserve current behavior). Keep the `isAuthenticated` gate.
5. Update `packages/trustee/src/routes/sign-in.tsx`: change `min-h-[calc(100vh-73px)]` to full-height (`min-h-screen`) now that there is no topbar, and update the stale comment referencing the topbar.
6. If Open Q #1 resolves to renaming the taxonomy: update `packages/trustee/src/lib/flowTypes.ts` (labels/paths), the route files under `packages/trustee/src/routes/`, and `routeTree.gen.ts` (regenerated by the TanStack plugin on `dev`/`build` — do not hand-edit). Otherwise keep existing paths and map Figma labels onto them via the nav config only.
7. Update the landing route `packages/trustee/src/routes/index.tsx` if "Overview" becomes the index — reconcile its content with the new shell (it currently lists flow types as `LinkCard`s; may become a genuine Overview page later, out of scope here, but ensure it renders sensibly inside the new frame).
8. Run `yarn workspace @pipeline/trustee lint` and `yarn workspace @pipeline/trustee build`; run `npx tsx scripts/lint-docs.ts` for docs; bring up `yarn workspace @pipeline/trustee dev` (port 5174) for live visual review against the Figma frame.

## Test Strategy

- **Update existing route tests** that render through `__root.tsx` → shell: `packages/trustee/src/routes/-index.test.tsx` and the per-type route tests (`-type1..4`) — any assertion about the old topbar nav labels ("Type 1 · Direct" etc.) or "Sign out" button must be updated to the new sidebar structure/labels.
- **Add a shell/sidebar test** `packages/trustee/src/components/-TrusteeSidebar.test.tsx` (mirroring the repo's `-*.test.tsx` colocated convention) asserting:
  - Sidebar renders the confirmed nav items and the `Logo`.
  - Active-route styling applies to the current route (render at a given path, assert active item has the white surface / brand-label classes or an `aria-current`).
  - Account chip renders the truncated address from a mocked `useTrusteeSession()` and the "Trustee · connected" subtitle.
  - `⋯` menu (if adopted per Open Q #4) exposes sign-out and calls `signOut`.
  - Badge slot renders only when a count is provided (guards the [no frontend-computed metrics] rule).
- **Auth gating test** (extend existing coverage): sidebar is NOT rendered on `/sign-in` while unauthenticated; IS rendered on a protected route when authenticated.
- **Figma verification (manual, required):** run the dev server and compare the rendered sidebar against `/tmp/figma-shell/get_screenshot_0.png` at the desktop frame — check the 320px width, 56px item height, 14px icon-label gap, divider color/placement, active-item white surface, and the bottom account chip. The frontend flow has no ux-tester phase, so this manual pass is the verification gate.
- Edge cases: missing/undefined `address` (render nothing, not "undefined"); very long labels (`whitespace-nowrap` per Figma); no backend counts (no badge).

## Docs to Update

- No product-spec change required — this is presentation chrome for behavior already specified in `docs/product-specs/trustee-dashboard.md` (spec #453). If the nav taxonomy is renamed (Open Q #1), update the `flowTypes.ts` doc-comment and note the label mapping there.
- Update `docs/frontend/` only if a new shared `@pipeline/ui` component is introduced (default: none). If dark-sidebar tokens are added to `theme.css` (Open Q #7), document them there with the Figma node id, matching the existing token comments.
- Log any deferred badge/mobile work in `docs/exec-plans/tech-debt-tracker.md` if the human defers those decisions.
