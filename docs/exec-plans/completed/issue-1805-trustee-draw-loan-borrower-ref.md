# Issue #1805: Trustee + wallet-connect: data_room_id field and the 2-arg draw_loan (borrower_ref)

Source: https://github.com/eq-lab/pipeline/issues/1805

Epic #1776. Frontend follow-up of #1792 (merged as PR #1807, deployed on pipeline-test).

## Scope

Approve on Stellar testnet fails today with `Error(WasmVm, UnexpectedSize)` /
`Func(MismatchingParameterLen)`. The console sends
`execute(loan_registry, "draw_loan", [to, metadata_uri, economics(no borrower_ref), initial_ccr, initial_location], caller)`.
The deployed contract is `draw_loan(metadata_uri: String, economics: ImmutableLoanData) -> u32`
(`pipeline-stellar-contracts` main @ e9881ac, `contracts/loan-registry/src/lib.rs:75`, `types.rs:42-52`).
`ImmutableLoanData` has 8 fields, starting with `borrower_ref: BytesN<32>`.

Today the trustee builds the args in the browser. `-useOriginationReview.ts` `approve()` passes
`submission.loan_data` (the raw submitted payload, human-unit amounts) to `useDrawLoan`. The
wallet-connect `encodeDrawLoanArgs` (`packages/wallet-connect/src/stellar/contracts/loanRegistry.ts:268`)
then scales the amounts with `parseUsdcToU128`, multiplies the rate by 100 and emits 5 args.

### In scope

