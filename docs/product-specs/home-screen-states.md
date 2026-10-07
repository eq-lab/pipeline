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
| 2 | Account not verified | account created · KYB bypassed / not completed · wallet not connected | Not yet implemented |
| 3 | KYB pending, empty | wallet connected · PLUSD = 0 · sPLUSD = 0 · KYB `UnderReview` | Not yet implemented |
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

Until states 2–6 land, every signed-in session renders today's pre-#1419
wallet-connection-driven layout (`deriveHomeState`'s `"legacy"` branch in
`packages/frontend/src/components/homeState.ts`).
