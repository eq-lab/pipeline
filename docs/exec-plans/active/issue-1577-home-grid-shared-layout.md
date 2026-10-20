# Issue #1577: Home: collapse the desktop home-grid branches in `routes/index.tsx` into one shared layout

Source: https://github.com/eq-lab/pipeline/issues/1577 (TD-122; epic #1419 states)

Branch: `feat/1577-home-grid-shared-layout`. Pure refactor — **no visible change**; every one of the
seven `homeState` compositions must render byte-identical markup.

## Scope

`packages/frontend` only.

- Extract the shared desktop grid shell from `routes/index.tsx` (`grid w-full grid-cols-7 gap-4`,
  the absolute-positioned `RecentActivityCard` slot, the `QnaSection` footer) into one layout
  component that takes the varying parts as slots.
- Extract the two repeated compact stacks (StartHere + Stake, AddUsd + Earned) into small slot
  components parameterised by the per-state `data-node-id` and card props.
- `Home` becomes: derive `homeState` → pick the hero card, the balances-stack props and the
  third-slot card for that state → render one `HomeDashboardGrid`.
- Docs: `docs/frontend/dashboard-components.md` Home route section (the "seven branches" wording),
  TD-122 resolved, user-stories doc (regression stories, one per state) + index row.

Out of scope: the mobile stack, `homeState.ts`, any card component, any visual change.

## Assumptions and Risks

- **Byte-identical proof.** Before touching the markup, a temporary vitest block renders each of
  the seven states through the existing `-index.test.tsx` harness and writes the
  `home-dashboard-grid` `outerHTML` to the scratchpad; after the refactor the same block runs again
  and the files are diffed. The block is deleted before commit; the existing 2444-test suite (which
  asserts test ids, node ids, card props and handlers per state) is the committed regression net.
- Seven states today (TD-122 said four when written): `zero`, `wallet-only`, `unverified`,
  `kyb-pending`, `plusd-held`, `kyb-problem`, `legacy`. The `legacy` branch differs structurally
  (non-compact StartHere/Earned, `StakeCard` directly in the third slot, no `padding="md"` on the
  activity card) — the layout component keeps those differences expressible through its slots
  rather than normalising them.
- Per-state card props that differ subtly (e.g. `unverified` and `zero` pass no `stakeDisabled`)
  are preserved exactly; nothing is "cleaned up" in passing.
- The `data-node-id` attributes (Figma anchors used by QA) stay on the same elements.

## Open Questions

_None._

## Implementation Steps

1. Temporary snapshot block in `-index.test.tsx` (not committed): render the seven states, write
   the grid markup to `<scratchpad>/home-grid/before/<state>.html`.
2. `src/routes/-HomeDashboardGrid.tsx` (route-private, `-` prefix): `HomeDashboardGrid({ hero,
   activityPadding?, balances: { nodeId, children }, third, children? })` rendering the grid shell;
   `CompactBalancesStack` and `CompactAddUsdStack` helpers in the same file.
3. `routes/index.tsx`: replace the seven-way ternary with a per-state selection of the slot
   contents feeding one `<HomeDashboardGrid>`.
4. Re-run the snapshot block → `after/`; `diff -r before after` must be empty; delete the block.
5. Docs per **Docs to Update**.

## Test Strategy

`diff -r` of the before/after grid markup for all seven states (step 4); `yarn workspace
@pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/frontend/dashboard-components.md` — Home route section: the grid shell lives in
  `-HomeDashboardGrid.tsx`; per-state composition table wording.
- `docs/exec-plans/tech-debt-tracker.md` — TD-122 resolved.
- `docs/user-stories/epic-1419/1577-home-grid-shared-layout.md` + index row.
