# Issue #1600: Trustee: make the Withdrawal Queue tab's chain scope explicit

Source: https://github.com/eq-lab/pipeline/issues/1600 — epic #1521, follow-up to backend #1586
(merged 2026-10-20: `GET /v1/withdrawal-queue` with `chain_id` omitted = every configured chain;
items carry `chain_id`). Branch: `feat/1600-trustee-withdrawal-queue-chain-scope`.

**Status: implemented (2026-10-22)** — all steps done; trustee lint/build/test (74 files, 1047 tests), `lint-docs` and `lint-comments` green. See PR #1607.

## Decision — option (a), scoped to the chain the trustee signed in with

Product rule (user, 2026-10-22): a page that aggregates across networks gets the all-chains view
(option b); a page that is per-network follows **the chain the trustee connected with** — not a
hardcoded Stellar. Cash Management is per-network (the Capital-Wallet custody balance, the ramp
hooks and the tab's top-up action are all single-chain), so the tab sends the **session's**
`chainId` (`useSessionState().chainId`, the chain picked at sign-in, falling back to
`ENV.STELLAR_CHAIN_ID` without a session) and labels that chain in the UI. The custody balance and
ramp hooks are still hardcoded to Stellar — logged as TD-153 so they follow the session chain too.

## Scope

`packages/trustee` only.

- `auth/sessionStore.ts`: `SessionState.chainId` (reactive snapshot field). `api/useWithdrawalQueue.ts`:
  `chain_id=<session chainId ?? ENV.STELLAR_CHAIN_ID>` on the request; key `["withdrawal-queue",
  chainId]`; result exposes `chainId`; `WithdrawalQueueItem.chain_id: number`.
- `-cash-management-withdrawals.ts`: view += `chainLabel` (`targetChainLabel(chainId)` — "Stellar" /
  "Hoodi").
- `cash-management.tsx`: a muted chain chip beside the "Withdrawal Queue" heading
  (`cash-management-withdrawals-chain`), and the sub-line reads "<chain> queue — the network you
  signed in with."
- Tests: new `api/-useWithdrawalQueue.test.tsx` (URL carries the session chain; Stellar fallback),
  presenter and page assertions for the label (Stellar and Hoodi sessions). Docs: `trustee-flows.md` Withdrawal Queue section; user-stories
  doc + index row.

Out of scope: an EVM withdrawal queue view (lands with EVM cash management), pagination.

## Open Questions

_None._

## Implementation Steps

1. Hook. 2. Presenter + view. 3. Tests. 4. Docs.

## Test Strategy

`yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`docs/frontend/trustee-flows.md` (Withdrawal Queue: architecture bullet, scope);
`docs/user-stories/epic-1521/1600-trustee-withdrawal-queue-chain-scope.md` + index row.
