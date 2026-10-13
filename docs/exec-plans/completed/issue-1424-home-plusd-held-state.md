# Issue #1424: Home state 4: wallet connected, PLUSD > 0, sPLUSD = 0, KYB passed, bank transfer unlocked

Source: https://github.com/eq-lab/pipeline/issues/1424

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97340&m=dev
— frame `6701:97340` (" PLUSD > 0, sPLUSD = 0, Bank Transfer unlocked")
Branch / worktree: `feat/home-state-plusd-held` at `/Users/luiza/Projects/pipeline-feat-home-state-plusd-held`

## Scope

Add the fifth `deriveHomeState` branch — `"plusd-held"` (state 4 of
`docs/product-specs/home-screen-states.md`) — and render its desktop grid pixel-exact to Figma
frame `6701:97340`.

In scope:

- `deriveHomeState` gains `"plusd-held"`: signed in · wallet connected · `lpRead === "loaded"` ·
  `kyb_status === "Passed"` · PLUSD **not** display-zero · sPLUSD display-zero. Evaluated after
  `"kyb-pending"` and before the `"legacy"` fallback.
- A fifth desktop grid branch in `packages/frontend/src/routes/index.tsx`.
- `PortfolioPlaceholderCard`: new compact variant for the Total Balance card whose sub-line is the
  underlined brand link `Stake PLUSD or Add USD to start earning` (Figma node
  `I6701:97451;1100:70504;6539:2331`).
- `StartHereCard layout="compact"`: new balance mode — eyebrow `PLUSD Balance`, PLUSD glyph + the
  served PLUSD amount at Heading 20, caption `<amount> USDC`, Buy + Sell row (node `6701:97462`).
- `AddUsdCard variant="unlocked"` (node `6701:97494`) mounted on `/` for the first time, with
  `onAddFunds` wired to the existing `FundingDetailsModal` / `useFundingDetailsModal` from #1283.
- `StakeCard layout="compact"` with the CTA **enabled** (`Stake`, 75×40 — node `6701:97492`);
  no new component work expected, only the already-supported `stakeDisabled={false}` path.
- `RecentActivityCard` keeps its existing wiring; with PLUSD held, `useRequests` populates rows and
  the `View All` link (node `6701:97525`, 126×48) appears. No change expected.
- Spec updates: `docs/product-specs/home-screen-states.md` (state 4 row, precedence, card
  composition), `docs/frontend/dashboard-components.md#home-route` (fifth branch table),
  `docs/frontend/bank-transfers.md` (the `unlocked` variant and the `onAddFunds` seam are now
  wired — update the "not yet wired to any route" sentence and the Seams table).
- A user-stories doc at `docs/user-stories/epic-1419/1424-home-plusd-held-state.md`.

Out of scope:

