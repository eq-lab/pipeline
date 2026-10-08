# Issue #1449: Trustee: mint the PLUSD leg of an LP bank deposit by calling the minter's record_wire_in from the Bank deposits list

Source: https://github.com/eq-lab/pipeline/issues/1449

Part of epic #1269. Continues #1413 (per-LP bank deposits, `ref_hash` / `is_minted`), PR #1418 (the Bank deposits section) and #1416 (the indexer/relayer flips `is_minted`).

## Scope

Add a per-row **Mint PLUSD** action to the Trustee → LP detail → "Bank deposits" table. For a row with `is_minted == false`, the Trustee's connected Stellar wallet signs and submits `record_wire_in` on the minter contract. All arguments come from data the API already serves; the minted state keeps coming from the served `is_minted` flag.

In scope:

- New Soroban client `recordWireIn` in `@pipeline/wallet-connect` (the trustee app may not import `@stellar/stellar-sdk` — TD-33/#791).
- New trustee hook `packages/trustee/src/api/useRecordWireIn.ts`.
- Row action, guards, stage/pending states and error surfacing in `-LpBankDepositsSection.tsx` / `-useLpBankDeposits.ts`.
- `VITE_STELLAR_YIELD_MINTER_ID` in `packages/trustee/src/lib/env.ts` + `.env.example`.
- Docs: the `record_wire_in` signature in `docs/product-specs/loans-data.md`, the flow in `docs/frontend/trustee-flows.md` and `docs/product-specs/deposits.md`, a user-stories doc under `docs/user-stories/epic-1269/`.

Out of scope (see "Resolved open points" below):

- The escrow path (`assign_wire_in` / `return_wire_in`). Confirmed a separate mechanism — follow-up issue.
- Any backend change. No new endpoint, no new field.
- Wire-out, ramps, cash entries — other minter methods.

## Confirmed contract facts (read from `eq-lab/pipeline-stellar-contracts@main`)

`contracts/minter/src/lib.rs:103`:

```rust
#[when_not_paused]
pub fn record_wire_in(
    e: &Env,
    caller: Address,
    receiver: Address,
    amount: i128,
    value_date: u64,
    ref_hash: BytesN<32>,
) -> u32
```

Five positional wire args in that order. Returns the wire id (`u32`).

Semantics confirmed in the body:

- `ensure_can_call(e, &caller, "record_wire_in")` → `caller.require_auth()` **plus** `access_manager.can_call(caller, "record_wire_in").immediate`. The caller authorises itself, so this is a **direct invocation on the minter contract** — NOT the `executor.execute(target, fn, args, caller)` proxy that `draw_loan` / `record_payment` use (the loan registry gates those with `#[only_role]`; the minter self-checks). The connected wallet is the transaction source account, so a single source-account signature satisfies `require_auth()` — same conclusion as #831 Open Question 1.
- `consume_mint_ref` rejects the zero hash (`MissingRef`) and a hash already seen (`RefHashSeen`) — a second call for the same deposit traps.
- `require_positive(amount)`, then `apply_budget` (per-tx / per-window mint caps).
- `receiver == <the minter contract itself>` → `WireInStatus::Escrowed`. **Any other address** (including a `G…` custody account) → `stake_for(receiver)` → `WireInStatus::Direct`. The Custody fallback this issue specifies is therefore *not* the escrow path.
- Emits `event::WireIn { id (topic), receiver, amount, value_date, ref_hash }`, which the indexer parses (`packages/worker/src/indexer/stellar/parsers.rs:232`) and the relayer joins on `ref_hash` (`packages/worker/src/relayer/stellar/wire_in_match.rs`, Rule A) to flip `is_minted`.

Role: `deployments/justfile` maps `record_wire_in` / `repay` / `record_income` on the minter to **`CASH_REPORTER`** (not `TRUSTEE`), with the explicit note that holders must have execution delay 0 because the method requires `immediate`.

Scale: Soroban stores every monetary field natively at **7 decimals** (`docs/product-specs/loans-data.md:76`). `BankDepositResponse.amount` is a plain dollar decimal string from `NUMERIC(20,2)` (`packages/api/src/routes/lp_bank_deposits.rs:44`). So `amount_i128 = round(dollars × 10^7)`, computed exactly on the decimal string (no float).

Testnet minter contract id: `CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK` (`deployments/networks/testnet/addresses.json`).

### Resolved open points from the issue

1. **Escrow / assign path** — out of scope, as a follow-up. Two reasons: the Custody-account fallback produces a `Direct` wire, not an escrowed one (escrow requires passing the minter's *own* contract address as `receiver`); and `assign_wire_in` is `#[only_owner]` with no `caller` argument, so it must be driven through the access-manager `execute` proxy — a different call shape, a different role (`TRUSTEE`), and a different UI (it operates on a wire id, not a deposit row).
2. **Decimal scale** — resolved: ×10^7, as derived above.

## Assumptions and Risks

- **The connected Trustee wallet must hold `CASH_REPORTER` with delay 0.** On testnet, `access.cash_reporter` currently lists only `GCOBEHPPNIX6CNQUUUJLDIBKL3CJTEWBMHGS3TDAAO4QCMQZJQ4X4RVE`, while the trustee wallets (`GAZFDDYK…`, `GCGQVOJ…`) hold `TRUSTEE`. Unless the role is granted, every attempt fails simulation with `MinterError::Unauthorized`. See Open Questions.
- `stake_for(receiver)` mints vault shares to the receiver. For the Custody `G…` account this presumes that account can hold sPLUSD (trustline / authorization). If not, simulation fails — the error must surface verbatim rather than be swallowed.
- `ref_hash` is single-use on-chain. A retry after a submit that actually landed will trap with `RefHashSeen`. The UI must present that as "already minted — refresh" rather than a generic failure.
- `is_minted` flips only after the worker's wire-in matching phase runs, so there is a lag between a successful submit and the served flag. The pending state must be bounded, and must never be persisted client-side.
- A wrong-typed guest argument traps as `UnreachableCodeReached`. Encoding is pinned by the signature above and verified by `simulateTransaction` before any signature is requested.
- The minter's per-tx / per-window mint budget can reject a large deposit (`apply_budget`). Surface the contract error.
- Branch `feat/trustee-record-wire-in` with draft PR #1450 is already open; this work lands there.

## Open Questions

- The deployed minter maps `record_wire_in` to the **`CASH_REPORTER`** role, but the trustee wallets are granted `TRUSTEE` in `deployments/networks/testnet/config.json`. Should `CASH_REPORTER` be granted (delay 0) to the trustee wallets on testnet/staging so this action is usable, or is a different signer intended for the mint leg? The frontend work is unblocked either way, but the feature cannot be exercised end-to-end until this is settled.

## Implementation Steps

1. **`packages/wallet-connect/src/stellar/contracts/minter.ts` (new).** Mirror `loanRegistry.ts`'s structure; file-header comment records the confirmed signature, the direct-invoke (no executor) decision, and the ×10^7 scale.
   - `export type RecordWireInStage = "awaiting-signature" | "submitting" | "confirming";`
   - `export function parseUsdDollarsToI128(decimalStr: string): bigint` — exact decimal-string → base units at 7 decimals; reject a non-numeric string, a negative/zero value, or more than 7 fractional digits. No `Number` arithmetic.
   - `export function hexToBytes32ScVal(hex: string): xdr.ScVal` — require exactly 64 lowercase hex chars, decode to 32 bytes, `xdr.ScVal.scvBytes`.
   - `export function encodeRecordWireInArgs({ caller, receiver, amount, valueDate, refHash })` → `[Address(caller).toScVal(), Address(receiver).toScVal(), i128, u64, bytesN32]` in exactly that order.
   - `export async function buildRecordWireInEnvelope(...)` — `new Contract(minterId).call("record_wire_in", ...args)`, `getAccount(caller)`, build, `simulateTransaction`, throw on simulation error including `simResult.error` verbatim, `assembleTransaction`, return XDR.
   - `export async function recordWireIn(...)` — build → `signTransaction` → `sendTransaction` → `pollTransaction`, with `onStageChange`, returning `{ hash, wireId }` where `wireId` is read from the final result's return value (fall back to the `wire_in` event topic, as `extractDrawnLoanId` does) and is `null` when it cannot be decoded.
2. **`packages/wallet-connect/src/index.ts`.** Export `recordWireIn`, `buildRecordWireInEnvelope`, `encodeRecordWireInArgs`, `parseUsdDollarsToI128`, `hexToBytes32ScVal` and the stage/param types, following the existing export-comment style.
3. **`packages/trustee/src/lib/env.ts`.** Add `STELLAR_YIELD_MINTER_ID: readString("VITE_STELLAR_YIELD_MINTER_ID", "")` with the established "empty = unconfigured, callers must short-circuit" comment.
4. **`.env.example`.** Add `VITE_STELLAR_YIELD_MINTER_ID=CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK` next to the other `VITE_STELLAR_*` entries, with a one-line comment naming #1449 and the testnet deployment it comes from.
5. **`packages/trustee/src/api/useRecordWireIn.ts` (new).** Shape it on `useRecordPayment.ts`: `useStellarWallet()`, a `stage` state, `useMutation`. Short-circuit with a clear message when `ENV.STELLAR_YIELD_MINTER_ID` is empty or the wallet is not connected. Input `{ lpId, depositId, receiver, amount, occurredAt, refHash }`; convert `occurredAt` (ISO-8601) to `value_date` Unix **seconds** and `amount` via `parseUsdDollarsToI128`. On success invalidate `["lp-bank-deposits", lpId]` and `["lp", lpId]`.
6. **`packages/trustee/src/routes/-useLpBankDeposits.ts`.**
   - Pull `useLp(lpId)` for `stellar_address` / `address_linked_at`.
   - `export function wireInReceiver(lp, custodyId): { receiver: string; isCustody: boolean } | null` — the LP's `stellar_address` when it is set **and** `address_linked_at` is non-null; otherwise `ENV.STELLAR_USDC_CUSTODY_ID`; `null` when neither is available (action disabled).
   - Extend `DepositRow` with `isMinted: boolean`, `refHash`, `amountRaw` (the served decimal string), `occurredAtIso`.
   - Add `mintingDepositId: number | null` and `pendingDepositIds: Set<number>` (in-memory only; cleared when the served flag flips or when the bounded wait elapses). While any id is pending, raise the deposits query's `refetchInterval` to ~5 s for at most ~2 min, then fall back to the default and show "Submitted — waiting for the indexer".
   - `mintDisabledReason(row)` returning the first applicable message: wallet not connected / minter id unset / no receiver available / already minted / a submit in flight.
   - Map on-chain errors through `toUserError` (`@/utils/userError`), surfacing the contract message verbatim in `details`; add a dedicated case so a `RefHashSeen` trap reads "This deposit's reference has already been minted on-chain. Refresh the list."
   - **Never** set a client-side minted flag — the `minted` cell stays derived from `deposit.is_minted`.
7. **`packages/trustee/src/routes/-LpBankDepositsSection.tsx`.** Add a trailing "Action" column. For `is_minted === true` render the existing "Minted" state and no button. Otherwise render a `Button` labelled "Mint PLUSD", disabled with `title`/`aria-describedby` carrying `mintDisabledReason`, showing the stage text while in flight ("Awaiting signature…" / "Submitting…" / "Confirming…") and "Waiting for the indexer" while pending. Render the error through `InlineError` with `details`, matching the section's existing error treatment.
8. **Docs** (step 9 below lists the files).

## Test Strategy

Vitest, alongside the existing suites.

- `packages/wallet-connect/src/stellar/contracts/minter.test.ts` (new):
  - `parseUsdDollarsToI128`: `"50000.00"` → `500000000000n`; `"0.01"` → `100000n`; `"1"` → `10000000n`; rejects `""`, `"abc"`, `"-1"`, `"0"`, and >7 fractional digits.
  - `hexToBytes32ScVal`: a valid 64-char lowercase hash round-trips to 32 bytes; rejects wrong length, uppercase, non-hex.
  - `encodeRecordWireInArgs`: five args, exact order and types (`Address`, `Address`, `i128`, `u64`, `bytes(32)`) asserted via `scValToNative` / the XDR discriminants — this is the guard against the `UnreachableCodeReached` failure mode.
  - `buildRecordWireInEnvelope`: with a mocked `SorobanRpc.Server`, asserts the invocation targets the **minter** contract and the function name `record_wire_in` (no `execute` wrapper), and that a simulation error propagates with the contract text.
  - `recordWireIn`: stage sequence `awaiting-signature → submitting → confirming`; throws on `sendTransaction` ERROR and on a non-SUCCESS poll.
- `packages/trustee/src/api/useRecordWireIn.test.ts` (new): short-circuits with no wallet; short-circuits with an empty minter id; passes `value_date` as Unix seconds derived from `occurred_at`; invalidates the deposit and LP query keys on success.
- `packages/trustee/src/routes/-LpBankDepositsSection.test.tsx` (extend): both receiver branches (`stellar_address` + `address_linked_at` set → LP wallet; unset → `VITE_STELLAR_USDC_CUSTODY_ID`); a minted row shows "Minted" and no button; each disabled reason renders its message; the pending state appears after a successful submit and clears only when the refetched payload reports `is_minted: true`; a `RefHashSeen` failure renders the dedicated message with the raw contract error in the details.
- Lint + typecheck + build for `packages/wallet-connect` and `packages/trustee`.

## Docs to Update

- `docs/product-specs/loans-data.md` — add the `record_wire_in` signature next to the other Soroban write signatures: the five positional args and types, the `CASH_REPORTER` role and the `immediate` requirement, the single-use `ref_hash`, the 7-decimal amount scale, and the `receiver == minter ⇒ escrow` rule.
- `docs/frontend/trustee-flows.md` (`#lp-bank-deposits`) — the per-row Mint PLUSD action: receiver rule, states (idle / signing / submitting / confirming / waiting for the indexer / minted), disabled reasons, error surfacing.
- `docs/product-specs/deposits.md` — the mint step in the LP bank-deposit lifecycle and the Custody fallback when no wallet is linked.
- `docs/user-stories/epic-1269/1449-trustee-mint-bank-deposit.md` (new) — follow the shape of `1413-lp-bank-deposits.md`.
- `.env.example` and `packages/trustee/src/lib/env.ts` doc comments (covered in the steps above).
