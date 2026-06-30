# Issue #716: Dashboard route + responsive layout shell

Source: https://github.com/eq-lab/pipeline/issues/716

Sub-issue of epic #712 (Protocol Dashboard). Flow: **frontend** (plan → implement → PR; no QA phase). The epic-level QA pass (#712) will verify the rendered page against Figma.

## Scope

In scope:

- A new TanStack Router file-based route at `/dashboard` (`packages/frontend/src/routes/dashboard.tsx`).
- A navigation entry point to reach `/dashboard`.
- A **responsive / adaptive** layout shell hosting four panel slots (A Balance Sheet, B Deployment Monitor, C Withdrawal Queue, D Yield History): desktop multi-column grid that collapses to a single-column stack on mobile, per Figma frames desktop `3283-12098` and responsive `3283-72387`.
- A shared panel container component plus reusable **loading / empty / error** state presentations that all four panels will consume.
- **Placeholder panels** only — each of the four slots renders the shared container with a title and a placeholder body. Real data wiring and per-panel content land in follow-up sub-issues of #712.
- Integration tests for the route + shell.

Out of scope (explicitly deferred to other #712 sub-issues / epics):

- Real panel data, API calls, and new backend endpoints (Panels A and C have no endpoint yet; B/D are partial — see epic #712 body).
- LP-scoped Home page (epic #463), Operations/Trustee console (#453), contract changes.
- Any change to the four panels' internal content beyond placeholders.

## Assumptions and Risks

- **Routing is file-based.** The repo uses TanStack Router with `@tanstack/router-plugin/vite` and a generated `src/routeTree.gen.ts`. Adding `routes/dashboard.tsx` with `createFileRoute("/dashboard")` regenerates `routeTree.gen.ts` automatically on `vite dev`/`build`. The coder must run dev or build once so the generated file picks up the new route, and commit the regenerated `routeTree.gen.ts` (it is checked in). Do not hand-edit `routeTree.gen.ts`.
- **Nav entry point — confirmed from Figma.** The Protocol Dashboard is reached from the **home page (`/`) "Current APY" stat block**, via the trailing external-link icon button (Figma frame `1497:94556`, stats row `1497:94560`, Current APY cell `1497:94563`, icon button `1497:94564`). That button already exists in code as `HomeStatsStrip.tsx` (node `1497:94564`) but is currently a dead link (`<a href="#" aria-label="View details">`). It is **not** a TopBar slot: the desktop `TopBar` keeps its four icons (the 5th nav icon in the Figma component, `1497:94723`, is `hidden`), and the previously-assumed `MobileNavMenu` "Pipeline Overview" item is **not** the intended entry. Because `HomeStatsStrip` renders on both desktop (in `WelcomeHeader`) and mobile (scrollable strip per `1989:8292`), wiring this one button covers both viewports.
- **Figma frames are now accessible via the Figma MCP** (the file is no longer private; frames `1497:94556`, `3283-12098` were read directly). Exact grid columns, breakpoints, gaps, max-width, and panel order must still be pulled from Figma at implementation time (`get_design_context` / `get_variable_defs`) and encoded — the plan specifies a sensible default structure that the coder reconciles against the frames.
- **Token discipline** (per `docs/FRONTEND.md`): no raw hex/sizes/radii. All colors, spacing, radii, and typography flow through `@pipeline/ui` primitives or Tailwind utilities resolving theme tokens. The `Card` primitive (`packages/ui/src/components/Card/Card.tsx`, `white` variant, default `lg` padding) is the surface to build the panel container on.
- **Code structure rules** (FRONTEND.md): one component per file; view/logic split via co-located `useXxx` hook when logic is non-trivial; shared utils/hooks catalogued in `docs/frontend/{utils,hooks}.md` with tests. The shell is mostly presentational, so a co-located hook may be unnecessary for the placeholder stage — only add one if real derivation appears.
- Risk: panel **order on mobile** may differ from desktop reading order. Confirm against frame `3283-72387` rather than assuming top-to-bottom = A,B,C,D.
- Risk: the dashboard is protocol-wide (not wallet-gated) per the spec, so the shell must render fully **without a connected wallet**. Do not gate the route or panels on wallet connection.

## Open Questions (resolved)

- ~~Desktop navigation entry: fifth `TopBar` slot vs. "Pipeline Overview" item?~~ **Resolved from Figma (`1497:94556`).** Neither: the desktop `TopBar` is unchanged (stays four icons; the 5th nav icon `1497:94723` is `hidden`), and there is no separate "Pipeline Overview" affordance. The Protocol Dashboard is reached from the **"Current APY" external-link icon button on the home page** (`HomeStatsStrip.tsx`, node `1497:94564`). See step 6 for the wiring. No `TopBar.tsx` / `MobileNavMenu.tsx` slot or active-nav changes are required.

## Implementation Steps

1. **Create the route.** Add `packages/frontend/src/routes/dashboard.tsx` exporting `Route = createFileRoute("/dashboard")({ component: Dashboard })`. Mirror the page-root pattern from `routes/transactions.tsx`: a `min-h-screen` root with `bg-[var(--color-pipeline-paper)]` / `text-[color:var(--color-pipeline-ink)]`, and a centred `<main>` content column. The `TopBar` is already mounted globally in `routes/__root.tsx`; do not re-add it. Add a top-of-file doc comment documenting desktop vs mobile structure and the Figma node ids (follow the convention in `index.tsx`/`transactions.tsx`).

2. **Build the responsive shell.** Inside `<main>`, lay out the four panel slots:
   - Desktop (`md:` and up): multi-column CSS grid (e.g. 2-column for the four panels, or the exact column structure from frame `3283-12098`), centred content column with a `max-w-[...]` cap matching the desktop frame, and grid gaps from the design.
   - Mobile (below `md`): single-column flex/`grid-cols-1` stack with the design's side margins (`px-*`) and vertical gaps, in the panel order shown in frame `3283-72387`.
   - Encode breakpoints to match the Figma frames (the home page uses `md` = 768px as the desktop/mobile switch; reuse unless the dashboard frames dictate otherwise).
   - Add `data-testid` hooks (`dashboard-page-root`, `dashboard-main`, one per panel slot, e.g. `dashboard-panel-balance-sheet`) and `data-node-id` traceability attributes as the existing pages do.

3. **Create the shared panel container** at `packages/frontend/src/components/dashboard/PanelContainer.tsx`. One component per file. It wraps `@pipeline/ui` `Card` (`white` variant) and renders a panel `title` header plus a `children` body region. Props: `title`, optional `data-testid`, `children`, and a `state` discriminator (`"ready" | "loading" | "empty" | "error"`) — or expose the states as sibling presentational components (see step 4). Keep it pure/presentational; no data fetching.

4. **Create the reusable state presentations** consumed by all four panels. Add small components under `packages/frontend/src/components/dashboard/`:
   - `PanelLoading.tsx` — skeleton/"Loading…" body using muted-ink token (mirror the loading copy/treatment in `transactions.tsx`).
   - `PanelError.tsx` — error message + Retry button (mirror the error/retry block in `transactions.tsx`; accept an `onRetry` callback).
   - `PanelEmpty.tsx` — empty-state body (reuse `@pipeline/ui` `EmptyState` where it fits; otherwise a simple captioned placeholder).
   These are the components follow-up panel issues will drop their real bodies into. If logic stays trivial, no co-located hook is needed (FRONTEND.md rule 2).

5. **Create the four placeholder panels.** Add `BalanceSheetPanel.tsx`, `DeploymentMonitorPanel.tsx`, `WithdrawalQueuePanel.tsx`, `YieldHistoryPanel.tsx` under `packages/frontend/src/components/dashboard/`, each rendering `PanelContainer` with its title and a placeholder body (e.g. `PanelEmpty` or a "Coming soon" caption). One component per file. The route composes these four into the grid from step 2. Keep them thin so follow-up sub-issues only have to fill the body.

6. **Wire the navigation entry point** in `packages/frontend/src/components/HomeStatsStrip.tsx`. The "Current APY" external-link icon button (node `1497:94564`) is currently a dead link — `<a href="#" aria-label="View details">`. Replace it with a TanStack Router navigation to `/dashboard` (use the router `Link` component, or `useNavigate`, consistent with how other in-app links in the frontend are built), and give it a descriptive `aria-label` (e.g. `"View Protocol Dashboard"`). Keep the existing `iconButtonClasses` styling and 40×40 tap target. Because `HomeStatsStrip` is rendered on both desktop (via `WelcomeHeader`) and mobile (the scrollable strip in `routes/index.tsx`), this single change wires both viewports. **Do not** touch `TopBar.tsx` or `MobileNavMenu.tsx` — no nav slot or active-state changes are needed (see resolved Open Question).

7. **Regenerate and verify routing.** Run the dev server or `yarn workspace @pipeline/frontend build` once so `routeTree.gen.ts` regenerates with the `/dashboard` entry; confirm the route resolves and the page renders without a wallet connected.

8. **Lint.** Run `yarn workspace @pipeline/frontend lint` (eslint + prettier) and `npx tsx scripts/lint-docs.ts` after doc edits. Fix all issues before handing back.

## Test Strategy

Add an integration test `packages/frontend/src/routes/-dashboard.test.tsx` following the existing route-test convention (file prefixed with `-` so it is not treated as a route; see `-transactions.test.tsx`/`-index.test.tsx`). Use `@testing-library/react` + `vitest`, render the route `component`, and assert:

- The page root and `<main>` render (by `data-testid`).
- All four panel containers render with their titles (`dashboard-panel-*` test ids).
- The shell renders with **no wallet connected** (protocol-wide page — no connect gate). Reuse the wagmi/AppKit mock pattern from `-index.test.tsx` only as needed; the shell should not require wallet hooks.
- Responsive structure is exercised at the class level: assert the desktop grid utilities are present on the layout container and the mobile single-column treatment is present (mirror the home test's "card height parity"/class-assertion approach since JSDOM has no real layout).
- Each reusable state presentation: a focused test that `PanelError`'s Retry invokes `onRetry`, `PanelLoading` shows loading copy, and `PanelEmpty` shows its caption. If any shared util/hook is extracted, it ships with its own unit test in the same commit.

Extend `HomeStatsStrip`'s test coverage (add/grow `HomeStatsStrip.test.tsx`) to assert the "Current APY" external-link button navigates to `/dashboard` (e.g. it renders as a router link/button targeting `/dashboard` and is reachable by its accessible label). No `TopBar.test.tsx` / `MobileNavMenu` test changes are needed — the nav slots and active-state derivation are unchanged.

Run `yarn workspace @pipeline/frontend test` and confirm green.

Note: pixel-accurate Figma verification is **not** done in this frontend flow (no QA phase here); it is performed in the epic #712 QA pass against frames `3283-12098` (desktop) and `3283-72387` (responsive). The plan's verification obligation is structural rendering + responsive class behavior + tests.

## Docs to Update

- **No product-spec change.** `docs/product-specs/dashboards.md` already specifies the Protocol Dashboard panels A–D; this issue delivers the shell only and introduces no new product behavior beyond what the spec describes.
- `docs/frontend/utils.md` and/or `docs/frontend/hooks.md` — only if a shared util or reused hook is extracted (catalogue it in the same commit, per FRONTEND.md rules 4–5). The placeholder shell likely needs neither.
- Consider a one-line note in the epic #712 thread (handled by the manager) that the shell sub-issue is complete and panels can build on `PanelContainer` + the state presentations under `packages/frontend/src/components/dashboard/`.
