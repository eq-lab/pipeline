# Issue #466: [FE] Mobile home page: balance states (0/0, has PLUSD, has sPLUSD)

Source: https://github.com/eq-lab/pipeline/issues/466

Sub-issue of Epic #463 (Home page). Frontend flow. Depends on #465 (merged, PR
#471) which shipped the mobile layout shell (responsive `TopBar` +
`MobileNavMenu`, `HomeStatsStrip`, mobile-first single-column home stack at the
`md` 768px breakpoint). Working branch: `feat/466-mobile-home-balance-states`.

## Scope

Implement the three **connected-wallet** balance states of the mobile home page
(`/`) at viewport widths below `md` (768px), pixel-matched to the mobile Figma
frames:

| State | PLUSD | sPLUSD | Figma (mobile) |
|---|---|---|---|
| A — Empty | 0 | 0 | `1988:7074` |
| B — Has PLUSD | > 0 | 0 | `1984:6501` |
| C — Also has sPLUSD | (any) | > 0 | `1886:46777` |

The disconnected state (`1989:8292`) and the desktop layout are **out of
scope** and must remain visually unchanged.

### What changes between the three states (derived from the Figma frames)

This is the heart of the issue: the current #465 mobile stack renders only
**static disconnected placeholders** in the connected branch
(`PortfolioPlaceholderCard` hard-coded `$0.00`, `StartHereCard` "Get PLUSD",
`EarnedCard` "Coming soon", enabled Stake CTA). None of the connected
balance-state strings ("Welcome back", "PLUSD Balance", "Staked PLUSD", "Stake
More", "Nothing to Stake", "Nothing yet", "+$X earning", computed Total
Balance) exist anywhere in the codebase today — **not on desktop either**
(confirmed by grep across `packages/frontend/src`). So this issue is net-new
behaviour, not a re-skin of existing connected cards.

Per-region behaviour the three frames require (mobile only):

1. **Greeting** (`WelcomeHeader`): connected → "Welcome back"; disconnected →
   "Welcome" (current). (Figma title node reads "Welcome back" in all three
   connected frames.)
2. **Portfolio / Total Balance card** (top, replaces today's static
   `PortfolioPlaceholderCard`):
   - State A: Total Balance `$0.00`, link "Get PLUSD to start" → `/deposit`,
     flat/empty chart.
   - State B: Total Balance = PLUSD balance (e.g. `$1,000.00`), link "Stake
     PLUSD to start earning" → `/stake`, growth chart.
   - State C: Total Balance = PLUSD + sPLUSD-in-PLUSD (e.g. `$1,042.80`),
     caption "+$42.80 earning" (green), growth chart.
3. **Left "Balances" card** (`StartHereCard` slot):
   - State A: "Start here / Get PLUSD / $1,000.00 USDC" (eyebrow copy), **Buy
     enabled, Sell disabled**.
   - States B & C: eyebrow becomes "**PLUSD Balance**", value = PLUSD balance
     with PLUSD coin icon, sub-line = "$X.XX USDC", **Buy + Sell both enabled**
     (segmented appearance).
4. **Earned card** (`EarnedCard` slot):
   - States A & B: "Earned / Nothing yet" (muted).
   - State C: "Earned / $21.30" (green value) + a hint info icon.
5. **Stake card** (`StakeCard` slot):
   - State A: "Stake PLUSD / Earn X.XX% p.a. / From senior loan coupons and
     T-bills", circular CTA **disabled** labelled "Nothing to Stake".
   - State B: same copy, circular **Stake** CTA enabled (navy).
   - State C: card becomes "**Staked PLUSD** / 1,000.00 / 1,042.80 sPLUSD"
     with a "**Stake More**" circular CTA **and** an "Unstake" text link.
6. **Recent activity** (`RecentActivityCard`): hidden/empty in State A; visible
   with rows in States B and C. (`RecentActivityCard` already gates on
   `isConnected` + request data — wire it; do not rebuild it.)
7. **Bottom stats strip** (`HomeStatsStrip`): unchanged across states.

### Out of scope (deferred)

- Desktop connected balance states (the matching desktop frames in #463 are
  *reference only* per the issue — confirm in Open Questions, but the issue
  title and DoD are mobile-only). Do **not** restyle the desktop grid.
