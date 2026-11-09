# Issue #1765: Trustee Cash Management: book USDC↔USD conversions and bank charges on-chain (open_ramp / close_ramp / record_expense), replacing the MPC swap shell

Source: https://github.com/eq-lab/pipeline/issues/1765

## Scope

The Cash Management **On / Off-ramp** tab of the Trustee console stops being a disabled MPC swap shell. It becomes the place where a wallet with the `TRUSTEE` role books conversions and bank charges in the minter's on-chain cash book. Sub-issue of epic #1795. Sources of truth:

- `docs/user-docs/how-it-works/capital-layer.md`, the cash-book rows "USDC to USD or USD to USDC conversion — Trustee" and "Bank charges — Trustee";
- `docs/user-docs/governance/fiduciary-trustee.md` ("Books conversions between USDC and bank dollars, and bank expenses");
- `docs/user-docs/security/custody.md`. Custody accounts sign their own USDC moves. The console never co-signs; it only books.

In scope:

1. **Pool summary** at the top of the tab, with three figures: "Booked bank cash", "Cash in transit" and "Pool total".
   - Source: **one on-chain `pool_state()` read** of the minter the console signs against (`ENV.STELLAR_YIELD_MINTER_ID`). Its fields `bank_cash`, `in_flight` and `total_assets` are raw 7-dp values, rendered exactly as `formatUsdExact(rawToDecimal7(raw))`. The `read_failed` flag is shown verbatim as a caption.
   - Why not the cash book: `GET /v1/cash-book` serves `summary.bank_cash` / `in_flight` but **not `total_assets`** (verified on `origin/main`, `packages/api/src/routes/cash_book.rs` `CashBookSummary`). Following the manager's rule (all three served, else chain), and so all three figures come from one ledger and one minter, the summary reads the chain.
   - This replaces the shell's fee "—" placeholders. Log TD-178 so the summary can move to the API once it serves `total_assets`.
