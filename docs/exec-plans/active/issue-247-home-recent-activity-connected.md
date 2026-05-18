# Issue #247: Show recent requests on home RecentActivityCard when wallet is connected

Source: https://github.com/eq-lab/pipeline/issues/247

## Scope

When the wallet is connected and `GET /v1/requests` returns rows, the home page's
`RecentActivityCard` (`packages/frontend/src/components/RecentActivityCard.tsx`)
must render the top **3** most recent rows inline using the same `ActivityRow`
visuals as `/transactions`, plus a right-aligned **View All →** link to
`/transactions`. Disconnected and empty / error states keep the current
`ActivityEmptyIllustration` + caption body unchanged.

Row mapping logic (`type` → icon, `status` → tone, amount formatting) is
extracted from `routes/transactions.tsx` into a single shared helper
`packages/frontend/src/components/activity/renderRequestRow.tsx` so the home
card and the `/transactions` page render rows from the same source.

**In scope**

- Wire `useRequests()` into `RecentActivityCard`, gated on
  `useWallet().isConnected`.
- Render the first 3 rows when `data.requests.length > 0`.
- Render a right-aligned **View All →** `<Link to="/transactions">` below the
  list when rows are shown.
- Extract `renderRequestRow(item: RequestItem): ReactNode` (the existing
  `RequestRow` component in `routes/transactions.tsx`, plus its
  `TwoLineAmount` sub-component) into a new file under
  `components/activity/`.
- Repoint `/transactions` to consume the extracted helper. Behavior unchanged.
- Tests for the new connected/empty/loading/error branches on
  `RecentActivityCard`, plus regression coverage on `/transactions`.

**Out of scope**

- Per-row interaction (tap-to-detail). Rows are display-only on both pages.
- Pagination on home — `View All →` covers it.
- Live polling beyond what `useRequests` already does (mock-bridge
  invalidation + React Query defaults).
- Re-styling rows for the narrower home column. If overflow shows up at the
  3/7-grid width, the implementer may tighten `gap` inside the same PR — no
  Figma-fidelity tweaks beyond that.
- Any changes to the `ActivityEmptyIllustration`, `EmptyState`, `Card`, or
  other `@pipeline/ui` primitives.

## Assumptions and Risks

- **N = 3.** The Figma frame (1497:95119) shows a single row with substantial
  whitespace below; combined with the issue's "small cap" wording, 3 fits the
  card height (`min-h-[564px]`) without scrolling. If the implementer finds
  the design genuinely renders a different number, they should update both
  the constant and this plan in the same PR.
- **`useRequests()` is already correctly disabled when disconnected**
  (`enabled: isConnected && !!address` in `useRequests.ts:113`). The card
  doesn't need to re-check `isConnected` for the fetch — only for the
  branching between connected (data/empty/loading/error) and disconnected
  (always empty illustration).
- **The card's `min-h-[564px]` and 564px Figma height are preserved.** Replacing
  the body must not change card height when toggling between states so the
  dashboard grid does not reflow.
