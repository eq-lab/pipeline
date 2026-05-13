# Issue #117: Add /transactions file-based route in frontend

Source: https://github.com/eq-lab/pipeline/issues/117

## Scope

Frontend-only wiring. Adds a TanStack Router file-based route at `/transactions`
with a placeholder body so `@tanstack/router-plugin` picks it up, regenerates
`routeTree.gen.ts`, and the page becomes reachable in dev. This is a scaffold —
the full composition lands in #125.

In scope:

- New route file: `packages/frontend/src/routes/transactions.tsx`. Renders
  `<TopBar activeNav="history" />` and a single TODO comment that points at
  #125. No layout column, no cards, no styled main element.
- Re-emitted `packages/frontend/src/routeTree.gen.ts` (the plugin owns this
  file; the coder just runs `yarn workspace @pipeline/frontend build` or `dev`
  once so the tree includes `/transactions`, then commits the regenerated
  output).

Out of scope:

- The full transactions/activity page composition — Issue #125 owns that, and
  it explicitly says "replace the placeholder from #117".
- Changes to `TopBar` itself: do NOT add `to: "/transactions"` to the `history`
  `NAV_ITEMS` entry, do NOT extend the `derivedActive` ternary to map
  `/transactions → history`. The Issue body deliberately scopes this slice to
  "Composition lands in a later issue" and passes `activeNav="history"`
  explicitly (which already overrides `derivedActive` via the
  `activeNav ?? derivedActive` precedence). Wiring the history icon to
  navigate to `/transactions` is the natural follow-up but is not asked for
  here — see **Open Questions**.
- The `wallet={…}` prop variant of `TopBar` referenced in #125. That is the
  Issue #112 deliverable ("Extend TopBar to support connected-wallet state");
  it is not yet implemented and is not required for this scaffold.
- New stories, new unit tests for the existing TopBar (it is unchanged).
- Mobile / responsive variants of the page.

## Assumptions and Risks

