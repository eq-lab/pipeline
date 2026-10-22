# User Stories: #1599 — Trustee: audit log across all chains with a chain column; reference as the loan name

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1599](https://github.com/eq-lab/pipeline/issues/1599)
Spec: [docs/frontend/trustee-flows.md#audit-log](../../frontend/trustee-flows.md#audit-log),
[docs/product-specs/audit-logging.md](../../product-specs/audit-logging.md)

Trustee app (`packages/trustee`) against staging (`CHAINS=99000001,560048`) with indexed events
on both chains, including a loan with the same id on each chain. No Figma for the Chain column.

---

## Story 1: The feed merges every chain, newest first, with a chain label

**Persona:** Trustee reviewing the audit log.

**Steps:**

1. Open `/audit-log` with the Network tab open.

**Expected outcomes:**

- The request is `GET /v1/audit-log` with no `chain_id`.
- Stellar and Hoodi rows are interleaved newest-first; the second column reads "Stellar" or "Hoodi" per row; the caption mentions every configured chain and the cash / collateral / deal-token event families.

---

## Story 2: Reference shows the full loan name

**Persona:** Trustee reading a loan-scoped row.

**Expected outcomes:**

- The Reference cell reads the whole loan name (e.g. "Open Mineral — Copper Concentrate"), never a truncated "Open M…trate" form; a Minter / CollateralRegistry / DealTokenFactory row shows "—".

---

## Story 3: Same loan id on two chains keeps its own name

**Persona:** Trustee comparing rows for loan `#4` on Stellar and loan `#4` on Hoodi.

**Expected outcomes:**

- Each row's Loan / scope cell resolves to the loan book name of its own chain; the two never swap. A loan the book does not list falls back to "Loan #4".

---

## Story 4: New event families render their server text

**Persona:** Trustee after a deal registration or a collateral sync.

**Expected outcomes:**

- Minter cash, CollateralRegistry and DealTokenFactory rows appear with the server's `action` text and the "Protocol" scope; no-op syncs are absent.
