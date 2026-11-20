# User Stories: #1314 — Backend: LP wire-ins on the activity feed

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1314](https://github.com/eq-lab/pipeline/issues/1314)
Spec: [docs/product-specs/minter-cash-book.md](../../product-specs/minter-cash-book.md)

API-level stories for the optional `wire_ins` list of `GET /v1/requests`. There is no UI in this issue; the Recent-activity merge is a follow-up on #1282. Run them with `curl` against a live API with indexed minter events.

---

## Story 1: A direct wire shows as Direct

**Pre-conditions:** A `WireIn` event whose receiver is the LP's `G...` address.

**Steps:**

1. `GET /v1/requests?wallet=<G...>&chain_id=<stellar>`.

**Expected outcomes:**

- `wire_ins` has one item with `status: "Direct"`, a 6-decimal `amount`, `value_date`, `ref_hash` and `recorded_at`, and no `assigned_at`.

---

## Story 2: An assigned escrow shows as Assigned

**Pre-conditions:** A `WireIn` to the minter, later `WireInAssigned` to the LP.

**Steps:**

1. Request the feed for the LP wallet.

**Expected outcomes:**

- The item has `status: "Assigned"` and `assigned_at`, and sorts at the assignment time, above a newer direct wire if assigned later.

---

## Story 3: Unassigned or returned escrow is never listed

**Pre-conditions:** An escrowed `WireIn` that is still unassigned, and another that was `WireInReturned`.

**Steps:**

1. Request the feed for any LP wallet.

**Expected outcomes:**

- Neither wire appears. `wallet=<minter C...>` also lists nothing.

---

## Story 4: Pending filter returns an empty list

**Steps:**

1. `GET /v1/requests?wallet=<G...>&status=pending`.

**Expected outcomes:**

- `wire_ins` is `[]` when a minter chain is in scope.

---

## Story 5: A lower-case wallet still matches

**Steps:**

1. Request the feed with the `G...` address in lower case.

**Expected outcomes:**

- The same `wire_ins` as the canonical upper-case form.

---

## Story 6: No minter chain means no key

**Steps:**

1. Request the feed with an EVM-only scope, or an unconfigured `chain_id`.

**Expected outcomes:**

- The response has no `wire_ins` key; `requests`, `pocket_claims` and `wire_outs` are unchanged.

---

## Story 7: Another LP's wire is never listed

**Pre-conditions:** A direct or assigned wire for LP B.

**Steps:**

1. Request the feed for LP A.

**Expected outcomes:**

- LP B's wire is absent.

---

## Automated coverage

- `packages/shared/tests/contract_logs_repo.rs` — `LP_WIRE_IN_EVENTS_SQL` shape (GIN containment, scoping, no `LOWER`).
- `packages/api/tests/minter_cash_book.rs` — `build_lp_wire_ins` filtering.
- `packages/api/tests/analytics_pnl_positions_chain.rs` — `lp_wire_in_items` mapping and sort, serialisation, OpenAPI, `degrade_minter_list`.
