# Issue #1764: Trustee: settle or cancel lender bank withdrawals (Minter.settle_wire_out / cancel_wire_out) with a pending wire-outs list

Source: https://github.com/eq-lab/pipeline/issues/1764

## Scope

Add a fifth Cash Management tab, **Bank wire-outs**, to the Trustee console. It lists the lenders' bank wire-out requests on the session chain and lets a wallet with the `TRUSTEE` role settle each one (`settle_wire_out`) or cancel it (`cancel_wire_out`). Sub-issue of epic #1795. Sources of truth: `docs/user-docs/lenders/withdraw.md` §"Bank wire withdrawals", `docs/user-docs/governance/fiduciary-trustee.md`, and the cash-book row "Lender wire out" in `docs/user-docs/how-it-works/capital-layer.md`.

In scope:

1. **List.** Source is `GET /v1/cash-book?chain_id=` `wire_outs[]` (#1790, on main, spec `docs/product-specs/minter-cash-book.md`). It already serves every field the issue asks for, so the audit-log fallback and a backend list-endpoint follow-up are **not needed**. Each row is `{ id, status: Pending|Settled|Cancelled, lp, lp_id?, lp_legal_name?, amount, requested_at, settled_at?, value_date?, ref_hash?, cancelled_at? }`. The lender name is the served `lp_legal_name`, resolved server-side from the LP link active at `requested_at`, so the app does no `/v1/lps` join. Each `Pending` row is confirmed on-chain with `wire_out(id)`.
2. **Settle.** The dialog takes the amount wired, the value date and the outgoing bank reference. The `ref_hash` is `sha256(reference.trim())`, checked against `ref_hash_seen` before signing. The call is `settle_wire_out(id, amount, value_date, ref_hash)` through `AccessManager.execute`. The PLUSD burn is the contract's effect and shows through the re-read status after the transaction.
3. **Cancel.** `cancel_wire_out(id)`. Before signing, the app checks `PLUSD.authorized(lp)`. If the contract still fails, its error is shown verbatim in the details.
4. **Gating.** `can_call(wallet, minter, fn)` on the AccessManager must be `{ immediate: true }`. The dialogs use the shared trustee shell (`useLpReviewDialog`).
5. **Specs.** A Trustee section in `docs/product-specs/withdrawals.md`, a section in `docs/frontend/trustee-flows.md`, and the user-stories doc `docs/user-stories/epic-1795/1764-trustee-wire-outs.md`.

Out of scope:

- **The lender's destination bank account (#1812, open backend issue).** The settle dialog shows a "Destination bank account" row with "—" and the line "The API does not serve the lender's bank account yet." The app never guesses one. Plan no backend work.
- **EVM.** The tab is read-only on EVM with the existing Stellar-only reason ("Bank wire-outs on {chain} are not available in the Trustee app yet.") and makes no request. The API serves no EVM cash book and the app has no EVM write client (#1573).
- The LP side (`request_wire_out`, #1757, on `epic/1795-lp-ui`).
- Any client-side figure. Amounts, dates, names and statuses are rendered as served (cash book) or as read (chain).
- Figma or design work. The tab reuses the Escrowed-wires table, chip and dialog patterns.

## Branch base (recommendation for the manager)

**Recommendation: stack on `feat/1763-trustee-escrowed-wires` (PR #1875). Do not build on main with duplicates.**

Why the overlap is large:

- #1764 needs these helpers from #1875 unchanged: `api/useCashBook.ts` (the whole file; #1875's trustee-flows section already says "#1764 and #1765 reuse it"), `readMinterPlusdId`, `readPlusdAuthorization`, `readWireInRefHashSeen` (a generic `ref_hash_seen` reader), `wireInReturnRefHash` (`sha256(trim)`), `useMinterPlusdId` / `ensureMinterPlusdId`, `cashBookError`, `formatUsdExact`, and the minter-mismatch guard. That is about 230 lines.
- Duplicating them on main would put same-named exports in `@pipeline/wallet-connect/src/index.ts` (a type error at merge) or force renamed copies plus a cleanup issue.
- The branch is cheap to move. `feat/1764-trustee-wire-outs` holds only the `chore: start work` commit. #1875 is ready for review and `MERGEABLE`. The user merges overlapping PRs first.

Step 0 below is for the manager, because the coder does not commit or rebase.

**Fallback if the manager keeps main.** Add a byte-identical copy of `packages/trustee/src/api/useCashBook.ts`; an identical add/add merges cleanly. Copy `formatUsdExact` byte-identically at the same spot in `utils/formatUsd.ts`. Put the PLUSD-authorization, `ref_hash_seen`, minter-PLUSD-id and sha256 helpers inside the new `wireOutSettlement.ts` under wire-out names (`readWireOutLpAuthorization`, `readWireOutRefHashSeen`, `readWireOutPlusdId`, `wireOutRefHash`), and log a TD entry to fold them into `wireInEscrow.ts` after #1875 merges.

## Assumptions and Risks

**Contract surface, verified 2026-11-09.** The checks below were simulated reads only, run with `/private/tmp/claude-501/-Users-luiza-Projects-pipeline/1ace6ff8-7957-4b39-a440-9054a51a5a0a/scratchpad/wireout.cjs` and `spec.cjs`. The source is `eq-lab/pipeline-stellar-contracts` `contracts/minter/src/lib.rs`. Both testnet minters, `CAPL5WN3…AIFK` (`VITE_STELLAR_YIELD_MINTER_ID`) and `CD2LPGLX…KPBD` (the API minter after contracts #42, PR #1855), expose the same surface:

- **Signatures.**
  - `settle_wire_out(id: u32, amount: i128, value_date: u64, ref_hash: BytesN<32>) -> ()`
  - `cancel_wire_out(id: u32) -> ()`
  - `wire_out(id: u32) -> WireOut`
  - `ref_hash_seen(BytesN<32>) -> bool`
  - `bank_cash() -> i128`
- **`WireOut` struct:** `{ amount: i128, lp: Address, ref_hash: BytesN<32>, requested_at: u64, status: WireOutStatus }`. `WireOutStatus` is a union: `Pending | Settled | Cancelled`.
- **Roles.** Both functions are `#[only_owner]`, and the owner is AccessManager `CDP7TUNB…WHTW`. `get_target_function_role(minter, settle_wire_out | cancel_wire_out)` = `TRUSTEE`. `can_call(GAZFDDYK…ZH6G, minter, fn)` = `{ immediate: true, delay: 0 }` on both minters. `AM.execute(minter, settle_wire_out | cancel_wire_out, [999, …], caller)` reaches the minter logic and fails `Error(Contract, #10)`. The call path is therefore `relay({ mode: "execute" })`, the same as #1763's assign / return.
- **`settle_wire_out` order.** `WrongWireStatus` (`#14`) when not Pending, then **`AmountMismatch` (`#17`) unless `amount == wire.amount` exactly**, then `consume_ref`, then `plusd_burn`, then `sub_bank_cash` (`InsufficientBankCash`, `#8`).
  - The contract settles only the full requested amount. The "amount wired" field is therefore an explicit confirmation: it is pre-filled with the exact on-chain amount and checked for equality before signing.
  - The encoder sends the **on-chain raw i128**, never the cash book's 6-dp floored amount, which would mismatch whenever the 7th decimal is non-zero.
  - `consume_ref` **silently skips the zero hash**, so the encoder must refuse it.
- **`cancel_wire_out` order.** `#14` when not Pending, then `LpFrozen` (`#16`) when `PLUSD.authorized(lp)` is false. A missing trustline traps as SAC `#13`, which `readPlusdAuthorization` already maps to `no-trustline`.
- **Other codes:** `#10` NonExistentWireOut, `#7` RefHashSeen. The minter error enum lives in the contracts repo `error.rs` and is not in the on-chain spec.
- **PLUSD is a Stellar Asset Contract** whose admin is the AccessManager. `settle_wire_out` burns the minter's own balance through SAC `burn(from = minter)`. That needs only the minter's contract auth, not an AccessManager role, so the "burn role" worry carried over from #1763 should not apply. It cannot be proven without a wire-out.

**Risks.**

- **No wire-out exists on testnet.** `wire_out(0..6)` answers `#10` on both minters, so the settle and cancel paths can be exercised live only after an LP requests one. The LP UI for that is #1757, on `epic/1795-lp-ui`; `request_wire_out` can also be called directly by a funded LP. Until then, unit tests carry the coverage. The user story lists this as a prerequisite.
- **`bank_cash` on `CD2LPGLX…` is 0** (`CAPL5WN3…` holds 734,122 raw-7). Settling on the new minter fails with `#8` until wire-ins are booked there. The copy maps `#8`; the user story records it.
- **Minter mismatch.** The trustee app signs against `VITE_STELLAR_YIELD_MINTER_ID` (`CAPL5WN3…`). The cash book reports its own `minter` (on pipeline-test it is `CD2LPGLX…` after argocd#503). When they differ, every action is disabled with #1763's reason ("The app's minter differs from the server's cash-book minter."). This is an env alignment for ops, not code. Note it in the user story.
- **Indexer lag.** After a settle or cancel, the cash book still serves `Pending` for a while. The row uses #1763's `*-pending-index` states and the 5 s refetch bounded to 120 s.
- **Stacking dependency.** If #1875 changes in review, #1764 must rebase onto it. After #1875 squash-merges, #1764 needs `git rebase --onto origin/main <old 1763 tip>` and a base retarget to `main`.
- **Tech-debt numbering is contested.** Main says TD-174 is the next free number; #1761 and #1763 both took TD-174 on their branches. Stacked on #1763, the coder takes the next free number that file shows (TD-175) and renumbers at merge to whatever main shows then. Same rule for any BUG entry (#1762 holds BUG-32 on its branch).
- **`withdrawals.md` size.** 101 lines on main. `epic/1795-lp-ui` adds 53 (about 154). Keep the new Trustee section at 25 lines or fewer and append it at the end of the file, after "Stellar queue read model (#1791)", where the epic diff does not touch. The `lint-docs` cap is a 200-line error and a 150-line warning.
- **Duplicate wire-out reader.** The epic branch adds `readMinterWireOut` / `MinterWireOut` to `stellar/contracts/minter.ts`; its version has no `ref_hash`. #1764 adds its reader in a new file under distinct names and logs a TD entry to merge the two once the epic lands. Do not touch `minter.ts`.

## Open Questions

_None_

## Implementation Steps

0. **Manager, before the coder starts.** Rebase the branch and retarget the PR:
   ```bash
   git fetch origin
   git rebase --onto origin/feat/1763-trustee-escrowed-wires main feat/1764-trustee-wire-outs
   git push --force-with-lease
   gh pr edit 1876 --base feat/1763-trustee-escrowed-wires
   ```
   This carries the plan commit along. Note the merge order in the PR body: #1875 first, then retarget #1876 to `main`.

1. **wallet-connect bindings.** New file `packages/wallet-connect/src/stellar/contracts/wireOutSettlement.ts` with header `// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-trustee-console`. Mirror `wireInEscrow.ts`:
   - Types:
     - `WireOutRecordStatus = "Pending" | "Settled" | "Cancelled"`
     - `WireOutRecord { id: number; lp: string; amount: string /* raw i128 */; requestedAt: number; status: WireOutRecordStatus; refHash: string /* hex */ }`
   - `readWireOutRecord({ minterId, id, rpcUrl, networkPassphrase })`: a `simulateRead(minterId, "wire_out", [u32(id)])` call that decodes the union status (array or string form), returns the bytes as hex, and throws on missing fields or an unknown status. Validate the id the same way as `requireWireId`; copy that check locally, because `requireWireId` is not exported.
   - `encodeSettleWireOutArgs({ id, amountRaw, valueDate, refHash })` returns `[u32 id, i128 BigInt(amountRaw), u64 BigInt(valueDate), hexToBytes32ScVal(refHash)]`. It throws on:
     - `amountRaw` that is not a positive integer string;
     - `valueDate` that is not a positive integer;
     - the zero `refHash`.
   - `encodeCancelWireOutArgs({ id })` returns `[u32 id]`.
   - `settleWireOut(params)` and `cancelWireOut(params)` call `relay({ ...rest, mode: "execute", target: minterId, fn: "settle_wire_out" | "cancel_wire_out", args })`, the same param shape as `assignWireIn`.
   - Reuse `hexToBytes32ScVal` from `./minter`. Do not re-implement `readPlusdAuthorization`, `readWireInRefHashSeen`, `readMinterPlusdId` or `wireInReturnRefHash`; they come from `wireInEscrow.ts`.
   - Export everything from `packages/wallet-connect/src/index.ts` as a new export block placed directly after the `./stellar/contracts/wireInEscrow` block.

2. **Trustee data hooks.** New file `packages/trustee/src/api/useWireOuts.ts` (spec header to the trustee-flows section). Mirror `useEscrowedWires.ts`:
   - `WireOutFn = "settle_wire_out" | "cancel_wire_out"`.
   - `wireOutRecordKey(minterId, id)` = `["minter-wire-out", minterId, id]`.
   - `fetchWireOutRecord(id)`.
   - `useWireOutRecords(ids, enabled)`: `useQueries`, `staleTime: 0`, `retry: false`.
   - `useWireOutAccess(fn, enabled)`: `readCanCall` against `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` / `ENV.STELLAR_YIELD_MINTER_ID`, key `["wire-out-access", address, fn]`, `staleTime: 30_000`.
   - `useSettleWireOut()` and `useCancelWireOut()`: copy the shape of `useWireEscrowMutation`, with the stage state, the not-configured / not-connected preflight, and `onSuccess` invalidating `["cash-book"]` and `wireOutRecordKey`.
   - Reuse `useMinterPlusdId` / `ensureMinterPlusdId` from `@/api/useEscrowedWires`.

3. **Presenters and copy.** New file `packages/trustee/src/lib/wireOut.ts`, the counterpart of `lib/wireEscrow.ts`:
   - `wireOutAccessReason(fn, { access, isPending, isError })`. Reasons:
     - "Checking this wallet's Trustee role…"
     - "Could not verify this wallet's Trustee role."
     - delay > 0: "This wallet holds the Trustee role with a {h} h delay; the app does not schedule wire-out settlements."
     - otherwise: "Only the Trustee role can settle bank wire-outs." or "Only the Trustee role can cancel bank wire-outs."
   - `wireOutRowState(servedStatus, chainRead)`. States: `reading | read-error | confirmed` (chain Pending) `| settled-pending-index | cancelled-pending-index` (served Pending, chain Settled or Cancelled) `| mismatch`. Add the `wireOutStateLabel` and `wireOutStateReason` pair, with copy parallel to #1763 ("Pending (confirmed on-chain)", "Settled on-chain — waiting for the indexer", …).
   - `rawToDecimal7(raw: string): string`: exact string formatting of a raw 7-dp i128, trailing zeros trimmed. It is display and pre-fill only, not a metric.
   - `settleFormError({ amountInput, amountRaw, valueDateInput, today, reference })`. The first failing check wins:
     - empty amount, or an amount that `parseUsdDollarsToI128` rejects → "Enter the amount wired.";
     - `parseUsdDollarsToI128(amountInput) !== BigInt(amountRaw)` → "The minter settles only the full requested amount ({rawToDecimal7(amountRaw)} PLUSD). If a different amount was wired, cancel this request instead.";
     - empty value date → "Enter the value date.";
     - a date after today (UTC) → "The value date cannot be in the future.";
     - empty trimmed reference → "Enter the outgoing wire's bank reference.";
     - a reference longer than 140 characters → "The reference can be at most 140 characters."
   - `valueDateSeconds(dateInput)`: `Date.parse(`${d}T00:00:00Z`) / 1000`. It stays local to avoid a third conflicting edit of `utils/formatDate.ts`, which #1761 and #1762 both append to; log it in the TD entry. Use `todayUtcDateInput()` locally too.
   - `wireOutErrorCopy(fn, err)`. Same structure as `wireEscrowErrorCopy`: keep the wallet-rejection copy and specific messages; otherwise map `parseSorobanContractErrorCode`:
     - `#7` / `RefHashSeen` (settle) → "This bank reference is already recorded on-chain. Use the outgoing wire's own reference."
     - `#17` → "The minter settles only the full requested amount."
     - `#8` → "The minter's bank cash is below this amount. Book the incoming wires first."
     - `#16` (cancel) → "This lender's address is not authorised to hold PLUSD, so the PLUSD cannot be returned."
     - `#14` → "This wire-out is no longer pending. Refresh the list."
     - `#10` → "The minter has no wire-out with this id."

     Every mapped error keeps `details` as the raw error text. That is the verbatim contract error, shown through `InlineError` "View details".
   - Reuse `cashBookError` from `@/lib/wireEscrow`.

4. **Section hook.** New file `packages/trustee/src/routes/-wire-outs.ts`, `useWireOutsSection()`, modelled on `useEscrowedWiresSection`:
   - Chain: `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`; `chainKindOf` decides `unsupported` for EVM and no fetch; `targetChainLabel` for the chip.
   - `useCashBook(chainId, { enabled: stellar, refetchMs })`: 30 s, or 5 s while a row is pending-index, bounded to 120 s per id. Export constants mirroring `ESCROW_*`.
   - Rows: every served `wire_outs[]` entry in served order (newest id first). Only `Pending` ids get `useWireOutRecords` confirmations.
   - Row fields:
     - `lenderName = lp_legal_name ?? "—"`;
     - `lpId`, which links to `/lp-counterparties/$id` when present;
     - `lp` (full address plus a truncated form);
     - `amount` as served (`formatUsdExact`-style grouping with a " PLUSD" suffix, no rescaling);
     - `requestedAt` via `formatIsoDateTimeUtc`;
     - `status` as served;
     - for Settled rows, served `settled_at`, `value_date` and `ref_hash` (first 8 / last 8, full value in `title`); for Cancelled rows, `cancelled_at`;
     - the on-chain state.
   - Row action gating. Settle and Cancel appear only on `Pending` rows, disabled with a visible reason; the first match wins:
     1. wallet not connected;
     2. minter or executor not configured;
     3. minter mismatch (`cashBook.data.minter !== ENV.STELLAR_YIELD_MINTER_ID`);
     4. role (`wireOutAccessReason`, per fn);
     5. on-chain state not `confirmed`;
     6. another action in flight.
   - **Settle flow.**
     - Open: dialog state `{ row, record, amountInput (pre-filled with rawToDecimal7(record.amount)), valueDateInput (today UTC), reference, refHash, error, submitting }`.
     - Show the computed `refHash` read-only as the reference is typed (`wireInReturnRefHash`).
     - Confirm checks `settleFormError`, then `readWireInRefHashSeen` (true shows the reused-reference copy and stops), then re-reads `wire_out(id)` (not Pending stops with the "no longer pending" copy). It then calls `useSettleWireOut().mutateAsync({ id, amountRaw: record.amount, valueDate, refHash })`.
     - After success: re-read `wire_out(id)`, set `lastResult`, and add the id to the pending-index set.
   - **Cancel flow.**
     - Open: the dialog runs `ensureMinterPlusdId`, then `readPlusdAuthorization({ plusdId, address: row.lp })`, with phase `reading | authorized | not-authorized | no-trustline | read-error`. Confirm is enabled only when the phase is `authorized`.
     - Not authorized: "This lender's address is not authorised to hold PLUSD, so the PLUSD cannot be returned. Cancel is blocked until it is authorised again."
     - No trustline: "This lender's address has no PLUSD trustline."
     - Read error: "Could not check the lender's PLUSD authorisation." with details.
     - Confirm re-reads `wire_out(id)` and the authorisation, then calls `useCancelWireOut().mutateAsync({ id })`. If the contract still fails, `wireOutErrorCopy` shows the mapped message plus the verbatim contract error.
   - **Result messages,** built from the post-transaction `wire_out(id)` read:
     - "Wire-out #{id} settled on-chain. Status {status}; the escrowed PLUSD was burned. Transaction {hash}. It updates in this list once indexed."
     - "Wire-out #{id} cancelled on-chain. Status {status}; the PLUSD was returned to {lp}. Transaction {hash}. …"
     - The `unverified` variant when the re-read fails.
   - States: `unsupported | loading | error | empty ("No bank wire-outs on {chain}.") | ready`.

5. **View.** New file `packages/trustee/src/routes/-WireOutsSection.tsx`, which is JSX only (FRONTEND.md rule 2):
   - Card header "Bank wire-outs", a chain chip (`cash-management-wireouts-chain`), and the sub-line "Lender bank withdrawals held in escrow by the minter on {chain} — settle once the wire is sent, or cancel to return the PLUSD."
   - Table columns: ID, Lender (name link plus `AddressChip` / truncated address), Amount, Requested at, Status (`StatusChip`), On-chain, Actions. Row test ids follow the `wireout-row-{id}-…` pattern of #1763.
   - `SettleWireOutDialog` (`useLpReviewDialog` shell, `role="dialog"`, `aria-modal`; Escape and backdrop cancel, both blocked while pending). It shows a summary (wire id, lender, address, requested amount, requested at). **"Destination bank account: —"** comes with the hint "The API does not serve the lender's bank account yet." The form has "Amount wired (PLUSD)", "Value date" (`type="date"`, `max` = today), "Outgoing bank reference", and the read-only "Reference hash". The confirm label follows the stage ("Awaiting signature…" / "Submitting…" / "Confirming…"), and `InlineError` shows "View details".
   - `CancelWireOutDialog`: the same shell, a summary, the authorisation result, and the copy "The escrowed PLUSD returns to the lender's address."
   - The green result notice.

6. **Tab.** `packages/trustee/src/routes/cash-management.tsx`:
   - add `"wireouts"` to `TabKey` with the label "Bank wire-outs", after "Escrowed wires";
   - add the branch `activeTab === "wireouts" ? <WireOutsSection /> : …`;
   - add one line to the existing header spec list (`docs/frontend/trustee-flows.md#cash-management--bank-wire-outs`).

   Keep the edits additive next to #1763's lines.

7. **Tech debt.** Add one entry to `docs/exec-plans/tech-debt-tracker.md`, using the next free number on the base branch and bumping the "Next free number" line. It records:
   - `readWireOutRecord` duplicates the epic branch's `readMinterWireOut`;
   - `valueDateSeconds` / `todayUtcDateInput` duplicate #1761's `dateInputToUnixUtc` and #1762's `dateInputToValueDate`;
   - `wireInReturnRefHash` / `readWireInRefHashSeen` are generic helpers with wire-in names that #1762's `bankReferenceRefHash` / `readRefHashSeen` duplicate.

   Suggested fix: one `minterRefs.ts` and one date helper after #1761, #1762, #1763 and the epic land.

8. **Docs.** See Docs to Update.

## Test Strategy

Every test file starts with a single `// spec:` header line and has no other comments (`lint-comments`).

- **`packages/wallet-connect/src/stellar/contracts/wireOutSettlement.test.ts`:**
  - Encoders: settle args have the ScVal types u32 / i128 / u64 / bytes(32), and the i128 equals `BigInt(amountRaw)` exactly with 7-dp precision, for example `"10000001"`. They reject a zero hash, an id below 1, a non-integer or non-positive `valueDate`, and a non-integer `amountRaw`. Cancel args are `[u32]`.
  - `readWireOutRecord`: decodes all three status forms (`["Pending"]`, `"Settled"`), turns bytes into hex, and throws on an unknown status or missing fields. Mock `simulateRead`.
  - `settleWireOut` / `cancelWireOut` call `relay` with `mode: "execute"`, the right `fn` and `target`. Mock `./accessManager`.
- **`packages/trustee/src/lib/-wireOut.test.ts`:**
  - `wireOutAccessReason`: every branch.
  - `wireOutRowState` and its labels.
  - `rawToDecimal7`: `"10000000"` gives `"1"`, `"12345678"` gives `"1.2345678"`, `"5"` gives `"0.0000005"`.
  - `settleFormError`: each message, plus an amount equal at 7 dp but typed with trailing zeros, which passes.
  - `valueDateSeconds`.
  - `wireOutErrorCopy`: each code, wallet rejection unchanged, `details` kept verbatim.
- **`packages/trustee/src/api/-useWireOuts.test.tsx`:** the access query key and args, the mutation preflight errors (not configured, not connected), the `relay` args, and the invalidations on success.
- **`packages/trustee/src/routes/-wire-outs.test.ts`:** the hook with mocked `apiFetch` and wallet-connect:
  - EVM session: `unsupported`, no `/v1/cash-book` call.
  - `404 minter_not_configured`, `403` and `401` copy.
  - Empty list.
  - Rows map served fields verbatim, `lp_legal_name` absent shows "—", and only Pending ids are read on-chain.
  - Minter mismatch disables the actions.
  - Settle:
    - an amount mismatch blocks before signing;
    - a seen reference blocks;
    - a re-read showing not-Pending blocks;
    - success passes the on-chain raw amount (not the served 6-dp one) and the sha256 of the trimmed reference.
  - Cancel: not-authorized and no-trustline block; a contract `#16` after a passing pre-check shows the mapped message with the verbatim details.
  - The pending-index polling window.
- **`packages/trustee/src/routes/-WireOutsSection.test.tsx`:**
  - the table renders;
  - the reasons are visible;
  - the settle dialog shows "Destination bank account" "—" and the hint;
  - Escape is blocked while pending;
  - the stage labels;
  - the result notice.
- **`packages/trustee/src/routes/-cash-management-page.test.tsx`:** the fifth tab exists and switches to the section.
- **Gates:**
  - `yarn workspace @pipeline/wallet-connect test`
  - `yarn workspace @pipeline/trustee test`
  - `yarn workspace @pipeline/trustee build` (tsc)
  - `npx tsx scripts/lint-docs.ts`
  - `npx tsx scripts/lint-comments.ts`
- **Live check by the user** (do not drive their browser). Follow the user-stories doc against staging. The probes in `/private/tmp/claude-501/-Users-luiza-Projects-pipeline/1ace6ff8-7957-4b39-a440-9054a51a5a0a/scratchpad/wireout.cjs` can be re-run, simulation only and never submitted, to confirm the surface and to look for a first testnet wire-out.

## Docs to Update

- **`docs/product-specs/withdrawals.md`.** Append `## Bank wire withdrawals (Trustee console)` at the end of the file (anchor `#bank-wire-withdrawals-trustee-console`), 25 lines or fewer. Cover:
  - the source docs;
  - the list from `GET /v1/cash-book` `wire_outs` (link `minter-cash-book.md`) with the `wire_out(id)` confirmation;
  - settle `settle_wire_out(id, amount, value_date, ref_hash)`: the full requested amount only (`#17`), `ref_hash = sha256(trimmed reference)`, single-use (`ref_hash_seen`, `#7`), burns the escrowed PLUSD and takes the cash out of `bank_cash` (`#8`);
  - cancel `cancel_wire_out(id)`: returns the PLUSD and needs `PLUSD.authorized(lp)` (`#16`);
  - both are `TRUSTEE` through `AccessManager.execute` with `immediate` only;
  - EVM is read-only;
  - the destination bank account is not served until #1812.

  Keep the file at 200 lines or fewer, including after the epic merge (about 175).
- **`docs/frontend/trustee-flows.md`.** Add `## Cash Management — Bank wire-outs` directly after "Cash Management — Escrowed wires". Same sub-structure as #1763: Sources, Chain scope, Data sourcing, Table, Row states and gating, Settle dialog, Cancel dialog, Shell, errors and result, Testnet caveat (no wire-out on testnet, `bank_cash = 0` on `CD2LPGLX…`, minter mismatch).
- **`docs/user-stories/epic-1795/1764-trustee-wire-outs.md`.** Status Initial. Real API on staging, no mocks, Network tab open. Prerequisites and risks as above. Stories:
  1. List on Stellar (the 200 response or `404` copy, the fields, the on-chain label).
  2. EVM reason with no request.
  3. A no-role wallet sees the reasons.
  4. Settle: an amount mismatch blocks.
  5. Settle: a reused reference blocks.
  6. Settle succeeds: the row goes to pending-index, then Settled with the served `settled_at`, `value_date` and `ref_hash`; Network shows the refetch.
  7. Cancel blocked for an unauthorised lender.
  8. Cancel succeeds and the PLUSD returns.
  9. Destination bank account shows "—".
- **`docs/user-stories/index.md`.** Add a row for #1764 under epic #1795.
- **`docs/exec-plans/tech-debt-tracker.md`.** One entry (step 7).