- **Both listed blockers are CLOSED.** Verified: #38 (`Bootstrap TanStack
  Router file-based routes`) is CLOSED; #51 (`TopBar component`) is CLOSED
  (Issue is in `executed`/CLOSED state). `__root.tsx`, `index.tsx`,
  `deposit.tsx`, the plugin (`TanStackRouterVite()` in
  `packages/frontend/vite.config.ts`), the generated `routeTree.gen.ts`, and
  `packages/frontend/src/components/TopBar.tsx` (with the `history` slot
  already registered in `NAV_ITEMS`) are all in place. Adding the new route
  file is the only source change required.
- **`TopBar` already accepts `activeNav="history"`.** `NAV_ITEMS` defines a
  `"history"` key (`packages/frontend/src/components/TopBar.tsx:98`) and the
  `activeNav` prop is typed as `NavItem["key"]`. Passing
  `activeNav="history"` will paint the history icon active and leave the
  other three muted, with no warnings.
- **`derivedActive` does NOT cover `/transactions`.** Today the ternary at
  `TopBar.tsx:117-122` maps `/deposit → convert`, `/ → home`, everything
  else → `"home"`. On `/transactions` without `activeNav`, the home icon
  would erroneously light up. Because Issue #117 passes `activeNav="history"`
  explicitly, the explicit prop wins and the visual is correct — the
  "everything else → home" default is masked. This is the intended seam: the
  follow-up Issue #112 / #125 can either extend the ternary or rely on the
  explicit prop. Either way, **this Issue does not touch `TopBar.tsx`.**
- **Risk: lint / build still references `activeNav` as the only public hook
  into TopBar's active state.** No change here, but worth flagging — if a
  future refactor removes `activeNav`, this placeholder route breaks.
- **Risk: the generated `routeTree.gen.ts` diff is large and is normally
  hand-off-limits.** The file is committed but auto-generated. The coder must
  run `yarn workspace @pipeline/frontend build` (or `dev` once) so the plugin
  re-emits it, then commit the diff verbatim. Do not hand-edit. The
  `/eslint-disable` + `@ts-nocheck` header at the top of `routeTree.gen.ts`
  already excludes it from linting.
- **Risk: dev server proxy.** `vite.config.ts` proxies `/api` to a configurable
  backend. Our new `/transactions` route does not touch `/api`, so there is
  no overlap. The proxy is unaffected.
- **Test infra is already wired** (vitest + `@testing-library/react`,
  `test-setup.ts`, the `TopBar.test.tsx` pattern). The placeholder route has
  no logic, so no new test file is required — see **Test Strategy**.
- **Test risk: route-tree typing.** `routeTree.gen.ts` extends the
  `FileRoutesByPath` module declaration. The TypeScript `tsc -b` step in
  `yarn build` will fail loudly if the new route is not picked up correctly
  (e.g. wrong `createFileRoute("/transactions")` string). Build success is the
  effective type check for this slice.

## Open Questions

- **Should the `history` icon in `TopBar` navigate to `/transactions` as part
  of this Issue?** Issue #101 (the `/deposit` scaffold) chose to wire the
  dollar icon at the same time, on the rationale that the route is useless
  without an entry point. Issue #117's body does **not** request the
  equivalent for `history` — it says "Composition lands in a later issue"
  and only lists the route file in **Files** / **Acceptance**. The strictly
  minimal read is "no TopBar change". The pragmatic read is "wire it now;
  #125 won't have to". My recommendation: **stay strictly minimal here**
  (route file + regenerated tree only). If the human approver disagrees, the
  one-line extension is to add `to: "/transactions"` to the `history` entry
  in `NAV_ITEMS` and extend `derivedActive` (`pathname === "/transactions"
  ? "history" : …`). Flag this for the gate.

## Implementation Steps

1. **Create the route file** `packages/frontend/src/routes/transactions.tsx`:

   ```tsx
   import { createFileRoute } from "@tanstack/react-router";
   import { TopBar } from "@/components/TopBar";

   /**
    * Transactions / Activity route — placeholder.
    *
    * Full page composition lands in Issue #125. This file exists so
    * TanStackRouterVite picks up the `/transactions` route and regenerates
    * the route tree; the TopBar is rendered with `activeNav="history"` per
    * the Issue body so the page is visually anchored under the right nav
    * slot even before the body is built.
    *
    * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev
    */
   function Transactions() {
     return (
       <>
         <TopBar activeNav="history" />
         {/* TODO(#125): compose the transactions/activity page body. */}
       </>
     );
   }

   export const Route = createFileRoute("/transactions")({
     component: Transactions,
   });
   ```

   - Use the `@/components/TopBar` alias (matches `routes/index.tsx`).
   - Match the import style and `Route` export pattern used in
     `routes/index.tsx` and `routes/deposit.tsx`.
   - Do NOT wrap the TopBar in `<main>` or any styled container. The Issue's
     third acceptance criterion is "No raw colors / sizes; TopBar is the only
     visible content for now" — TopBar already owns its background, border,
     and padding tokens, so a bare fragment is correct.
   - Do NOT add additional imports, layout primitives, or `<Card>`s. The page
     stays intentionally inert until #125.

2. **Regenerate the route tree.**
   - Run `yarn workspace @pipeline/frontend build` (or start `dev` once). The
     `TanStackRouterVite()` plugin in `packages/frontend/vite.config.ts`
     re-emits `packages/frontend/src/routeTree.gen.ts` with the new
     `TransactionsRouteImport`, `TransactionsRoute`, and the corresponding
     entries in `FileRoutesByFullPath`, `FileRoutesByTo`, `FileRoutesById`,
     `FileRouteTypes`, `RootRouteChildren`, and the
     `declare module "@tanstack/react-router"` block.
   - Commit the regenerated file verbatim. Do not hand-edit; the header
     comments at the top already excise it from lint/typecheck.
   - Sanity-check by grepping the regenerated tree:
     ```bash
     grep -n "/transactions" packages/frontend/src/routeTree.gen.ts
     ```
     Expect entries inside the three `FileRoutes*` interfaces, the
     `FileRouteTypes.fullPaths` / `.to` union, and the `declare module` block.

3. **Verify dev render.**
   - `yarn workspace @pipeline/frontend dev`, then open
     `http://localhost:5173/transactions` (or whichever port vite picks).
   - Expect: TopBar visible, history icon active (painted with
     `--color-pipeline-brand`), no console errors, no React warnings about
     missing keys or unknown routes.
   - Also visit `/` and `/deposit` to confirm the existing routes are
     unaffected.

