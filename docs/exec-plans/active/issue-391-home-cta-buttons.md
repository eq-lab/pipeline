# Issue #391: Home page Buy/Sell/Stake buttons are no-ops

Source: https://github.com/eq-lab/pipeline/issues/391

## Scope

Wire the three primary CTAs on the home page (`/`) so they navigate to their
target flows instead of being inert:

- **Buy** (`StartHereCard`) → `/deposit` (direction defaults to `deposit`).
- **Stake** (`StakeCard`) → `/stake`.
- **Sell** (`StartHereCard`) → enable and navigate to
  `/deposit?direction=withdraw` (the existing withdraw destination — see
  `packages/frontend/src/routes/withdraw.tsx`, which already redirects there).
  This drops the current hardcoded `disabled` on the Sell button.

In scope:

- `packages/frontend/src/routes/index.tsx` — pass navigation handlers (or
  `Link` wrappers) to `StartHereCard` and `StakeCard`.
- `packages/frontend/src/components/StartHereCard.tsx` — remove the hardcoded
  `disabled` on the Sell button; doc comment update so it no longer claims
  Sell is "disabled/coming-soon".
- Tests: extend `packages/frontend/src/routes/-index.test.tsx` and the
  component tests (or add component tests if missing) to cover the new
  navigation behaviour.

Out of scope:

- Any change to the deposit / withdraw / stake routes themselves.
- Visual redesign of the cards.
- Wiring real protocol data behind the cards.

## Assumptions and Risks

- **Assumption.** `/deposit?direction=withdraw` is the canonical Sell
  destination. Confirmed by `routes/withdraw.tsx` (which redirects to
  `/deposit` with `direction=withdraw`) and by `routes/deposit.tsx`'s
  `validateSearch` accepting `direction=withdraw`.
- **Assumption.** Enabling Sell is acceptable. The Issue explicitly lists
  three options for Sell (wire / hide / keep disabled). Since a withdraw
  flow exists and is reachable today (TopBar / Portfolio card link to it),
  the user-facing inconsistency of an inert Sell button is the bug; wiring
  it is the minimal fix that matches the Buy treatment. If product wants
  Sell to stay hidden, the alternative is to remove the button from
  `StartHereCard` rather than ship it inert — flagged in Open Questions.
- **Risk (small).** The Figma reference (`1497:94556`, `1497:94690`) shows
  Sell with a disabled-looking ghost style. Switching to enabled may break
  visual parity. Mitigation: keep `variant="secondary"` (ghost ink), drop
  only `disabled`; visual diff should be limited to opacity. Confirm via
  ux-tester once implemented.
- **Risk (low).** Tests in `-index.test.tsx` mock TanStack Router's `Link`;
  if we use `useNavigate()` instead of `<Link>`, the existing mock
  scaffolding may need extending. Mitigation: prefer `<Link>` wrapping the
  Button via `asChild`-style composition, or pass a navigation callback
  built from `useNavigate()` — the test already mocks router primitives, so
  either path is workable.

## Open Questions

- Sell behaviour: wire to `/deposit?direction=withdraw` (planner's
  recommendation), keep visibly disabled, or hide entirely? The Issue lists
  all three as possibilities and defers to the implementer.

## Implementation Steps

1. **`packages/frontend/src/components/StartHereCard.tsx`** — remove the
   hardcoded `disabled` attribute on the Sell `<Button>` (line ~193). Update
   the JSDoc block (lines ~12, ~30–34, ~80–86) so it no longer describes Sell
   as disabled/coming-soon; instead describe Sell as the withdraw entry point
   matched to the Buy CTA. Keep `variant="secondary"` so the ghost ink visual
   stays close to the Figma reference.
2. **`packages/frontend/src/routes/index.tsx`** — import `useNavigate` from
   `@tanstack/react-router` and create three handlers inside `Home()`:
   - `onBuy = () => navigate({ to: "/deposit" })`
   - `onSell = () => navigate({ to: "/deposit", search: { direction: "withdraw" } })`
   - `onStake = () => navigate({ to: "/stake" })`
   Pass them into `<StartHereCard onBuy={…} onSell={…} … />` and
   `<StakeCard onStake={…} … />`. Update the JSDoc block at the top of the
   file to note the new wiring (one short sentence near the StartHereCard /
   StakeCard descriptions).
3. **Tests — `packages/frontend/src/routes/-index.test.tsx`** — extend the
   existing TanStack Router mock so `useNavigate` returns a `vi.fn()` whose
   calls can be asserted. Add three cases:
   - Click "Buy" → `navigate` called with `{ to: "/deposit" }`.
   - Click "Sell" → `navigate` called with
     `{ to: "/deposit", search: { direction: "withdraw" } }`.
   - Click "Stake" → `navigate` called with `{ to: "/stake" }`.
   All three should run in the disconnected scenario (where the cards are
   mounted today). If the Buy/Sell/Stake cards are also rendered in the
   connected scenario, add the same assertions there.
4. **Component-level tests (optional but preferred)** — if there is no
   existing `StartHereCard.test.tsx` / `StakeCard.test.tsx`, add minimal
   ones that verify the buttons render enabled, call their `on*` props
   when clicked, and that Sell is no longer `disabled`.
5. **Lint / typecheck / unit test pass.** Run:
   - `npx tsx scripts/lint-docs.ts` (per `AGENTS.md`).
   - The project's frontend test suite (`yarn test` / project equivalent
     via the `test-fast` skill).
6. **Manual verification** — load `/` (disconnected and connected if cheap),
   click each CTA, confirm navigation lands on the right route with the
   expected `direction` query for Sell.

## Test Strategy

- **Integration (route-level)** in `-index.test.tsx`:
  - Mock `useNavigate` and assert handler invocations as in step 3.
  - Continue to cover the existing scenarios (PortfolioPlaceholderCard,
    SegmentedTabs default, height parity) — no regressions.
- **Component-level** (if added): assert
  - Buy/Sell/Stake buttons are present and **not** `disabled`.
  - `onBuy` / `onSell` / `onStake` callbacks fire on click.
- **Edge cases:**
  - Sell route preserves any incoming search params (only `direction` is
    forced) — covered indirectly by the existing
    `-withdraw-redirect.test.tsx` for the `/withdraw` path; our index test
    only needs to confirm the navigate call shape.
  - Disabled-state visual parity verified via ux-tester against Figma node
    `1497:94556` since the planner removes `disabled`.

## Docs to Update

- No product-spec change required (this is a `bug` fix restoring intended
  behaviour, not a behavioural change).
- Inline JSDoc in `StartHereCard.tsx` and `routes/index.tsx` updated as
  described in steps 1 and 2.
- If Sell behaviour is decided to be "hide" (Open Question), revisit
  `docs/product-specs/` for the home dashboard spec to record the decision.
