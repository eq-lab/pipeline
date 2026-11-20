# Issue #1886: Trustee: show the LP's settlement bank account on pending wire-outs and in LP detail / KYB review

Source: https://github.com/eq-lab/pipeline/issues/1886

Frontend flow, sub-issue of epic #1795. This is the Trustee half of #1812. The backend is merged
(#1882) and deployed on staging. Branch `feat/1886-trustee-settlement-bank-account` (draft PR #1932).

No Figma frames are referenced. The Bank wire-outs section (#1764) and the LP detail / review dialog
(#1271, #1453, #1826) were built from the trustee theme and the shared detail primitives
(`components/detail/`). The additions here follow the same approach: `KeyValueRow`, `StatusChip`,
`DetailCard`, `detailTokens`, the toast, and `useCopyToClipboard` from `@pipeline/ui`.

## Scope

### Served data (verified in code and in the deployed OpenAPI, `https://api.pipeline.stage.eqlab.net/api-docs/openapi.json`)

`SettlementBankAccountDetails` (`packages/api/src/routes/lps.rs`). Every key is always present:

```
{ account_holder_name: string, bank_name: string, bank_address: string|null,
  account_number: string|null, iban: string|null, swift_bic_code: string|null,
  routing_number: string|null }
```

It is served in three places:

- **`GET /v1/cash-book` `wire_outs[]`.** The row gets an optional `bank_account`
  (`packages/api/src/routes/cash_book.rs`, `skip_serializing_if = None`). The API sets it only when
  `status == "Pending"`, the row resolved to an LP (`lp_id` present) and that LP has an account.
- **`GET /v1/lps/{id}`** and the `POST /v1/lps/{id}/kyb` response. They carry
  - `settlement_bank_account: { account_holder_name, bank_name, account_last4 } | null` (masked,
    always serialized), and
  - `settlement_bank_account_details?: SettlementBankAccountDetails`, which is omitted when no
    account is on file. For the trustee audience the two fields are both present or both absent.
- **`GET /v1/lps`** (the list) does **not** serve either field (`LpSummary`). The list's
  "Bank Info Available" column stays `—` (#1275 is still open). It is out of scope here.

### What changes

1. **Types.** `packages/trustee/src/api/useLp.ts` gains `SettlementBankAccountSummary` and
   `SettlementBankAccountDetails`. These are hand-mirrors of the Rust DTOs (TD-42 convention: the
   trustee app does not import `@pipeline/frontend`). `LpDetail` gains
   `settlement_bank_account: SettlementBankAccountSummary | null` and
   `settlement_bank_account_details?: SettlementBankAccountDetails`. `CashBookWireOut`
   (`api/useCashBook.ts`) gains `bank_account?: SettlementBankAccountDetails | null`.
2. **One presenter and one primitive, shared by all three surfaces.**
   - `lib/settlementBankAccount.ts` (pure):
     - The field order and labels mirror the LP app's `components/account/settlementBankAccount.ts`
       (#1885) without the form-only suffixes:
       1. Account holder name
       2. Bank name
       3. Bank address
       4. IBAN
       5. Account number
       6. SWIFT/BIC code
       7. Routing number (ABA)

       The values are copied, not imported. The LP module also holds form, draft and error-parsing
       code, and lives in another app.
     - `bankAccountRows(details)` returns `{ field, label, value, copyable }[]`. `value` is the
       served string verbatim, or `null`. `copyable` is true for `iban`, `account_number`,
       `swift_bic_code` and `routing_number` when the value is non-null.
     - `wireOutBankAccountState(wire)` returns `"served" | "missing" | "unresolved" | "not-pending"`:
       - `not-pending`: the status is not `Pending`.
       - `unresolved`: no `lp_id`.
       - `served`: `bank_account` is present.
       - `missing`: otherwise.
   - `components/detail/BankAccountRows.tsx`: renders the seven rows as `KeyValueRow`s.
     - A `null` value renders `—`.
     - Identifiers (IBAN, account number, SWIFT/BIC, routing) use the dialog's mono 13px style
       (`font-mono text-[13px] leading-[18px] break-all`, as "Lender address" in `WireOutSummary`).
       Names and the bank address use the body style.
     - A copyable value is followed by a 32×32 icon button: `aria-label="Copy {label}"`,
       `data-testid="{testIdPrefix}-{field}-copy"`. It calls `useCopyToClipboard().copy(value)`.
       On success it raises the toast "{label} copied" (the label only, never the value). A failed
       clipboard raises nothing, as in `AddressText`.
     - The value span gets `data-testid="{testIdPrefix}-{field}"`.
   - `components/detail/DetailIcons.tsx` gains `CopyIcon`: an inline 16px stroked glyph, two offset
     rounded rects, `currentColor`, like `CheckIcon` / `CrossIcon`. There is no copy icon in
     `packages/ui/src/assets/icons`.
3. **Bank wire-outs** (`routes/-wire-outs.ts`, `routes/-WireOutsSection.tsx`, `lib/wireOut.ts`).
   - `WireOutRow` gains `bankAccount: SettlementBankAccountDetails | null` and
     `bankAccountState`.
   - **Table, Pending rows only.** Under the lender's address chip in the Lender cell:
     - `served`: a text toggle "Show bank account" / "Hide bank account"
       (`wireout-row-{id}-bank-toggle`, `aria-expanded`, `aria-controls`). It expands a full-width
       sub-row (`<tr><td colSpan={7}>`, `wireout-row-{id}-bank`) holding `BankAccountRows`
       (max width 640px). It is collapsed by default, so the numbers are not on screen until asked
       for.
     - The expanded set lives in `useWireOutsSection` (`expandedBankIds`, `toggleBankAccount(id)`).
       The view stays JSX only (FRONTEND.md rule 2).
     - `missing`: an attention `StatusChip` "No bank account on file"
       (`wireout-row-{id}-no-bank-account`).
     - `unresolved`: nothing extra (the lender name already reads `—`).
   - **Why the row as well as the dialog.** The Trustee sends the bank wire *before* settling. The
     Settle button is often disabled at that moment: wallet not connected, role missing, on-chain
     state not confirmed, or another action in flight. A destination shown only in the settle
     dialog would then be unreachable.
   - **Settle dialog.** The "Destination bank account" placeholder row and `NO_BANK_ACCOUNT_HINT`
     ("The API does not serve the lender's bank account yet.") are removed. A destination block
     goes after `WireOutSummary`:
     - `served`: the heading "Destination bank account" plus `BankAccountRows`
       (prefix `wireout-settle-bank`).
     - `missing`: `—` plus the attention warning (`wireout-settle-no-bank-account`): "No bank
       account on file for this lender. Do not send a wire until one is added; cancel the request to
       return the PLUSD."
     - `unresolved`: `—` plus the muted hint (`wireout-settle-destination-hint`): "This wire-out is
       not linked to a lender, so no bank account is served."
   - Settle is **not** blocked by a missing account. The issue asks for a warning only, and the
     account may be known out of band.
   - The cancel dialog is unchanged.
4. **LP counterparty detail** (`routes/lp-counterparties.$id.tsx`). A new full-width `DetailCard`
   "Settlement bank account" (`ariaLabel`, `data-testid="lp-bank-account"`) goes between the
   profile/KYB grid and the KYB documents card, so the reviewer reads it next to the documents.
   - With `settlement_bank_account_details`: `BankAccountRows` (prefix `lp-bank-account`).
   - Without it: "No settlement bank account on file." (muted, `lp-bank-account-empty`).
   - The masked summary is not rendered. The full details supersede it, and the app derives
     nothing from either.
5. **KYB review dialog** (`routes/-LpReviewDialog.tsx`).
   - New optional prop `bankAccount?: SettlementBankAccountDetails | null`. The route passes
     `lp.settlement_bank_account_details ?? null`.
   - The dialog shows a "Settlement bank account" block under the description for **LP-level
     verdicts only** (`action.documentId === undefined`: Passed, ChangesRequested, Failed). Document
     Verify / Reject dialogs are about one file and do not show it.
     - With an account: `BankAccountRows` (prefix `lp-review-bank`). On `Passed`, add the muted line
       "Passing KYB also verifies this settlement bank account." (decision 2026-10-30).
     - Without one: "No settlement bank account on file." (`lp-review-bank-empty`). KYB may pass
       without one (USDC-only lenders, #1812 D7), so nothing is blocked.
   - `useReviewLp` is unchanged. It ignores the `POST /v1/lps/{id}/kyb` body and invalidates
     `["lp", id]`, so the refreshed detail carries the account.
6. **Privacy rules (enforced by construction and tests).**
   - Values appear only as rendered text and in clipboard writes.
   - No `console.*`, no `reportAppError` extra, no URL / search param, no `title` attribute, no
     `data-*` attribute, and no toast carries a value.
   - The trustee app has no analytics.
   - The disclosure state is keyed by wire-out id, never by a value.

### Out of scope

- The LP list's "Bank Info Available" column (not served on `GET /v1/lps`, #1275).
- Any write path for the account. Post-`Passed` changes are ops SQL (TD-182).
- Backend changes.
- `docs/product-specs/trustee-dashboard.md`: it has no wire-out or bank-account text to correct, so
  it is not edited (it is at 199 of 200 lines).

## Assumptions and Risks

- **No live wire-out on testnet** (the #1764 testnet caveat), so the cash-book half can only be
  exercised by unit tests until a lender calls `request_wire_out`. The LP detail half can be checked
  on staging with any LP that saved an account through #1885. LPs that passed before #1812 have none
  (TD-182) and show the empty state. That is expected, not a defect.
- **A served account that changes between list and dialog.** The settle dialog snapshots `row` at
  open, like the other summary fields. The 30 s / 5 s cash-book refetch updates the table, but not
  an open dialog. This is acceptable: the account is frozen once KYB is `UnderReview` or `Passed`,
  and only ops SQL changes it.
- **`bank_account` is the LP's *current* account**, not a record of where an earlier wire went. That
  is why the API serves it on Pending rows only, and the UI never shows it on settled or cancelled
  rows.
- **Table width.** The table is `min-w-[1040px]` with seven columns. The chip and the toggle sit
  inside the existing Lender cell (20%), so no column is added. The sub-row spans all columns.
- **The lint-comments baseline** lists none of the files touched. The new files get one
  `// spec: docs/frontend/trustee-flows.md#…` header and nothing else.

## Open Questions

_None_

## Implementation Steps

1. [x] **Types.**
   - `packages/trustee/src/api/useLp.ts`: export the interfaces `SettlementBankAccountSummary` and
     `SettlementBankAccountDetails` (fields above). Add
     `settlement_bank_account: SettlementBankAccountSummary | null` and
     `settlement_bank_account_details?: SettlementBankAccountDetails` to `LpDetail`.
   - `packages/trustee/src/api/useCashBook.ts`: add
     `bank_account?: SettlementBankAccountDetails | null` to `CashBookWireOut` (type import from
     `./useLp`).
2. [x] **Presenter** `packages/trustee/src/lib/settlementBankAccount.ts`. Header:
   `// spec: docs/frontend/trustee-flows.md#settlement-bank-account`. Exports:
   - `BANK_ACCOUNT_FIELDS` (the order above)
   - `BANK_ACCOUNT_LABELS`
   - `COPYABLE_BANK_FIELDS`
   - `bankAccountRows(details)`
   - `type WireOutBankAccountState`
   - `wireOutBankAccountState(wire: Pick<CashBookWireOut, "status" | "lp_id" | "bank_account">)`

   Use no formatting, no masking and no derivation.
3. [x] **Icon.** `packages/trustee/src/components/detail/DetailIcons.tsx`: add
   `CopyIcon({ size = 16, ...rest })` in the same `GlyphProps` / stroked style as `CheckIcon`.
4. [x] **Primitive** `packages/trustee/src/components/detail/BankAccountRows.tsx`. Header:
   `// spec: docs/frontend/trustee-flows.md#shared-detail-primitives`.
   - Props: `{ details: SettlementBankAccountDetails; testIdPrefix: string }`.
   - Renders one `KeyValueRow` per `bankAccountRows` entry, with `isLast` on the last row.
   - Value cell: `<span className="inline-flex items-center justify-end gap-[8px]">`, holding the
     value span (or `—`) and, when copyable, a `<button type="button">` 32×32
     (`inline-flex size-[32px] items-center justify-center rounded-[4px]`, `INK_MUTED` colour,
     `hover:bg-[rgba(0,0,128,0.06)]`, like `DOWNLOAD_LINK_CLASS`) wrapping
     `<CopyIcon aria-hidden />`.
   - On click: `void copy(value).then(ok => ok && showToast(`${label} copied`))`.
5. [x] **Wire-outs hook** `packages/trustee/src/routes/-wire-outs.ts`.
   - In the `rows` map, add `bankAccount: wire.bank_account ?? null` and
     `bankAccountState: wireOutBankAccountState(wire)` to `WireOutRow`.
   - Add `const [expandedBankIds, setExpandedBankIds] = useState<ReadonlySet<number>>(() => new Set())`
     and a `toggleBankAccount(id)` function.
   - Return `isBankAccountOpen: (id) => expandedBankIds.has(id)` and `toggleBankAccount`.
6. [x] **Wire-outs view** `packages/trustee/src/routes/-WireOutsSection.tsx`.
   - Delete `NO_BANK_ACCOUNT_HINT` and the placeholder `KeyValueRow` in `SettleWireOutDialog`.
   - `WireOutTableRow` returns a fragment: the existing `<tr>` plus, when
     `row.bankAccountState === "served" && section.isBankAccountOpen(row.id)`, a
     `<tr data-testid="wireout-row-{id}-bank"><td colSpan={7} className="pb-[12px]"><div className="max-w-[640px]"><BankAccountRows … testIdPrefix="wireout-row-{id}-bank" /></div></td></tr>`.
     The sub-row has no top border.
   - Lender cell, under `AddressChip`:
     - `served`: an underlined text button (`HINT_CLASS`, brand colour) "Show bank account" /
       "Hide bank account", with `aria-expanded` and
       `aria-controls="wireout-row-{id}-bank-panel"`.
     - `missing`: `<StatusChip band="attention" label="No bank account on file" testId="wireout-row-{id}-no-bank-account" />`.
   - New `SettleDestination({ row })` after `WireOutSummary` in the settle dialog: the
     `CardTitle`-free subheading "Destination bank account" (15px body, `INK_MUTED`) plus the three
     branches from Scope §3. The warning copy is a `const` in `lib/wireOut.ts`
     (`NO_BANK_ACCOUNT_COPY`, `UNRESOLVED_LENDER_BANK_COPY`).
7. [x] **LP detail** `packages/trustee/src/routes/lp-counterparties.$id.tsx`.
   - Insert `<DetailCard className="gap-[8px] p-[26px]" ariaLabel="Settlement bank account" testId="lp-bank-account">`
     with `<CardTitle>Settlement bank account</CardTitle>` and either `BankAccountRows`
     (`testIdPrefix="lp-bank-account"`) or the empty paragraph.
   - Pass `bankAccount={lp.settlement_bank_account_details ?? null}` to `LpReviewDialog`.
   - Check that `DetailCard` accepts `testId` (it does for `lp-detail-error`).
8. [x] **Review dialog** `packages/trustee/src/routes/-LpReviewDialog.tsx`.
   - Add the optional `bankAccount` prop.
   - When `action.documentId === undefined`, render a bordered block (`LINE_COLOR` top rule) after
     the description: the "Settlement bank account" label, then `BankAccountRows`
     (`testIdPrefix="lp-review-bank"`) plus, on `Passed`, the verification line; or the empty line.
9. [x] **Lint and build** (from the repo root, unless noted):
   - `cd packages/trustee && npx vitest run`
   - `yarn workspace @pipeline/trustee build` (no new route, so no routeTree regeneration)
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`
   - the repo's eslint / prettier for the trustee package

## Test Strategy

Vitest, run from inside `packages/trustee`, with React Testing Library and the existing fixtures. All
tests are pure and mock `fetch` / hooks as the neighbouring tests do. No network.

- **New `src/lib/-settlementBankAccount.test.ts`**
  - The row order and labels.
  - Null optional fields give `value: null`.
  - `copyable` holds exactly for the four identifier fields, and only when non-null.
  - Values pass through verbatim (a served IBAN with odd casing or spacing is unchanged).
  - `wireOutBankAccountState`: `not-pending` for Settled and Cancelled (even if `bank_account` were
    present), `unresolved` without `lp_id`, `served` with `bank_account`, `missing` with `lp_id` and
    no `bank_account` (both absent key and `null`).
- **New `src/components/detail/-BankAccountRows.test.tsx`**
  - Renders seven rows; `—` for nulls.
  - A copy button exists only for non-null identifiers.
  - A click writes the exact value to the mocked `navigator.clipboard` (pattern from
    `-AddressChip.test.tsx`) and calls `showToast("IBAN copied")` (provider wrapper or mocked
    `useToast`).
  - A rejected clipboard raises no toast.
  - Neither the toast text nor any attribute in the rendered DOM contains the value (scan
    `container.innerHTML` attributes for the IBAN string outside text nodes).
- **`src/routes/-wire-outs.test.tsx`**
  - Rows carry `bankAccount` / `bankAccountState` from served data.
  - `toggleBankAccount` flips `isBankAccountOpen`.
- **`src/routes/-WireOutsSection.test.tsx`**
  - Pending + account: the toggle shows and hides `wireout-row-{id}-bank` with every field, and
    `aria-expanded` follows.
  - Pending + resolved LP + no account: the `wireout-row-{id}-no-bank-account` chip shows, and the
    settle dialog shows `—` plus `wireout-settle-no-bank-account`. Settle is still enabled when the
    other gates pass.
  - Pending + unresolved LP: no chip, no toggle; the dialog shows `—` plus the unresolved hint.
  - Settled and Cancelled rows show neither a toggle nor a chip.
  - The settle dialog with an account renders `wireout-settle-bank-*` values and copy buttons.
  - Replace the existing "destination placeholder" assertion (line ~428).
  - Spy `console.log` / `console.error` / `console.warn` across a full render plus copy, and assert
    that no call argument contains the IBAN or account number.
- **`src/routes/-lp-counterparties.$id.test.tsx`**
  - The card renders with the details (verbatim values, `—` for nulls, copy buttons).
  - The empty state when `settlement_bank_account_details` is absent.
  - The `Passed` verdict dialog shows `lp-review-bank-*` and the verification line.
  - The `ChangesRequested` / `Failed` dialogs show the block without that line.
  - The document Verify dialog shows no bank block.
  - The empty line when there is no account.
- **Manual (user-stories doc, staging, real API).**
  - The LP detail for an LP that saved an account through #1885: compare every field with the
    Network response; copy each identifier.
  - An LP without one: the empty state.
  - The review dialog on an UnderReview LP.
  - Wire-out stories run once a testnet wire-out exists.

## Docs to Update

1. **`docs/frontend/trustee-flows.md`**
   - **§Cash Management — Bank wire-outs.**
     - Data sourcing: `bank_account` on Pending, resolved rows, verbatim.
     - Table: the toggle and sub-row, and the "No bank account on file" chip.
     - Settle dialog: replace the "—" / "does not serve … yet (#1812)" sentence with the three
       destination branches. Settle is not blocked.
     - Testnet caveat: unchanged except the #1812 note.
   - **§LP Counterparties → Detail view.**
     - The new "Settlement bank account" card and its position.
     - The review dialog's bank block on LP verdicts.
     - Replace "Bank Info remains unavailable" with "the list's Bank Info column stays `—` (not
       served on `GET /v1/lps`, #1275)".
   - **New subsection `### Settlement bank account`** (anchor `#settlement-bank-account`, the target
     of the presenter's spec header), after §Settlement addresses:
     - the field order and labels (mirroring #1885)
     - verbatim / `—`
     - the copyable fields and the toast copy
     - the privacy rules (no logs, URLs, attributes or toasts carrying values; no analytics)
     - the four wire-out states
   - **§Shared detail primitives table:** add `BankAccountRows.tsx`, and add `CopyIcon` to the
     `DetailIcons.tsx` row.
2. **`docs/product-specs/kyb-lp-verification.md`** § Settlement Bank Account: add a
   **Trustee console.** paragraph beside **LP app.** It says the full account shows on the LP detail
   card, in the LP-verdict review dialogs and on Pending wire-outs (row disclosure and settle
   dialog), with a "no bank account on file" warning. It links
   `../frontend/trustee-flows.md#settlement-bank-account`.
3. **User stories:**
   - New `docs/user-stories/epic-1795/1886-trustee-settlement-bank-account.md`, in the 1764 doc's
     format: the LP detail with and without an account, the review dialog, copy-to-clipboard, the
     pending wire-out with an account / without / unresolved, and settled or cancelled rows showing
     nothing. It notes the testnet wire-out prerequisite.
   - Add a row to `docs/user-stories/index.md` under Epic #1795.
   - In `docs/user-stories/epic-1795/1764-trustee-wire-outs.md`, replace the prerequisite line "The
     lender's bank account is not served by the API yet (#1812)…" with a pointer to the 1886 doc.
4. No change to `docs/product-specs/trustee-dashboard.md`, `minter-cash-book.md` or `withdrawals.md`.
   They already describe the served fields.
