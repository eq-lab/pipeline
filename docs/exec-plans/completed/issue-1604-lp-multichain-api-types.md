# Issue #1604: LP: API types, comments and README for the multi-chain contract

Source: https://github.com/eq-lab/pipeline/issues/1604 — epic #1521, follow-up to #1550, #1584,
#1586, #1597. Branch: `feat/1604-lp-multichain-api-types`.

**Status: implemented (2026-10-22)** — all steps done; frontend lint/build/test (154 files, 2460 tests), wallet-connect lint/test, `lint-docs` and `lint-comments` green. See PR #1618.

## Scope

`packages/frontend` only.

- Additive fields mirrored from the API structs: `VaultStatsItem.chain_id`,
  `WithdrawalQueueItem.chain_id`, `SubmissionView.target_chain_id` / `chain_id: number | null` /
  `loan_id: string | null`, `LoanBookEntry.chain_id` / `loan_id`.
- Stale text: `useDashboardYieldHistory` header (series = historical `YieldMinted` plus Minter
  `CashRepaid` mints net of `CashRepaymentReversed`, #1597); `api/README.md` — `useLoanSubmissions`
  takes no `chainId` since #1550 (every target chain), and the Stellar voucher note names
  `VITE_STELLAR_CHAIN_ID` instead of the hard-coded `99000001`.
- **Product call (the issue's optional item):** the Deployment Monitor's In Origination tab already
  lists every target chain (#1550) while the Active tab follows the dashboard chain. Product rule
  (2026-10-22): a cross-network list shows its chain. So the tab gains a **Chain** column
  (`target_chain_id` → "Stellar" / the EVM chain name via `evmChainInfo`), making the mixed scope
  visible instead of silent — the same treatment the Trustee origination table got in #1536.

Out of scope: any fetch/scope change; the Active tab.

## Open Questions

_None._

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`packages/frontend/src/api/README.md`; `docs/frontend/dashboard-components.md` (In Origination
table column set); `docs/product-specs/dashboards.md` (the "7-column field set" sentence);
`docs/user-stories/epic-1521/1604-lp-multichain-api-types.md` + index row.
