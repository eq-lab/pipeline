# Home Screen States

## Overview

The LP home route (`/`) renders one of seven states depending on the combination of account
creation / sign-in, wallet connection, KYB status (`NotStarted` / `UnderReview` / `Passed` /
`ChangesRequested` / `Failed`, per [kyb-lp-verification.md](./kyb-lp-verification.md)), and
balances (PLUSD, sPLUSD, bank transfer received). Epic #1419 owns this derivation and its
precedence rule; it is independent of #1282 and of the earlier home-page epic #463 — neither is
replaced or superseded. See [dashboards.md](./dashboards.md) for the rest of the LP Dashboard.

## States

| # | State | Condition | Status |
|---|---|---|---|
| 1 | Zero state | not signed in · no account · wallet not connected | Implemented (#1421) |
| 2 | Account not verified | account created · KYB bypassed / not completed · wallet not connected | Implemented (#1422) |
| 3 | KYB pending, empty | wallet connected · PLUSD = 0 · sPLUSD = 0 · KYB `UnderReview` | Implemented (#1423) |
| 4 | Verified, holds PLUSD | wallet connected · PLUSD > 0 · sPLUSD = 0 · KYB `Passed` · bank transfer unlocked | Implemented (#1424) |
| 5 | Verified, funded, staked | wallet connected · KYB `Passed` · bank transfer received · PLUSD = 0 · sPLUSD > 0 | Not yet implemented |
| 6 | KYB problem | KYB not verified due to a problem (`ChangesRequested` / `Failed`) | Not yet implemented |
| 7 | Wallet connected, no account | wallet connected · not signed in (no email account) · PLUSD = 0 · sPLUSD = 0 | Not yet implemented (#1460) |

## Precedence rule

States are evaluated in the order above; the first matching condition wins.

**State 1 (zero state) requires both no auth session and no connected wallet.** A visitor with
a wallet connected but no session is **state 7** (Figma `7149:16033`, #1460): the wallet is not a
credential — connecting it only lets the visitor see it on the Account page — and the visitor
registers through the Account page's `Add email` row (#1459, the same signup → OTP → session flow
as Create account), with the header showing the account icon instead of Sign In / Sign Up (#1458).
Until #1460 lands, `deriveHomeState` still returns `"zero"` for every sessionless visitor, wallet
or not, so the zero-state grid is what a wallet-only visitor sees today. A connected wallet with a
non-zero balance and no session is still undesigned and keeps falling through to state 1 until a
frame exists.

States 2–6 all presuppose an auth session — their KYB status comes from `GET /v1/lps/me`, which
needs one.

**State 2 (account not verified)** additionally requires the wallet to be disconnected — a
connected wallet with `kyb_status: "NotStarted"` is a combination not yet designed and falls
through to `"legacy"` until it is. An absent LP record (`GET /v1/lps/me` returning 404) is
equivalent to `NotStarted` for this rule: a user who dismissed account setup without ever
submitting a profile has, by definition, not completed KYB. An unknown or failed LP read (the
request is in flight, or it errored) renders `"legacy"` rather than guessing — there is no
designed loading state for the home grid, and request failures do not imply an empty account (see
[kyb-lp-verification.md](./kyb-lp-verification.md)).

**State 3 (KYB pending, empty)** requires all five of: an auth session, a **connected** wallet,
`lpRead === "loaded"`, `kyb_status === "UnderReview"`, and **both** PLUSD and sPLUSD rendering as
zero at two decimal places (the #1186 displayed-zero rule, `isDisplayZero` in
`packages/frontend/src/lib/format.ts`, the same rule that drives the Buy/Sell/Stake CTA disabling).
`UnderReview` with a non-zero balance, or with no wallet connected, is a combination the product
has not designed and falls through to `"legacy"`; an unknown or failed LP read still renders
`"legacy"`, as for state 2. Because an unresolved balance reads as displayed-zero, a connected
`UnderReview` LP that actually holds PLUSD can render state 3 for the moment before the balance
resolves — the same in-flight shape tracked as TD-121.

**State 4 (verified, holds PLUSD)** requires all five of: an auth session, a **connected** wallet,
`lpRead === "loaded"`, `kyb_status === "Passed"`, and PLUSD rendering **non**-zero while sPLUSD
renders zero at two decimal places (the same #1186 displayed-zero rule as state 3). `Passed` with
PLUSD also display-zero, `Passed` with sPLUSD non-zero, `Passed` with no wallet connected, and an
unknown/failed/absent LP read all fall through to `"legacy"` — none of these combinations is
designed. As with state 3, an unresolved PLUSD balance reads as displayed-zero (TD-121), so a
`Passed` LP who actually holds PLUSD can render briefly as `"legacy"` before the balance resolves.
"Bank transfer unlocked" is not an independently served field — it is the
`AddUsdCard variant="unlocked"` rendering, gated by the same `kyb_status === "Passed"` that defines
the state itself; there is no separate "transfers unlocked" flag on `GET /v1/lps/me`.

Until states 5–7 land, every other signed-in session renders today's pre-#1419
wallet-connection-driven layout (`deriveHomeState`'s `"legacy"` branch in
`packages/frontend/src/components/homeState.ts`).

## Card composition (states 1–4)

States 1–3 share one desktop composition — a 1136px-wide 7-column grid inside a 1200px white
panel padded 32, matching Figma `6701:98220` (state 1), `6701:97538` (state 2) and `6701:98417`
(state 3); state 4 (Figma `6701:97340`) reuses the same grid with two of its four cards swapped:

| Row | Columns | State 1 (zero) | State 2 (unverified) | State 3 (KYB pending) | State 4 (PLUSD held) |
| --- | ------- | --------------- | --------------------- | ----------------------- | ---------------------- |
| 1   | 1–4     | Get Started promo, 643×274 | Total Balance placeholder + Connect wallet, 643×274 | Total Balance + `Get PLUSD to start`, 643×274 | Total Balance + `Stake PLUSD or Add USD to start earning`, 642×274 |
| 1–2 | 5–7     | Recent activity, 478×634 | Recent activity, 478×634 | same | same, populated with real activity rows + `View All` |
| 2   | 1–2     | Get PLUSD 313×164 + Stake PLUSD 313×164 | same | same, Stake CTA disabled as `Nothing to Stake` 160×40 | PLUSD Balance 313×164 (Buy tinted, Sell ink-muted) + Stake PLUSD 313×164, CTA enabled |
| 2   | 3–4     | Add USD (locked) 313×246 + Earnings 313×82 | Verify your account 313×246 + Earnings 313×82 | Verifying account… 313×246 + Earnings 313×82 | Add USD (unlocked) 313×246 + Earnings 313×82 |
| 3   | 1–7     | FAQ strip, 1136×89 | same | same | same |

All four states use the **compact** Get PLUSD/PLUSD Balance / Stake PLUSD / Earnings cards — 16px
interior padding, a single 40px rectangular CTA per card (no 128px circular Stake button). States
1–3 keep the Figma copy "Convert with USDC 1:1"; state 4 swaps the left card's content for the
served PLUSD balance (eyebrow "PLUSD Balance", the balance at Heading 20 with the `$` stripped,
caption "`$<amount>` USDC"), rendering `—` for both when the balance is not yet served. The
`"legacy"` branch keeps the taller pre-#1419 cards until states 5–6 land and define their own
composition.

State 4's Buy/Sell row is the one visual exception to "states share one `Button` treatment": Buy is
tinted `rgba(184,191,190,0.12)` with a primary-ink label, and Sell is untinted with an **ink-muted**
label (the `--color-pipeline-ink-muted` token, not an opacity override) — scoped to this state's
compact balance mode only; states 1–3's navy-Buy/ink-Sell pair is unchanged.

In state 3 the Total Balance card keeps its served wiring — the heading is the real
`formatBigintCurrency(splusdShares)` (which reads `$0.00` because sPLUSD is zero, a served value
rather than a default) and the chart stays bound to `GET /v1/positions/history`. The
`View Status` CTA on the Verifying card navigates to `/account`, per the Figma node's
`Open Account` annotation and [kyb-lp-verification.md](./kyb-lp-verification.md), which freezes LP
writes while `UnderReview`. The card's heading ships as `Verifying account…`; the Figma frame's
"Veryfying account..." is a typo and is not reproduced.

**State 4's Total Balance heading keeps the same sPLUSD-position binding as state 3** —
`formatBigintCurrency(splusdSharesActive)`, `$0.00` here since sPLUSD is zero — even though the
Figma frame mocks `$1,000.00` (the PLUSD holding). No endpoint serves a combined PLUSD+sPLUSD
total, and summing them client-side is the derived-metric the project forbids; a backend total is
out of scope for #1424 (human decision, 2026-10-12). The sub-line below it,
"Stake PLUSD or Add USD to start earning", carries two real actions in one underlined brand-navy
sentence: "Stake PLUSD" navigates to `/stake?tab=stake`; "Add USD" opens the `FundingDetailsModal`
(#1283) with no `details`, so all six rows render `—` — the same inert-modal decision #1282 shipped
for `/test`, now reachable from `/` for the first time. `RecentActivityCard` needs no change: with
PLUSD held, `useRequests` already populates real rows and the `View All` link.

Values on these cards stay backend-served: the staking APY renders exactly as `GET /v1/stats`
serves it (`—` when absent, with the `" p.a."` suffix kept), and Earnings reads "Tracked once you
stake" until `GET /v1/pnl` serves a total. Nothing on the home grid is computed client-side.
