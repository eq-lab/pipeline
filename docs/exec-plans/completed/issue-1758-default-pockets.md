# Issue #1758: LP: default pockets — show each defaulted loan's pocket share and claimable recoveries, and claim them

Source: https://github.com/eq-lab/pipeline/issues/1758

Branch: `feat/1758-default-pockets` (cut from `epic/1795-lp-ui`; PR #1827 targets `epic/1795-lp-ui`, not `main`).

## Scope

In scope (LP app, `packages/frontend` + `packages/wallet-connect`):

- A **Default pockets** card on the `/stake` route, below the stake conversion / steps cards, rendered only when the wallet is connected, the active chain's Pocket is configured, and at least one candidate pocket exists.
- One row per candidate loan: loan id + borrower/commodity (served by `/v1/loan-book`), pocket balance (from `pocket(loan_id)`), "Claimable" (`claimable(holder, loan_id)`), "Claimed" (`claimed(holder, loan_id)`). Every number is the on-chain value formatted from raw units (PLUSD decimals per chain), never rescaled or derived; any failed read renders "—".
- A **Claim** button per row: `claim(holder, loan_id)` signed by the connected wallet; disabled while claimable is `0`, unknown, or a claim is in flight; on success, toast + invalidate/refetch the row's reads and the wallet's PLUSD balance.
- Chain follows the connected wallet via `useActiveChain()` (`packages/frontend/src/wallet/useActiveChain.ts`) — Stellar default when none.
- Config: `VITE_STELLAR_POCKET_ID`, `VITE_EVM_POCKET_ADDRESS` in `.env.example`, `docker/frontend/entrypoint.sh`, `packages/frontend/src/lib/env.ts`. Empty / zero address hides the card on that chain (same convention as `wireOutConfig.ts`).
- Spec: new section "Default pockets" in `docs/product-specs/staking.md`; frontend doc entries; user-stories doc under `docs/user-stories/epic-1795/`.

Out of scope:

- Backend changes (loan-book has no `closure_reason`; see Assumptions). No backend issues are planned for this user.
- Argocd / staging values for the two new env vars (ops, not code — note in the PR).
- Any client-side pro-rata, unabsorbed-loss or "your share %" maths.
- Figma: per the 2026-10-29 decision on the Issue there are no frames; build from the LP theme (`packages/ui` `Card`, `InfoRow`, `Button`, tokens) following `WithdrawQueueCard` / `WireOutInfoCard` patterns. No Figma verification step.

## Assumptions and Risks

- **Contract sources are not in this repo** (`contracts/pocket` and `deployments/networks/testnet/addresses.json` live elsewhere). The exact `PocketData` field names and the EVM `PipelinePocket` ABI must be confirmed against the deployed contracts before coding (step 1). Known from the Issue: Stellar `CD464…2RA5`, EVM hoodi-v5 `0xe885…498B`; full ids must be copied from the deployments file / Issue author.
- **Candidate loan set.** `GET /v1/loan-book?chain_id=` returns active loans then terminal `Default`/`Closed` rows, but `LoanBookEntry` has no closure reason (`packages/api/src/routes/loan_book.rs:179`). Plan: candidates = entries with `status` `Default` or `Closed`; for each, read `pocket(loan_id)`; a loan whose pocket does not exist (Stellar `Error(Contract, #2)`, EVM equivalent/empty struct) is dropped silently — that is an on-chain fact, not a derivation. Closed-by-maturity loans never had a pocket, so they drop out.
- **"Has a share" filter.** The listed contract surface has no per-holder share read; see Open Questions. Default used in this plan: show a row for every existing pocket on the active chain, with the wallet's claimable/claimed.
- Stellar `claim` may return the claimed amount (`i128`); the success toast shows that value only if the return decodes, otherwise a plain "Claimed" toast.
- Holder must sign as itself (`holder` = connected address); Stellar requires `require_auth` on holder — simulate+assemble handles the auth entry as in `requestWireOut`.
- Stellar XLM funding: reuse the stake page's `needsXlmFunding` gate — Claim disabled with the existing `XlmFundingBanner` already shown on the page.
- Wrong EVM network: reuse `useEvmNetworkGuard` like the other EVM writes (native wallet prompt, no standalone banner).
- Testnet currently has no pockets (`next_loan_id = 0`), so live verification will only show the hidden/empty state until a default is staged; unit tests carry the row states.

## Open Questions

_None_ — answered 2026-11-02 by the user: **option (a)**. The card lists every pocket that exists on
the active chain (loan-book `Default` / `Closed` loans whose `pocket(loan_id)` read succeeds), with
the connected wallet's `claimable` / `claimed` shown verbatim, zeros as `0`. Rows are never hidden
on zero values, and no client-side share is derived.

## Decision log

- 2026-11-02 — Which rows to list (the Pocket contract has no per-holder share read): (a) every
  existing pocket with the wallet's claimable/claimed **(chosen)**; (b) hide rows with both zero
  (rejected: hides a real share before the first recovery); (c) a snapshot share read (none exists
  in the LP app today).
- 2026-11-02 — Contract surface (step 1): the Pocket sources and full ids are outside this repo and
  the `stellar` CLI is not installed, so the surface is derived from the Issue body and **unverified**:
  Stellar `pocket(loan_id)` is read as a map with an i128 `balance` (missing renders "—"), loan id
  `u32`, not-found `Error(Contract, #2)`; EVM `pocket(uint256)` decoded as a tuple whose first field
  is `balance`, a revert means no pocket. Recorded in `staking.md#default-pockets`; confirm when the
  full contract ids reach `.env` (only `pocket.ts` in both wallet-connect folders changes).
- 2026-11-02 — Stellar holder reads (`claimable` / `claimed`) run only after `pocket(loan_id)`
  returns a pocket, to avoid calls for loans without one (two round trips, polled at 30 s).
- 2026-11-02 — The card uses `InlineError` (built-in "View details" dialog) instead of the page's
  `ErrorDetailsDialog`, so it takes no `onError` prop; `stake.tsx` passes only `claimBlocked`.

## Implementation Steps

1. [x] **Confirm the contract surface.** `stellar contract info interface --id <full Pocket id> --network testnet` and the hoodi-v5 `PipelinePocket` ABI (explorer / contracts repo). Record `PocketData` field names (which field is the current balance, which is total recovered/released, burned), the not-found error, and EVM `pocket(uint256)` return tuple. Put the findings in the spec section (step 9), not in code comments.
2. [x] **Env/config.**
   - `.env.example` (frontend block near line 250/263): `VITE_STELLAR_POCKET_ID=<testnet id>  # LP default-pockets card; empty hides it` and `VITE_EVM_POCKET_ADDRESS=` with the same comment.
   - `docker/frontend/entrypoint.sh`: add both `--arg` lines and the JSON keys, mirroring `VITE_EVM_MINTER_ADDRESS` / `VITE_STELLAR_YIELD_MINTER_ID`.
   - `packages/frontend/src/lib/env.ts`: `EVM_POCKET_ADDRESS` (`readString("VITE_EVM_POCKET_ADDRESS", ...)` like `EVM_MINTER_ADDRESS`) and `STELLAR_POCKET_ID`.
   - `packages/frontend/src/wallet/stellar/chain.ts`: export `pocketId`.
   - New `packages/frontend/src/wallet/pocketConfig.ts`: `isPocketConfigured(kind)` (copy `wireOutConfig.ts` shape, zero-address check).
3. [x] **Stellar contract module** `packages/wallet-connect/src/stellar/contracts/pocket.ts`:
   - `readPocket({ pocketId, loanId, rpcUrl, networkPassphrase })` via `simulateRead` → `{ balance: string, ... } | null` (null on the not-found contract error; rethrow others). Loan id ScVal type must match the contract (`u32` like `readMinterRepayment`, or `u64` — confirm in step 1).
   - `readPocketClaimable` / `readPocketClaimed({ pocketId, holder, loanId, ... })` → raw `string`.
   - `buildClaimEnvelope` + `claimPocket({ pocketId, holder, loanId, rpcUrl, networkPassphrase, signTransaction, onStageChange })` → `{ hash, amount: string | null }`, structured exactly like `requestWireOut` in `minter.ts` (sign → send → poll → decode return).
   - Export from `packages/wallet-connect/src/index.ts`.
4. [x] **EVM ABI** `packages/wallet-connect/src/evm/contracts/pocket.ts`: `pocketAbi` (`as const`) with `pocket`, `claimable`, `claimed`, `claim`; export from index.
5. [x] **Frontend read hooks** (mirror `useStellarMinterReads.ts` / `useEvmMinterReads.ts` / `useWireOutReads.ts`):
   - `packages/frontend/src/wallet/stellar/useStellarPocketReads.ts` — react-query `useQueries` per loan id: pocket + claimable + claimed, `staleTime`/`refetchInterval` 30 s, `retry: false`, keys `["pocket", "stellar", pocketId, loanId, holder]`.
   - `packages/frontend/src/wallet/evm/useEvmPocketReads.ts` — one `useReadContracts` batch (3 calls per loan), 30 s poll.
   - `packages/frontend/src/wallet/usePocketReads.ts` — `usePocketReads(kind, loanIds, holder)` → `Record<loanId, { exists?: boolean; balanceRaw?: string; claimableRaw?: string; claimedRaw?: string; error?: Error }>`; each chain hook enabled only for its kind and when `isPocketConfigured(kind)`.
6. [x] **Frontend write hooks:**
   - `packages/frontend/src/wallet/stellar/useStellarPocketClaim.ts` — copy `useStellarRequestWireOut` shape: `claim(loanId)`, `isPending`, `isSuccess`, `error`, `hash`, `reset`, in-flight ref guard.
   - `packages/frontend/src/wallet/evm/useEvmPocketClaim.ts` — `useWriteContract` + `useWaitForTransactionReceipt`, network guard like `useEvmRequestWireOut.ts`.
   - `packages/frontend/src/wallet/usePocketClaim.ts` dispatching on `kind`; on success invalidate `["pocket", ...]` queries (Stellar) / `refetch` (EVM) and the PLUSD balance query used by the stake flow.
   - Export the public hooks from `packages/frontend/src/wallet/index.ts`.
7. [x] **Component** `packages/frontend/src/components/stake/DefaultPocketsCard.tsx` + view hook `useDefaultPocketsCard.ts`:
   - `useActiveChain()` → `{ kind, chainId }`; `useLoanBook({ chainId })`; candidates = `loans.filter(l => l.status === "Default" || l.status === "Closed")`; holder = connected address for `kind`.
   - Rows = candidates whose pocket read `exists !== false` (pending reads keep the row with "—"); hide the whole card when not connected, not configured, no candidates, or every candidate's pocket is confirmed absent.
   - Layout: `Card variant="white"` with a title "Default pockets" and short helper text (copy from the user docs Recovery mechanics sentence); per loan a `Card variant="plain"` block (as in `WithdrawQueueCard`) with header "Loan #<id> · <borrower>" and `InfoRow`s "Pocket balance", "Claimable", "Claimed", then `Button variant="primary-dark" size="compact"` "Claim". Format raw amounts with the existing PLUSD formatter used by the stake flow (chain-specific decimals, 7 Stellar / 18 EVM — reuse, don't hardcode); "—" for undefined.
   - Errors: claim failure → `InlineError` + the page's `ErrorDetailsDialog` via `toUserError` (same as stake page); success → `useToast` "Claimed <amount> PLUSD" (amount from the contract return or the pre-claim `claimable` read — the served value, not computed).
   - File header: one 2-line spec pointer `// spec: docs/product-specs/staking.md#default-pockets`. No other comments.
8. [x] **Mount** in `packages/frontend/src/routes/stake.tsx` inside the served branch, after the steps/connect card: `<DefaultPocketsCard onError={setErrorDialog} />`. Not shown when `served === false`.
9. [x] **Docs** (see Docs to Update).
10. `yarn workspace` lint/typecheck/tests (`/test-fast`); `yarn build` for `packages/frontend` (no new route, no routeTree regen needed).

## Test Strategy

- `packages/wallet-connect/src/stellar/contracts/pocket.test.ts`: `readPocket` decodes the PocketData map; returns `null` on `Error(Contract, #2)`; rethrows other errors; `claimable`/`claimed` stringify i128; `claimPocket` builds a `claim(holder, loan_id)` invocation with correct ScVal types, signs with `address: holder`, throws on `ERROR`/non-SUCCESS, decodes the return amount (pattern: `minter.test.ts`).
- `packages/frontend/src/wallet/stellar/useStellarPocketReads.test.tsx`, `evm/useEvmPocketReads.test.tsx`, `usePocketReads.test.tsx`: disabled when unconfigured / other chain; per-row errors map to `error`; absent pocket → `exists: false`.
- `useStellarPocketClaim.test.tsx`, `useEvmPocketClaim.test.tsx`: not-configured / not-connected errors; in-flight guard; success invalidates reads.
- `packages/frontend/src/components/stake/DefaultPocketsCard.test.tsx`: hidden when disconnected / unconfigured / no Default-Closed loans / all pockets absent; renders rows only for existing pockets; Performing loans never queried; values verbatim-formatted from raw; "—" on failed read; Claim disabled at `0`, unknown, or pending; click calls `claim(loanId)`; success toast; error surfaces; switching active chain (EVM connected) re-queries with the EVM chain id.
- `packages/frontend/src/routes/-stake.test.tsx`: card mounted in the served branch, absent under `ChainNotServedNotice`.
- Manual (staging, after ops sets the env vars): Network tab shows `/v1/loan-book?chain_id=<active>` and Soroban `simulateTransaction` / `eth_call` pocket reads; with no pockets on testnet the card is hidden. The user verifies; do not drive their browser.

## Docs to Update

- `docs/product-specs/staking.md`: new `## Default pockets` section — data sources (loan-book candidates, pocket reads, field mapping from step 1), visibility rules, claim flow, "—" rule, env vars.
- `docs/frontend/dashboard-components.md` (stake route: the new card), `docs/frontend/wallet-flows.md` (pocket reads/claim hooks per chain), `docs/frontend/ui-components.md` if a new composite is listed there, `docs/frontend/error-handling.md` (claim errors).
- `docs/FRONTEND.md`: env var table entries for `VITE_STELLAR_POCKET_ID` / `VITE_EVM_POCKET_ADDRESS`.
- `docs/user-stories/epic-1795/1758-default-pockets.md` + link in `docs/user-stories/index.md`.
- On completion: move this plan to `docs/exec-plans/completed/`.
