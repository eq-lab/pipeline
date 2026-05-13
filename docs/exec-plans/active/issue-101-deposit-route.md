# Issue #101: Add /deposit file-based route in frontend

Source: https://github.com/eq-lab/pipeline/issues/101

## Scope

Frontend-only wiring. Adds a TanStack Router file-based route at `/deposit` with a placeholder body, and makes the dollar (`Convert`) icon in `TopBar` navigate to it.

In scope:

- New route file: `packages/frontend/src/routes/deposit.tsx` whose component returns `<main>Deposit</main>` (placeholder — the real composition lands in D14).
- `packages/frontend/src/components/TopBar.tsx`: turn the dollar `IconButton` into a navigation control pointing at `/deposit`, and drive the active-nav highlight from the current route rather than the hardcoded `home` default.
- Regenerated `packages/frontend/src/routeTree.gen.ts` (emitted by `@tanstack/router-plugin`).

Out of scope:

- The final D14 deposit page composition.
- Any other route changes, design tokens, or new components.
- Mobile/collapsed nav variants.
- Wiring the remaining nav slots (`markets`, `history`) to routes that do not yet exist.

## Assumptions and Risks

- **Blocker resolved.** Issue #38 (router bootstrap) is CLOSED — `__root.tsx`, `index.tsx`, the plugin, and `routeTree.gen.ts` are all in place. The `deposit.tsx` file will be picked up by `TanStackRouterVite()` automatically on next build/dev run.
- **HTML validity.** `IconButton` renders a native `<button>`. Wrapping it inside TanStack's `<Link>` (an `<a>`) would produce invalid `a > button` HTML. The plan therefore uses TanStack Router's idiomatic `useNavigate()` + an `onClick` handler on the existing `IconButton`, which is the project's "idiomatic equivalent" called out in the Issue. This keeps the primitive (`IconButton`, shared in `@pipeline/ui`) unchanged.
- **Active state.** Today `TopBar` defaults `activeNav` to `"home"`. After this change the active slot must follow the current URL so that landing on `/deposit` highlights the dollar icon (acceptance criterion 2). We derive it from `useRouterState({ select: s => s.location.pathname })` and map `"/" → "home"`, `"/deposit" → "convert"`.
- **Test infra.** The frontend currently has no `*.test.tsx` files (vitest is configured via `vite.config.ts` and `src/test-setup.ts`, but nothing exercises it). Adding the first component test is low risk but means the coder will write the first test pattern for the package — acceptable; aligns with the Test Strategy below.
- **Risk: prop API of `TopBar`.** `activeNav` is currently a public prop with a `"home"` default. We will keep the prop (so consumers can still override in stories/tests) but fall back to the route-derived value when the caller does not pass one. The existing call site in `routes/index.tsx` passes no `activeNav`, so behaviour is preserved (it will still highlight `home` on `/`).

## Open Questions

_None_

## Implementation Steps

1. ✅ **Create the route file** `packages/frontend/src/routes/deposit.tsx`:

   ```tsx
   import { createFileRoute } from "@tanstack/react-router";

   function Deposit() {
     return <main>Deposit</main>;
   }

   export const Route = createFileRoute("/deposit")({
     component: Deposit,
   });
   ```

   Match the import style and `Route` export pattern used in `routes/index.tsx`. No `TopBar`, no styling — this is intentionally the placeholder body called out in the Issue; the full page lands in D14.

2. ✅ **Let the plugin regenerate `routeTree.gen.ts`.** Running `yarn workspace @pipeline/frontend dev` or `yarn workspace @pipeline/frontend build` will re-emit the file via `TanStackRouterVite()`. Commit the regenerated `routeTree.gen.ts` so CI builds are reproducible (the existing tree is already checked in).

