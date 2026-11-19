# User Stories: #2058 — Home: merged Recent activity feed with bank wire-ins and wire-outs

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#2058](https://github.com/eq-lab/pipeline/issues/2058)
Spec: [docs/frontend/dashboard-components.md#activity-feed](../../frontend/dashboard-components.md#activity-feed)

Figma frame `6701:97136` was not readable at planning time; bank rows follow the existing on-chain row pattern. Data comes from the real `GET /v1/requests` (Network tab), no mocks.

---

## Story 1: Bank wires interleave with on-chain rows on the home card

**Persona:** LP with a Stellar wallet that has a bank wire-in and a wire-out.

**Steps:**

1. Sign in on the Stellar view and open `/`.

**Expected outcomes:**

- Recent activity shows at most 5 rows, newest first, mixing on-chain rows with `Add funds` (`+{amount} USD`) and `Withdraw funds` (`−{amount} PLUSD`) rows.
- Bank rows show `Bank transfer · {status}` with the served status verbatim; a missing status, amount or time shows `—`.
- A wire-in is placed by its assignment time when it has one, otherwise its recorded time.
- `View All` still opens `/transactions`.

---

## Story 2: /transactions shows the same rows with tab filtering

**Steps:**

1. Open `/transactions` on the same wallet and switch tabs.

**Expected outcomes:**

- All shows every row in the same order as the home card.
- Buy shows Deposit requests and wire-ins; Sell shows Withdraw requests and wire-outs.
- Stake and Unstake show requests only.
- A wallet with only bank rows does not show the empty state.

---

## Story 3: Wallets without bank movements are unchanged

**Steps:**

1. Open `/` and `/transactions` on an EVM view, or a Stellar wallet with no wires.

**Expected outcomes:**

- Only on-chain rows appear and the layout matches the previous behaviour.
- No bank row, error or placeholder appears when the wire lists are omitted.
