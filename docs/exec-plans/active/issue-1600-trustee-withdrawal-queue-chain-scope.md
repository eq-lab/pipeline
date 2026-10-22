# Issue #1600: Trustee: make the Withdrawal Queue tab's chain scope explicit

Source: https://github.com/eq-lab/pipeline/issues/1600 — epic #1521, follow-up to backend #1586
(merged 2026-10-20: `GET /v1/withdrawal-queue` with `chain_id` omitted = every configured chain;
items carry `chain_id`). Branch: `feat/1600-trustee-withdrawal-queue-chain-scope`.

## Decision — option (a): Stellar-scoped, and say so

The rest of Cash Management is Stellar-only: the Capital-Wallet custody balance is a Stellar SAC
read (`useUsdcCustodyBalance`), the ramp hooks send the Stellar `chain_id`, and the tab's one action
(the Withdrawal Queue wallet top-up) is a Stellar Capital-Wallet MPC transfer. An all-chains
"Total claimable" next to a Stellar-only balance would mix books; a per-chain breakdown (option b)
has no Figma and no EVM cash-management counterpart yet (TD-152 / EVM rollout). So the tab sends
`chain_id=ENV.STELLAR_CHAIN_ID`, keys its query on it, and **labels the scope in the UI** so the
narrowing is visible rather than silent.

## Scope

`packages/trustee` only.

- `api/useWithdrawalQueue.ts`: `chain_id=ENV.STELLAR_CHAIN_ID` on the request; key
  `["withdrawal-queue", chainId]`; `WithdrawalQueueItem.chain_id: number`.
- `-cash-management-withdrawals.ts`: view += `chainLabel` (`targetChainLabel(ENV.STELLAR_CHAIN_ID)`
  → "Stellar").
- `cash-management.tsx`: a muted "Stellar" scope chip beside the "Withdrawal Queue" heading
  (`cash-management-withdrawals-chain`), and the sub-line says the figures are this chain's.
- Tests: new `api/-useWithdrawalQueue.test.tsx` (URL asserts `chain_id=99000001`), presenter and
  page assertions for the label. Docs: `trustee-flows.md` Withdrawal Queue section; user-stories
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
