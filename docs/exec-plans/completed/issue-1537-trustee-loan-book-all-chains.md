# Issue #1537: Trustee: loan book across all chains; per-loan calls send the loan's own chain_id

**Status: implemented (2026-10-16)** — every step and the Test Strategy are complete; trustee
lint/build/test (72 files, 1035 tests) and `lint-docs` green. See PR #1562.

Source: https://github.com/eq-lab/pipeline/issues/1537

Frontend follow-up of epic #1521 (backend-only, merged: #1550 submissions target chain, #1551 loan
book across chains, #1552 per-loan `chain_id` required). Unblocked 2026-10-16; #1536 (the
submission form's target chain) is merged. Branch: `feat/1537-trustee-loan-book-all-chains`.

Backend contract (`docs/product-specs/trustee-dashboard.md` Loans page row, `loans.md`): `GET
/v1/loan-book` — `chain_id` optional; omitted = the union over every configured chain with
`summary` recomputed over the union, each row carrying its own `chain_id`; loan ids are unique only
per chain. A configured id = that chain only; well-formed unconfigured = 200 empty; malformed or
repeated = 400. Per-loan routes (`/valuations`, `/financials`, `/ccr-history`, `/waterfall`,
`/disbursement/complete`) require `chain_id`.

No Figma: the Loans page design (`4116:9989`) predates multi-chain; the Chain column, the chain
filter, and the hero chain label derive from the shipped Origination patterns (#1536 Chain column).

## Scope

In scope (`packages/trustee`):

- `useLoanBook(chainId?)` stops pinning Stellar: no `chain_id` by default (all chains); an optional
  configured id narrows the fetch server-side so `summary` stays server-computed.
- Loans page: a **Chain** column after Originator and a **chain filter** (All chains / Stellar /
  `<EVM chain>`) next to the status tabs. Row key and navigation carry `(chain_id, loan_id)`.
- Per-loan identity = `(chain_id, loan_id)`. The six per-loan routes (`/loans/$id`,
  `/loans/$id/record-coupon`, `/loans/$id/record-repayment`, `/risk-council/{escalate,reterm,
  writedown}/$id`) gain a validated `chain` search param (default: the Stellar chain id, so
  existing URLs keep working). Every link/navigate to them passes `search: { chain }`.
- Per-loan hooks take the chain as their first argument and send `chain_id=<that chain>`:
  `useLoanValuation`, `useLoanFinancials`, `useLoanCcrHistory`, `useLoanWaterfall`,
  `useCompleteDisbursement` (mutation variables). Loan-book lookups match on both ids.
- Hero meta line shows the chain label; Needs Attention loan rows and the Audit Log name map become
  chain-aware.
- Safety gate (same judgment as #1536): the trustee-wallet on-chain actions (Update lifecycle, Roll
  over, Record coupon, Close loan → `record_payment`/`close_loan`) run on Stellar only. For a loan
  whose `chain_id` is not the Stellar chain, the loan-detail actions card disables them with an
  explanatory line and the Record Coupon / Record Repayment pages refuse to submit. "Disbursement
  complete" (DB-only) stays available.
- Docs, user stories, tests.

Out of scope:

- EVM on-chain trustee writes (no EVM `LoanRegistry` path in the Trustee app; TD-151 extended).
- The LP frontend (`packages/frontend`) loan book — already chain-scoped by #1498/#1530.
- Audit log / capital allocation / ramp hooks: still Stellar-scoped by design (#765, #1004).

## Assumptions and Risks

- **Search param over path param.** `/loans/$chainId/$id` would rename six route files and change
  every deep link; a `chain` search param keeps today's URLs valid and the file routes intact.
  `validateSearch` returns `{ chain: number }` (absent or malformed → `DEFAULT_TARGET_CHAIN_ID`),
  so TanStack types `search` as required on every link to these routes — a missed call site is a
  type error, not a silent Stellar fallback.
- **Row identity.** `loan_id` collides across chains (both registries count from 1), so every
  `loans.find` matches `chain_id` too; list keys become `` `${chain_id}:${loan_id}` ``.
- **Chain filter is server-side** (`?chain_id=`), not a client filter, because the summary tiles
  must not be recomputed client-side ([[no-frontend-computed-metrics]]). Tab counts stay a grouping
  of served rows. React Query key `["loan-book", chainId ?? "all"]`; existing
  `invalidateQueries({ queryKey: ["loan-book"] })` prefixes still hit every variant.
- **Needs Attention / Audit Log consumers** call `useLoanBook()` with no filter (all chains). The
  audit log itself is Stellar-scoped, so its loan-name map only takes Stellar rows (avoids a Hoodi
  loan #4 shadowing Stellar loan #4).
- **Default chain when absent** is Stellar: matches pre-#1537 behaviour for bookmarks.
- **Mock-key seam** (`pipeline.mock.api.GET./v1/loan-book?chain_id=…`): keys are exact-match
  including the query string, so manual-QA mocks for the all-chains fetch use `/v1/loan-book`.

## Open Questions

_None_ — the one judgment call (gate the Stellar-only on-chain actions for non-Stellar loans rather
than let a Stellar signature target an EVM loan id) mirrors #1536 and is recorded above and on the
Issue.

## Implementation Steps

### 1. `packages/trustee/src/lib/loanRoute.ts` (new)

`LoanRouteSearch { chain: number }`; `parseLoanRouteSearch(raw: Record<string, unknown>)` → a
positive integer `chain` (string or number) else `DEFAULT_TARGET_CHAIN_ID`;
`findLoanEntry(loans, chainId, loanId)` matches both ids; `loanRowKey(chainId, loanId)`. Test:
`-loanRoute.test.ts`.

### 2. `packages/trustee/src/api/useLoanBook.ts`

`useLoanBook(chainId?: number | null)`: URL `/v1/loan-book` or `?chain_id=<id>`; key
`["loan-book", chainId ?? "all"]`. Export `LoanBookEntry.chain_id` doc unchanged (already present).

### 3. Per-loan hooks (`api/`)

`useLoanValuation(chainId, loanId)`, `useLoanFinancials(chainId, loanId)`,
`useLoanCcrHistory(chainId, loanId, from, step?)`, `useLoanWaterfall(chainId, loanId, amount,
asOf)`; query keys include `chainId`; URLs use it. `useCompleteDisbursement` variables
`{ chainId, loanId }`. Drop the `ENV` imports.

### 4. Loans page — `routes/-useLoansTable.ts` + `loans.index.tsx`

- `LoanTableRow` += `chainId: number`, `chain: string` (`targetChainLabel`); `key = loanRowKey`.
- `buildLoansView(data, activeTab)` unchanged in shape; `useLoansTable(activeTab, chainFilter:
  number | null)` passes the filter to `useLoanBook`.
- `COLUMN_HEADERS` += "Chain" after Originator; `GRID_TEMPLATE_COLUMNS` gains a `90px` track
  (Originator `minmax(0,1.3fr)` → `minmax(0,1.1fr)`); cell `data-testid="loans-chain-cell-<key>"`.
- Chain filter: `<select data-testid="loans-chain-filter">` ("All chains" + `TARGET_CHAINS`) rendered
  in the tab-bar row (right-aligned), local state like `activeTab`.
- `openLoan` navigates with `search: { chain: row.chainId }`.

### 5. Loan detail — `routes/-useLoanDetail.ts` + `loans.$id.tsx`

- `useLoanDetail(chainId, loanId)`; lookups via `findLoanEntry`; per-loan hooks get `chainId`.
- `buildHero(loanId, entry)` meta: `Loan #<id> · <chain label> · <payment clause>`.
- `UseLoanDetailResult` += `onChainBlockedReason: string | null` — set when
  `!isStellarTarget(entry.chain_id)`: "On-chain actions run on Stellar only — this loan lives on
  `<label>`, and signing them from the Trustee app is not supported yet. Disbursement complete is
  still available."
- `loans.$id.tsx`: `validateSearch: parseLoanRouteSearch`; `const { chain } = Route.useSearch()`;
  `OtherActionsCard` takes `blockedReason` → buttons `disabled`, muted line
  `data-testid="loan-detail-onchain-blocked"`; the Matured rollover card's button likewise;
  `completeDisbursement.mutate({ chainId: chain, loanId: id })`; navigations to record-coupon /
  record-repayment / risk-council escalate pass `search: { chain }`; `Hero` `backTo` unchanged.

### 6. Record Coupon / Record Repayment — `-record-coupon.ts`, `-record-repayment.ts`, pages

`useRecordCoupon(chainId, loanId)` / `useRecordRepayment(chainId, loanId)`: `useLoanFinancials` /
`useLoanWaterfall` get `chainId`; lookup via `findLoanEntry`; view += `onChainBlockedReason`
(same text) and `canSubmit` is false when set. Pages: `validateSearch`, `Route.useSearch()`, the
blocked line above the submit button, every `Link`/`navigate` to `/loans/$id` carries `search`.

### 7. Risk Council — `-risk-council-{escalate,reterm,writedown}.ts` + pages

Hooks take `(chainId, loanId)`; `findLoanEntry`; `useLoanFinancials` / `useLoanCcrHistory` get
`chainId`. Pages add `validateSearch` + `Route.useSearch()`. No on-chain write on these pages, so
no gate.

### 8. Needs Attention — `components/useNeedsAttention.ts` + `NeedsAttention.tsx`

`LoanNeedsAttentionRow` += `chainId`; subtitle `"<label> · loan #<id> · <chain label>"`; row key
`loanRowKey`; the Open `Link` passes `search: { chain: row.chainId }`.

### 9. Audit Log — `routes/-useAuditLog.ts`

`loanNames` built from rows with `chain_id === ENV.STELLAR_CHAIN_ID` only.

### 10. Docs

See **Docs to Update**.

## Test Strategy

- `lib/-loanRoute.test.ts`: parse (absent / string / number / junk), `findLoanEntry` (same id on two
  chains picks the right one), `loanRowKey`.
- `api/-useLoanBook.test.tsx`: no `chain_id` by default; `?chain_id=560048` when given; key variants.
- `api/-useLoanValuation|Financials|CcrHistory|CompleteDisbursement.test.tsx`: `chain_id=560048`
  flows from the argument (replace the `99000001` assertions).
- `-useLoansTable.test.ts`: `chain` label + `chainId` per row, key `99000001:4488`; `useLoansTable`
  passes the filter to `useLoanBook`.
- `-loans.index.test.tsx`: "Chain" header + cell, filter select calls `useLoanBook(560048)`, row
  click navigates with `search: { chain }`.
- `-useLoanDetail.test.ts`: hooks receive `chainId`; same-id-other-chain row is ignored; hero meta
  carries the chain label; `onChainBlockedReason` null for Stellar, set for Hoodi.
- `-loans.$id.test.tsx`: `Route.useSearch` patched; navigations carry `search`; disabled actions +
  blocked line when the hook reports a reason; `completeDisbursement.mutate` gets `chainId`.
- `-record-coupon(-page)`, `-record-repayment(-page)`, `-risk-council-*(-page)` tests: new first
  argument, `useSearch` patch, blocked state on the two record pages.
- `-useNeedsAttention.test.ts`, `-useAuditLog.test.ts`: chain-aware rows / Stellar-only name map.
- Gate: `yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/frontend/trustee-flows.md`: Loan book Architecture (`useLoanBook` scope, Chain column,
  chain filter), Loan detail Architecture + Hero (identity `(chain_id, loan_id)`, `chain` search
  param, chain label), Wired actions (the Stellar-only gate), Route registration (search param),
  Risk Council Routing, Needs Attention, Audit Log name map.
- `docs/product-specs/trustee-dashboard.md`: Loans page row — the Trustee app now omits `chain_id`
  and filters per chain server-side.
- `docs/exec-plans/tech-debt-tracker.md`: extend TD-151 — the loan-detail on-chain actions are
  gated for non-Stellar loans too.
- `docs/user-stories/epic-1521/1537-trustee-loan-book-all-chains.md` + index row.
