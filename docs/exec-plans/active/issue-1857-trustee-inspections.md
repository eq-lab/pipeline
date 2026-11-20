# Issue #1857: Trustee: inspections — enter and approve (four-eyes), variances and flags (SecurityRegistry)

Source: https://github.com/eq-lab/pipeline/issues/1857 (epic #1795)

## Scope

Add the two INSPECTION_OPERATOR writes, `record_inspection` and `approve_inspection`, to the
Trustee loan detail page. Fill in the inspection display that the
[Security records card](../../frontend/trustee-flows.md#security-records-card) (#1767) does not show yet.
Everything else the issue body calls "new" is already on `main`: `VITE_STELLAR_SECURITY_REGISTRY_ID`
(`.env.example:312`, `docker/trustee/entrypoint.sh`, `lib/env.ts`), the Stellar and EVM
`securityRegistry.ts` encoders, the Risk Council Security page and Inspector panel (#1858), the
records card with its inspections table (#1767), and marks, extension consent and the coverage check (#1859).
This plan reuses them.

**In scope (Stellar loans only):**

1. **Enter inspection.** On each record that may be inspected, an "Enter inspection" button opens a dialog. The
   dialog calls `record_inspection(caller, record_id, inspection: NewInspection)` **directly** on the
   SecurityRegistry. This is not `AM.execute`: the contract runs its own `can_call(caller, self,
   "record_inspection")` check and requires `immediate`.
2. **Approve inspection.** On each inspection row that awaits approval, an "Approve" button opens a confirm dialog that calls
   `approve_inspection(caller, inspection_id)` directly. The button is hidden for the wallet that
   entered the inspection (served `entered_by`). The contract stays the authority (`SameOperator` #31).
3. **Display additions** in `buildSecurityRecords`. All values are served verbatim and show `—` when missing. Nothing is computed on the client:
   - Inspection rows gain Inspector (`inspector`) and Certificate (`certificate_no`) columns, plus an action column.
   - Each record gains a "Latest inspection" row from `lot.latest_quantity` + unit,
     `lot.latest_inspection_id` and `lot.latest_inspected_at`. It sits under Counted quantity
     (`valuation.counted_quantity`, already served) with the static user-docs sentence "Counted
     quantity is the smaller of the document quantity and the latest approved inspection."
     (`docs/user-docs/risks/credit-policy.md:43`).
   - When `flagged_by` is set, a record gains an "Open flag" row: "Inspection #{flagged_by}. The Risk Council settles it."
     It links to `/risk-council/security/$id?chain=` (#1858), where `resolve_flag` already lives.
   - The card gains an "Inspector panel" block from the served `/security` `inspectors` (`AddressText` each).
     When the list is empty it reads "No inspectors are on the panel." The block links to `/risk-council/inspectors`.
4. Error copy **by contract error name**, the `docs/frontend/trustee-flows.md` section, and the user-stories
   doc.

**Out of scope:**
- **EVM.** The EVM `PipelineSecurityRecordNft` at `pipeline-contracts@150631a` has the same pair. Hoodi runs `f92d719`, which has the same file. The pair is
  `recordInspection(uint256 recordId, NewInspection newInspection) restricted returns (uint256)` and
  `approveInspection(uint256 inspectionId) restricted`. Both are `_requireDirectCall` (the caller is `msg.sender`, and there is no
  caller argument), with `SecurityRecordNftSameOperator` / `AlreadyApproved` / `NotInspector` / … errors.
  `NewInspection` is the tuple `(address inspector, uint8 kind, uint64 inspectedAt, uint256 quantity,
  uint256 grade, bytes32 siteHash, bytes32 certificateHash, string region, string certificateNo)`.
  This issue is Stellar-only, as the body specifies and as #1859 did. On an EVM loan the display additions render,
  because `/security` serves EVM, but the Enter and Approve buttons are hidden (`stellarOnlyActionReason`). EVM goes to a
  follow-up issue (see Open Questions).
- A cross-loan "awaiting approval" queue. No aggregated endpoint serves one, and fetching `/security` once per loan would
  be client-side fan-out. Approvers work from the loan detail page.
- Any backend or contract change. `set_inspectors` and `resolve_flag` stay on the #1858 pages.
- Uploading or storing the certificate file. The contract keeps only `certificate_hash`.

**Backend reads (verified on `main`).** `GET /v1/loan-book/{loan_id}/security?chain_id=` serves the following
(`packages/api/src/security_state.rs` `InspectionDto` :204-230, `inspection_dto` :556; spec
`docs/product-specs/loan-security-state.md`):
- `records[].inspections[]`: `inspection_id`, `inspector`, `kind`, `inspected_at`, `region`, `site_hash`, `quantity`, `grade`,
  `certificate_hash`, `certificate_no`, `entered_by`, `entered_at`, `approved_by`, `approved_at`,
  `variance_reference_bps` / `variance_previous_bps` / `variance_grade_bps` (only once approved,
  `packages/shared/src/security_registry.rs:596`), `flagged`, `resolution`, `resolution_reason_hash`,
  `resolved_at`, `is_lot_latest`, `complete`, `needs_view`.
- On the record: `records[].flagged_by`, `lot.{latest_inspection_id, latest_inspected_at, latest_quantity}`, `region`, `site_hash`,
  `reference_quantity`, `reference_grade`, `protection`, `status`, `valuation.counted_quantity`.
- At the top level: `inspectors`, `paused` and `refresh_pending`.

Every field the UI needs is served, so nothing is kept out for lack of data.

**Contract (source of truth).** `pipeline-stellar-contracts@e9881ac`
`contracts/security-registry/src/lib.rs`:
- `record_inspection` (:365-426, `#[when_not_paused]`) takes `caller: Address, record_id: u32, inspection: NewInspection` and returns `u32`.
- `approve_inspection` (:435-498, `#[when_not_paused]`) takes `caller: Address, inspection_id: u32`.
- `ensure_can_inspect` (:1149-1168) and `ensure_can_call` (:1244-1261, `caller.require_auth()` then AM `can_call(...).immediate`) guard both.

In `types.rs`:
- `NewInspection` (:309-319) has the fields `inspector: Address`, `kind: InspectionKind`, `inspected_at: u64`,
  `region: String`, `site_hash: BytesN<32>`, `quantity: i128`, `grade: i128`, `certificate_hash: BytesN<32>`,
  `certificate_no: String`.
- `InspectionKind` (:254) is `LoadingTally | DraftSurvey | SamplingAssay | DischargeSurvey | StockCount`.
  `SamplingAssay` does not measure quantity.
- Quantity and grade are 7 dp. A grade of `0` means not measured.

Errors are in `error.rs`. Roles: `deployments/justfile` `setup-access` maps `record_inspection` and `approve_inspection` to
`INSPECTION_OPERATOR` (:711), with delay 0 and at least two members (:754). This matches the user docs: `governance/multisig-roles.md:24`,
`technical/smart-contracts.md:40` and `references/glossary.md:105-107` ("one operator enters, a second approves").

## Assumptions and Risks

- **Blocker cleared.** #1780 and #1779 are merged, and the reads above are on `main`.
- **Direct invoke, not relay.** Because `caller.require_auth()` runs on the wallet, the transaction must call
  the SecurityRegistry itself, with the wallet as both source and `caller`. This follows the `checkCoverage` envelope pattern
  (`stellar/contracts/securityRegistry.ts:302-383`), not `relaySecurityRegistry`. Routing the call through `AM.execute` would
  make the AM the invoker and fail the `can_call` check.
- **The served panel can lag the chain.** It comes from `security_registry_state`, refreshed by the `inspectors_set` event and the hourly view. A
  `set_inspectors` executed seconds ago may not be listed yet. The contract rejects an inspector that is not on the panel
  with `NotInspector` (#27), and the error copy says so. The plan uses the served panel, as the issue asks: "the panel, values
  from the backend". It does not use the on-chain `useSecurityInspectors` read of the Inspector panel page.
- **Indexing lag.** A new inspection, and an approval's variances and flag, show after one or two 30 s fold
  cycles. Writes invalidate `loan-security`, `loan-book` and `audit-log` immediately and again at 5 s and 15 s, the same as #1859.
- **Testnet acceptance needs fixtures.** "Enter, then approve by a second wallet" needs all of the following:
  - two wallets holding `INSPECTION_OPERATOR`, both trustees in the API `auth_users`;
  - a non-empty panel;
  - a goods record (`EndorsedBl`, `WarehousePledge`, `CollateralManagement`) that is `PendingPerfection` or `Active`, on a loan with terms.

  If any of these is missing on stage 99000001, QA is blocked even though the code is done (see Open Questions).
- **Soroban error codes** are read with `amErrorCode` (`Error(Contract, #N)`). The call is direct, so `#N` is the
  SecurityRegistry's own code (it cannot collide with an AM code). The pause panic code from the Stellar pausable library is not pinned in this repo. The UI
  therefore gates on the served `paused === true` and does not map that code.
- `docs/user-docs/**` overrides the internal specs. No role name appears in UI copy, following #1859: availability follows the
  connected wallet's `can_call`.

## Open Questions

1. **No Figma frames exist for this screen.** None is linked on #1857 or epic #1795, and the specs have none. The plan builds from the
   existing theme: the loan-detail primitives (`CARD_CLASS`, `CardTitle`, `KeyValueRow`, `chipStyle`, `AddressText`,
   `detailTokens`), the `-RevalueDialog.tsx` dialog shell and `-SecurityActionsCard.tsx` form controls (#1859), and the
   existing inspections table. The manager needs the user's decision: grant a per-Issue no-design exception, or park the issue for frames.
2. **Salted hashes.** The contract stores `certificate_hash` as a "salted sha256 of the certificate as received" and
   `site_hash` as a "salted sha256 of the vessel IMO or the warehouse". No salting convention exists in this repo or its specs.
   Default in this plan:
   - **Certificate:** the operator pastes a 64-hex certificate hash, computed off-chain by the lending vehicle's procedure.
     The app never sees the file or the salt.
   - **Site:** the site hash is prefilled from the record's served `site_hash`, the same site, and stays editable.

   Is that right? The alternative is for the app to hash an uploaded file plus a salt. That needs a salt source and storage that do not exist.
3. **EVM.** Is a follow-up issue under epic #1937 wanted for the RecordNft `recordInspection` / `approveInspection` arm
   (`useChainWallet`, direct `restricted` call)? This plan is Stellar-only, as the body says.
4. **Testnet fixtures for acceptance.** Who provides two `INSPECTION_OPERATOR` wallets (also API trustees), a
   non-empty panel and an inspectable goods record on stage 99000001? Without them the "works on testnet" acceptance
   cannot be shown.
5. **Precision of `inspected_at`.** The default is a date-only UTC input sent as 00:00 UTC, like the extension-consent date. This means two approved
   inspections on the same day tie, and the later approval becomes the lot's latest (contract `>=`, lib.rs:458). Should the
   form take a time (UTC) as well?

## Implementation Steps

Every new file opens with one 2–3-line `// spec:` header pointing at
`docs/frontend/trustee-flows.md#security-inspections-1857`. Files carry no other comments.

### 1. wallet-connect: Stellar encoder and direct invoke

`packages/wallet-connect/src/stellar/contracts/securityRegistry.ts`:
- Add the following exports:
  - `InspectionKind`: `"LoadingTally" | "DraftSurvey" | "SamplingAssay" | "DischargeSurvey" | "StockCount"`.
  - `INSPECTION_KINDS`, in contract order.
  - `inspectionMeasuresQuantity(kind)`, which is `kind !== "SamplingAssay"`.
  - `NewInspectionInput`: `{ inspector, kind, inspectedAt: number|string, region, siteHash, quantity, grade, certificateHash, certificateNo }`.
    Quantity and grade are 7-dp decimal strings.
- `encodeNewInspection(input)`: an `scMap` (sorted `Symbol` keys, via `scval.ts`) with the following entries:

  | Key | Encoding |
  |---|---|
  | `certificate_hash` | `hashArg` |
  | `certificate_no` | `nativeToScVal(str, {type:"string"})` |
  | `grade` | i128 |
  | `inspected_at` | `u64Arg` |
  | `inspector` | `new Address(...).toScVal()`, validated with `isInspectorAddress` |
  | `kind` | `variant(kind)`, validated against `INSPECTION_KINDS` |
  | `quantity` | i128 |
  | `region` | string |
  | `site_hash` | `hashArg` |

  Generalise `decimal7ToI128` with an optional `what` label so a bad quantity or grade does not report itself as "value per unit".
  Negative values are rejected by the existing regex.
- `encodeRecordInspectionArgs(caller, recordId, input)` returns `[Address(caller), u32Arg(recordId), encodeNewInspection]`.
  `encodeApproveInspectionArgs(caller, inspectionId)` returns `[Address(caller), u32Arg(inspectionId)]`.
- Refactor `buildCheckCoverageEnvelope` / `checkCoverage` into a private
  `buildDirectEnvelope({registryId, caller, fn, args, rpcUrl, networkPassphrase})` and `submitDirect(...)`. The stages
  (`awaiting-signature` → `submitting` → `confirming`) and error strings stay as they are. Keep `buildCheckCoverageEnvelope` and
  `checkCoverage` as thin wrappers with unchanged signatures, so `securityRegistryCoverage.test.ts` keeps passing.
- Export `recordInspection(params) → { hash, inspectionId: number | null }`. It reads the u32 return value from
  `pollTransaction(...).returnValue` via `scValToNative`, giving `null` if absent. Also export `approveInspection(params) → { hash }`.
- Export the new symbols from `packages/wallet-connect/src/index.ts`. They join the existing `securityRegistry` export block (:359-382).

### 2. Trustee API hooks

- `packages/trustee/src/api/useLoanSecurity.ts`:
  - Add the served fields to `LoanSecurityInspection`: `region`, `site_hash`, `certificate_hash`, `certificate_no`,
    `resolution_reason_hash`, `needs_view`.
  - Add `region`, `site_hash` and `lot.complete` to `LoanSecurityRecord` / `LoanSecurityRecordLot`.

  All are optional, and nothing is computed from them.
- `packages/trustee/src/api/useSecurityMarks.ts`:
  - Widen the `useSecurityRegistryAccess` `fn` union with `"record_inspection" | "approve_inspection"`. Same AM
    (`STELLAR_LOAN_REGISTRY_EXECUTOR_ID`), same target, same key shape.
  - Export the existing `useSecurityWrite` and `rpc` helpers so the new hooks reuse the stage, invalidation and recheck logic unchanged.
- New `packages/trustee/src/api/useSecurityInspections.ts`:
  - `useRecordInspection()` calls `recordInspection({ registryId: ENV.STELLAR_SECURITY_REGISTRY_ID, caller, recordId, inspection, ... })`.
  - `useApproveInspection()` calls `approveInspection(...)`.
  - Both use `useSecurityWrite(checkCoverageConfigured, ...)`. Only the registry id is needed: there is no AM relay, and `can_call` is read separately.

### 3. Pure logic

New file `packages/trustee/src/lib/securityInspections.ts`.

**Copy constants.**

| Constant | Text |
|---|---|
| `ENTER_NO_ROLE` | "This wallet is not allowed to enter inspections." |
| `APPROVE_NO_ROLE` | "This wallet is not allowed to approve inspections." |
| `ENTERED_BY_THIS_WALLET` | "Entered by this wallet. A second operator approves it." |
| `CONNECT_TO_ENTER` | "Connect a Stellar wallet to enter an inspection." |
| `CONNECT_TO_APPROVE` | "Connect a Stellar wallet to approve." |
| `REGISTRY_PAUSED_INSPECTIONS` | "The SecurityRegistry is paused. Inspections can't be entered or approved until it resumes." |
| `NO_PANEL` | "No inspectors are on the panel. The Risk Council sets the panel." |
| `APPROVE_EFFECT` | "Approving computes the variances against the document quantity, the lot's latest inspection and the reference grade. The record is flagged when a variance is above the loan's tolerance; only the Risk Council clears a flag." |
| `COUNTED_QTY_NOTE` | the user-docs sentence above |

**Gates.**
- `inspectableRecord(record)`: `open === true`, `protection` is `EndorsedBl | WarehousePledge | CollateralManagement`,
  and `status` is `PendingPerfection | Active`. These come from served values and mirror `ensure_can_inspect`. The contract stays the authority.
- `canOfferApprove(row, wallet)`: the row is awaiting approval (the existing `approved === "awaiting"` rule) and `entered_by !== wallet`
  (exact Strkey). When `entered_by` is not served, Approve is still offered and the contract decides.

**Form.**
- `InspectionFormInput` has `{ inspector, kind, dateInput, region, siteHash, quantity, grade, certificateHash, certificateNo }`.
- `inspectionSeed(record, panel)` returns:
  - `region` = the served record `region`, or `""`;
  - `siteHash` = the served `site_hash`, or `""`;
  - `inspector` = the first panel entry when the panel has exactly one;
  - `kind` = `""`.
- `inspectionFormError(input, panel, today)`. It returns the first failing rule's message, or `null`:

  | Rule | Message |
  |---|---|
  | Inspector is not in the served panel | "Pick an inspector from the panel." |
  | Kind is not in `INSPECTION_KINDS` | — |
  | Date is not a valid `YYYY-MM-DD` | — |
  | Date is after today (UTC) | "The inspection date can't be in the future." |
  | Quantity is not a non-negative number with at most 7 dp | "Enter the quantity found, at most 7 decimals." |
  | Grade is not empty and not a non-negative number with at most 7 dp | — |
  | A hash is not `/^[0-9a-f]{64}$/` after trim and lowercase | "Enter the 64-character hex hash." |
  | Certificate no is empty | — |

  The quantity rule applies only when `inspectionMeasuresQuantity(kind)`. The grade may be empty, meaning not measured.
  Rows with a dash have no fixed copy; the coder writes a short message in the same style.
- `toNewInspection(input)` sends:
  - `inspectedAt` = `valueDateSeconds(dateInput)` (`lib/wireOut.ts`);
  - `quantity` = `"0"` for `SamplingAssay` (the contract ignores it there);
  - `grade` = `"0"` when empty;
  - hashes lowercased.

**Errors.**
- `SECURITY_REGISTRY_ERROR_NAMES`: codes 1–32 to their `error.rs` names, the full table pinned from `e9881ac`.
- `INSPECTION_ERROR_COPY` gives copy for these codes:
  `1` NonExistentRecord, `4` InvalidQuantity, `12` WrongRecordStatus, `14` NoTerms, `23` Unauthorized,
  `25` NonExistentInspection, `26` NotGoodsRecord, `27` NotInspector ("…not on the inspector panel. The panel may
  have changed; reload."), `28` InvalidInspectionDate, `29` TooManyInspections ("A record holds at most 64
  inspections."), `30` AlreadyApproved, `31` SameOperator ("The operator who entered an inspection can't approve it. A second operator must approve it.").
- `inspectionErrorCopy(err, fallback)` is modelled on `securityMarksErrorCopy`. It returns `{ message: "{copy} ({Name})", details,
  isSpecific: true }`. A known code without copy shows `"SecurityRegistry error {Name} (#N)."`. An unknown code keeps the generic `toUserError` text with the raw
  details. "You cancelled the transaction" passes through.

### 4. Records view

`packages/trustee/src/routes/-loanSecurityRecords.ts` (pure):
- `SecurityInspectionRow` gains the following fields:
  - `inspector: string | null`;
  - `certificateNo` (verbatim, else `—`);
  - `inspectionId: number | null`, parsed from the served decimal id for the write;
  - `enteredBy: string | null`;
  - `awaitingApproval: boolean`.
- `grade` uses `formatDecimal7` rather than the raw string. This trims display only, as for quantity.
- `SecurityRecordView` gains the following fields:
  - `inspect: InspectionSeed | null`, non-null when `inspectableRecord`;
  - `latestInspection: string`: "{qty unit} · Inspection #{id} · {date}" from `lot`, or `—`;
  - `openFlag: { inspectionId: string } | null`, from `flagged_by`;
  - `recordIdNumber`.
- `SecurityRecordsView` gains `panel: string[] | null` (served `inspectors`; `null` when not an array) and `paused: boolean`
  (`=== true`).

### 5. UI

**`packages/trustee/src/routes/-SecurityRecordsCard.tsx`.** The card takes new props `loanId` and `chainId`. The route already passes `chainId`, the loan's own `chain`.
- **Panel block.** Under the title: an "Inspector panel" `KeyValueRow` list (`AddressText`), `NO_PANEL` when empty, and a link
  "Inspector panel" to `/risk-council/inspectors`. Test id: `loan-detail-inspector-panel`.
- **Per record:**
  - a "Latest inspection" row after Counted quantity, with `COUNTED_QTY_NOTE` as muted text;
  - an "Open flag" row with a link to `/risk-council/security/$id` with `chain` (test id `loan-detail-open-flag`);
  - an "Enter inspection" secondary button (`loan-detail-enter-inspection`), placed beside the Inspections heading.
- **Inspections table:**
  - add the Inspector (`AddressText`) and Certificate columns;
  - add a last column with an "Approve" button (`loan-detail-approve-inspection`, `data-inspection-id`) when `canOfferApprove`;
  - otherwise show `ENTERED_BY_THIS_WALLET` muted on rows this wallet entered.
- **Availability.** Stellar loan (`stellarOnlyActionReason(chainId) === null`), `checkCoverageConfigured()`,
  `securityMarksConfigured()` (the AM is needed for the `can_call` read), and not `paused`.
  - Enter is enabled when the wallet is connected and `useSecurityRegistryAccess("record_inspection")` is `immediate`.
  - Approve is enabled when the wallet is connected and `useSecurityRegistryAccess("approve_inspection")` is `immediate`.
  - Notes use the copy constants (`loan-detail-inspection-note`).
  - Buttons are hidden on EVM and when not configured, as Set price is.
- **Result line** (`loan-detail-inspection-result`), the same shape as the revalue result:
  - "Inspection #{id} entered on record #{r}. Transaction {hash}. It counts once a second operator approves it." The id is from the
    return value, and the line falls back to "Inspection entered…" when it is null.
  - "Inspection #{id} approved. Transaction {hash}. Variances and any flag show once indexed."

**New `packages/trustee/src/routes/-InspectionDialog.tsx`** (`inspection-dialog`). It uses the `-RevalueDialog.tsx` shell: `useLpReviewDialog`,
`DIALOG_CLASS`, `INPUT_CLASS`, `HINT_CLASS`, `role="dialog"`, Escape and backdrop cancel, `stageLabel` on submit.
- **Context rows:** record title, commodity, document quantity and reference grade, verbatim.
- **Fields:**

  | Field | Test id | Notes |
  |---|---|---|
  | Inspector | `inspection-inspector` | a select of the served panel, labelled with short addresses |
  | Kind | `inspection-kind` | — |
  | Inspection date (UTC) | `inspection-date` | `max=todayUtcDateInput()` |
  | Quantity found ({unit}) | `inspection-quantity` | disabled with "Not measured by a sampling assay" for `SamplingAssay` |
  | Grade | `inspection-grade` | optional, hint "Leave empty if not measured" |
  | Region | `inspection-region` | — |
  | Site hash | `inspection-site-hash` | hint "Prefilled from the record" |
  | Certificate no | `inspection-certificate-no` | — |
  | Certificate hash | `inspection-certificate-hash` | hint "Salted sha256 of the certificate as received, 64 hex characters" |

- **Other test ids:** `inspection-validation`, `inspection-error`, `inspection-confirm`.
- **Label:** "Enter inspection".
- **Helper text:** "An entered inspection counts for nothing until a second operator approves it."

**New `packages/trustee/src/routes/-ApproveInspectionDialog.tsx`** (`approve-inspection-dialog`). The same shell.
- **Rows:** the inspection's kind, inspector, inspected date, quantity, grade, certificate no, entered by and date.
- **Text:** `APPROVE_EFFECT`, then the loan's served `terms.tolerance_bps` / `grade_tolerance_bps` as "{n} bps", verbatim.
- **Button:** "Approve inspection" (`approve-inspection-confirm`). Errors go to `approve-inspection-error`.

`packages/trustee/src/routes/loans.$id.tsx`: pass `loanId` to the three `SecurityRecordsCard` call sites (:1347, :1399,
:1457). Pass the served terms through `detail.securityRecords` if they are not already there. The layout does not change.

### 6. Docs

See Docs to Update. Write them in the same PR.

## Test Strategy

Vitest, colocated `-*.test.ts(x)`, following the #1859 tests.

- **`packages/wallet-connect/src/stellar/contracts/securityRegistry.test.ts`:**
  - `encodeNewInspection` produces the exact sorted map: key order and types `bytes`, `string`, `i128`, `u64`, `address`,
    `vec[symbol]`, with an XDR snapshot for a fixed input;
  - it rejects a negative or over-7-dp quantity or grade, an invalid Strkey, an unknown kind, a non-hex hash, and a u32 overflow;
  - `encodeRecordInspectionArgs` / `encodeApproveInspectionArgs` put `caller` first as `scvAddress`.
- **`securityRegistryCoverage.test.ts`:** unchanged and still green after the direct-envelope refactor.
- **A new test** covers that `recordInspection` builds `Contract(registryId).call("record_inspection", …)` with the wallet as source (no AM in the
  operation), and that it parses the `u32` return value. Mock `rpc.Server` as the coverage test does.
- **`packages/trustee/src/lib/-securityInspections.test.ts`:**
  - each `inspectionFormError` branch, including a future date, today allowed, SamplingAssay quantity ignored, an empty grade becoming
    `"0"`, and hash lowercasing;
  - `inspectableRecord` for each protection and status, and for `open: false`;
  - `canOfferApprove` for the same wallet, another wallet, an unserved `entered_by`, an approved row and a `complete: false` row;
  - `inspectionErrorCopy` for #27, #30 and #31 (name in the message), an unmapped known code, an unknown code and a user cancel.
- **`-loanSecurityRecords.test.ts`:**
  - the new row fields, verbatim;
  - "Latest inspection" `—` when `lot` is null;
  - "Open flag" only when `flagged_by` is set;
  - `panel` null versus `[]`;
  - grade formatting;
  - a partial 200 (`{}` inspection) never throws.
- **`-SecurityRecordsCard.test.tsx`:**
  - Enter is hidden on EVM and disabled without a wallet, without a role or when paused;
  - Approve is hidden for the entering wallet and shown for another;
  - the panel block and its empty copy;
  - the open-flag link carries `chain`.

  Mock the hooks as the revalue tests do.
- **`-InspectionDialog.test.tsx` / `-ApproveInspectionDialog.test.tsx`:**
  - prefill from the record;
  - validation messages;
  - submit calls the hook with the encoded input;
  - the stage label;
  - the error by name;
  - Escape and backdrop cancel.
- **New `api/-useSecurityInspections.test.tsx`:** it is modelled on `-useSecurityMarks.test.tsx`. It checks the EVM chain gate, the not-configured gate, and the
  invalidation of `loan-security`, `loan-book` and `audit-log` immediately and at 5 s and 15 s.
- **Gates:**
  - `yarn workspace @pipeline/wallet-connect test`, `yarn workspace @pipeline/trustee test`, and the lint and type checks;
  - `npx tsx scripts/lint-docs.ts`;
  - `npx tsx scripts/lint-comments.ts`, shrinking `scripts/lint-comments.baseline.json` for any touched file it lists;
  - `yarn build` for trustee.
- **Manual, on testnet** (user story; this needs the Open Question 4 fixtures):
  1. Operator A enters an inspection on a goods record.
  2. The row shows "Awaiting approval", and A sees no Approve button.
  3. Operator B approves.
  4. The variances, Flagged and Latest inspection show after indexing.
  5. Approving with A's wallet through a stale UI shows the `SameOperator` copy.
  6. An off-panel inspector, which needs a panel change between load and submit, shows the `NotInspector` copy.

## Docs to Update

- **`docs/frontend/trustee-flows.md`.** Add a new `#### Security inspections (#1857)` section under "Security records card", after
  "Security marks (#1859)". It covers:
  - sources (contract lines above, code paths);
  - the direct-call model (no AM relay);
  - availability by `can_call`;
  - the field table and encoding;
  - the copy constants;
  - the error-name table;
  - the four-eyes hide rule;
  - the served fields used;
  - the test ids;
  - the Stellar-only scope with the EVM function pair noted for the follow-up.

  Update the "Security records card" bullets (the new columns, the Latest inspection and Open flag rows, the panel block) and its "Not shown
  here" sentence.
- **`docs/user-stories/epic-1795/1857-trustee-security-inspections.md`.** A new file with the stories: enter, four-eyes approve,
  same-wallet hidden, errors by name, panel shown, latest inspection and counted-quantity note, open flag link, EVM loan
  read-only. Add its row to `docs/user-stories/index.md`, next to the #1859 row (:395).
- **`.env.example:312`.** Extend the `VITE_STELLAR_SECURITY_REGISTRY_ID` comment with "also the direct target of
  record_inspection / approve_inspection".
- **`docs/exec-plans/tech-debt-tracker.md`.** Add a TD for the EVM inspection writes (RecordNft `recordInspection` /
  `approveInspection`) unless a follow-up issue is filed instead (Open Question 3), and a TD that the panel is the served copy
  and can lag `set_inspectors` by a fold cycle.
- `docs/product-specs/loan-security-state.md` needs no change: the reads are served unchanged.