- Mobile. No mobile frame exists for this state; the mobile stack keeps its existing
  `isConnected` + `deriveMobileHomeState("plusd")` rendering, unchanged (same decision as
  #1421/#1422/#1423).
- State 5 (`funded`/staked), state 6 (KYB problem), state 7 (#1460, wallet-only visitor), the
  header/Account changes of #1458 and the Add-email screen of #1459.
- Real trust-account wire details behind `FundingDetailsModal` (#1285 / a backend issue) and the
  `funded` AddUsdCard variant.
- Any client-side derived metric: nothing new is summed, scaled or normalized in the frontend.

## Assumptions and Risks

- **`kyb_status` string.** `"Passed"` is the exact served value per
  `docs/product-specs/kyb-lp-verification.md`; `deriveHomeState` compares raw strings today
  (`"NotStarted"`, `"UnderReview"`) and continues to do so.
- **"Bank transfer unlocked" is not a served field.** The frame's `Transfers unlocked` caption is
  the `unlocked` AddUsdCard variant, and the only gate available is `kyb_status === "Passed"` — the
  same condition as the state itself. No separate "transfers unlocked" flag exists in
  `GET /v1/lps/me`. The plan therefore treats the AddUsdCard variant as a consequence of the state,
  not an extra input.
- **TD-121 still applies.** An unresolved balance reads as displayed-zero, so a `Passed` LP holding
  PLUSD can render state 3's sibling conditions or `"legacy"` for the moment before the balance
  resolves. No loading state is designed; do not invent one.
- **Shared-component churn.** `PortfolioPlaceholderCard` and `StartHereCard` are also used by the
  zero/unverified/kyb-pending branches, the legacy branch and mobile. Every new behaviour must be
  additive and opt-in by prop, with the existing snapshots/tests untouched.
- **Figma radii fallbacks are stale.** `get_design_context` prints `24px`/`8px` literals; the
  applied mode resolves to 4px (`--radius-pipeline-card` / `--radius-pipeline-button`), as recorded
  in `dashboard-components.md`. Do not copy the literals.
- **Open Questions below gate the frontend flow.** Questions 1 and 3 change what renders; do not
  start the Total Balance binding or the Buy/Sell treatment before they are answered.

## Open Questions

1. **What value does the state-4 Total Balance heading bind to?** The frame shows `$1,000.00`,
   equal to the PLUSD holding, but the shipped card binds the heading to the served sPLUSD position
   (`formatBigintCurrency(splusdSharesActive)`), which renders `$0.00` here since sPLUSD = 0. No
   endpoint serves a combined total (`/v1/positions/history`, `/v1/pnl`, `/v1/financial-position`
   checked), and adding PLUSD + sPLUSD-in-PLUSD in the frontend is exactly the derived metric the
   project forbids. Keep the honest `$0.00` (and accept the Figma delta), or is a backend total
   wanted first?
2. **Where does `Stake PLUSD or Add USD to start earning` navigate?** One underlined link, two
   actions in the copy. Proposed: `/stake?tab=stake`, matching the existing
   `Stake PLUSD to start earning` link in the balance variant. Confirm, or should it instead open
   the Add-funds modal / split into two links?
3. **Buy / Sell treatment.** In this frame Buy is a grey-tinted pill
   (`rgba(184,191,190,0.12)` fill, primary ink — node `6701:97475`) and Sell is untinted with
   60%-alpha ink (`6701:97476`), whereas states 1–3 ship Buy as navy `primary-blue` and Sell as
   `secondary` (full ink, 32% when disabled). Do we add a tinted Button treatment (and a muted Sell
   label) scoped to the compact balance mode to match the frame, or keep the shipped navy/ink pair
   for consistency across #1419?
4. **Add Funds modal content in production.** `FundingDetailsModal` has no backend endpoint;
   `FUNDING_DETAILS_PLACEHOLDER` is `/test`-only fixture data. Proposed: mount it from `/` with no
   `details`, so all six rows render `—` (backend-served-only rule). Confirm that an all-`—` modal
   is acceptable on the real home screen, or should Add Funds stay inert until #1285 serves data?

## Decision log

Answers from the user on the Issue (2026-10-12), unblocking implementation:

1. **Total Balance heading** — no "total" changes in this issue; keep the shipped binding (served
   sPLUSD position, `formatBigintCurrency(splusdSharesActive)`, which renders `$0.00` here). A
   follow-up issue catches up once the backend serves a combined total.
2. **Link target** — split into its two actions, not one link: "Stake PLUSD" navigates to `/stake`
   (`search: { tab: "stake" }`); "Add USD" opens the Add Funds modal (the #1283
   `FundingDetailsModal` / `useFundingDetailsModal`). Both are underlined brand-coloured link/button
   text in the same sentence "Stake PLUSD or Add USD to start earning" — the Figma text node
   (`I6701:97451;1100:70504;6539:2331`) turned out to be a single run, entirely underlined brand
   navy, so the plain words ("or", "to start earning") carry the same typography as the two actions
   rather than being styled differently.
3. **Buy / Sell treatment** — exactly as in Figma, scoped to the new compact balance mode only:
   Buy tinted `rgba(184,191,190,0.12)` fill with a primary-ink label (node `6701:97475`); Sell
   untinted with an ink-**muted** label — the `--color-pipeline-ink-muted` token (node
   `6701:97476`), confirmed against `get_design_context`'s `content-test/secondary` binding, not an
   opacity override. States 1–3's navy/ink Buy/Sell pair is untouched.
4. **Add Funds modal** — keep it as it is: mount the existing `FundingDetailsModal` from `/` with
   no `details`, so all six rows render `—`. Follow-up when the backend serves wire details.

## Implementation Steps

1. **`packages/frontend/src/components/homeState.ts`** — DONE. Extended `HomeState` with
   `"plusd-held"` and added the branch after the `"kyb-pending"` check exactly as specified:
   `isConnected && lpRead === "loaded" && kybStatus === "Passed" && !plusdIsZero && splusdIsZero`.
   The spec-pointer header is unchanged and remains the file's only comment.

2. **`packages/frontend/src/components/homeState.test.ts`** — DONE. Added a
   `deriveHomeState — plusd-held (#1424)` block with the cases listed in the plan, plus the
   neighbouring-`kybStatus` sweep (`NotStarted`/`UnderReview`/`ChangesRequested`/`Failed`/
   `InProgress`, all → `"legacy"`).

3. **`packages/frontend/src/components/PortfolioPlaceholderCard.tsx`** — DONE, with one deviation
   from the plan's pre-decision-log wording: `get_design_context` on node `6701:97451` showed the
   whole sentence "Stake PLUSD or Add USD to start earning" as a **single** underlined brand-navy
   text run — not just two linked substrings — so per the decision log's answer to Question 2 the
   sentence renders as a `<Link to="/stake" search={{ tab: "stake" }}>` for "Stake PLUSD", a plain
   `<button onClick={onAddFunds}>` for "Add USD", and two `<span>`s for "or" / "to start earning",
   all four styled identically (`compactSubtitleClasses` / `sentenceTextClasses`, same brand
   underline). New prop `onAddFunds?: () => void`. No unrealized-PnL caption in this variant.
   Heading binding kept at the served `splusdBalanceFormatted` per decision 1.

4. **`packages/frontend/src/components/StartHereCard.tsx`** — DONE, with one deviation: instead of
   a single `compactBalanceLabel` prop doubling as the mode toggle (ambiguous once the value can
   legitimately be `undefined` while still in balance mode, per the test strategy's `—` case), the
   mode is a separate `compactVariant?: "get-plusd" | "balance"` prop (default `"get-plusd"`, the
   existing copy), with `compactBalanceLabel?: string` carrying only the value. Renders eyebrow
   `PLUSD Balance` (`6701:97465`), PLUSD `CoinIcon` + the `$`-stripped label at Heading 20
   (`6701:97471`), caption `<label> USDC` (`6701:97473`) — both render `—` when
   `compactBalanceLabel` is omitted. Card node id `6701:97462`; Buy `6701:97475` tinted
   `rgba(184,191,190,0.12)` + ink label; Sell `6701:97476` ink-**muted** label (token, not opacity)
   per decision 3 — both only in balance mode, the default compact branch is untouched.

5. **`packages/frontend/src/routes/index.tsx`** — DONE. Added the `homeState === "plusd-held"`
   branch exactly as specified (grid positions, node ids, `data-testid`s all match), with
   `compactVariant="balance"` + `compactBalanceLabel={plusdFormattedActive}` on `StartHereCard` and
   `onAddFunds` wired to both the `PortfolioPlaceholderCard` sentence and `AddUsdCard`.

6. **Add-funds wiring** — DONE. Added `fundingDetailsOpen` state and mounted
   `<FundingDetailsModal open={fundingDetailsOpen} onDismiss={...} />` (no `details`, per decision
   4) at the end of the route's JSX, reusing the component exactly as `routes/test.tsx` does.

7. **Lint/format** — DONE. `npx tsx scripts/lint-docs.ts` (0 errors), `yarn workspace
   @pipeline/frontend lint` (eslint + prettier, clean), `yarn workspace @pipeline/frontend build`
   (tsc + vite, clean), `TZ=UTC yarn workspace @pipeline/frontend test` (2139 passed), plus
   `cargo clippy --all -- -D warnings` and `cargo test --all` (no Rust touched, both green) per the
   coder gate.

## Test Strategy

- **Unit — `homeState.test.ts`**: the six derivation cases in step 2, including each neighbouring
  combination that must fall through to `"legacy"`.
- **Component — `StartHereCard`**: new tests for the compact balance mode (eyebrow, heading value,
  `USDC` caption, `—` when the balance is undefined, Buy/Sell enabled), plus a regression assertion
  that the compact card without the new prop still renders `Start here / Get PLUSD /
  Convert with USDC 1:1`.
- **Component — `PortfolioPlaceholderCard`**: the new variant renders the `Total Balance` eyebrow,
  the served heading, the underlined link with the frame's exact copy and the resolved href, and
  renders **no** unrealized-PnL caption and no `Connect wallet` / `Get PLUSD to start` controls.
- **Component — `AddUsdCard`**: existing `unlocked` tests already cover the copy; add one asserting
  `onAddFunds` fires (the circular CTA is enabled in `unlocked`).
- **Route — `routes/index` tests** (follow the existing #1421/#1422/#1423 route tests): with a
  session, connected wallet, `kyb_status: "Passed"`, non-zero PLUSD and zero sPLUSD, assert the
  grid renders the new portfolio variant, the compact balance card, the enabled `Stake` CTA, the
  `unlocked` AddUsdCard and `EarnedCard`; clicking `Add Funds` opens the funding-details modal;
  and each neighbouring combination (sPLUSD > 0, PLUSD zero, disconnected, `UnderReview`,
  unresolved `lpRead`) still renders its existing branch.
- **Mobile regression**: at <768px the existing mobile stack is unchanged for a PLUSD-holding LP —
  no `Transfers unlocked` copy and no `Stake PLUSD or Add USD to start earning` link on mobile.
- **Figma verification** (required, frame `6701:97340`): compare the rendered desktop grid against
  the frame with the Dev Mode MCP (`get_screenshot` / `get_design_context` on `6701:97340`,
  `6701:97461`, `6701:97493`, `6701:97519`). Geometry to confirm: row 1 = 274, row 2 = 344
  (164 + 16 + 164 and 246 + 16 + 82), columns 642.28 / 477.71 / 313.14 inside the 1136px content
  box, FAQ strip 1136×89, Add Funds circle 128×128 bottom-right of its card, `View All` 126×48.
  The teal connector line leaving the Add Funds circle is a prototype wire, not a visual element —
  not rendered (already recorded in `bank-transfers.md`).
- **Suite**: `/test-fast` (lint + unit + integration) must be green before the PR.

## Docs to Update

- `docs/product-specs/home-screen-states.md` — flip state 4 to Implemented (#1424); add its
  precedence paragraph (all five conditions; which neighbouring combinations fall through to
  `"legacy"`); extend the card-composition section to cover state 4's row-2 differences (PLUSD
  balance card, enabled Stake CTA, `unlocked` AddUsdCard) and record the Total Balance binding
  decided in Open Question 1.
- `docs/frontend/dashboard-components.md#home-route` — the fifth branch table (slot / grid position
  / content with Figma node ids), and the new `PortfolioPlaceholderCard` variant and
  `StartHereCard` compact balance prop in their component sections.
- `docs/frontend/bank-transfers.md` — the `unlocked` variant is now mounted on `/`; update the
  "`unlocked`/`funded` variants are not yet wired to any route" sentence and the Seams table rows
  for `AddUsdCard.onAddFunds` (and `FundingDetailsModal.details`, per Open Question 4).
- `docs/user-stories/epic-1419/1424-home-plusd-held-state.md` — new, modelled on
  `1423-home-kyb-pending-state.md`: the state-4 grid, the Add Funds modal, Buy/Sell/Stake
  behaviour, the neighbouring fall-through states, and mobile unchanged.
- `docs/exec-plans/tech-debt-tracker.md` — only if Open Question 1 or 4 is resolved as a known gap.