- Real portfolio chart data — the chart stays the synthetic `usePortfolioChart`
  placeholder; its graduation is tracked in #389. State A/B/C only need the
  chart to render (flat vs growth is cosmetic and already period-driven).
- TVL live data (still hardcoded; separate issue).
- The "Earned" real value source — there is no earned-balance endpoint. State C
  shows a value; see Open Questions for where `$21.30` comes from.

## Assumptions and Risks

- **Assumption (data layer is sufficient):** the connected balances can be
  derived entirely from existing hooks — `useEvmToken({ token: plusdAddress })`
  for the PLUSD balance, `useEvmToken({ token: stakedPlusdAddress })` for the
  sPLUSD share balance, and `useStakedPlusdConvertToAssets(shares)` to convert
  sPLUSD → PLUSD for the Total Balance and "Staked PLUSD" sub-line. The sPLUSD
  vault address is read via `useStakedPlusdAsset` (already used in
  `routes/index.tsx`). No new hooks or ABIs are required for A/B/C except
  reading the sPLUSD ERC-20 balance (same `useEvmToken` shape).
- **Assumption (state selection):** state is purely a function of the two
  balances: `sPLUSD > 0` → State C; else `PLUSD > 0` → State B; else State A.
  Disconnected short-circuits to the existing `/465` disconnected layout.
- **Assumption (mock-driven, no real RPC in tests):** the existing
  `pipeline.mock.wallet.*` localStorage layer drives every read
  (`pipeline.mock.wallet.isConnected`, `…balance.<token>`,
  `…contract.stakedPlusd.asset`, `…contract.stakedPlusd.convertToAssets`).
  `routes/-index.test.tsx` already seeds PLUSD address + balance this way, so
  the three states are reproducible in JSDOM without wagmi.
- **Risk (shared components, desktop regression):** `StartHereCard`,
  `EarnedCard`, `StakeCard`, `PortfolioPlaceholderCard`,
  `RecentActivityCard`, and `WelcomeHeader` are all **shared** between the
  mobile stack and the desktop grid in `routes/index.tsx`. Adding connected
  state behaviour inside these components would change desktop output. To keep
  desktop byte-for-byte unchanged (Scope constraint), the connected
  state-aware variants must be **gated to the mobile stack** — either by
  introducing mobile-specific connected card variants/props consumed only by
  the `md:hidden` mobile block, or by passing explicit "state"/value props from
  `routes/index.tsx` that the desktop block does not pass. Pick the approach in
  step 1 and verify desktop DOM is unchanged.
- **Risk (placeholder Total Balance vs real value):** today's
  `PortfolioPlaceholderCard` hard-codes `$0.00`. States B/C need a computed
  Total Balance and the "+$X earning" caption. This card currently has no value
  props; extending it (or adding a mobile sibling) is required.
- **Risk (FRONTEND.md reuse rules):** any extracted shared component/hook must
  be catalogued in `docs/frontend/utils.md` / `hooks.md`, and an extracted
  component must ship its unit test in the same commit (FRONTEND.md rules 3–5).
- **Risk (token discipline):** every color/size/font must resolve through
  `@pipeline/ui/styles/theme.css` tokens (green "earning"/"Earned" value uses
  the existing positive/chart token — verify the exact token name via Figma
  `get_variable_defs`, do not hardcode a hex).
- **Risk (Stake card mode switch):** in State C the StakeCard fundamentally
  changes content ("Staked PLUSD" balance + "Stake More" + "Unstake" link) vs
  the A/B promo. This is closer to a second card variant than a prop toggle —
  scope it as a distinct connected/staked rendering branch.

## Open Questions

1. **Desktop scope.** The issue title/DoD are mobile-only and #463 lists the
   desktop frames as "for reference". Confirm #466 ships **mobile-only** and
   does NOT implement the desktop connected balance states (those would be a
   separate sub-issue). The plan assumes mobile-only.