4. **Build & lint gates.**
   - `yarn workspace @pipeline/frontend build` — must succeed (this runs
     `tsc -b` first, which is the type-level acceptance check for the new
     route, then `vite build`, which regenerates the route tree).
   - `yarn workspace @pipeline/frontend lint` — `eslint . && prettier --check
     .` must pass. The new route file follows the same prettier shape as
     `deposit.tsx`; `routeTree.gen.ts` carries its own `/* eslint-disable */`
     header so it stays out of the lint surface.
   - `npx tsx scripts/lint-docs.ts` from the repo root (required by
     `AGENTS.md` after any TS change). The plan + new STORIES line below must
     not regress the docs lint baseline.

5. **Visual sanity-check via Figma** —
   https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev.
   The transactions frame shows the same TopBar with the history icon active
   in the top-right cluster. The placeholder route deliberately renders only
   that bar; comparing the dev server's `/transactions` view against the
   *header band only* of the Figma frame is sufficient — the rest of the
   composition is #125's responsibility. No new screenshot is committed.

## Test Strategy

This Issue is a scaffold; the route component has no branches, no state, no
event handlers. Following the existing convention (`routes/deposit.tsx` ships
without its own route-level test) we do not add a new test file for the route
itself. Instead:

1. **Build smoke test (the canonical acceptance gate, run by the coder and
   re-run by the manager):**
   - `yarn workspace @pipeline/frontend build` — exits 0, no plugin warnings.
     This compiles the route, regenerates `routeTree.gen.ts`, and
     simultaneously exercises the type system across the new route entry.
   - `yarn workspace @pipeline/frontend lint` — exits 0.

2. **Existing unit suite stays green.**
   - `yarn workspace @pipeline/frontend test` (or `vitest run`) — the
     existing `TopBar.test.tsx` continues to pass. We are NOT touching
     `TopBar.tsx` or `TopBar.test.tsx`, so this should be a no-op
     verification.
   - If the human approver answers the Open Question with "yes, wire the
     history icon", THEN extend `TopBar.test.tsx` with two cases mirroring
     the existing `/deposit` ones:
       - Render at `/transactions`; assert `"History"` button has
         `data-active="true"` and `"Home"` is `"false"`.
       - From `/`, click `"History"`; assert the router transitions to
         `/transactions`.
     Add a `vi.mock("@pipeline/ui/assets/icons/nav-history.svg", …)` line if
     not already present (it is — see `TopBar.test.tsx:23-25`).

3. **Manual / `ux-tester` script** (added to `docs/STORIES.md` as part of
   this Issue):
   - From `/`, navigate manually to `/transactions` by typing the URL.
   - Expected: TopBar renders, history icon is active (brand-tinted), no
     console errors, page body is blank below the bar.
   - From `/transactions`, visit `/` and `/deposit`; both still render
     correctly.

4. **Edge cases worth checking by hand:**
   - Hard refresh on `/transactions` — TanStack file-based routes should
     resolve client-side; ensure no 404.
   - `dev` server hot-reload after editing the placeholder body keeps the
     route mounted (proves the plugin picked it up cleanly).

## Docs to Update

- `docs/STORIES.md`: append a short S-117 story so `ux-tester` has a
  regression case ("navigating to `/transactions` renders TopBar with the
  history icon active and an otherwise blank page"). Mirror the shape of
  the S-101 entry for `/deposit`.
- No `docs/product-specs/` or `docs/design-docs/` update: `/transactions`
  already exists in the Figma file and the Issue itself is the spec for this
  scaffold. The #125 follow-up will own the spec/design-doc update for the
  real page.
- No `ARCHITECTURE.md` / `docs/FRONTEND.md` update — routing convention
  (TanStack file-based routes) is already established by Issue #38; this is
  just another route under the same convention.
- After PR merge, the manager moves this plan from
  `docs/exec-plans/active/issue-117-transactions-route.md` to
  `docs/exec-plans/completed/`, per the standard archive flow.
