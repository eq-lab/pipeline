# Issue #1893: Trustee + wallet-connect: update_mutable sends 5 args to the 3-arg contract — Update lifecycle (WatchList) always fails on Stellar

Source: https://github.com/eq-lab/pipeline/issues/1893

Branch `fix/1893-update-mutable-three-args` (from `main` at `112eb1f2`), draft PR #1894. Parent epic #1776. Split out of #1805.

## Scope

Stellar only. Make **Update lifecycle** on `/loans/$id` call the deployed LoanRegistry's `update_mutable` with the right arguments, and stop it from wiping the stored `metadata_uri`.

### Verified contract facts (2026-11-11, not guessed)

- **Source.** `eq-lab/pipeline-stellar-contracts` `contracts/loan-registry/src/lib.rs:135`. The function body is byte-identical at `e9881ac` (the deployment #42 commit) and at the current `main` `a2295fd`:
  ```rust
  #[only_owner] #[when_not_paused]
  pub fn update_mutable(e: &Env, loan_id: u32, status: LoanStatus, metadata_uri: String)
  // Closed -> AlreadyClosed (#2)
  // Approved | Default -> status must equal current (metadata-only), else WrongCurrentStatus (#3)
  // otherwise (Performing | WatchList) -> status ∈ {Performing, WatchList}, else WrongCurrentStatus (#3)
  // always: mutable.metadata_uri = metadata_uri; emits StatusUpdated only when status changed
  ```
  There is no CCR and no location argument. `LoanStatus` = `Approved | Performing | WatchList | Default | Closed`.
- **Deployed wasm spec.** Read from `getContractWasmByContractId(CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ)` (`VITE_STELLAR_LOAN_REGISTRY_ID` in `.env.example`). `update_mutable` inputs are `loan_id: u32`, `status: LoanStatus (udt)`, `metadata_uri: String`. The LoanStatus cases match the source.
- **Simulation through the executor.** Called `execute(CDWN5…, "update_mutable", args, GAZFDDYK…)` on the AccessManager `CDP7TUNB…` (`VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`) with the trustee wallet as caller:
  - 3-arg `[u32, Vec[Symbol(WatchList)], String]`: the AccessManager lets the call through and the registry traps with `Error(Contract, #1)` = `NonExistentLoanId`. The layout is accepted.
  - The current 5-arg layout fails with `Error(WasmVm, UnexpectedSize)` / `Func(MismatchingParameterLen)`. This is the bug.
- **The testnet registry has no loans yet.** `next_loan_id()` returns `0` on `CDWN5…`, so no loan exists after the #42 redeploy. The acceptance check needs a loan drawn and disbursed first (see Assumptions and Risks).

### In scope

1. **wallet-connect encoder and client** (`packages/wallet-connect/src/stellar/contracts/loanRegistry.ts`):
   - Encode `[scvU32(loan_id), scvVec([scvSymbol(status)]), scvString(metadata_uri)]`.
   - Drop `ccrPercent` and `location` from `encodeUpdateMutableArgs`, `UpdateMutableParams`, `BuildUpdateMutableEnvelopeParams`, `buildUpdateMutableEnvelope` and `updateMutable`.
2. **On-chain read of the current mutable state.** `GET /v1/loan-book` does not serve `metadata_uri`. `loan_book.rs:396` serves only the submission's `draw_loan` URI, which `update_mutable` can since have replaced. So the dialog reads `mutable_loan_data(loan_id)`, and the on-chain `status` and `metadata_uri` come from that one read.
   - Add `metadataUri` to the existing `readLoanChainState` (`riskCouncil.ts`), which already reads `mutable_loan_data`.
   - Pass the value through verbatim: `String(data.metadata_uri)`, with no trimming or other changes.
3. **Trustee hook** (`packages/trustee/src/api/useUpdateLifecycle.ts`):
   - The input becomes `{ loanId, status, metadataUri }`.
   - Add a read query `useLoanMutableState(chainId, loanId)` beside it, which calls `readLoanChainState`. On success the mutation also invalidates `["loan-mutable", …]` and `["risk-council-loan"]`.
4. **Trustee dialog** (`packages/trustee/src/routes/loans.$id.tsx`, `UpdateLifecycleDialog`):
   - Remove the CCR, location type, location identifier and tracking URL inputs.
   - Remove the "CCR is written only at 130 / 120 / 110% threshold crossings" sentence.
   - **Status options** come from the on-chain current status, following the contract rule:
     - `Performing` / `WatchList` → `[Performing (Active), WatchList (Watchlist)]`
     - `Approved` → `[Approved]` (metadata-only)
     - `Default` → `[Default]` (metadata-only)
     - `Closed` or unknown → none; submit stays disabled and the dialog shows a one-line reason.
   - **Status preselect** is the on-chain current status from the same read.
   - **Metadata URI** is prefilled with the on-chain `metadata_uri`. The label changes from "Append metadataURI" to "Metadata URI", because the contract replaces the value and does not append to it. The value is sent exactly as it appears in the field.
   - **Submit is disabled** in any of these cases:
     - the read is loading or failed (the read error is shown in the dialog);
     - the metadata field is blank while the on-chain value is non-blank, so the stored URI is never wiped by default;
     - nothing changed (`status === current && metadataUri === current`), which avoids a no-op transaction.
5. **Docs, tests and the user-stories doc** listed below.

### Out of scope

- The EVM `updateMutable` path. The trustee has no EVM executor path; the TD-152 gate stays as it is.
- Re-introducing CCR or location on-chain.
- Backend changes, such as serving `metadata_uri` on the loan-book. This is logged as tech debt instead.
- Human copy for registry error codes `#2` / `#3` in `SOROBAN_ERROR_COPY`. The generic "could not verify" copy still applies, and the dialog no longer offers transitions that would hit those codes.
- Figma restyling.

## Assumptions and Risks

- **Acceptance needs a live loan.** The registry has 0 loans (`next_loan_id = 0`, checked 2026-11-11), so "a Performing loan moves to WatchList and back on pipeline-test" cannot run until a loan is drawn and disbursed on `CDWN5…`. The disbursement moves it from Approved to Performing.
  - The coder still verifies the encoding by simulation: a 3-arg simulate must reach the registry, which means `#1` rather than `UnexpectedSize` while no loan exists.
  - The live round-trip is a stated manual step in the user-stories doc. The PR stays draft until it runs, or the manager parks it for a human to draw a loan.
- **Two status sources.** The dialog uses the on-chain `mutable_loan_data.status`; the rest of the page keeps the served `onchain_status`. The #1621 rule ("raw on-chain status, never the display chip") still holds, and this value is more direct. Indexer lag can make the two differ briefly. The contract enforces the on-chain value, so gating on it is correct.
- **`readLoanChainState` lives in `riskCouncil.ts`.** Adding `metadataUri` is additive, but the riskCouncil tests that use `toEqual` on the whole object must include the new field.
- **Test fixtures.** `-loans.$id.test.tsx` mocks `useLoanDetail`. The new `useLoanMutableState` must be mocked there too, or every dialog test will try a real RPC call.
- **`LocationInput` stays exported.** `draw_loan` still uses it; only `update_mutable`'s use of it goes away.
- **Tech-debt number.** The tracker header says **Next free number: TD-183**, because TD-182 is already taken by #1882. The manager brief said TD-182; use TD-183 and bump the header to TD-184.

## Open Questions

_None_

## Implementation Steps

1. **Encoder** (`packages/wallet-connect/src/stellar/contracts/loanRegistry.ts`, about lines 676–880):
   - Make the function `encodeUpdateMutableArgs(loanId: number, status: string, metadataUri: string): xdr.ScVal[]` and have it return `[scvU32(loanId), scvVec([scvSymbol(status)]), scvString(metadataUri)]`.
   - Remove `ccrPercent` and `location` from `UpdateMutableParams`, `BuildUpdateMutableEnvelopeParams`, `buildUpdateMutableEnvelope` and `updateMutable`, and from their destructuring and forwarding.
   - Replace the stale doc blocks: the "⚠️ inferred" note, the 5-arg signature and the ccr/location encodings. Use a single-line pointer at most (the comment-minimal rule); the file's existing header stays.
2. **Reader** (`packages/wallet-connect/src/stellar/contracts/riskCouncil.ts`): add `metadataUri: string` to `LoanChainState`, set to `String(data?.metadata_uri ?? "")`. It is a `String` field in `MutableLoanData`, so `rawField` also works. `packages/wallet-connect/src/index.ts` already exports the type, so check that nothing else needs exporting.
3. **Hook** (`packages/trustee/src/api/useUpdateLifecycle.ts`):
   - `UseUpdateLifecycleInput` becomes `{ loanId: number; status: string; metadataUri: string }`. Forward only those to `updateMutable`, and drop the `LocationInput` re-export if nothing else uses it.
   - Add `export function useLoanMutableState(chainId: number | null | undefined, loanId: number | null, enabled: boolean)`:
     - `useQuery` with key `["loan-mutable", chainId, loanId]`;
     - enabled only when `stellarOnlyActionReason(chainId) === null`, the loan id is an integer, the env ids are set and `enabled` is true;
     - `staleTime: 0`, `retry: false`;
     - calls `readLoanChainState({ registryId: ENV.STELLAR_LOAN_REGISTRY_ID, loanId, rpcUrl, networkPassphrase })` and returns `{ status, metadataUri }`.
   - In `onSuccess`, add invalidation of `["loan-mutable"]` and `["risk-council-loan"]`.
   - Keep the file header as one 2–3-line `// spec:` pointer.
4. **Dialog** (`packages/trustee/src/routes/loans.$id.tsx`):
   - In `LoanDetail`, call `useLoanMutableState(chain, Number(id), updateOpen)` and pass `chainState` (data, loading, error) to `UpdateLifecycleDialog` in place of `currentStatus={detail.lifecycleStatus}`.
   - In `UpdateLifecycleDialog`:
     - remove the `ccr`, `locationType`, `locationId` and `trackingUrl` state and inputs;
     - the `onConfirm` type becomes `{ status: string; metadataUri: string }`;
     - when `open` and the data arrive, seed `status` and `metadataUri` from the chain state;
     - build the status options with a small pure helper `allowedLifecycleTargets(current: string): string[]` in `routes/-useLoanDetail.ts` beside `lifecycleStatusOf`. Option labels stay "Active" / "Watchlist"; Approved and Default use the raw tag;
     - show a loading line while the read is pending;
     - show `InlineError` from `toUserError(readError, "Could not read the loan's on-chain state.")` when the read fails;
     - when there are no allowed targets (Closed), show the line "This loan's on-chain status does not allow a lifecycle update.";
     - `valid = !loading && !readError && targets.includes(status) && !(metadataUri.trim() === "" && current.metadataUri.trim() !== "") && (status !== current.status || metadataUri !== current.metadataUri)`;
     - remove the CCR sentence from the subtitle, and change the metadata label to "Metadata URI (replaces the stored value)". The placeholder stays `ipfs://…`.
   - Remove `lifecycleStatus` from `UseLoanDetailResult` and `lifecycleStatusOf` if they become unused. If anything else uses them, keep them; grep before removing.
5. **Error copy**: no change to `utils/userError.ts`. Keep the `-userError.test.ts` `updateMutable simulation error` case.
6. **Tech debt**: append **TD-183** to `docs/exec-plans/tech-debt-tracker.md` and bump the header to TD-184.
   - Text: "Update lifecycle reads `mutable_loan_data` on-chain because `GET /v1/loan-book` does not serve the loan's current `metadata_uri` (and serves `onchain_status` from the indexer)."
   - Fix: "serve `metadata_uri` on `LoanBookEntry`, then drop the read."
7. **Docs** (see Docs to Update), then the user-stories doc.
8. **Gates**:
   - `yarn workspace @pipeline/wallet-connect lint && test && build` and the same for `@pipeline/trustee` (use each package's script names);
   - `npx tsx scripts/lint-docs.ts`;
   - `npx tsx scripts/lint-comments.ts`, shrinking `scripts/lint-comments.baseline.json` for any touched file it lists.
9. **Live encoding check** (no signature). Run a node one-off from the scratchpad, not committed, that simulates `execute(CDWN5…, "update_mutable", encodeUpdateMutableArgs(0, "WatchList", "ipfs://x"), <trustee G…>)` on testnet.
   - While no loan exists, it must fail with `Error(Contract, #1)`, not `UnexpectedSize`.
   - Once a loan exists, it must succeed on simulation for Performing → WatchList.
   - Record the result in the PR body.

## Test Strategy

- **`packages/wallet-connect/src/stellar/contracts/loanRegistry.test.ts`** (`encodeUpdateMutableArgs` around line 607, envelope around line 674):
  - assert exactly 3 args: `u32` / `vec[symbol]` / `string`, in that order;
  - assert that a `""` metadata URI encodes as an empty string (encoder-level; the UI prevents it);
  - assert the envelope calls `execute(target, symbol("update_mutable"), vec(3 args), caller)`;
  - delete the ccr and location assertions.
- **`riskCouncil.test.ts`**: `readLoanChainState` also returns `metadataUri` verbatim, including a value with surrounding spaces, unchanged.
- **`packages/trustee/src/api/-useUpdateLifecycle.test.tsx`**:
  - the mutation forwards exactly `{ loanId, status, metadataUri }`, with no `ccrPercent` or `location` keys;
  - the existing guards still reject before the call;
  - `useLoanMutableState` is disabled for a non-Stellar chain and when `enabled` is false, and maps `readLoanChainState` to `{ status, metadataUri }`.
- **`packages/trustee/src/routes/-loans.$id.test.tsx`** (replace the cases around lines 831–960; mock `useLoanMutableState`):
  - The dialog has no `update-lifecycle-ccr`, `-location`, `-location-type` or `-tracking` elements.
  - On-chain Performing with `metadataUri: "ipfs://cur"`: status is preselected to Performing, metadata is prefilled `ipfs://cur`, and submit is disabled because nothing changed. Switching to WatchList enables submit, and the call is `mutateAsync({ loanId: 4488, status: "WatchList", metadataUri: "ipfs://cur" })`.
  - On-chain WatchList: the options are exactly Performing and WatchList; preselect is WatchList, which replaces the #1621 matured/past-due cases with the on-chain source.
  - On-chain Approved: the only option is Approved. Submit is disabled until metadata changes, then sends `{ status: "Approved", metadataUri: "ipfs://new" }`.
  - On-chain Default: the only option is Default (metadata-only).
  - On-chain Closed: no options, the reason line shows and submit is disabled.
  - Clearing a non-empty prefilled URI disables submit.
  - Read loading: submit is disabled. Read error: the error shows and submit is disabled.
  - Keep the #1037 mutation-error case.
- **`allowedLifecycleTargets`** unit tests in the existing `-useLoanDetail` test file: one case per `LoanStatus` plus an unknown string.
- **Manual / live**: step 9's simulation, plus the user-stories doc run on pipeline-test once a loan exists.

## Docs to Update

All in-place edits; no product spec may grow past 200 lines.

- **`docs/frontend/trustee-flows.md`** around line 879, the **Update lifecycle** bullet and the **Status default (#1621)** sub-bullet. Rewrite them to say:
  - the dialog collects status and metadata URI only;
  - the Stellar call is `update_mutable(loan_id: u32, status: LoanStatus, metadata_uri: String)`;
  - status options follow the contract rule (Performing ↔ WatchList; same-status metadata-only on Approved / Default; none on Closed);
  - status and metadata URI come from one on-chain `mutable_loan_data` read (TD-183);
  - the URI is prefilled and replaced, never appended, and a blank field never overwrites a non-blank stored URI;
  - submit is disabled on a no-op.

  New explanatory text goes here, since this file has no line cap.
- **`docs/product-specs/trustee-dashboard.md:54`** (Flow 3 row, file at 199 lines; edit the cell text only, no new lines):
  - inputs become "Current on-chain status, current `metadata_uri`";
  - parameters become "Target status (Performing ↔ WatchList, or same status on Approved / Default), replacement `metadata_uri`";
  - the call becomes `update_mutable(loan_id, status, metadata_uri)` (Stellar);
  - drop CCR, location and the location/ccr events. Only `StatusUpdated` is emitted, on a status change.
- **`docs/product-specs/smart-contracts-registry.md:12`**: replace the `updateMutable` row's signature and description with the Stellar signature and the transition rule above. Note that `metadata_uri` is overwritten on every call, and that it reverts `AlreadyClosed` on Closed and `WrongCurrentStatus` otherwise. The issue body says `docs/references/smart-contracts-registry.md`, but that file does not exist; the registry table lives in `docs/product-specs/`.
- **`docs/product-specs/loans.md:125–127`** (197 lines): replace the 3-line `updateMutable()` paragraph with an equal-length one stating the actual rule (`{Performing, WatchList}` toggle; same-status metadata-only on Approved / Default; reverts on Closed).
- **`docs/product-specs/loans-data.md:21–29`** (195 lines): update the `updateMutable` interface stub to `(loanId, status, metadataURI)`, add a trailing `// Stellar: update_mutable(loan_id: u32, status: LoanStatus, metadata_uri: String)` comment, and refresh the comment above it to the transition rule. Net lines must be ≤ 0; the stub loses 2 parameter lines.
- **`docs/product-specs/user-stories.md:244–245`**: rewrite both bullets in place. Drop "ccrBps with timestamp, currentLocation"; state Performing ↔ WatchList plus the metadata-only update. The Default revert stays.
- **`docs/product-specs/relayer-service.md:110`**: the sentence that "asks the Trustee to call `update_mutable` to update `ccr`" is now impossible on-chain. Change it in place to "asks the Trustee to review the loan (move it to WatchList via `update_mutable`)". Same line count.
- **`docs/exec-plans/tech-debt-tracker.md`**: add TD-183 and bump the header to TD-184 (step 6).
- **`docs/user-stories/epic-1776/1893-update-mutable-three-args.md`** (new), modelled on `1792-draw-loan-data-room-id.md`. Persona trustee; pipeline-test; Stellar trustee wallet with `TRUSTEE`. Stories:
  1. A Performing loan moves to WatchList: `metadata_uri` is unchanged on chain (`mutable_loan_data`) and the loan-book chip shows Watchlist after the refetch.
  2. A WatchList loan moves back to Performing.
  3. The dialog has no CCR or location fields, and the metadata URI is prefilled.
  4. Clearing the metadata URI blocks submit.
  5. A metadata-only update on the same status replaces the URI.
  6. An Approved (Disbursing) loan offers only Approved.
  7. The encoding check: a 3-arg simulate reaches the registry.

  State the precondition that a loan must be drawn and disbursed on registry `CDWN5…`, which had none as of 2026-11-11.
- No `docs/user-docs/**` change. `risks/default-management.md:25` ("The Trustee moves a loan between Performing and WatchList") already matches the contract.