1. **Source of truth: the API's `draw_loan` block.** Approve encodes `submission.draw_loan`
   (`GET /v1/loan-book/submissions`, `packages/api/src/routes/loan_book.rs` `draw_loan_args`)
   and no longer encodes `loan_data`. The block already holds 7-dp base-unit `u128` strings,
   `senior_interest_rate` as bps × 100, unix-second dates and the sha256 `borrower_ref` hex.
   The browser does no scaling and no hashing. This follows the issue rule ("Read
   `borrower_ref` from the API. Do not compute the hash in the browser") and the #1792 comment
   ("`encodeDrawLoanArgs` can be `[scvString(metadata_uri), scMap(economics)]` straight from the
   served block").
2. **wallet-connect** (`packages/wallet-connect/src/stellar/contracts/loanRegistry.ts`):
   - `encodeDrawLoanArgs` returns exactly 2 args: `[scvString(metadata_uri), economicsMap]`.
   - `encodeEconomicsMap` emits the 8 `ImmutableLoanData` keys, sorted. `borrower_ref` is
     first and is encoded as bytes (32 bytes decoded from the hex). Amounts pass through as
     `u128`, the rate as `u32` and the dates as `u64`, with no re-scaling.
   - Strict input validation throws a clear error **before any RPC call**.
   - The input type becomes the served block (see Implementation Steps).
3. **Trustee new-loan form** (`/origination/new`):
   - Add a required `data_room_id` field ("Data room ID"), trimmed.
   - Remove `to` and the whole Collateral section (`initial_ccr`, `initial_location.*`), with
     their validation. Stop sending them.
4. **Trustee origination detail and review** (`/origination/$id`):
   - Drop the Location row (`initial_location`) and the `initialLocation` preview line.
   - Show `borrower_ref`, shortened, in Deal Details and in the Approve dialog preview.
   - Gate Approve on `draw_loan` being present with an empty `missing_inputs`. Show a clear
     "Data room ID missing" reason.
   - Legacy `to` / `initial_ccr` / `initial_location` keys in `loan_data` are never read, so
     the page cannot crash on them, whether they are present or absent.
5. **Tests**: update the fixtures and add the new tests (see Test Strategy).
6. **Docs**: trustee-flows.md, the trustee-dashboard product spec, error-handling.md, a
   user-stories doc and the index row.

### Out of scope

- EVM `draw_loan` (#1573 / TD-151). EVM targets keep the existing "Stellar only" block.
- Making `data_room_id` required in the API (#1792 step 2).
- `encodeUpdateMutableArgs` / the Update-lifecycle dialog (see Open Questions 1). Recommended
  as a separate follow-up issue.
- The LP frontend's `packages/frontend/src/api/useLoanSubmissions.ts` type still declares
  `to` / `initial_ccr` / `initial_location`. It only declares them and never reads them, so it
  stays untouched.
- The preview keyword `LoanRegistry.mintLoan` (a Figma literal) stays as it is.
- A trustee-side resubmit UI. None exists today; legacy rows are fixed through Request changes
  or Reject.

## Assumptions and Risks

- **Dependency met.** #1792 is merged and deployed on pipeline-test. The API accepts
  `data_room_id` and serves `draw_loan` on `InReview` / `Approved` / `ChangesRequested` rows
  (`null` once drawn, on `Rejected`, for an EVM target, or for an unconfigured target chain).
  The deployed registry is the 2-arg contract (confirmed by today's failure). Nothing blocks.
- **The live list copy drives Approve.** `useOriginationReview` already reads `submission`
  from `useLoanSubmissions()` (the live list, not the router-state snapshot), so
  `submission.draw_loan` is the current served block. The router-state `SubmissionView` from
  older navigations may lack `draw_loan`. Treat `undefined` like `null` (blocked).
- **Amount format.** The API serves amounts as plain integer strings, which may exceed
  `Number.MAX_SAFE_INTEGER`. Convert with `BigInt(str)` only after `/^\d+$/` passes, and
  check the value is at most `2n ** 128n - 1n`. Never use `Number()`.
- **Bytes encoding without a global `Buffer`.** wallet-connect has no other `scvBytes` today.
  Decode the hex into a `Uint8Array` with a small local helper and encode it with
  `nativeToScVal(bytes, { type: "bytes" })`. The SDK copies the bytes into its own bundled
  `Buffer`, so the trustee browser bundle does not need a global `Buffer`. Verify this against
  the installed `@stellar/stellar-sdk` 15.1.0 (`nativeToScVal` handles a `Uint8Array` with type
  `bytes` by returning `xdr.ScVal.scvBytes`).
- **Export surface changes.** The issue says "Re-export from `index.ts` unchanged". The
  function exports (`drawLoan`, `buildDrawLoanEnvelope`, `encodeDrawLoanArgs`) stay. The
  input types change shape, so they are renamed to mirror the API (`DrawLoanArgs`,
  `DrawLoanEconomics`). `SubmitLoanRequest` and `EconomicsInput` are dropped from
  wallet-connect. `parseUsdcToU128` and `STELLAR_USDC_DECIMALS` have no consumer once the
  browser stops scaling (grep confirms only wallet-connect itself and a comment in
  `trustee/src/utils/stellarSacUnits.ts` mention them), so they are removed. `LocationInput`
  stays, because `encodeUpdateMutableArgs` / `useUpdateLifecycle` still use it.
- **Simulation is still the on-chain check.** The contract also panics on
  `InvalidTranches` / `InvalidMaturityDate` / `InvalidOfftakerPrice`. Those still surface
  through the existing "Could not verify the loan on-chain" simulate mapping. Do not
  duplicate those invariants client-side.
- **Related finding, not fixed here: `update_mutable` is broken the same way.**
  `encodeUpdateMutableArgs` (`loanRegistry.ts:746-760`) sends 5 args
  `[loan_id, metadata_uri, status, new_ccr, new_location]`. The contract is
  `update_mutable(loan_id: u32, status: LoanStatus, metadata_uri: String)`
  (`lib.rs:135`). The contract also **overwrites** `metadata_uri`, so the dialog's "blank
  sends `""`" behavior would wipe it. It only allows `Performing` ↔ `WatchList` toggles, or a
  same-status metadata-only update on `Approved` / `Default`. A fix touches the
  Update-lifecycle dialog UI on `/loans/$id` (dropping the CCR and location inputs and
  prefilling or requiring `metadata_uri`), `useUpdateLifecycle`, its tests, trustee-flows
  "Wired actions" and product-spec Flow 3 (`trustee-dashboard.md:54`,
  `smart-contracts-registry.md:12`). That is not a small addition, so a follow-up issue is
  recommended (Open Questions 1).
- **Minor related finding: loan id `0` is dropped.** `toLoanId` (`loanRegistry.ts:354`)
  rejects `0`, but the contract's `next_loan_id` starts at `0` (`storage.rs:36-41`). On a
  fresh registry the first drawn loan gets no "View loan" deep link. The mint itself is not
  affected. Log it in `known-bugs.md`, do not fix it inline (AGENTS.md rule).
- **Comment lint.** Several touched files carry long JSDoc blocks. Run
  `npx tsx scripts/lint-comments.ts`. Do not add new field or function JSDoc. Shrink
  `scripts/lint-comments.baseline.json` for every touched file it lists.

## Open Questions

1. **`update_mutable` (5-arg encoder vs the 3-arg contract `update_mutable(loan_id, status, metadata_uri)`):** include the fix in #1805, or open a follow-up issue? Recommendation: a follow-up issue, because it changes the Update-lifecycle dialog UI (drops the CCR and location inputs) and its semantics (`metadata_uri` is overwritten, not appended, so blank would wipe it). This plan assumes the follow-up and only logs the finding in `known-bugs.md`.
2. **Where `borrower_ref` shows on the review page (no Figma):** the plan replaces the Deal Details "Location" row with a "Borrower ref" row (`ab12cd…9f0e`, with the full hex in a `title` tooltip, or "Data room ID missing"). It also replaces the preview's `initialLocation:` line with `borrowerRef:`. Confirm this placement, and confirm that the raw `data_room_id` should **not** be shown as its own row.

**Resolved by the user (2026-11-11):**

1. `update_mutable` is **not** fixed here; it goes to a separate follow-up issue (filed alongside this plan). Only the `known-bugs.md` entry is added in this issue.
2. Borrower ref placement as planned: it replaces the Deal Details "Location" row (shortened hash, full hash in a tooltip) and the preview's `initialLocation` line; the raw `data_room_id` gets no row of its own.

## Implementation Steps

### A. wallet-connect: 2-arg `draw_loan` from the served block

1. `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts`:
   - Replace the `EconomicsInput` / `SubmitLoanRequest` types (`:85-122`) with a self-contained
     port of the API block (TD-42 duplication):
     `DrawLoanEconomics { borrower_ref: string; original_facility_size: string; original_senior_tranche: string; original_equity_tranche: string; original_offtaker_price: string; senior_interest_rate: number; origination_date: number; original_maturity_date: number }`
     and `DrawLoanArgs { metadata_uri: string; economics: DrawLoanEconomics }`. These are the
     non-null variant: the trustee narrows the API's nullable block before calling.
   - Delete `parseUsdcToU128` and `STELLAR_USDC_DECIMALS` (`:186-212`).
   - Add a module-local `hexToBytes32(hex): Uint8Array`. It accepts exactly 64 hex characters
     (`/^[0-9a-fA-F]{64}$/`; reject a `0x` prefix, because the API serves none) and otherwise
     throws `drawLoan: invalid draw_loan input economics.borrower_ref (expected 32 bytes as 64 hex characters)`.
   - Add module-local validators that throw `drawLoan: invalid draw_loan input <field>`:
     - `metadata_uri`: a non-empty string after trim.
     - the 4 amounts: `/^\d+$/` and `BigInt(v) <= 2n ** 128n - 1n`.
     - `senior_interest_rate`: an integer with `0 <= x <= 4_294_967_295`.
     - the dates: non-negative safe integers.

     Keep the wording free of `reject|cancel|declin|denied|dismiss|simulation error|not configured|not connected`,
     so `mapMintError` does not misclassify it.
   - `encodeEconomicsMap(economics: DrawLoanEconomics)` builds the `scMap` of 8 entries:
     `borrower_ref` → `nativeToScVal(hexToBytes32(..), { type: "bytes" })`, 4 × `u128(BigInt(v))`,
     `senior_interest_rate` → `xdr.ScVal.scvU32(v)` (no ×100), and 2 × `u64`. `scMap` sorts
     the keys, which puts `borrower_ref` first.
   - `encodeDrawLoanArgs(args: DrawLoanArgs): xdr.ScVal[]` validates `metadata_uri` and
     returns `[xdr.ScVal.scvString(args.metadata_uri), encodeEconomicsMap(args.economics)]`.
     `encodeLocationMap` stays (used by update_mutable).
   - `BuildDrawLoanEnvelopeParams` / `DrawLoanParams`: rename `loanData: SubmitLoanRequest`
     to `args: DrawLoanArgs`. In `buildDrawLoanEnvelope`, call `encodeDrawLoanArgs(args)`
     **right after the id guards and before `new SorobanRpc.Server` / `getAccount`**, so a
     bad input throws with no RPC traffic.
   - Rewrite the module doc's "Encoding" section (`:29-59`) for the 2-arg layout:
     `[0] string metadata_uri`, `[1] map ImmutableLoanData` (8 sorted keys, `borrower_ref`
     bytes, values taken verbatim from the API's `draw_loan` block, no browser-side scaling or
     hashing). Fix the "five positional `draw_loan` arguments" wording (`:12`). Update the
     stale testnet ids paragraph (`:61-65`): drop the literal ids and keep the
     "injected by the caller" sentence.
2. `packages/wallet-connect/src/index.ts` (`:89-111`):
   - Exports: `drawLoan`, `buildDrawLoanEnvelope`, `encodeDrawLoanArgs` (drop
     `parseUsdcToU128`, `STELLAR_USDC_DECIMALS`).
   - Types: `DrawLoanArgs`, `DrawLoanEconomics`, `LocationInput`, `DrawLoanParams`,
     `DrawLoanResult`, `DrawLoanStage`, `BuildDrawLoanEnvelopeParams` (drop
     `SubmitLoanRequest`, `EconomicsInput`).
   - Update the block comment (`:89-95`).
   - Before deleting, run `rg -n "parseUsdcToU128|STELLAR_USDC_DECIMALS|SubmitLoanRequest|EconomicsInput" packages --glob '!**/node_modules/**'`.
     Only trustee-local same-named types (`useLoanSubmissions.ts`, `useSubmitLoan.ts`) may
     remain, and they are not imports from wallet-connect.

### B. Trustee data layer

3. `packages/trustee/src/api/useLoanSubmissions.ts`:
   - Add local port types matching the API (`loan_book.rs:446-479`). `DrawLoanEconomics` has
     all 8 fields nullable (`string | null` / `number | null`). `DrawLoanArgs` is
     `{ metadata_uri: string | null; economics: DrawLoanEconomics; missing_inputs: string[] }`.
   - Add `draw_loan?: DrawLoanArgs | null` to `SubmissionView`.
   - `SubmitLoanRequest`: remove `to`, `initial_ccr`, `initial_location` and the local
     `LocationInput`. Nothing reads them any more; legacy rows still carry them in the
     loosely-typed JSON, which is harmless. Add `data_room_id?: string`.
   - Fix the stale economics comment: amounts are human-unit decimals (#1620), not base units.
4. `packages/trustee/src/api/useSubmitLoan.ts`:
   - `SubmitLoanInput`: remove `to`, `initial_ccr`, `initial_location` and `LocationInput`.
     Add `data_room_id: string`.
   - `SubmitLoanResponse`: add `draw_loan?: DrawLoanArgs | null`. Import the type from
     `useLoanSubmissions.ts`; no consumer is required.
5. New pure helper `packages/trustee/src/lib/drawLoanArgs.ts`:
   - `readyDrawLoanArgs(served: DrawLoanArgs | null | undefined): ReadyDrawLoanArgs | null`.
     It returns the non-null-typed args (structurally the wallet-connect `DrawLoanArgs`) only
     when `served` is present, `missing_inputs` is empty, and every economics field and
     `metadata_uri` is non-null. Otherwise it returns `null`.
   - `drawLoanBlockedReason(served): string | null` returns:
     - absent or null block: `"On-chain draw inputs are not available for this submission. Reject or request changes instead."`
     - `missing_inputs` includes `"data_room_id"`: `"Data room ID missing — this submission can't be drawn on-chain. Request changes so it is resubmitted with a data room ID, or reject it."`
     - other missing inputs: `` `On-chain draw inputs missing: ${missing_inputs.join(", ")}. Request changes so it is resubmitted through the current form, or reject it.` ``
     - `null` when `readyDrawLoanArgs` is non-null.
   - `formatBorrowerRef(served): string` returns:
     - `truncateAddress(hex)` (from `@/lib/truncateAddress`, 6…4) when `borrower_ref` is a
       64-char hex;
     - `"Data room ID missing"` when the block is present and `missing_inputs` has
       `data_room_id`;
     - `"—"` otherwise.
6. `packages/trustee/src/api/useDrawLoan.ts`:
   - `UseDrawLoanInput` becomes `{ args: DrawLoanArgs }` (the wallet-connect type).
   - Pass `args` to `drawLoan`. Drop the `SubmitLoanRequest` import.

### C. Approve flow and review page

7. `packages/trustee/src/routes/-useOriginationReview.ts`:
   - `approveBlockedReason`, in order:
     1. the existing non-Stellar reason (unchanged);
     2. `drawLoanBlockedReason(submission.draw_loan)` for a Stellar target.

     When `submission` is still loading (undefined), keep today's `null`. `approve()` already
     returns early on a missing submission.
   - `approve()`: compute `const args = readyDrawLoanArgs(submission.draw_loan)`. Return
     (no-op) when it is null, then call `drawLoanMutation.mutateAsync({ args })`. The
     idempotency and Approved no-op guards stay unchanged.
   - `mapMintError`: add a branch before the default for `/invalid draw_loan input/i`, returning
     `"This submission's on-chain inputs are incomplete. No signature was requested."`
     (`isSpecific: true`, raw text in `details`).
8. `packages/trustee/src/routes/-origination-detail.ts`:
   - Remove `formatLocation` and `DealDetailsDisplay.location`. Add `borrowerRef: string` and
     `borrowerRefFull: string | null` (the full hex for the tooltip), built with
     `formatBorrowerRef(submission.draw_loan)`.
   - `EMPTY_TRANSACTION_PREVIEW` and `mapTransactionPreview`: replace the `initialLocation`
     row with `{ label: "borrowerRef", value: formatBorrowerRef(submission.draw_loan) }`.
     Keep the rows `originator`, `economics` (still the human-unit `loan_data` summary,
     unchanged) and `metadataURI`.
   - The not-ready fallback's `dealDetails` follows the new shape (`borrowerRef: "—"`,
     `borrowerRefFull: null`).
   - No reads of `loan_data.to`, `loan_data.initial_ccr` or `loan_data.initial_location`
     remain anywhere under `packages/trustee/src` (non-test). Verify with
     `rg -n "initial_ccr|initial_location|loan_data\.to\b|loanData\.to\b" packages/trustee/src -g '!*test*'`.
9. `packages/trustee/src/routes/origination.$id.tsx` (`DealDetailsCard`, `:164`): replace
   `<TermRow label="Location" …>` with `<TermRow label="Borrower ref" value={dealDetails.borrowerRef} />`.
   - Add a `title` with `borrowerRefFull` when it is present. Extend `TermRow` with an
     optional `title` prop if it lacks one, rather than adding a new component.
   - Keep the existing `origination-detail-approve-blocked` line. It already renders
     `approveBlockedReason`, and Approve is already disabled whenever it is non-null.

### D. New-loan form

10. `packages/trustee/src/routes/-origination-new.ts`:
    - In `FORM_SECTIONS` "Loan & metadata":
      - remove the `to` field (`:44-48`);
      - add `{ path: "data_room_id", label: "Data room ID", required: true }` right after
        `borrower_id`.
    - Delete the whole "Collateral" section (`:116-148`). Keep "Collateral valuation".
    - `buildSubmitLoanInput`:
      - drop `to`, `initial_ccr` and `initial_location` from the built input;
      - add `data_room_id: get("data_room_id")` (`get` already trims; an empty value already
        fails "Required.").
    - JSON import needs no code change. Legacy keys are ignored because only `ALL_FIELDS` are
      read, and a payload without `data_room_id` lists it in the missing-fields warning.
11. `packages/trustee/src/routes/-ImportJsonDialog.tsx:78`: change the placeholder to
    `'{ "metadata_uri": "…", "data_room_id": "…", … }'`.
12. `packages/trustee/src/routes/origination.new.tsx`: no structural change expected, because
    it maps `FORM_SECTIONS`. Check that no copy mentions "Mint to" or the Collateral section.

### E. Docs and logs

13. Docs edits (see Docs to Update).
14. `docs/exec-plans/known-bugs.md`: add two entries, each with date 2026-11-11, location,
    symptom, root cause and workaround:
    - (a) the `update_mutable` arg mismatch (5 args vs 3), noting that the contract overwrites
      `metadata_uri`. Cross-link the follow-up issue once the manager or user opens it.
    - (b) loan id `0` dropped by `toLoanId`.
15. `docs/exec-plans/tech-debt-tracker.md`: append to TD-42 that the `draw_loan` block shape
    is now hand-mirrored in three places (API Rust, trustee `useLoanSubmissions.ts`,
    wallet-connect `DrawLoanArgs`).

### F. Verify

16. Run `yarn workspace @pipeline/wallet-connect lint`, `yarn workspace @pipeline/wallet-connect test`,
    `yarn workspace @pipeline/trustee lint`, `yarn workspace @pipeline/trustee test`,
    `yarn workspace @pipeline/trustee build`, `npx tsx scripts/lint-docs.ts` and
    `npx tsx scripts/lint-comments.ts`.
17. Optional pre-PR testnet check (strongly recommended, not committed): a throwaway `tsx`
    script that:
    - fetches one `InReview` Stellar submission with an empty `missing_inputs` from
      pipeline-test `GET /v1/loan-book/submissions`;
    - calls the real `buildDrawLoanEnvelope` with the trustee env ids (`STELLAR_LOAN_REGISTRY_EXECUTOR_ID`,
      `STELLAR_LOAN_REGISTRY_ID`, `STELLAR_RPC_URL`, passphrase) and a trustee-role `caller`;
    - confirms that the simulate succeeds.

    If no trustee-role address is available locally, skip this and rely on the post-deploy
    user story.

## Test Strategy

Frontend tests stay next to the code (the `-*.test.ts(x)` convention already used in these
packages). Pure unit and component tests only, with no network.

**wallet-connect `src/stellar/contracts/loanRegistry.test.ts`**
- Extend the SDK mock with bytes support (`nativeToScVal` already returns `{t: type, v}`,
  so `{t:"bytes", v: Uint8Array}` falls out). Add `scvBytes` to the `xdr.ScVal` mock only if
  the implementation uses it directly.
- Replace the `LOAN_DATA` fixture with a `DRAW_LOAN_ARGS` served-block fixture:
  `borrower_ref` = `sha256("DR-0001")` hex, amounts `"12000000000000"` / `"10000000000000"` /
  `"2000000000000"` / `"12500000000000"`, rate `100000`, and dates.
- Delete the `parseUsdcToU128` describe and the 5-arg / location-map draw tests. Keep
  location-map coverage by moving the sorted-key, enum-shape and passthrough assertions under
  `encodeUpdateMutableArgs`, since `encodeLocationMap` is now reached only there.
- New `encodeDrawLoanArgs` cases:
  - exactly 2 args: `[0]` is `{t:"string", v: metadata_uri}` and `[1]` is a map;
  - the economics map keys are exactly the 8 `ImmutableLoanData` names in sorted order, with
    `borrower_ref` first;
  - `borrower_ref` is `{t:"bytes"}` with a 32-byte `Uint8Array` that re-encodes to the same
    hex (round trip);
  - amounts are `u128` and equal `BigInt(served string)` with no re-scaling, including a
    value above `2^53`;
  - the rate is `u32` with the value unchanged (no ×100);
  - the dates are `u64`.
- Throws (message matches `/invalid draw_loan input/`):
  - `borrower_ref` missing or empty;
  - `borrower_ref` 62 hex characters (short);
  - `borrower_ref` with a `0x` prefix;
  - `borrower_ref` with non-hex characters;
  - an amount `"1200000.5"`, a negative amount, or an amount above `u128::MAX`;
  - a rate above `u32::MAX` or a non-integer rate;
  - an empty `metadata_uri`.
- `buildDrawLoanEnvelope` with an invalid `borrower_ref` rejects **without** calling
  `getAccount` / `simulateTransaction`. Update the existing envelope and `drawLoan` tests to
  pass `args`.

**trustee**
- `src/lib/-drawLoanArgs.test.ts` (new, next to `drawLoanArgs.ts`, matching the `lib/-*.test.ts`
  convention):
  - `readyDrawLoanArgs` returns ready args for a full block and `null` for a null/undefined
    block, a non-empty `missing_inputs`, or any null field;
  - `drawLoanBlockedReason` covers the three copies and `null`;
  - `formatBorrowerRef` covers the shortened hex, "Data room ID missing" and `—`.
- `src/api/-useDrawLoan.test.tsx`: `mutateAsync({ args })` forwards `args` to `drawLoan`.
  The configured and connected guards are unchanged.
- `src/routes/-useOriginationReview.test.ts`:
  - `approve()` calls the mint with `submission.draw_loan`'s ready args, never with
    `loan_data`;
  - `approveBlockedReason` and the no-op `approve()` / `openApprove()` cases:
    - `missing_inputs: ["data_room_id"]`: the data-room copy;
    - other missing inputs: the listed copy;
    - `draw_loan: null` and `draw_loan` absent: the unavailable copy;
    - an EVM target: the existing Stellar-only copy, taking precedence;
  - a legacy `loan_data` that still carries `to` / `initial_ccr` / `initial_location` plus a
    full `draw_loan` approves normally;
  - `mapMintError` maps an `invalid draw_loan input` error to the new copy.
- `src/routes/-origination-detail.test.ts`:
  - the Deal Details `borrowerRef` and `borrowerRefFull` cover the full, missing and absent
    states;
  - `location` is gone;
  - the preview rows are `originator, economics, metadataURI, borrowerRef`;
  - a submission whose `loan_data` has the legacy keys, and one with none of them, both map
    without throwing.

  Replace the #1014 `initial_location` and `initialLocation` cases (`:335-500`).
- `src/routes/-origination-detail-page.test.tsx`:
  - the "Borrower ref" row renders and the "Location" row is absent;
  - with `missing_inputs: ["data_room_id"]`, Approve is disabled and
    `origination-detail-approve-blocked` shows the data-room copy;
  - update the preview fixture rows.
- `src/routes/-ApproveMintDialog.test.tsx`: replace the `initialLocation` fixture row with
  `borrowerRef`.
- `src/routes/-origination-new.test.ts`:
  - `data_room_id` is required ("Required.") and trimmed in the built input;
  - the built input has no `to`, `initial_ccr` or `initial_location` keys;
  - JSON import of a legacy payload (with `to` / `initial_*` and without `data_room_id`)
    imports the rest and lists `data_room_id` in `missingFields`;
  - remove the `to` / `initial_ccr` expectations (`:66-74`, `:113`, `:143`, `:179`).
- `src/routes/-origination-new-page.test.tsx`:
  - the "Data room ID" field renders;
  - `submit-loan-section-Collateral` is absent and "Collateral valuation" is still present;
  - the POSTed body has `data_room_id` and lacks `to`, `initial_ccr` and `initial_location`;
  - update the fixtures at `:82` and `:274`.
- Fixture-only updates (drop `initial_ccr` / `initial_location`, add `data_room_id` and,
  where a submission is built, a `draw_loan` block):
  - `components/-NeedsAttention.test.tsx`, `components/-useNeedsAttention.test.ts`;
  - `routes/-index.test.tsx`, `routes/-origination.index.test.tsx`,
    `routes/-useOriginationTable.test.ts`;
  - `api/-useLoanSubmissions.test.tsx`, `api/-useSubmitLoan.test.tsx`.

  Keep **one** legacy-shaped fixture (with the deprecated keys) in `-useOriginationTable.test.ts`
  to prove the table tolerates them.

Edge cases to cover explicitly:
- `draw_loan` absent from an old cached `SubmissionView`.
- `missing_inputs` non-empty while `borrower_ref` is present (for example a bad amount).
- An uppercase-hex `borrower_ref`. Accept it: the validator is case-insensitive and the API
  serves lowercase.
- An amount string at exactly `u128::MAX`.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - **Data layer (`useLoanSubmissions`)**: the draw path paragraph (`parseUsdcToU128` ×10^7)
    is replaced. Approve encodes the API-served `draw_loan` block verbatim (base units, rate
    bps × 100, `borrower_ref` hex, which the browser neither scales nor hashes). Document the
    `SubmissionView.draw_loan` field and its `null` cases.
  - **Submit a loan (#1100)**:
    - the Sections list gains `data_room_id` ("Data room ID", required, trimmed) and loses
      `to` and the Collateral section;
    - drop the "`to` label reads 'Mint to…'" sentence in the Target chain bullet;
    - the Validation split no longer lists `initial_ccr >= 1_000_000`;
    - the import-JSON example warning still lists `collateral_valuation.*` + `fee_schedule.*`,
      plus `data_room_id` for an old payload.
  - **Origination detail field mapping**: replace the Location bullet with the "Borrower ref"
    row (source `draw_loan.economics.borrower_ref`, 6…4 shortened with the full hex in a
    tooltip, "Data room ID missing" or `—`). State that the legacy `to` / `initial_ccr` /
    `initial_location` keys are ignored.
  - **Approve & mint confirmation dialog**: the `initialLocation` line is replaced by
    `borrowerRef`.
  - **Chain-first Approve ordering**:
    - step 1 becomes `useDrawLoan().mutateAsync({ args })` built from `submission.draw_loan`;
    - add a "Draw-inputs gate (#1805)" paragraph after the target-chain gate, covering the
      three copies, the order and the `missing_inputs` rule.
- `docs/frontend/error-handling.md` (`:287-292` mint table and `mapMintError` text): add the
  "invalid draw_loan input" row.
- `docs/product-specs/trustee-dashboard.md:88`: replace the Location-row sentence with the
  Borrower-ref row. Add that Approve is disabled while the API reports missing draw inputs
  (data room ID), and that the submission form collects a data room ID and no longer collects
  a mint-to address, initial CCR or initial location.
- `docs/user-stories/epic-1776/1805-trustee-draw-loan-borrower-ref.md` (new, format of
  `1792-draw-loan-data-room-id.md`, persona trustee, run on pipeline-test after deploy):
  - Story 1: submit with a data room ID. The review page shows the Borrower ref (matching
    `printf '<id>' | shasum -a 256`, shortened) and the preview `borrowerRef`.
  - Story 2: Approve simulates, signs and submits on Stellar testnet. The banner flips to
    Approved, and the loan appears in `/loans` and the registry.
  - Story 3: a legacy submission without `data_room_id` opens without errors. Approve is
    disabled with the data-room copy.
  - Story 4: the form has no Mint-to or Collateral fields. "Data room ID" is required, and a
    whitespace-only value is rejected.
  - Story 5: an EVM-target submission keeps the Stellar-only reason.
- `docs/user-stories/index.md`: add the #1805 row under "Epic #1776" (status Initial).
- `docs/exec-plans/known-bugs.md`: the 2 entries from step 14.
- `docs/exec-plans/tech-debt-tracker.md`: the TD-42 note from step 15.
- `packages/trustee/src/utils/stellarSacUnits.ts`: drop the `parseUsdcToU128` mention from
  the `economicsUsdDecimal` comment.
- No API product-spec change: `api-authorization-loan-submission.md` already documents the
  block and the "do not draw while `missing_inputs` is non-empty" rule.