3. ✅ **Update `TopBar.tsx` to make the dollar icon navigate:**

   a. Import the router hooks: `import { useNavigate, useRouterState } from "@tanstack/react-router";`.

   b. Extend `NavItem` with an optional `to?: string` field. Set `to: "/"` for `home` and `to: "/deposit"` for `convert`. Leave `markets` and `history` without a `to` (no route exists yet — they remain inert buttons, matching the "no other route behavior changes" acceptance criterion).

   c. Inside the `TopBar` component:

      - Call `const navigate = useNavigate();`.
      - Call `const pathname = useRouterState({ select: (s) => s.location.pathname });`.
      - Derive `derivedActive`: `"convert"` if `pathname === "/deposit"`, `"home"` if `pathname === "/"`, otherwise `undefined`.
      - Use `activeNav ?? derivedActive ?? "home"` as the effective active key so explicit prop wins, then URL, then the existing default.

   d. In the `NAV_ITEMS.map` callback, pass `onClick={item.to ? () => navigate({ to: item.to }) : undefined}` to each `IconButton`. The existing `aria-label` / `active` props stay.

   e. Remove the now-obsolete `active: true` flag on the `home` item (active state is fully derived from `activeNav` / route). This is a minor cleanup; keep `data-node-id` comments and Figma traceability intact.

4. ✅ **Visual sanity-check via Figma** (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100130&m=dev): the deposit frame uses the same `TopBar`; on `/deposit` the dollar icon must paint with `--color-pipeline-brand` and the home icon must paint with `--color-pipeline-ink-muted`. This is the `1498:100130` design state we are reproducing for the icon highlight only (page body remains the placeholder until D14).

5. ✅ **Lint / typecheck / build:**

   - `yarn workspace @pipeline/frontend build` — must succeed; route tree regenerated.
   - `npx tsx scripts/lint-docs.ts` from the repo root (required by `AGENTS.md` after any TS change).

## Test Strategy

1. **Unit (vitest + @testing-library/react) — `packages/frontend/src/components/TopBar.test.tsx`** (new file, first frontend test):

   - Render `<TopBar />` inside a memory router seeded at `/`. Assert that the icon button labelled `"Home"` has `data-active="true"` and the one labelled `"Convert"` has `data-active="false"`.
   - Render inside a memory router seeded at `/deposit`. Assert `"Convert"` has `data-active="true"` and `"Home"` has `data-active="false"`.
   - Click the `"Convert"` button on `/`. Assert the router transitions to `/deposit` (assert via `useRouterState` snapshot, or by re-querying that `"Convert"` is now active).

   Set-up: build a minimal in-test router using `createRouter` + `createMemoryHistory` + a root route that renders `<TopBar />` and a `/deposit` route that renders a stub. This becomes the reusable pattern for future route-aware component tests.

2. **Build smoke test (manual, as `manager`/`ux-tester` runs anyway):**

   - `yarn workspace @pipeline/frontend build` — exits 0, no plugin warnings.
   - `yarn workspace @pipeline/frontend dev` — visit `/`, click the dollar icon, URL changes to `/deposit`, page body becomes `Deposit`, dollar icon active. Use browser Back; lands on `/` with home icon active. This is the acceptance scenario from the Issue and the script for `ux-tester`.

3. **Edge cases to exercise in the unit test:**

   - Explicit `activeNav` prop still wins over route-derived state (e.g. `<TopBar activeNav="markets" />` highlights markets even on `/`).
   - Clicking a nav slot without a `to` (e.g. `"Markets"`) does not throw and does not navigate.

## Docs to Update

- `docs/STORIES.md`: add a Deposit-nav story line so `ux-tester` has a regression case ("dollar icon on `/` navigates to `/deposit`; dollar icon is active on `/deposit`"). Pure addition, no behaviour change to existing stories.
- No `docs/product-specs/` or `docs/design-docs/` update needed — `/deposit` already appears in the Figma file and the Issue itself is the spec for this slice. The D14 follow-up will own the spec update for the real page.
- No `ARCHITECTURE.md` / `FRONTEND.md` update — routing convention (TanStack file-based routes) is already established by Issue #38; this is just another route.
