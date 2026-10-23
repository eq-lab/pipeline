# User Stories: #1626 — Trustee: dates in local time, waterfall as_of at midnight, CCR trend start, compact formatter and other display fixes

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521)
Issue: [#1626](https://github.com/eq-lab/pipeline/issues/1626)
Spec: [docs/frontend/trustee-flows.md#dates](../../frontend/trustee-flows.md#dates)

Trustee app (`packages/trustee`) against staging, with the browser time zone set to a US zone (for example `America/New_York`).

---

## Story 1: Dates show the UTC day

**Persona:** Trustee in a US time zone reviewing a loan whose maturity is 15 Dec 2026 00:00 UTC.

**Steps:**

1. Open the Loans table, the loan detail epoch range and the Origination table.

**Expected outcomes:**

- Maturity, epoch and Submitted/Approved dates read `15 Dec 2026` / `15 Dec`, not `14 Dec`.
- Audit-log and bank-deposit timestamps are unchanged (already UTC).

---

## Story 2: Record Coupon / Record Repayment preview uses the server's now

**Persona:** Trustee opening Record Coupon or Record Repayment; Network tab open.

**Steps:**

1. Enter an amount (Record Coupon) or let the principal prefill (Record Repayment).

**Expected outcomes:**

- The `/v1/loan-book/<id>/waterfall` request has no `as_of` query parameter.
- The "Date received" field still shows today, read-only.
- A loan drawn earlier the same day no longer returns 400 for a midnight `as_of`.

---

## Story 3: CCR trend starts at origination, also for a rolled-over loan

**Persona:** Trustee opening a Watchlist loan detail and its Escalate page.

**Expected outcomes:**

- The `/ccr-history` request `from` is the origination (at most one day later), never the end of the original term.
- Loan detail and Escalate send the same `from`.

---

## Story 4: Compact amounts never read as 1000K

**Expected outcomes:**

- `$999,999` renders `$1M` (`$1.00M` in two-decimal tables) and `$999.999` renders `$1K`, never `$1000K` or `$1000`.
- `$999,994` still renders `$999.99K`.

---

## Story 5: Bank-deposit rows show the exact amount

**Persona:** Trustee reconciling a deposit against the wire before minting.

**Expected outcomes:**

- A `1234567.89` deposit reads `$1,234,567.89`, not `$1.23M`; the row does not wrap and the mint amount is unchanged.

---

## Story 6: Record Repayment prefill is exact

**Expected outcomes:**

- A served `6150000.000000` outstanding prefills `6,150,000`; `1234567.891234` prefills `1,234,567.891234` (no float noise).
- On Stellar, a sub-micro residue of at most 9 raw units can remain by design; the served value then reads `0.000000`, the fully-paid gate opens and `close_loan` waives it.

---

## Story 7: Escalate shows the real days on watchlist

**Expected outcomes:**

- The Days-on-watchlist tile shows the loan's `days_on_watchlist` (for example `12`), or `—` when it is not served; never a fixed `18`.
