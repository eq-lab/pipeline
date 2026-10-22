# User Stories: #1604 — LP: API types, comments and README for the multi-chain contract

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1604](https://github.com/eq-lab/pipeline/issues/1604)
Spec: [docs/frontend/dashboard-components.md#originationtable](../../frontend/dashboard-components.md#originationtable)

LP app (`packages/frontend`) against staging (`CHAINS=99000001,560048`) with submissions targeting
both chains. The types/comments/README part has no visible change; the one visible change is the
Chain column on the Protocol Dashboard's In Origination tab.

---

## Story 1: The In Origination tab names each submission's target chain

**Persona:** LP reading the Protocol Dashboard's Deployment Monitor.

**Steps:**

1. Open `/dashboard`, switch the Loan Book panel to the In Origination tab.

**Expected outcomes:**

- The table has eight columns: Commodity · Chain · Facility · Corridor · Rate · Maturity · Submitted · Status.
- Submissions from every target chain are listed (unchanged since #1550); each row's Chain cell reads "Stellar" or "Hoodi" per its `target_chain_id`.
- Switching the dashboard chain changes the Active Loans tab only; the In Origination rows stay the same.

---

## Story 2: Types match the API (developer check)

**Expected outcomes:**

- `yarn workspace @pipeline/frontend build` passes; `VaultStatsItem.chain_id`, `WithdrawalQueueItem.chain_id`, `SubmissionView.target_chain_id / chain_id / loan_id` and `LoanBookEntry.chain_id / loan_id` are present in `src/api/*.ts` and match `packages/api/src/routes/*.rs`.
- `src/api/README.md` no longer lists `useLoanSubmissions` among the `{ chainId }` hooks and names `VITE_STELLAR_CHAIN_ID` instead of `99000001`.
