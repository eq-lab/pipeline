# User Stories: #1313 — Backend: composite Total-Balance series for the LP home graph

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1313](https://github.com/eq-lab/pipeline/issues/1313)
Spec: [docs/product-specs/lp-total-balance.md](../../product-specs/lp-total-balance.md)

API-level stories for `GET /v1/positions/history`. There is no UI in this issue; #1282 and #1629 bind the fields. Run them with `curl` against a live API and a seeded wallet; the pure-compute behavior is also covered by automated tests (listed at the end).

---

## Story 1: Each bucket values the sPLUSD position

**Persona:** LP viewing the home graph.

**Pre-conditions:** A wallet with sPLUSD shares and `share_prices` samples on the chain.

**Steps:**

1. `GET /v1/positions/history?wallet=<wallet>&chain_id=<id>&days=7`.

**Expected outcomes:**

- Every `history[]` item has `splusd_value`, equal to `shares_balance / 10^share_decimals ×` the bucket's closing share price, as a 6-decimal plain string.
- A bucket with no price sample shows the previous bucket's price.
- The last item is the current value.

---

## Story 2: Pending wire-outs show as escrow on Stellar

**Persona:** LP who requested a withdrawal to the bank.

**Pre-conditions:** A Stellar chain with `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`; the wallet has a `WireOutRequested` not yet settled.

**Steps:**

1. Request the history for the wallet.

**Expected outcomes:**

- `wire_out_escrow` is the escrowed amount from the request bucket onward, and returns to `"0.000000"` from the bucket where it is settled or cancelled.
- Each `total_balance` equals `splusd_value + wire_out_escrow`.

---

## Story 3: EVM and minter-less chains omit the escrow term

**Steps:**

1. Request the history on an EVM chain, or on a Stellar chain without the minter key.

**Expected outcomes:**

- No `wire_out_escrow` key. `total_balance` equals `splusd_value`.

---

## Story 4: A wallet with only wire-outs has a history

**Steps:**

1. Request the history, with `days` omitted, for a wallet that has a wire-out request but never held sPLUSD.

**Expected outcomes:**

- `history` is dense from the day of the first request; items show `shares_balance: "0"`, `splusd_value: "0.000000"` and the escrow in `total_balance`.
- `vault_address` is present.

---

## Story 5: A wallet with shares and no price sample

**Steps:**

1. Request the history for a wallet that holds shares on a chain with no `share_prices` rows.

**Expected outcomes:**

- `splusd_value` and `total_balance` are omitted from the items and from the response stats; the rest of the response is unchanged.

---

## Story 6: Y-axis stats

**Steps:**

1. Request the history for a window.

**Expected outcomes:**

- Response-level `splusd_value` and `total_balance` each have `max`, `min` and `average` over the same grid as `history`.

---

## Story 7: PLUSD held in the wallet is not served yet

**Steps:**

1. Request the history for a wallet holding PLUSD but no sPLUSD.

**Expected outcomes:**

- There is no `plusd_balance` field, and `total_balance` does not include the wallet PLUSD (added by #1865). Queue PLUSD, unclaimed deposits and `pending_bank_deposits` are not included either.

---

## Automated coverage

- `packages/api/tests/positions_history_composite.rs` — values, price carry and seed, escrow fold, totals, window start, stats, parsing, plain strings.
- `packages/api/tests/minter_cash_book.rs` — `wire_out_escrow_steps`.
- `packages/shared/tests/position_repo_composite_sql.rs` — `share_price_closing_sql`.
- `packages/api/tests/analytics_pnl_positions_chain.rs` — OpenAPI shape.
