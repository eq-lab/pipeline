# Home Screen States

## Overview

The LP home route (`/`) renders one of six states depending on the combination of account
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
| 4 | Verified, holds PLUSD | wallet connected · PLUSD > 0 · sPLUSD = 0 · KYB `Passed` · bank transfer unlocked | Not yet implemented |
| 5 | Verified, funded, staked | wallet connected · KYB `Passed` · bank transfer received · PLUSD = 0 · sPLUSD > 0 | Not yet implemented |
| 6 | KYB problem | KYB not verified due to a problem (`ChangesRequested` / `Failed`) | Not yet implemented |

## Precedence rule

States are evaluated in the order above; the first matching condition wins.

**State 1 (zero state) wins on the absence of an auth session alone** — an unauthenticated visitor
with a wallet connected still sees the zero state; the wallet connection is ignored for this
decision. Unauthenticated-but-wallet-connected is a distinct combination the product has not
designed yet; it will be added as its own state in a later issue, at which point this precedence
list is revisited.

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

Until states 4–6 land, every other signed-in session renders today's pre-#1419
wallet-connection-driven layout (`deriveHomeState`'s `"legacy"` branch in
`packages/frontend/src/components/homeState.ts`).

## Card composition (states 1–3)

States 1–3 share one desktop composition — a 1136px-wide 7-column grid inside a 1200px white
panel padded 32, matching Figma `6701:98220` (state 1), `6701:97538` (state 2) and `6701:98417`
(state 3):

| Row | Columns | State 1 (zero)                             | State 2 (unverified)                                | State 3 (KYB pending)                                 |
| --- | ------- | ------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| 1   | 1–4     | Get Started promo, 643×274                 | Total Balance placeholder + Connect wallet, 643×274 | Total Balance + `Get PLUSD to start`, 643×274         |
| 1–2 | 5–7     | Recent activity, 478×634                   | Recent activity, 478×634                            | same                                                   |
| 2   | 1–2     | Get PLUSD 313×164 + Stake PLUSD 313×164    | same                                                 | same, Stake CTA disabled as `Nothing to Stake` 160×40 |
| 2   | 3–4     | Add USD (locked) 313×246 + Earnings 313×82 | Verify your account 313×246 + Earnings 313×82       | Verifying account… 313×246 + Earnings 313×82          |
| 3   | 1–7     | FAQ strip, 1136×89                         | same                                                 | same                                                   |

All three states use the **compact** Get PLUSD / Stake PLUSD / Earnings cards — 16px interior
padding, a single 40px rectangular CTA per card (no 128px circular Stake button), and the Figma
copy "Convert with USDC 1:1". The `"legacy"` branch keeps the taller pre-#1419 cards until states
4–6 land and define their own composition.

In state 3 the Total Balance card keeps its served wiring — the heading is the real
`formatBigintCurrency(splusdShares)` (which reads `$0.00` because sPLUSD is zero, a served value
rather than a default) and the chart stays bound to `GET /v1/positions/history`. The
`View Status` CTA on the Verifying card navigates to `/account`, per the Figma node's
`Open Account` annotation and [kyb-lp-verification.md](./kyb-lp-verification.md), which freezes LP
writes while `UnderReview`. The card's heading ships as `Verifying account…`; the Figma frame's
"Veryfying account..." is a typo and is not reproduced.

Values on these cards stay backend-served: the staking APY renders exactly as `GET /v1/stats`
serves it (`—` when absent, with the `" p.a."` suffix kept), and Earnings reads "Tracked once you
stake" until `GET /v1/pnl` serves a total. Nothing on the home grid is computed client-side.