2. **Source of the "Earned" value and "+$X earning" caption.** Figma State C
   shows "Earned $21.30" (green) and the Portfolio caption "+$42.80 earning".
   There is no earned-balance API. Should these be (a) derived from
   sPLUSD-vs-deposited delta, (b) a synthetic placeholder like the chart
   (matching #389's deferral), or (c) left as "Nothing yet"/omitted until a
   real source exists? The plan cannot invent a financial figure — need
   direction. (Default if unanswered: render a clearly-placeholder value
   wired to the same synthetic source as the chart, and log the graduation in
   tech-debt / #389.)
3. **Total Balance composition in State C.** Confirm Total Balance =
   `PLUSD balance + convertToAssets(sPLUSD shares)` (PLUSD-denominated), and
   that the "+earning" caption = `TotalBalance − principal`. If "principal" is
   not derivable on-chain, this depends on the answer to Q2.
4. **"Staked PLUSD" two-number display.** Frame C shows "1,000.00" (large) over
   "1,042.80 sPLUSD" (sub-line). Confirm the large number is **shares**
   (sPLUSD count) and the sub-line is the **PLUSD-equivalent**, or vice-versa —
   the labels are ambiguous in the static frame.
5. **State C left card when PLUSD = 0.** Frame C shows "PLUSD Balance / $0.00 /
   $0.00 USDC" with Buy + Sell. Confirm Buy/Sell stay enabled at $0.00 PLUSD in
   State C (i.e. enablement is keyed on "has any position / connected", not on
   PLUSD > 0). The Sell-disabled rule appears specific to State A.
6. **Recent activity data on mobile.** `RecentActivityCard` reads real request
   data via its existing hook. In the mock/dev environment with seeded
   balances but no seeded activity, the connected card will show its empty
   state rather than the rows in the Figma frames. Confirm that is acceptable
   for this issue (rows are illustrative), or whether activity rows must be
   mock-seedable for the user-stories doc.

## Implementation Steps

1. **Choose the desktop-safe state strategy and read current classes.** Decide
   between (a) mobile-only connected card variants vs (b) value/state props
   passed only from the mobile block in `routes/index.tsx`. Re-read the exact
   Tailwind classes and props of `StartHereCard`, `EarnedCard`, `StakeCard`,
   `PortfolioPlaceholderCard`, `RecentActivityCard`, `WelcomeHeader` so every
   change is additive and the desktop grid render is untouched. Pull the three
   frames' tokens via `get_design_context` / `get_variable_defs` (nodes
   `1988:7074`, `1984:6501`, `1886:46777`).

2. **Compute the balance state in `routes/index.tsx`.** Add reads for the
   sPLUSD share balance (`useEvmToken({ token: stakedPlusdAddress })`) and the
   PLUSD-equivalent (`useStakedPlusdConvertToAssets(spShares)`); the PLUSD
   balance read already exists. Derive a `homeState: "empty" | "plusd" |
   "splusd"` selector (only when `isConnected`). Keep all wallet hooks
   unconditional (existing pattern). Pass the derived values/state into the
   mobile-stack cards only.

3. **Greeting** (`WelcomeHeader.tsx`). Add a connected-aware title: "Welcome
   back" when connected, "Welcome" otherwise. Gate so desktop string is
   unchanged unless Q1 says desktop is in scope (it is not, per assumption) —
   pass an explicit prop from the mobile block, or compute from `useEvmWallet`
   and verify desktop frame `1497:94556` still reads "Welcome". (Resolve via
   Q1; if desktop must stay "Welcome", drive the greeting by a prop set only in
   the mobile block.)

4. **Total Balance card** (Portfolio slot). Extend `PortfolioPlaceholderCard`
   (or add a mobile connected sibling) to accept a `totalBalance` display
   value, an optional `earning` caption (State C, green), and the
   state-appropriate CTA link ("Get PLUSD to start" → `/deposit` for State A;
   "Stake PLUSD to start earning" → `/stake` for State B; earning caption for
   State C). Resolve the value source via Q2/Q3. Chart stays synthetic.

5. **Left Balances card** (`StartHereCard` slot). Render the connected
   "PLUSD Balance" variant for States B/C: eyebrow "PLUSD Balance", PLUSD coin
   icon + formatted balance, "$X.XX USDC" sub-line, Buy + Sell both enabled.
   State A keeps the existing "Start here / Get PLUSD / Convert USDC 1:1" with
   Sell disabled. Use `useEvmToken().formattedBalance` for the value.

6. **Earned card** (`EarnedCard` slot). State C → green value + hint icon;
   States A/B → "Nothing yet" (current "Coming soon" copy must change to
   "Nothing yet" per the frames — confirm the disconnected #465 copy does not
   regress). Value source per Q2.

7. **Stake card** (`StakeCard` slot). State A → disabled circular CTA labelled
   "Nothing to Stake". State B → enabled navy "Stake" CTA. State C → "Staked
   PLUSD" balance display (per Q4) + "Stake More" circular CTA + "Unstake"
   text link (→ `/stake` unstake flow). Use the existing `stakeDisabled` prop
   for A; add the staked/connected branch for C. Keep desktop StakeCard usage
   (which only passes `stakeDisabled`) unchanged.

8. **Recent activity** (`RecentActivityCard`). Ensure it is present in the
   mobile stack for States B/C (it already gates on `isConnected` + data) and
   hidden/empty for State A per the frames. No rebuild — only placement/gating.

9. **User-stories doc.** Create
   `docs/user-stories/epic-463/466-mobile-home-balance-states.md` covering all
   three connected states on a ≈402px viewport, each as a seedable scenario via
   `pipeline.mock.wallet.*` keys (isConnected + PLUSD balance + sPLUSD balance
   + convert rate). Add the row to `docs/user-stories/index.md` under Epic
   #463.

10. **Lint, build, test.** Run `npx tsx scripts/lint-docs.ts`, the frontend
    typecheck/build, and the frontend unit/integration suite; fix all errors
    before handoff.

## Test Strategy

- **Unit / integration (Vitest + Testing Library), mock-driven:** extend
  `packages/frontend/src/routes/-index.test.tsx` with a connected `describe`
  block per state, seeding `pipeline.mock.wallet.*` keys (the file already
  shows the PLUSD-balance seeding pattern):
  - **State A (0/0):** "Welcome back"; Total Balance `$0.00`; left card "Get
    PLUSD" with Sell disabled; Stake CTA disabled ("Nothing to Stake"); Earned
    "Nothing yet"; activity absent/empty.
  - **State B (PLUSD>0, sPLUSD=0):** Total Balance = seeded PLUSD; left card
    "PLUSD Balance" with Buy+Sell enabled; Stake CTA enabled; activity present.
  - **State C (sPLUSD>0):** Total Balance includes converted sPLUSD; "+earning"
    caption present; Stake card shows "Staked PLUSD" + "Stake More" + "Unstake";
    Earned shows a value.
  - JSDOM has no media queries — assert on the always-rendered mobile-stack DOM
    and on the responsive utility classes (mirror the existing
    `min-h-[274px]` / class-presence assertions), not computed visibility.
- **Extracted-component tests (FRONTEND.md rule 3):** if any card gains a new
  connected variant component or a shared hook is extracted, ship its focused
  unit test in the same commit.
- **Desktop non-regression:** keep the existing desktop assertions in
  `-index.test.tsx` / `TopBar.test.tsx` green; add an assertion that the
  desktop grid block still renders the unchanged (disconnected-style) cards or
  is otherwise untouched, proving the connected behaviour is mobile-gated.
- **Figma-based visual verification (manual, by the coder before handoff):**
  run the app, resize to 402px, and seed each state via the
  `pipeline.mock.wallet.*` console snippets; compare `/` against frames
  `1988:7074`, `1984:6501`, `1886:46777`. Then confirm desktop (≥768px) is
  visually unchanged against `1497:94556`. (Frontend flow has no separate
  ux-tester phase; the epic QA pass is human-requested via #464.)

## Docs to Update

- `docs/user-stories/epic-463/466-mobile-home-balance-states.md` — new stories
  doc (step 9); required by the issue Definition of Done.
- `docs/user-stories/index.md` — add the #466 row under Epic #463.
- `docs/FRONTEND.md` — extend the **Responsive behavior** section to document
  the three connected mobile balance states and how state is derived from
  wallet balances.
- `docs/frontend/utils.md` / `docs/frontend/hooks.md` — catalogue any extracted
  shared component/hook (e.g. a balance-state selector hook) per FRONTEND.md
  rules 4–5.
- `docs/exec-plans/tech-debt-tracker.md` and/or #389 — if the Earned value /
  earning caption ship as synthetic placeholders (pending Q2), log the
  graduation to a real data source.
- No product-spec change required — `docs/product-specs/dashboards.md` (LP
  Dashboard) describes the data, which is unchanged; this is presentation-only.