- **Loading state.** Per issue scope: while `isLoading`, keep the existing
  empty state body. No skeleton row component is introduced. Same for `error`
  — fall through to the empty state silently rather than surfacing a noisy
  error on the dashboard (matches the issue's "utilitarian is fine" note).
- **Risk: row visual at narrower column.** Home gives the card 3/7 of a
  1200px-capped grid (~430px tier). `ActivityRow` is currently used at
  `max-w-[480px]` on `/transactions`, so it should fit, but the implementer
  must visually verify against Figma and tweak inner gaps if needed.
- **Risk: snapshot drift on `/transactions`.** Lifting `RequestRow` /
  `TwoLineAmount` into a shared helper is behavior-preserving but moves code.
  Re-run `routes/-transactions.test.tsx` to confirm zero regressions.
- **Risk: `Link` from TanStack Router needs to be imported in a non-route
  file.** The repo already does this transitively (see `TopBar.tsx` using
  `useNavigate`/`useRouterState`), and `<Link to="/transactions">` will
  type-check against the generated route tree.

## Open Questions

_None_

## Implementation Steps

1. ✅ **Create `packages/frontend/src/components/activity/renderRequestRow.tsx`.**
   - Export `renderRequestRow(item: RequestItem): React.ReactNode`.
   - Move the existing `RequestRow` component logic (currently
     `routes/transactions.tsx` lines 101–203) verbatim into this helper.
   - Move the `TwoLineAmount` helper (`routes/transactions.tsx` lines 57–99)
     alongside it; export it as a named export (or keep it module-private if
     no other caller needs it — the `RecentActivityCard` does not call it
     directly).
   - Keep all imports (`@pipeline/ui` `ActivityRow`, `AmountPill`, the
     formatters from `@/lib/format`, and `RequestItem` from `@/api`) — no
     additional dependencies.
   - Add a brief docblock that explains both call sites and the rule "row
     visuals stay identical between home and `/transactions`".

2. ✅ **Refactor `packages/frontend/src/routes/transactions.tsx`.**
   - Delete the local `RequestRow` and `TwoLineAmount` definitions.
   - Replace `filtered.map((item, i) => <RequestRow key={i} item={item} />)`
     with
     `filtered.map((item, i) => <React.Fragment key={i}>{renderRequestRow(item)}</React.Fragment>)`,
     or refactor `renderRequestRow` to accept an optional `key` argument so
     the route can spread it directly. The implementer picks whichever reads
     cleaner; behavior must stay identical.
   - Import: `import { renderRequestRow } from "@/components/activity/renderRequestRow";`.
   - No other changes to the route file. The page header, tabs, loading /
     empty / error markers, and the `max-w-[480px]` column all stay.

3. ✅ **Wire data into `packages/frontend/src/components/RecentActivityCard.tsx`.**
   - Convert the file to consume `useWallet()` (`from "@/wallet"`) and
     `useRequests()` (`from "@/api"`).
   - Add a `MAX_ROWS = 3` module constant directly below the existing
     `ILLUSTRATION_WIDTH` constant, with a comment that ties it to the
     1497:95119 Figma frame and notes that the design shows one row with
     plenty of whitespace below.
   - Compute:
     ```ts
     const { isConnected } = useWallet();
     const { data, isLoading, error } = useRequests();
     const requests = data?.requests ?? [];
     const showList =
       isConnected && !isLoading && !error && requests.length > 0;
     ```
   - Replace the existing `<div className="flex min-h-0 flex-1">…<EmptyState …/></div>`
     body slot with a conditional:
     - **`showList === true`**: render
       ```tsx
       <div className="flex min-h-0 flex-1 flex-col gap-4" data-node-id="1497:94569">
         <ul className="flex flex-col">
           {requests.slice(0, MAX_ROWS).map((item, i) => (
             <li key={i}>{renderRequestRow(item)}</li>
           ))}
         </ul>
         <Link
           to="/transactions"
           className={[
             "self-end",
             "font-[family-name:var(--font-body)]",
             "text-[length:var(--text-pipeline-body)]",
             "leading-[var(--text-pipeline-body--line-height)]",
             "text-[color:var(--color-pipeline-ink)]",
             "no-underline hover:underline",
           ].join(" ")}
         >
           View All →
         </Link>
       </div>
       ```
       — exact class list is illustrative; implementer reuses the same token
       utilities already in `routes/transactions.tsx` and ensures no raw
       colors / px sizes are introduced.
     - **otherwise**: render the existing
       `<EmptyState illustration={…} caption="You will see all transactions here" />`
       slot exactly as today (preserves disconnected, loading, error, and
       connected-but-empty states with a single branch).
   - Update the file's top docblock: drop the "Disconnected-state right-column
     card" framing, add a one-paragraph description of the two states
     (connected-with-data vs everything-else), and call out that row visuals
     come from the shared `renderRequestRow` helper. The Figma node reference
     for the connected state is `1497:95119`.
   - Import `Link` from `@tanstack/react-router`.

4. ✅ **Verify the home page composition still passes.**
   - `routes/index.tsx` already renders `<RecentActivityCard />` with the
     existing className for grid placement. No changes there; the card's
     external API (`RecentActivityCardProps = Omit<…, "children">`) stays the
     same, which preserves the type contract for the home composer.

5. ✅ **Run `yarn lint && yarn build` from the workspace root** (or per
   `packages/frontend` if the repo's preferred granularity demands it) and
   fix any TS or lint findings before moving to tests.

## Test Strategy

All new tests use Vitest + `@testing-library/react` + `userEvent`, matching
the existing `routes/-transactions.test.tsx` style.

1. **New file: `packages/frontend/src/components/RecentActivityCard.test.tsx`.**
   - Mock `@/api` exactly as `-transactions.test.tsx` does (a controllable
     `mockUseRequests` returning `{ data, isLoading, error, refetch }`).
   - Mock `@/wallet` to provide a configurable `useWallet` (`isConnected`
     boolean is the only field the card reads).
   - Mock `@tanstack/react-router` to render `Link` as a passthrough that
     forwards `to` onto an `<a href={to}>` so the test can assert it links to
     `/transactions`. Pattern matches `routes/-transactions.test.tsx`.
   - Cases:
     - **Disconnected** (`isConnected = false`, `data = undefined`):
       `ActivityEmptyIllustration` is in the DOM (assert via
       `data-tone="muted"` or by class on the SVG wrapper, matching the
       existing S-202 story TC); "View All" is absent; "Recent activity"
       heading is present.
     - **Connected + 3-row fixture** (one Deposit Completed, one Withdraw
       PendingClaim, one Stake Completed — mirrors the existing
       `-transactions.test.tsx` FIXTURE): three `ActivityRow`s render with
       the expected formatted amount strings (e.g. `+1,000.00 USDC`); the
       `View All →` link is present and has `href="/transactions"` (or the
       passthrough `to` attribute, depending on the router mock shape).
     - **Connected + 5-row fixture**: only 3 rows render. Assert by counting
       `getAllByRole("listitem")` or by checking that the 4th and 5th
       fixture amount strings are absent.
     - **Connected + empty list** (`data = { requests: [] }`): empty-state
       illustration renders; no "View All" link.
     - **Connected + loading** (`isLoading = true`, `data = undefined`):
       empty-state illustration renders; no "View All" link; no thrown
       error.
     - **Connected + error** (`error = new Error("boom")`, `data = undefined`):
       empty-state illustration renders; no "View All" link; no error text
       leaked into the DOM.

2. **Update `packages/frontend/src/routes/-transactions.test.tsx`.**
   - Re-run the suite unchanged after the refactor — the rendered output is
     unchanged, so all assertions must continue to pass.
   - Add one assertion that nails down the shared-helper contract: import
     `renderRequestRow` and call it with each fixture row to confirm it
     produces a non-null React element. This both protects the helper's
     public surface and guarantees the route + card render rows from the
     same code path.

3. **Manual UX verification (handed off by manager to `ux-tester`).**
   - The Issue cites Figma frame `1497:95119`. The implementer must visually
     compare the connected state against that frame (row layout, "View All"
     placement, card height). The `ux-tester` skill will run this pass after
     implementation; no change to its workflow is required from this plan,
     but the plan flags Figma `1497:95119` as the target frame for the
     connected state and `1497:94567` for the unchanged empty state.

4. **Whole-suite gate.** Run `yarn test-fast` from the repo root before
   handing off. Any unrelated failures are not this PR's problem, but the
   new and changed tests must be green.

## Docs to Update

- **`docs/STORIES.md`** — add a new story (next free `S-247` slot) that
  describes the connected-state behavior of the home Recent Activity card,
  with at least one test case mirroring the "Connected + 3 rows → 3
  `ActivityRow`s + View All link" assertion. This keeps the docs-first
  invariant intact and gives `ux-tester` a documented case for the regression
  pass.
- **`packages/frontend/src/components/RecentActivityCard.tsx` docblock** —
  rewrite the header doc to reflect the new dual-state behavior (see
  Implementation Step 3). Not a separate doc file, but called out here so the
  coder doesn't skip it.
- **No product-spec change required.** This issue is a behavior alignment
  with `/transactions`: the home card now shows the same data on a smaller
  surface. The existing transaction-history spec covers the data shape and
  visuals; nothing new is being defined.
- **`docs/exec-plans/active/issue-247-home-recent-activity-connected.md`** —
  this plan file. The manager archives it to `docs/exec-plans/completed/`
  after merge.