2. **Conversions list.** Source is the served `GET /v1/cash-book?chain_id=` `ramps[]` (#1790, already typed as `CashBookRamp` in `api/useCashBook.ts`):
   - row fields: `{ id, status: Open|Closed, direction: UsdcToBank|BankToUsdc, amount, opened_at, open_ref_hash, received?, loss?, closed_at?, close_ref_hash? }`;
   - each served `Open` row is confirmed on-chain with `ramp(id)`;
   - the **shortfall is the served `loss`**, which the API takes from the contract's `RampClosed` event. It is never computed as `amount − received`.
3. **Open a conversion** (button "Open conversion"). The dialog takes:
   - a direction: "USDC → USD" = `UsdcToBank`, "USD → USDC" = `BankToUsdc`;
   - an amount (USD, up to 7 dp);
   - the transfer reference, hashed as `ref_hash = sha256(reference.trim())`.

   It signs `open_ramp(direction, amount, ref_hash) -> id` through `AccessManager.execute`.
4. **Close a conversion** (row action "Close" on an `Open` row, so the Trustee picks from the served list and `ramp(id)` confirms it). The dialog takes the amount received (0 allowed) and the closing reference, then signs `close_ramp(id, received, ref_hash)`. Any shortfall is booked by the contract as an `Expense` entry and absorbed by the vault. The UI states this and shows the served `loss` once the close is indexed.
5. **Record a bank charge** (button "Record bank charge"). The dialog takes the amount, the value date (UTC date, not in the future) and the bank reference, then signs `record_expense(delta, value_date, ref_hash)`. It is burned from the vault, and the result links to the Audit Log (`CashRecorded`).
6. **Gating.**
   - `can_call(wallet, minter, fn)` must be `{ immediate: true }` for each of `open_ramp`, `close_ramp`, `record_expense`.
   - `ref_hash_seen` is checked before signing.
   - `paused()` is read before opening; only `open_ramp` is `#[when_not_paused]`.
   - Error copy covers a reused reference (`#7`) and paused (OZ `PausableError::EnforcedPause` = `#1000`). The minter-mismatch guard and the not-connected / not-configured reasons come from #1763.
7. **Retire the shells.**
   - Remove `SwapDialog` and the "New swap" button from the On/Off-ramp tab.
   - Remove the **T-Bills tab**: `TbillsSwapDialog`, `-cash-management-tbills.ts` and its test. T-bills / USYC are not part of the documented pool.
   - Drop the swap-only data from `-cash-management.ts` (`usdcBalance*`, `rampAddressDisplay`) and delete the now-unused `api/useRampAddresses.ts`.
8. **Ramp-event review queue** (`GET /v1/ramp/events`, `POST /v1/ramp/events/{id}/review`, #936). **Kept exactly as it is**, below the new conversions block. Whether its DB-side approval stays is a separate backend decision and is out of this issue.
9. **Specs:**
   - `docs/product-specs/trustee-dashboard.md` §Type 2 flows 7–9, rewritten as cash-book bookings with **net 0 lines** (the file is at 199 of 200);
   - `docs/frontend/trustee-flows.md`, a new §"Cash Management — Conversions and bank charges" holding the detail, plus the On/Off-ramp section rewritten;
   - the user-stories doc `docs/user-stories/epic-1795/1765-trustee-conversions-bank-charges.md`.

Out of scope:

- **EVM.** The tab's conversions block is read-only on EVM with the existing Stellar-only reason ("Conversions and bank charges on {chain} are not available in the Trustee app yet."). It sends no `/v1/cash-book` request and makes no RPC read. hoodi-v5 has `openRamp / closeRamp / recordExpense`, but the app has no EVM write client (#1573) and the API serves no EVM cash book.
- **Backend work of any kind**, including serving `total_assets` (TD-178 only) and retiring the ramp-event review queue.
- **Loan disbursement booking** (`disburse`, Type 2 flow 7). The spec row is rewritten to the booking model and points at the existing TD-157. No UI here.
- **The Withdrawal Queue tab's "Top up" MPC co-sign shell** (#945, flow 9's old model). The spec flow 9 is rewritten, and the leftover shell is logged as TD-179 rather than removed. The issue names only the swap and T-Bills shells.
- The `tbills` bucket in `CapitalAllocationCard` (shared with Overview; #1768 / backend).
- Any client-side figure. Amounts, dates, statuses and shortfalls are served (cash book) or read (chain) verbatim. The only arithmetic is input validation (comparing typed amounts with on-chain raw integers), never a displayed number.
- Figma and design work. The tab reuses the #1763/#1764 card, table, chip and `useLpReviewDialog` patterns. No design questions.
- Fixing the wire-id-0 bug in #1763/#1764 (logged as BUG-33, see Risks).

## Assumptions and Risks

**Branch.** `feat/1765-trustee-ramps-expenses` is stacked on `feat/1764-trustee-wire-outs` (PR #1876), which is stacked on `feat/1763-trustee-escrowed-wires` (PR #1875); draft PR #1877. The tree already holds:

- from #1763: `api/useCashBook.ts`, `readPlusdAuthorization`, `readMinterPlusdId`, `readWireInRefHashSeen`, `wireInReturnRefHash`, `cashBookError`, `formatUsdExact` and the minter-mismatch guard;
- from #1764: the `useWireOutMutation` / `wireOutSettlement.ts` shapes, plus `rawToDecimal7`, `valueDateSeconds`, `todayUtcDateInput` and `REUSED_BANK_REFERENCE_COPY` in `lib/wireOut.ts`.

Reuse them; do not copy them. If #1875 or #1876 change in review, rebase. After they squash-merge, use `git rebase --onto` and retarget, as the #1764 plan describes.

**Contract surface, verified 2026-11-09.** These were simulated reads only, never submitted, run with `/private/tmp/claude-501/-Users-luiza-Projects-pipeline/1ace6ff8-7957-4b39-a440-9054a51a5a0a/scratchpad/ramp.cjs`, `exp.cjs` and `wid.cjs`. The source is `eq-lab/pipeline-stellar-contracts` `contracts/minter/src/{lib,error,storage}.rs`. Both testnet minters, `CAPL5WN3…AIFK` (`VITE_STELLAR_YIELD_MINTER_ID`) and `CD2LPGLX…KPBD` (the API minter), expose the same spec:

- **Signatures.**
  - `open_ramp(direction: RampDirection, amount: i128, ref_hash: BytesN<32>) -> u32`
  - `close_ramp(id: u32, received: i128, ref_hash: BytesN<32>) -> ()`
  - `record_expense(delta: i128, value_date: u64, ref_hash: BytesN<32>) -> ()`
  - `ramp(id: u32) -> Ramp`
  - `pool_state() -> PoolState`
  - `bank_cash() / in_flight() / total_assets() -> i128`
  - `paused() -> bool`
  - `ref_hash_seen(BytesN<32>) -> bool`
- **`RampDirection`** is a union `UsdcToBank | BankToUsdc`. Encode it as `scvVec([scvSymbol(name)])`, which the probe confirmed. `scValToNative` decodes it to `["UsdcToBank"]`.
- **`Ramp`** is `{ amount: i128, closed: bool, closed_at: u64, direction: RampDirection, opened_at: u64, received: i128 }`. It has **no ref_hash and no loss field**. The loss exists only in the `RampClosed` event and in the cash book's `loss`.
- **`PoolState`** is `{ bank_cash, custody: Vec<(Address, i128)>, in_flight, outstanding_total, read_failed: bool, total_assets, unabsorbed_total }`.
- **Roles.** All three functions are `#[only_owner]`, and the owner is AccessManager `CDP7TUNB…WHTW`. `get_target_function_role` = `TRUSTEE` for each. `can_call(GAZFDDYK…ZH6G, minter, fn)` = `{ immediate: true, delay: 0 }` on both minters. The call path is `relay({ mode: "execute" })`, which simulates before asking for a signature, so contract errors surface before signing.
- **Order of checks:**
  - **`open_ramp`:** paused (`#1000`); `require_positive` (`#6`); `consume_ref` (`#7`, which **silently skips the zero hash**, so the encoders must refuse it); then
    - UsdcToBank: custody USDC total < amount → `InsufficientCustody` (`#18`); nothing moves;
    - BankToUsdc: `sub_bank_cash` → `#8`;

    then `in_flight += amount`.
  - **`close_ramp`:** **not paused-gated.** Unknown id → `#11`. Already closed → `RampClosed` (`#20`). `received < 0` → `#6`. `received > amount` → `ReceivedExceedsAmount` (`#19`). Then `consume_ref` (`#7`) and `in_flight −= amount`. For a UsdcToBank ramp, `bank_cash += received`. `loss = amount − received`, and `loss > 0` triggers `absorb(loss)` (vault `pull` plus PLUSD burn) and an `Expense` cash entry.
  - **`record_expense`:** **not paused-gated.** `#6`, then `#7`, then `sub_bank_cash` (`#8`), then `absorb(delta)`.
- **Ids start at 0.** `storage.rs` `next_id` returns 0 first. Simulating `AM.execute(open_ramp BankToUsdc 1)` on `CAPL5WN3…` returns id `0`. The ramp id validator must accept 0.
- **Live state.**
  - No ramp exists on either minter (`ramp(0..8)` answers `#11`).
  - `CAPL5WN3…`: `bank_cash` 7,341,220,000,000 raw (734,122.0000000), `in_flight` 0, `total_assets` = `bank_cash`, `paused` false, custody `GAPCFSTT…` USDC 0.
  - `CD2LPGLX…`: everything is 0.
- **Cash book and audit log.**
  - The cash book serves `ramps[]` with `status`, `loss` and both ref hashes, so the close dialog can pick from a served list.
  - `GET /v1/audit-log` renders `RampOpened` ("Ramp opened — {dir} ${amount}"), `RampClosed` ("Ramp closed — received ${r}, loss ${l}") and `CashRecorded` ("Cash recorded — Expense …").
  - Recorded bank charges are **not** listed by the cash book (it has no cash-entry list), so their result points to the Audit Log.

**Risks.**

- **Testnet blocks most live writes.**
  - USDC → USD fails `#18` on both minters (custody USDC is 0).
  - On `CD2LPGLX…`, USD → USDC and bank charges fail `#8` (`bank_cash` 0).
  - On `CAPL5WN3…`, USD → USDC opens: simulation OK, id 0. But **`record_expense` and any close with a shortfall fail inside the vault's `pull`** (vault `CDHSWXEG…544XM` returns its own `Error(Contract, #2)`). The vault does not accept pulls from this minter.
  - `#2` collides with the minter's `SameValue`, so the error copy must **not** map `#2`. It shows the generic message with the verbatim details.
  - A full-amount close (no loss) does not touch the vault and should succeed.

  The user story records all of this; unit tests carry the rest.
- **Minter mismatch on staging.** The app signs against `CAPL5WN3…`, while the pipeline-test cash book reports `CD2LPGLX…` (found by the #1764 planner). With a mismatch, every conversion action is disabled with #1763's reason. The pool summary still renders and labels its source minter (truncated). This is an environment alignment for ops.
- **Indexer lag.** After an open or close, the served list lags. Use #1763/#1764's pending-index window: refetch every 5 s, bounded to 120 s. A fresh open has no id in the UI until indexed, because `RelayResult` is `{ hash }` only. The result message therefore says "appears in the list once indexed" and does not show an id. Extending `relay` to return the value is deliberately avoided, since `accessManager.ts` is shared with #1761/#1762.
- **Merge with #1874 (#1762, "Bank income" tab).** Every new UI lives in new files. The edits to `cash-management.tsx` are:
  - an import;
  - one `<ConversionsSection />` line in the `onofframp` branch;
  - the header copy;
  - **deletions** of the swap, the T-Bills branch, `TbillsSwapDialog` and `SwapDialog`.

  Two textual conflicts with #1874 are expected and mechanical:
  1. `TabKey` / `TABS`, which #1763/#1764 already conflict on. Resolve to the union minus `tbills`.
  2. #1874's `income` branch is inserted directly after the T-Bills branch. Resolve by keeping `income` and dropping `tbills`.

  `trustee-flows.md` §On/Off-ramp conflicts the same way with #1874's "Bank income tab" lines; keep both. Record this in the PR body.
- **Wire ids start at 0 too.** `wire_in(0)` exists on `CAPL5WN3…` (status `Direct`). `requireWireId` in `wireInEscrow.ts` and `wireOutSettlement.ts` rejects `id < 1`, so wire-in 0 and the first wire-out on a fresh minter cannot be acted on. This is unrelated to this issue's scope, so per AGENTS it is **logged, not fixed** (BUG-33, step 9).
- **Numbering.** The next free TD on this branch is TD-178. BUG-32 is held by #1874, so take BUG-33. Renumber at merge if main moved.
- **`trustee-dashboard.md` cap.** It is 199 lines and the cap is 200. Every edit must be a same-line-count rewrite; check with `wc -l` and `lint-docs`.

## Open Questions

_None_

## Implementation Steps

1. **wallet-connect bindings.** [done] New file `packages/wallet-connect/src/stellar/contracts/minterRamps.ts`. Header: `// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges`. Mirror `wireOutSettlement.ts`:
   - Types:
     - `RampDirection = "UsdcToBank" | "BankToUsdc"`
     - `MinterRamp { id: number; direction: RampDirection; amount: string /* raw i128 */; openedAt: number; closed: boolean; closedAt: number; received: string /* raw */ }`
     - `MinterPoolState { bankCash: string; inFlight: string; totalAssets: string; readFailed: boolean }` (raw strings)
   - `requireRampId(id, who)`: an integer with `0 <= id <= 0xffffffff`. **Zero is valid.**
   - `readMinterRamp({ minterId, id, rpcUrl, networkPassphrase })`: `simulateRead(minterId, "ramp", [u32])`. It decodes the direction in array or string form and throws on an unknown direction or missing fields.
   - `readMinterPoolState(...)`: `simulateRead(minterId, "pool_state", [])`. Map the four fields; ignore `custody` / `outstanding_total` / `unabsorbed_total`.
   - `readMinterPaused(...)`: `simulateRead(minterId, "paused", [])` returns `=== true`.
   - Encoders:
     - `encodeOpenRampArgs({ direction, amountRaw, refHash })` returns `[scvVec([scvSymbol(direction)]), i128, bytes32]`.
     - `encodeCloseRampArgs({ id, receivedRaw, refHash })` returns `[u32, i128, bytes32]`. `receivedRaw` is a **non-negative** integer string, so `"0"` is allowed.
     - `encodeRecordExpenseArgs({ deltaRaw, valueDate, refHash })` returns `[i128, u64, bytes32]`.
     - All of them throw on a non-positive amount (open / expense), a negative or non-integer received, a non-positive or non-integer `valueDate`, an unknown direction, and **the zero `refHash`**.
   - Relays `openRamp`, `closeRamp` and `recordExpense` call `relay({ ...rest, mode: "execute", target: minterId, fn, args })`, with the same param shape as `settleWireOut`. Reuse `hexToBytes32ScVal` from `./minter`.
   - Export the functions and types from `packages/wallet-connect/src/index.ts` in a new block placed directly after the `./stellar/contracts/wireOutSettlement` blocks.

2. **Trustee data hooks.** [done] New file `packages/trustee/src/api/useConversions.ts`, with header `// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges`. Mirror `useWireOuts.ts`:
   - `ConversionFn = "open_ramp" | "close_ramp" | "record_expense"`.
   - `minterRampKey(minterId, id)` = `["minter-ramp", minterId, id]`, `fetchMinterRamp(id)`, and `useMinterRamps(ids, enabled)` (`useQueries`, `staleTime: 0`, `retry: false`).
   - `minterPoolStateKey(minterId)` = `["minter-pool-state", minterId]` and `useMinterPoolState(enabled)` (`refetchInterval` 30 s, `retry: false`).
   - `useMinterPaused(enabled)`, key `["minter-paused", minterId]`, `staleTime` 30 s.
   - `useConversionAccess(fn, enabled)`: `readCanCall` against `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` / `ENV.STELLAR_YIELD_MINTER_ID`, key `["conversion-access", address, fn]`, `staleTime` 30 s.
   - `useOpenRamp()`, `useCloseRamp()` and `useRecordExpense()`: copy the `useWireOutMutation` shape (stage state, not-configured / not-connected preflight). `onSuccess` invalidates `["cash-book"]`, `minterPoolStateKey`, and `minterRampKey` for a close. Not-configured copy: "Conversion and bank-charge actions are not configured for this environment."

3. **Presenters and copy.** [done] New file `packages/trustee/src/lib/conversions.ts`, with header `// spec: …#cash-management--conversions-and-bank-charges`.
   - `RAMP_DIRECTION_LABEL`: `UsdcToBank` → "USDC → USD", `BankToUsdc` → "USD → USDC".
   - `conversionAccessReason(fn, { access, isPending, isError })`. Reasons, parallel to `wireOutAccessReason`:
     - "Checking this wallet's Trustee role…"
     - "Could not verify this wallet's Trustee role."
     - delay > 0: "This wallet holds the Trustee role with a {h} h delay; the app does not schedule cash-book bookings."
     - otherwise: "Only the Trustee role can open conversions." / "…can close conversions." / "…can record bank charges."
   - `rampRowState(servedStatus, chainRead)`: `reading | read-error | confirmed` (chain not closed) `| closed-pending-index` (served Open, chain closed) `| mismatch`. Add the `rampStateLabel` / `rampStateReason` pair: "Open (confirmed on-chain)", "Closed on-chain — waiting for the indexer", "On-chain status differs from the cash book", "Could not confirm on-chain".
   - `parseReceivedRaw(input): bigint | null`: a literal zero (`/^0+(\.0{1,7})?$/`) gives `0n`; otherwise `parseUsdDollarsToI128`, with `null` on throw.
   - Form validators. The first failing check wins. Reference rules are shared: trimmed, non-empty, at most 140 characters (reuse `WIRE_OUT_REFERENCE_MAX`).
     - `openFormError({ direction, amountInput, reference })`:
       - no direction → "Choose a direction.";
       - bad amount → "Enter the amount to convert.";
       - empty reference → "Enter the transfer reference.".
     - `closeFormError({ receivedInput, amountRaw, reference })`:
       - bad input → "Enter the amount received.";
       - `parseReceivedRaw > BigInt(amountRaw)` → "The amount received cannot exceed the opened amount ({rawToDecimal7(amountRaw)})." This is a comparison with the on-chain raw value, not a displayed figure;
       - empty reference → "Enter the closing reference.".
     - `expenseFormError({ amountInput, valueDateInput, today, reference })`:
       - "Enter the charge amount."
       - "Enter the value date."
       - "The value date cannot be in the future."
       - "Enter the bank reference."
   - `conversionErrorCopy(fn, err)`: the structure of `wireOutErrorCopy`. Keep the wallet-rejection and specific messages. Otherwise map `parseSorobanContractErrorCode`:
     - `#7` / `RefHashSeen` → `REUSED_BANK_REFERENCE_COPY`, imported from `lib/wireOut.ts`;
     - `#1000` / `EnforcedPause` (open) → "The minter is paused. Conversions cannot be opened until it is unpaused.";
     - `#8` → "The minter's booked bank cash is below this amount.";
     - `#18` (open) → "Custody USDC on-chain is below this amount.";
     - `#19` → "The amount received cannot exceed the opened amount.";
     - `#20` → "This conversion is already closed. Refresh the list.";
     - `#11` → "The minter has no conversion with this id.";
     - `#6` → "The amount must be greater than zero.";
     - **leave `#2` and every other code unmapped.**

     Every mapped error keeps `details` as the raw text.
   - Reuse `rawToDecimal7`, `valueDateSeconds` and `todayUtcDateInput` from `@/lib/wireOut`, and `cashBookError` from `@/lib/wireEscrow`. Define no copies.

4. **Section hook.** [done] New file `packages/trustee/src/routes/-conversions.ts`, `useConversionsSection()`, modelled on `useWireOutsSection`:
   - Chain: `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`. `chainKindOf` gives `unsupported` for EVM, with no cash-book fetch and no pool or paused read. `targetChainLabel` supplies the chip label.
   - **Summary:** `useMinterPoolState(stellar && !!ENV.STELLAR_YIELD_MINTER_ID)`. The view fields are `bankCash`, `inFlight` and `totalAssets`, each `formatUsdExact(rawToDecimal7(raw))`; `readFailed`; `sourceMinter` (truncated `ENV.STELLAR_YIELD_MINTER_ID`); and the states `loading | error | ready`. The error copy is "Could not read the minter's pool state.", with details.
   - **List:** `useCashBook(chainId, { enabled: stellar, refetchMs })`. Export `CONVERSION_REFETCH_MS = 30_000`, `CONVERSION_PENDING_REFETCH_MS = 5_000` and `CONVERSION_PENDING_WINDOW_MS = 120_000`.
     - Rows are served `ramps[]` in served order. Only `Open` ids get `useMinterRamps` confirmations.
     - Row fields: `id`, direction label, `amount` (`formatUsdExact`, served), `openedAt` (`formatIsoDateTimeUtc`), `openRefHash` (first 8 / last 8, full value in `title`), status, `received` / `loss` / `closedAt` / `closeRefHash` as served or "—", and the chain state.
     - Section states: `unsupported | loading | error | empty ("No conversions on {chain}.") | ready`.
   - **Shared gating.** The first match wins:
     1. wallet not connected;
     2. minter or executor not configured;
     3. minter mismatch (`cashBook.data.minter !== ENV.STELLAR_YIELD_MINTER_ID`); the expense button needs the cash book loaded for this check too;
     4. role (`conversionAccessReason` for the fn);
     5. another action in flight.

     Extra conditions:
     - **Open** also needs `paused === false`. While paused it shows "The minter is paused; conversions cannot be opened." and while the read is pending, "Checking whether the minter is paused…".
     - **Close** (Open rows only) also needs the row's chain state to be `confirmed`.
   - **Open flow.** Dialog state is `{ direction, amountInput, reference, refHash, error, submitting }`. `refHash` shows read-only as the reference is typed (`wireInReturnRefHash`).
     - The direction choice explains the effect from the spec:
       - USDC → USD: "Books USDC sent from custody to the bank as cash in transit. The custody balance must cover it."
       - USD → USDC: "Takes the amount out of booked bank cash into cash in transit."
     - Confirm runs `openFormError`, then `readWireInRefHashSeen` (true shows the reused copy and stops), then re-reads `paused`, then calls `useOpenRamp().mutateAsync({ direction, amountRaw: parseUsdDollarsToI128(amountInput).toString(), refHash })`.
     - After success: refetch the pool state, start the pending-index window, and set the result "Conversion opened on-chain ({direction label}, {amountInput}). Transaction {hash}. It appears in the list once indexed."
   - **Close flow.** Opening the dialog runs `fetchMinterRamp(id)`, with phase `reading | open | closed | read-error`. Confirm is enabled only while `open`.
     - The dialog shows the on-chain opened amount `rawToDecimal7(ramp.amount)` next to the served amount.
     - Inputs: "Amount received" (empty by default) and "Closing reference", with the read-only hash.
     - Fixed copy: "Any shortfall between the opened amount and the amount received is booked by the contract as an expense and absorbed by the vault."
     - Confirm runs `closeFormError` against the **on-chain** `ramp.amount`, then `ref_hash_seen`, then re-reads `ramp(id)` (closed stops with the `#20` copy), then calls `useCloseRamp().mutateAsync({ id, receivedRaw, refHash })`.
     - After success, re-read `ramp(id)`. The result is "Conversion #{id} closed on-chain. Received {rawToDecimal7(read.received)}; any shortfall is booked as an expense and shows in this list once indexed. Transaction {hash}." If the re-read fails, use the `unverified` variant (as #1764). Add the id to the pending-index set.
   - **Expense flow.** Dialog state is `{ amountInput, valueDateInput (today UTC), reference, refHash }`.
     - Confirm runs `expenseFormError`, then `ref_hash_seen`, then calls `useRecordExpense().mutateAsync({ deltaRaw, valueDate: valueDateSeconds(valueDateInput), refHash })`.
     - Result: "Bank charge of {amountInput} booked on-chain, value date {date}; it was burned from the vault. Transaction {hash}. It appears in the Audit Log once indexed." with a link to `/audit-log` (the #1762 pattern). Refetch the pool state.
   - Export `ConversionsSection = ReturnType<typeof useConversionsSection>`.

5. **View.** [done] New file `packages/trustee/src/routes/-ConversionsSection.tsx`, JSX only (FRONTEND.md rule 2), with a one-line spec header. Reuse the `-WireOutsSection.tsx` styling constants and patterns.
   - **Summary card** (`cash-management-pool-summary`): three tiles, "Booked bank cash", "Cash in transit" and "Pool total" (`pool-summary-bank-cash`, `-in-flight`, `-total`).
     - Caption: "Read on-chain from the minter {truncated id} (pool_state)."
     - When `readFailed`: "A custody balance could not be read; the minter counts it as 0 in the pool total."
     - States: skeleton, `InlineError`, or the EVM reason.
   - **Action bar:** buttons "Open conversion" (`conversion-open`) and "Record bank charge" (`expense-open`). Each is disabled with a visible reason line (`conversion-open-reason`, `expense-open-reason`).
   - **Conversions table** (`cash-management-conversions`). Columns: ID, Direction, Amount, Opened at, Reference hash, Status (`StatusChip` Open/Closed), Received, Shortfall, Closed at, On-chain, Actions. Rows use `ramp-row-{id}-…` test ids; the Close button is `ramp-row-{id}-close`, with a reason at `ramp-row-{id}-reason`.
   - **Dialogs** `OpenConversionDialog`, `CloseConversionDialog` and `RecordExpenseDialog`. Each uses the `useLpReviewDialog` shell (`role="dialog"`, `aria-modal`). Escape and backdrop cancel, and both are blocked while pending. The confirm label follows the stage ("Awaiting signature…" / "Submitting…" / "Confirming…"). Errors use `InlineError` with "View details". Direction is a two-option radio group (`conversion-direction-UsdcToBank` / `-BankToUsdc`), and the value date is an `<input type="date" max={today}>`.
   - A green result notice (`conversion-result`).

6. **Tab wiring.** [done] `packages/trustee/src/routes/cash-management.tsx`:
   - import `ConversionsSection` from `./-ConversionsSection`;
   - in the `onofframp` branch, remove the "New swap" button and render `<ConversionsSection />` between the header row and the existing review-queue card. Leave the review-queue card markup unchanged, except for a small heading "Ramp-event review" with the note "Ramp transfers detected on-chain, approved in the database (#936)."
   - change the sub-line to "{chain} — the network you signed in with. Book conversions between USDC and bank dollars, and bank charges, on the minter.";
   - remove `swapOpen` and `tbillsSwapOpen` state and their resets, the `SwapDialog` and `TbillsSwapDialog` components and their render sites, the `tbills` `TabKey` / `TABS` entry and its branch, and the `useTbillsSwap` import;
   - update the header spec list: replace `#cash-management--onoff-ramp--t-bills` with `#cash-management--onoff-ramp` and add `#cash-management--conversions-and-bank-charges`;
   - add no other comments.

7. **Presenter clean-up.** [done]
   - `packages/trustee/src/routes/-cash-management.ts`: drop `usdcBalanceValue`, `usdcBalanceDisplay`, `rampAddressDisplay`, the `useRampAddresses` / `useUsdcCustodyBalance` calls and their imports. Update the header anchor to `#cash-management--onoff-ramp`. `useUsdcCustodyBalance` stays, because `CapitalAllocationCard` and `useDrawLoan` use it.
   - Delete `packages/trustee/src/api/useRampAddresses.ts`, `routes/-cash-management-tbills.ts` and `routes/-cash-management-tbills.test.ts`.
   - Remove the tbills test's entry from `scripts/lint-comments.baseline.json`. Shrink the baseline for `-cash-management.ts` / `-cash-management.test.ts` / `-cash-management-page.test.tsx` / `cash-management.tsx` if their counts drop (`npx tsx scripts/lint-comments.ts --update-baseline`; commit only shrinks).
   - Leave the `// spec:` headers of `useRampEvents.ts`, `useReviewRampEvent.ts` and `-useRampHooks.test.tsx` unchanged; they point at `#onoff-ramp-tab`, and that heading is kept. Delete only the `useRampAddresses` case from `-useRampHooks.test.tsx`.

8. **Tech debt** [done] in `docs/exec-plans/tech-debt-tracker.md`. Bump "Next free number" to TD-180.
   - **TD-178.** The pool summary reads `pool_state()` on-chain because `GET /v1/cash-book` does not serve `total_assets`. Fix: serve `total_assets` (and the snapshot `read_failed`) from the cash book, then switch the summary to served values.
   - **TD-179.** The Withdrawal Queue tab still renders the #945 "Top up" MPC 3-of-5 co-sign shell (`WithdrawalTopUpDialog`), but `trustee-dashboard.md` flow 9 now says the top-up is a custody transfer under the custody policy, which the console does not co-sign. Fix: retire the dialog in a follow-up frontend issue.
   - Append #1765 to TD-177's Location: `-conversions.ts` reuses `wireInReturnRefHash` / `readWireInRefHashSeen` and `lib/wireOut.ts`'s date helpers.
   - Mark **TD-156** resolved: "Resolved by #1765: the SwapDialog is removed; no Cash Management view shows a custody balance any more." Leave its body unchanged otherwise.

9. **Known bug** [done] in `docs/exec-plans/known-bugs.md`. Add **BUG-33**: "Escrowed-wire and wire-out bindings reject id 0, but minter ids start at 0".
   - Location: `wireInEscrow.ts` / `wireOutSettlement.ts` `requireWireId` (`id < 1`).
   - Root cause: `storage.rs` `next_id` returns 0 first.
   - Symptom: `wire_in(0)` exists on `CAPL5WN3…`. An escrowed wire-in 0, or the first wire-out on a fresh minter, cannot be confirmed or acted on.
   - Workaround: none.

   Do not fix it in this issue.

10. **Docs.** [done] See Docs to Update.

## Test Strategy

Every test file has a single `// spec:` header line and no other comments (`lint-comments`).

- **`packages/wallet-connect/src/stellar/contracts/minterRamps.test.ts`:**
  - Encoders:
    - the open direction ScVal is `vec[symbol]` for both directions;
    - the i128 equals `BigInt(amountRaw)` exactly (for example `"10000001"`);
    - close accepts id `0` and `receivedRaw` `"0"`;
    - expense args are i128 / u64 / bytes32;
    - each rejects the zero hash, a negative or non-integer amount, a zero amount (open / expense), an id < 0 or > u32, and an unknown direction.
  - `readMinterRamp`: decodes both direction forms, and throws on unknown or missing fields.
  - `readMinterPoolState`: maps the raw strings and `read_failed`.
  - `readMinterPaused`.
  - `openRamp` / `closeRamp` / `recordExpense` call `relay` with `mode: "execute"`, the right `fn` and the `target` (mock `./accessManager` and `./simulateRead`).
- **`packages/trustee/src/lib/-conversions.test.ts`:**
  - every `conversionAccessReason` branch;
  - `rampRowState` and its labels;
  - `parseReceivedRaw`: `"0"` and `"0.00"` give `0n`, `"1.5"` gives `15000000n`, `"abc"` gives `null`;
  - each form-validator message, including received equal to the opened amount (passes) and received one raw unit above (blocks);
  - `conversionErrorCopy` for `#7`, `#1000`, `#8`, `#18`, `#19`, `#20`, `#11`, `#6`. **`#2` stays unmapped** (generic message, verbatim details). Wallet rejection passes through unchanged.
- **`packages/trustee/src/api/-useConversions.test.tsx`:** the access query key and args per fn; the pool-state, paused and ramp query keys; the mutation preflight errors; the `relay` args; and the invalidations on success (`["cash-book"]`, pool state, ramp).
- **`packages/trustee/src/routes/-conversions.test.ts`:** the hook with mocked `apiFetch` and wallet-connect.
  - EVM session: `unsupported`; no `/v1/cash-book` call; no `pool_state` / `paused` read.
  - Summary renders the raw values exactly (`7341220000000` gives `$734,122`); `read_failed` caption; pool-state error copy.
  - Cash-book `404 minter_not_configured`, `403` and `401` copy; the empty list.
  - Rows map served fields verbatim, `loss` is shown as served and never derived, and only `Open` ids are read on-chain.
  - Minter mismatch disables all three actions.
  - Paused disables Open but not Close or Record.
  - Open: a seen reference blocks; success passes `parseUsdDollarsToI128(amount)` and the sha256 of the trimmed reference.
  - Close: received above the on-chain amount blocks before signing; a re-read showing closed blocks; success passes `receivedRaw` `"0"` for a typed `0`.
  - Expense: a future date blocks; success passes `valueDateSeconds`.
  - The pending-index polling window.
- **`packages/trustee/src/routes/-ConversionsSection.test.tsx`:**
  - the summary tiles;
  - the table and the Close button only on Open rows;
  - the reasons are visible;
  - each dialog opens and validates;
  - Escape is blocked while pending;
  - the stage labels;
  - the result notices (the expense notice has the Audit Log link).
- **`packages/trustee/src/routes/-cash-management-page.test.tsx`:**
  - mock `./-ConversionsSection`;
  - delete the "T-Bills swap dialog" and "swap dialog" describe blocks and the `useRampAddresses` / `useUsdcCustodyBalance` / `useCapitalAllocation` mocks that only they needed;
  - the shell test asserts the tabs `onofframp, withdrawals, escrow, wireouts`, that there is no `cash-management-tab-tbills`, and that there is no `cash-management-swap-open`;
  - the On/Off-ramp tab renders the conversions stub **and** the unchanged review queue (keep every review-queue test).
- **`packages/trustee/src/routes/-cash-management.test.ts`:** drop the swap-field assertions; keep the event mapping.
- **`packages/trustee/src/api/-useRampHooks.test.tsx`:** drop the `useRampAddresses` case.
- **Gates:**
  - `yarn workspace @pipeline/wallet-connect test`
  - `yarn workspace @pipeline/trustee test`
  - `yarn workspace @pipeline/trustee build` (tsc; no new route, so no routeTree regeneration)
  - `npx tsx scripts/lint-docs.ts` (0 errors; `trustee-dashboard.md` ≤ 200)
  - `npx tsx scripts/lint-comments.ts`
- **Live check by the user** (do not drive their browser). Follow the user-stories doc on staging. The probes `/private/tmp/claude-501/-Users-luiza-Projects-pipeline/1ace6ff8-7957-4b39-a440-9054a51a5a0a/scratchpad/ramp.cjs` (run from `packages/wallet-connect`) can be re-run, simulation only and never submitted, to compare the pool figures and to spot the first ramp.

## Docs to Update

- **`docs/product-specs/trustee-dashboard.md`**, net 0 lines. Rewrite in place:
  1. Four-types table row 2: "2. Cash-book booking | The Trustee role books a bank or custody movement on the minter through the AccessManager | Nobody; custody accounts sign their own USDC moves | None (immediate) | Fill the form; one signature books it". The two lines under the table become "No dashboard action moves USDC from a custody account. The console books movements; it never co-signs them."
  2. Flow note B's sentence "The resulting disbursement is a separate Type 2 action the Trustee co-signs" becomes "…a separate Type 2 booking (`disburse`, TD-157)", same line count.
  3. `## Type 2 — Capital Wallet MPC co-signature` becomes `## Type 2 — Cash-book bookings`. The intro paragraph (4 lines) states: Trustee role, `AccessManager.execute`, immediate only, single-use `ref_hash`; detail in [trustee-flows.md](../frontend/trustee-flows.md#cash-management--conversions-and-bank-charges). The table rows become:
     - **7** Loan disbursement booking: `disburse(loan_id, amount, value_date, ref_hash)`, takes `bank_cash`, not yet in the console (TD-157);
     - **8** USDC↔USD conversion: `open_ramp` / `close_ramp`; cash in transit until closed; the shortfall is booked as an expense;
     - **9** Bank charge: `record_expense`, out of `bank_cash`, burned from the vault.
  4. Flow note C (T-Bill band-keeping) becomes "Flow note C — Withdrawal Queue top-up": a custody-to-custody transfer under the custody signing policy, no cash-book entry, not a console action. It has the same or fewer lines.
  5. API row "Build a co-signed request" becomes "Cash-book bookings | none: the console signs `AccessManager.execute`; lists from `GET /v1/cash-book` | Flows 7, 8, 9". In the Reserves row, drop "the USYC price and band".
  6. Security bullet 1 becomes "No dashboard action moves USDC from a custody account. Bookings change only the on-chain cash book, each with a single-use `ref_hash`."

  Verify with `wc -l` (≤ 200) and `lint-docs`.
- **`docs/frontend/trustee-flows.md`:**
  - Rename `## Cash Management — On/Off-ramp & T-Bills` to `## Cash Management — On/Off-ramp` and update the Sources line: drop `TbillsSwapDialog`, `-cash-management-tbills.ts` and `SwapDialog`; add `-ConversionsSection.tsx`. Source of truth becomes the user docs.
  - Rewrite `### On/Off-ramp tab`: part 1 is the conversions block (pointer to the new section); part 2 is the review queue, unchanged, plus one sentence saying the DB approval is kept as-is and its retirement is a separate backend decision. Remove the SwapDialog paragraph and the custody-balance sentence.
  - Replace `### T-Bills tab (#944)` with two lines: "Retired by #1765: T-bills / USYC are not part of the documented pool (`capital-layer.md`)."
  - Add `## Cash Management — Conversions and bank charges` directly after "Cash Management — Bank wire-outs", with the same sub-structure as #1764:
    - Sources;
    - Chain scope (EVM reason, no fetch);
    - Pool summary (`pool_state` on-chain, verbatim, why not the cash book, TD-178);
    - Data sourcing (`ramps[]`, `ramp(id)` for Open rows, `loss` served, never computed);
    - Table;
    - Row states and gating (the order above; paused applies to open only);
    - Open dialog;
    - Close dialog;
    - Record bank charge dialog;
    - Shell, errors and result (code map, `#2` unmapped);
    - Testnet caveat: no ramps; custody USDC 0 gives `#18`; `CD2LPGLX…` `bank_cash` 0 gives `#8`; the `CAPL5WN3…` vault `pull` gives `#2` for an expense or a lossy close; minter mismatch; ids start at 0.
- **`docs/user-stories/epic-1795/1765-trustee-conversions-bank-charges.md`.** Status Initial. Real API on staging, no mocks, Network tab open. Prerequisites and risks as above. Stories:
  1. The pool summary on Stellar matches `pool_state` (probe), with its source caption.
  2. EVM: reason shown, no `/v1/cash-book` request.
  3. A no-role wallet sees the reasons on all three actions.
  4. The T-Bills tab and "New swap" are gone, and the ramp-event review queue still works.
  5. Open USD → USDC: a reused reference blocks before signing.
  6. Open USD → USDC succeeds: the row appears Open after indexing, and in transit and bank cash change in the summary, read from chain.
  7. Open USDC → USD with custody 0 shows "Custody USDC on-chain is below this amount." before signing.
  8. Close with the full amount: Closed, served shortfall `0` or "—".
  9. Close with a shortfall: the served `loss` appears. Known vault `#2` risk on `CAPL5WN3…`.
  10. Received above the opened amount is blocked.
  11. Record a bank charge: the Audit Log shows "Cash recorded — Expense". Known `#2` / `#8` risk.
  12. Paused minter: Open is disabled with a reason, and Close and Record stay enabled (only when ops pauses the minter; optional).
  13. Minter mismatch disables all actions.
- **`docs/user-stories/index.md`.** Add a row for #1765 under epic #1795, after #1764.
- **`docs/exec-plans/tech-debt-tracker.md`.** TD-178, TD-179, the TD-177 append and the TD-156 resolution (step 8).
- **`docs/exec-plans/known-bugs.md`.** BUG-33 (step 9).
