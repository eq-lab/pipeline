# User Stories: #1603 — Trustee: waterfall preview uses the loan's own chain decimals

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521)
Issue: [#1603](https://github.com/eq-lab/pipeline/issues/1603)
Spec: [docs/frontend/trustee-flows.md#scale-handling](../../frontend/trustee-flows.md#scale-handling-both-flows-verified-against--useloandetailts--useloanwaterfallts)

Trustee app (`packages/trustee`) against staging with one active loan on Stellar and one on Hoodi.

---

## Story 1: An EVM loan's preview sends and reads 6-decimal units

**Persona:** Trustee opening Record Coupon for a Hoodi loan.

**Steps:**

1. Open `/loans/<hoodi id>/record-coupon?chain=560048`, enter `123.45` in Coupon received; watch the Network tab.

**Expected outcomes:**

- The request is `GET /v1/loan-book/<id>/waterfall?amount=123450000&chain_id=560048` (10^6 units), not `1234500000`.
- The previewed rows (senior principal returned, net coupon, fees) match the server's base-unit figures divided by 10^6 — the same magnitude as the entered amount, not 10× smaller.
- "Record on the ledger" stays disabled with the Stellar-only line (TD-152) — the preview is read-only here.

---

## Story 2: A Stellar loan is unchanged

**Persona:** Trustee opening Record Coupon or Record Repayment for a Stellar loan.

**Expected outcomes:**

- The request carries `amount=1234500000` (10^7 units) for `123.45`; rows divide by 10^7 as before; recording works.
