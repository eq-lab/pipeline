# Issue #1601: Trustee: decide Capital Allocation card chain scope; remove stale 'Stellar-scoped' JSDoc

Source: https://github.com/eq-lab/pipeline/issues/1601 — epic #1521, follow-up to backend #1586 /
#1551. Branch: `feat/1601-trustee-capital-allocation-chain-scope`.

**Status: implemented (2026-10-22)** — all steps done; trustee lint/build/test (74 files, 1051 tests), `lint-docs` and `lint-comments` green. See PR #1615.

## Decision — per-network: the card follows the chain the trustee signed in with

Product rule (2026-10-22, #1600): a page that aggregates across networks shows every chain; a
per-network surface follows the chain the trustee connected with. The Capital Allocation card
describes one chain's deployment — its Capital Wallet, Withdrawal Queue wallet, trust-account
residuals, deployed senior and T-Bills are per-chain custody — so summing them across chains
would blend two books into one total and one bar. It therefore sends the **session's** `chainId`
(`useSessionState().chainId`, `ENV.STELLAR_CHAIN_ID` only as the no-session fallback), keys on it,
and shows a chain chip in the card header. The Overview deliberately mixes scopes: Needs Attention
and the loan book are cross-network work queues (all chains, #1537), the allocation card is
per-network; the chip makes that visible.

The #765 pin rationale (malformed Hoodi rates) no longer applies as a reason to hardcode Stellar:
an EVM session reads the EVM allocation by choice, and the readers are LoanRegistry-scoped since
#1543 / #1597. #765 itself stays open for the backend to close (its data was re-indexed).

**Custody fold-in.** `useUsdcCustodyBalance` is a Stellar SAC read; it is folded into the Capital
Wallet legend row and the guarded total only when the resolved chain is the Stellar chain. For an
EVM session the row shows the backend `capital_wallet` bucket or `—` (no cross-chain fold-in;
the EVM custody read is TD-153).

## Scope

`packages/trustee` only.

- `api/useCapitalAllocation.ts`: session chain; result exposes `chainId`; stale JSDoc replaced.
- `components/useCapitalAllocationCard.ts`: Stellar-only fold-in gate; result += `chainLabel`.
  `CapitalAllocationCard.tsx`: chain chip (`capital-allocation-chain`) beside the title.
- Stale JSDoc: `api/useLoanSubmissions.ts` ("Always sends `chain_id=ENV.STELLAR_CHAIN_ID`" — the
  code sends none since #1536); `api/useRampEvents.ts` / `useRampAddresses.ts` keep their
  Stellar-scoped notes (ramp *is* still Stellar-hardcoded, TD-153) but say so accurately.
- Tests (hook URL per session chain + fallback; card label + fold-in gate), docs
  (`trustee-flows.md` Capital Allocation data layer), user-stories doc + index row.

Out of scope: an EVM custody read (TD-153), the ramp hooks' scope.

## Open Questions

_None._

## Implementation Steps

1. Hook. 2. Presenter + card. 3. JSDoc sweep. 4. Tests. 5. Docs.

## Test Strategy

`yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`docs/frontend/trustee-flows.md` (Capital Allocation card — data layer);
`docs/user-stories/epic-1521/1601-trustee-capital-allocation-chain-scope.md` + index row.
