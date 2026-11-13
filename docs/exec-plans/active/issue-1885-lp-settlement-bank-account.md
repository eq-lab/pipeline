# Issue #1885: LP: settlement bank account — capture in KYB / Account, masked view, gate bank wire-outs on it

Source: https://github.com/eq-lab/pipeline/issues/1885

Frontend flow, sub-issue of epic #1795. Branch `feat/1885-lp-settlement-bank-account` (draft PR #1916), based on
`main`. The backend half is merged (#1812, PR #1882; archived plan
`docs/exec-plans/completed/issue-1812-lp-settlement-bank-account.md`). The backend user stories are in
`docs/user-stories/epic-1795/1812-lp-settlement-bank-account.md`.

Behaviour sources, in precedence order:

1. `docs/user-docs/lenders/onboarding.md` line 14 ("a bank account for a USD wire") and `withdraw.md` §bank wire.
2. `docs/product-specs/kyb-lp-verification.md` §Settlement Bank Account (155 lines; the lint warns above 150 and fails
   above 200).
3. The API. In `packages/api/src/routes/lps.rs`: `UpsertProfile.settlement_bank_account`,
   `SettlementBankAccountSummary`, `bank_account_views`, and the 400 `settlement_bank_account.{field}: {reason}`. In
   `packages/shared/src/bank_account.rs`: `normalize` and the reason strings.

## Scope

### In this PR: capture and masked view, on the KYB modal and the Account page

- **API client** (`packages/frontend/src/api/lps.ts`):
  - Type the served masked summary on `LpResponse`.
  - Let `upsertMyLp` send an optional `settlement_bank_account` object.
  - A call that does not pass it sends no key, which means "unchanged".
- **Pure helpers and a shared draft hook**, used by both surfaces:
  - the field list and labels
  - payload building
  - parsing the 400 into a field error, and the error copy
  - the masked detail line
- **A shared `SettlementBankAccountSection`** in the profile card of both surfaces, below the settlement-address rows:
  - **Masked view.** Holder name, then bank name and "ending 1234".
  - **Add / Replace.** While the record is open (`writable`), an inline form with seven inputs. Replace always opens
    with empty inputs, and the masked current value stays visible above them.
  - **Frozen.** At `UnderReview`, `Passed` and `Failed` the section is read-only, with no inputs or buttons.
- **Account page** (`useAccountPage` + `AccountProfileCard`):
  - The bank draft is saved through the existing **Save profile** (one `POST /v1/lps/me`).
  - An open, non-blank bank draft counts as unsaved, so it blocks uploading and Submit for review, like a Name or
    Country draft.
- **KYB modal** (`CompanyDocsModal`):
  - A non-blank bank draft goes in the upsert that Submit already makes before uploading and submitting.
  - A 400 on a bank field stops before any upload.
- **400 handling.** A `settlement_bank_account.<field>: …` message becomes that field's inline `TextField` error. No
  generic alert is shown for it. The draft is kept.
- **Unchanged calls.** The Notify-me resend in `AuthFlowProvider` and the LP-creating upsert in
  `useAccountPage.saveDocuments` keep omitting the key, which means "unchanged". Tests assert it.
- **Docs.** `docs/frontend/account-page.md`, `docs/frontend/auth-components.md#companydocsmodal`, a short "LP app"
  paragraph in the product spec, and a new user-stories doc
  `docs/user-stories/epic-1795/1885-lp-settlement-bank-account-ui.md`.

### Out of scope

- **Bank tab wire-out gating (#1757).** Decided by the manager: #1757 lives only on `epic/1795-lp-ui` (draft PR #1804),
  which is 60 commits behind `main` and has conflicts. It is specified below under
  [Follow-up](#follow-up-bank-tab-gating-sub-issue-blocked-on-1757), to be filed as a sub-issue blocked on #1757.
- **Removing an account.** The API has no "clear": `null` means unchanged. The UI offers Replace, never Remove.
- **Changing the account after `Passed`.** Ops only (TD-182). The UI says "contact support".
- **Client-side validation.** The server is authoritative: no IBAN, BIC or ABA checks, no `maxLength`, no
  required-field gating in the browser.
- **Trustee surfaces** (LP detail `settlement_bank_account_details`, the cash-book `bank_account`). These are separate
  follow-ups from #1812.
- **The `/test?tab=auth` preview of the modal.** The section is hidden when `lp === undefined`, the same as the
  settlement-address rows. The Account page `?state=` fixtures are also out of scope.

## Assumptions and Risks

- **Design: no frame exists.**
  - `docs/frontend/account-page.md` and `auth-components.md` record no bank-account node.
  - The Issue links no Figma.
  - Epic #1795 says "No dedicated Figma frames for #1757, #1758, #1759 … Other issues reuse existing frames where the
    Issue links them".
  - The plan builds the section from the shipped parts (`AccountListRow variant="plain"`, `TextField` with the
    `[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]` class, `Button size="compact"`, LP tokens),
    following the #1849 "Different address" inline form.
  - #1885 is not on the per-Issue build-from-theme exception list (#1757/#1758/#1759, #1817, #1825, #1849). See Open
    Questions.
- **PII hygiene in the client.**
  - The draft lives only in React state: no `localStorage`, `sessionStorage` or URL.
  - It is cleared on a successful save, on Cancel, on a session-token change and on an LP identity change.
  - Inputs use `autoComplete="off"` and `spellCheck={false}`.
  - No `console.*` call touches the draft.
  - The error message never contains the value (the server guarantees this), and the client only adds a label.
- **Freeze race.** A trustee may freeze the record between the read and the save. The server then answers 409. The
  existing 409 path (generic message + `refresh`) handles it: the refreshed LP has `writable: false`, so the section
  becomes read-only. Clear the draft on 409 as well.
- **`account_last4` can be `null`** when the identifier has 4 characters or fewer. The detail line then shows only the
  bank name. It never invents a mask.
- **The KYB modal cannot save a bank account on its own.** Submit is enabled only with staged files or an eligible
  persisted set. A `ChangesRequested` LP with an unreplaced Rejected document and no staged file therefore cannot save a
  bank draft from the modal. The Account page's Save profile covers that case. This is accepted, not a bug, and is
  documented in `auth-components.md`.
- **Fixture churn.** `LpResponse.settlement_bank_account` is typed as required (`… | null`), because the server always
  serves it to the owner. The fixtures that build an `LpResponse` gain `settlement_bank_account: null`:
  - `CompanyDocsModal.test.tsx`
  - `useAccountPage.test.tsx`
  - `settlementAddress.test.ts`
  - `useSettlementAddressLink.test.tsx`
  - `AuthFlowProvider.setup.test.tsx`
  - `routes/-account.test.tsx`
  - any other fixture `tsc` reports
- **Lint.**
  - Every new file gets exactly one 2–3-line `// spec:` header and no other comments.
  - Run `npx tsx scripts/lint-comments.ts`, and shrink `scripts/lint-comments.baseline.json` if a touched file is
    listed.
  - Run `npx tsx scripts/lint-docs.ts`. The product spec must stay at 200 lines or fewer.
- **No dependency** on unmerged work for this PR. The follow-up depends on #1757 reaching `main`.

## Open Questions

1. **Design for the bank-account block.** No Figma frame exists for it on the KYB modal or the Account page, and #1885
   is not on the per-Issue "build from the LP theme" exception list (#1757/#1758/#1759, #1817, #1825, #1849). Choose
   one:
   - **(a)** Extend the exception to #1885. The plan is written for this: it builds from the shipped Account rows,
     `TextField` and the #1849 inline-form pattern.
   - **(b)** Park with `needs-figma`. Frames needed:
     - the masked row (present / none)
     - the Add/Replace inline form (empty, field error)
     - the frozen captions
     - each of these on both the Account profile card and the "Finish account setup" modal

## Implementation Steps

1. **API types and client** (`packages/frontend/src/api/lps.ts`; re-export from `src/api/index.ts` if that file lists
   types explicitly):
   - `export interface SettlementBankAccountSummary { account_holder_name: string; bank_name: string; account_last4: string | null; }`
   - `export interface SettlementBankAccountInput { account_holder_name: string; bank_name: string; bank_address: string | null; account_number: string | null; iban: string | null; swift_bic_code: string | null; routing_number: string | null; }`
   - `LpResponse.settlement_bank_account: SettlementBankAccountSummary | null`.
   - The `upsertMyLp` profile param gains `settlement_bank_account?: SettlementBankAccountInput`. The body is
     `JSON.stringify(profile)` unchanged, so an omitted property sends no key.

2. **Pure helpers**: `packages/frontend/src/components/account/settlementBankAccount.ts`.
   - Header: `// spec: docs/frontend/account-page.md#settlement-bank-account-1885`.
   - `BANK_FIELDS` is an ordered tuple of the seven API keys, in form order:
     1. `account_holder_name`
     2. `bank_name`
     3. `bank_address`
     4. `iban`
     5. `account_number`
     6. `swift_bic_code`
     7. `routing_number`

     `type BankField = (typeof BANK_FIELDS)[number]`.
   - `BANK_FIELD_LABELS: Record<BankField, string>`:

     | Field | Label |
     | --- | --- |
     | `account_holder_name` | `Account holder name` |
     | `bank_name` | `Bank name` |
     | `bank_address` | `Bank address (optional)` |
     | `iban` | `IBAN` |
     | `account_number` | `Account number` |
     | `swift_bic_code` | `SWIFT/BIC code` |
     | `routing_number` | `Routing number (ABA)` |

   - `type BankDraft = Record<BankField, string>`, and `EMPTY_BANK_DRAFT`.
   - `bankDraftDirty(draft)`: some field has a non-blank trimmed value.
   - `bankDraftPayload(draft): SettlementBankAccountInput`: each value trimmed. A blank `bank_address`,
     `account_number`, `iban`, `swift_bic_code` or `routing_number` becomes `null`. A blank holder or bank name is sent
     as `""`, so the server answers `… is required`.
   - `parseBankAccountError(error: unknown): { field: BankField; message: string } | null`:
     - Match only `ApiError` with status 400 and a message matching `/^settlement_bank_account\.([a-z_]+): (.+)$/`,
       where the captured field is in `BANK_FIELDS`. Anything else returns `null`.
     - `message` comes from a copy table keyed by the server reason. These are the reasons in `bank_account.rs`:

       | Server reason | Field it arrives on | Inline copy |
       | --- | --- | --- |
       | `is required` | holder, bank | `{Label} is required.` |
       | `is too long` | holder, bank | `{Label} is too long (140 characters max).` |
       | `is too long` | address | `Bank address is too long (280 characters max).` |
       | `is not a valid IBAN` | iban | `Enter a valid IBAN.` |
       | `is not a valid account number` | account_number | `Enter a valid account number (letters and digits only).` |
       | `is not a valid SWIFT/BIC code` | swift_bic_code | `Enter a valid SWIFT/BIC code (8 or 11 characters).` |
       | `is not a valid routing number` | routing_number | `Enter a valid 9-digit ABA routing number.` |
       | `or iban is required` | account_number | `Enter an IBAN or an account number.` |
       | `or routing_number is required` | swift_bic_code | `Enter a SWIFT/BIC code or a routing number.` |

     - The `{Label}` used here drops " (optional)" and " (ABA)".
     - An unknown reason on a known field falls back to `{Label} {reason}`, never the raw `error.message`.
   - `bankAccountDetail(summary): string`: `` `${bank_name} · ending ${account_last4}` ``, or `bank_name` when
     `account_last4` is `null`. Served strings are used verbatim.

3. **Draft hook**: `packages/frontend/src/components/account/useSettlementBankAccountDraft.ts`.
   - Returns:
     - `open`, `draft`, `errors: Partial<Record<BankField, string>>`, `dirty` (= `open && bankDraftDirty(draft)`)
     - `openForm()`, `cancel()` (clears the draft and errors, closes)
     - `setField(field, value)`, which clears that field's error. It also clears the paired error: editing `iban`
       clears an `account_number` "or" error, and editing `routing_number` clears a `swift_bic_code` "or" error.
     - `payload()` → `bankDraftPayload(draft)`, or `undefined` when not `dirty`
     - `applyError(error): boolean`: true when `parseBankAccountError` matched. It sets the field error and keeps the
       draft and `open`.
     - `reset()`: same as `cancel`.
   - It holds no other state. Callers own when to reset.

4. **Section component**: `packages/frontend/src/components/account/SettlementBankAccountSection.tsx`.
   - Header: `// spec: docs/frontend/account-page.md#settlement-bank-account-1885`.
   - Props:
     - `account: SettlementBankAccountSummary | null`
     - `kybStatus: string | undefined`
     - `writable: boolean`
     - `disabled: boolean`
     - `controls: ReturnType<typeof useSettlementBankAccountDraft>`
     - `testIdPrefix?: string`
   - Use `useId()` for input ids, because both surfaces can be mounted together.
   - **Masked row.** `AccountListRow variant="plain"`, `leading={null}` (as `SettlementAddressRow` does), caption
     `Settlement bank account`.
     - The title is `account.account_holder_name`, or `Not added` when `account` is `null`.
     - When `account` is present, a body-s detail line `bankAccountDetail(account)` follows in
       `--color-pipeline-ink-muted` (testid `settlement-bank-detail`), styled like the `Signer` line in
       `SettlementAddressRow`.
     - Testid on the row: `settlement-bank-row`.
   - **Caption under the row** (body-s, `--color-pipeline-ink-subtle`, testid `settlement-bank-caption`):

     | Condition | Caption |
     | --- | --- |
     | `writable` and `account` is `null` | `Optional. Needed only to withdraw to a bank account by wire.` |
     | `kybStatus === "UnderReview"` | `Locked while your account is under review.` |
     | `kybStatus === "Passed"` and `account` is `null` | `To add a bank account, contact support.` |
     | `kybStatus === "Passed"` and `account` is present | `To change it, contact support.` |
     | `writable` and `account` is present, or `Failed` | none |

   - **Trailing button.** Only when `writable` and the form is closed: `Button variant="secondary" size="compact"`
     labelled `Add` when `account` is `null`, `Replace` otherwise. It is disabled when `disabled`. Testid
     `settlement-bank-open`. It calls `controls.openForm()`.
   - **Form** (when `writable && controls.open`; a `<div>`, not a nested `<form>`, because the modal and card already
     own their submit buttons; testid `settlement-bank-form`):
     - Seven `<label htmlFor>` + `TextField` pairs, in `BANK_FIELDS` order.
       - Each input: `value`, `onChange` → `setField`, `invalid` and `error` from `controls.errors[field]`,
         `autoComplete="off"`, `spellCheck={false}`, `disabled`.
       - The first input is focused on open.
     - Body-s helper captions (`--color-pipeline-ink-subtle`): `Enter an IBAN, an account number, or both.` after
       `account_number`, and `Enter a SWIFT/BIC code, a routing number, or both.` after `routing_number`.
     - When `account` is present (a replace), a body-s line `Replacing {bankAccountDetail(account)}. Enter the full
       account again.` sits above the inputs. The masked row also stays visible above the form.
     - A `Cancel` button (`secondary`, `size="compact"`, testid `settlement-bank-cancel`) calls `controls.cancel()`.
     - There is no separate save button in the form. Saving goes through the surface's own button (steps 5 and 6).
   - **Frozen** (`!writable`): only the row and the caption. Hide the form even if `open` is still set from before a
     refresh.

5. **Account page.**
   - **`useAccountPage.ts`:**
     - Own `const bank = useSettlementBankAccountDraft()`. Call `bank.reset()` in the session/identity reset effect,
       and when `adopt` sees a new identity.
     - `canSaveProfile = canWrite && legalName.trim().length > 0 && (readState === "absent" || profileChanged || bank.dirty)`.
     - `canUpload` and `canSubmitForReview` also require `!bank.dirty`.
     - `saveProfile`:
       - Build the body and add `settlement_bank_account: bank.payload()` only when `bank.dirty`. Do not add the key at
         all otherwise; do not send `undefined`.
       - On success: `bank.reset()`, then the existing adopt and baseline code.
       - On error: `if (bank.applyError(error)) return;` before `setActionError`, so no generic alert. On 409: also
         `bank.reset()`, then the existing refresh.
     - `saveDocuments`'s LP-creating upsert stays without the key.
     - Return `bank` and `bankAccount: lp?.settlement_bank_account ?? null`.
   - **`AccountProfileCard.tsx`:**
     - Add an optional prop `bank?: { account; kybStatus; controls }`.
     - Render `<SettlementBankAccountSection …>` after the settlement rows and before the Save button, with
       `writable={writable}` and `disabled={disabled}`.
     - The Save button label stays `Save profile`.
   - **`AccountPage.tsx`:**
     - Pass `bank` only when `account.readState` is `loaded` or `absent`. With `absent`, `account` is `null` and
       `writable` is true, so the LP can add an account while creating the LP. Save profile then creates the LP with it.

6. **KYB modal** (`packages/frontend/src/components/CompanyDocsModal.tsx`).
   - `const bank = useSettlementBankAccountDraft()`. Call `bank.reset()` in the existing `lp` identity-change branch of
     the `useEffect`.
   - In `submit()`:
     - The upsert condition becomes `!saved || profileChanged || bank.dirty || files.length > 0`.
     - Spread `...(bank.dirty ? { settlement_bank_account: bank.payload() } : {})` into the upsert.
     - On success: `bank.reset()`.
     - In the outer `catch`: `if (bank.applyError(requestError)) return;` before `setError`. On a 409 from the upsert:
       `bank.reset()`.
     - The `finally` still clears `busy`.
   - Render `<SettlementBankAccountSection>` inside the first surface card, after `SettlementAddressRows`, only when
     `!preview`:
     - `account={serverLp?.settlement_bank_account ?? null}`
     - `kybStatus={serverLp?.kyb_status}`
     - `writable={writable}`
     - `disabled={!writable || busy}`
     - `testIdPrefix="company-docs"` if ids would otherwise collide in tests
   - `canSubmit` is unchanged.

7. **AuthFlowProvider.** No code change. Add a regression test (step 8) that the Notify-me body has no
   `settlement_bank_account` key.

8. **Tests** (see Test Strategy), then from `packages/frontend`:
   - `npx vitest run`
   - `npx tsc --noEmit` (or `yarn build`)

   Then from the repo root:
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`
   - the repo's eslint/prettier for the touched files

9. **Docs** (see Docs to Update).

## Test Strategy

Use vitest from inside `packages/frontend`, with real component rendering and mocked `@/api` functions, following the
existing test files' patterns.

- **`settlementBankAccount.test.ts`** (new, pure):
  - `bankDraftDirty`: whitespace counts as blank.
  - `bankDraftPayload`: trims; blank optionals become `null`; blank required fields become `""`.
  - `parseBankAccountError`, for every reason row in the table:
    - field mapping and copy
    - fallback for an unknown reason
    - `null` for non-400, a non-`ApiError`, a field not in `BANK_FIELDS`, and a plain `legal_name …` 400
  - `bankAccountDetail`: with and without `account_last4`.
- **`SettlementBankAccountSection.test.tsx`** (new):
  - Rendering:
    - null and writable → `Not added`, the optional caption and `Add`
    - present and writable → holder title, `Bank · ending 5432` and `Replace`
    - `account_last4: null` → the bank name only
  - Replace:
    - opens seven empty inputs
    - shows the `Replacing …` line
    - keeps the masked row
  - `Cancel` clears the inputs and closes.
  - Frozen:
    - `UnderReview` → locked caption, no buttons and no inputs
    - `Passed` + null and `Passed` + present → the two support captions
    - `Failed` → no caption
  - The field error renders on the right input (`aria-invalid`), and typing clears it.
- **`useAccountPage.test.tsx`** (extend):
  - Saving with a dirty draft sends `settlement_bank_account` with the trimmed and nulled payload, then resets the draft.
  - Saving with no draft, or with an open but blank form, sends no `settlement_bank_account` key: assert
    `"settlement_bank_account" in body === false`.
  - A 400 `settlement_bank_account.iban: is not a valid IBAN` sets `bank.errors.iban`, leaves `actionError` undefined
    and keeps the draft.
  - A 409 clears the draft and refreshes.
  - A dirty draft disables `canUpload` and `canSubmitForReview`, and enables `canSaveProfile` without a
    profile change.
  - A token change resets the draft.
  - The LP-creating upsert in `saveDocuments` has no key.
- **`AccountProfileCard.test.tsx` / `AccountPage.test.tsx`** (extend): the section renders between the settlement rows
  and Save profile, and is read-only when `writable` is false.
- **`CompanyDocsModal.test.tsx`** (extend):
  - An existing eligible LP with no files and a dirty draft: Submit calls `upsertMyLp` with the key, then submits.
  - New LP with a draft plus a file: the key is in the creating upsert, before the upload.
  - A 400 bank error: no upload or submit call, an inline field error, no generic alert, and the staged files are kept.
  - No draft: the upsert body has no key.
  - Frozen LP: read-only row.
  - Preview (`lp` undefined): no section.
- **`AuthFlowProvider.setup.test.tsx`** (extend): the Notify-me upsert body has no `settlement_bank_account` key.
- **Fixtures**: add `settlement_bank_account: null` wherever `tsc` flags an `LpResponse` literal.
- **Manual / QA** (user-stories doc): staging with a real session.
  - Network tab: a `POST /v1/lps/me` body carries the object only on a bank save, and the response's masked object
    renders verbatim.

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md` §Settlement Bank Account.**
  - Add one paragraph after **Reads.** (≤3 lines; the file must stay ≤200, now 155):
    > **LP app.** The KYB modal and the Account page profile card show the masked account and, while the record is
    > open, an Add / Replace form that always starts empty. It is sent only on the save that carries it, and a 400
    > names the field inline. Frozen records show it read-only, with "contact support" once `Passed` (TD-182).
  - Spec pointer for the frontend detail: `docs/frontend/account-page.md#settlement-bank-account-1885`.
- **`docs/frontend/account-page.md`.**
  - New section `## Settlement bank account (#1885)` after `## Settlement address`. It covers:
    - the behaviour sources and the no-frame note (with the Open Question's outcome)
    - row, caption and button rules (the step 4 tables, verbatim copy)
    - the form fields, labels and helper captions
    - the save path through Save profile and the unsaved-draft gate on upload/submit
    - the 400 copy table
    - the PII rules (state only; cleared on save, cancel, token or identity change; `autoComplete="off"`)
    - no Remove
  - Update `## Page composition` so `AccountProfileCard` lists "… settlement address rows, settlement bank account".
  - Add the copy to `## Verbatim copy`.
- **`docs/frontend/auth-components.md#companydocsmodal`.** One paragraph:
  - The section sits in the first card after the settlement rows.
  - A dirty draft is sent in Submit's pre-upload upsert, and a field 400 stops before the upload.
  - It is hidden in the preview.
  - The modal cannot save a bank account without a submittable set; the Account page covers that case.
- **`docs/user-stories/epic-1795/1885-lp-settlement-bank-account-ui.md`** (new; same header format as `1760-…`). Stories:
  1. A `NotStarted` LP adds an account on the Account page and sees `Holder` / `Bank · ending 5432`.
  2. An invalid IBAN shows the inline error, and the Network response has no value echoed.
  3. Add during Finish account setup, submitted with the documents.
  4. `UnderReview` / `Passed` are read-only, with the captions.
  5. `ChangesRequested` → Replace shows empty inputs plus the masked current value, and saves.
  6. Notify me and profile-only saves leave the account unchanged (Network: no key).
- **`docs/frontend/index.md`.** No change unless it lists sections.
- **Tech debt.** None new; TD-182 already covers the post-`Passed` change path.

## Follow-up: Bank tab gating (sub-issue blocked on #1757)

File as a frontend sub-issue of #1795 titled "LP Bank tab: show the settlement bank account as the wire-out destination
and gate the request on it". It is blocked on #1757 reaching `main` (today it is only on `epic/1795-lp-ui`, PR #1804).
It depends on this PR for `LpResponse.settlement_bank_account` and `bankAccountDetail`.

Code on `epic/1795-lp-ui` that it amends:

- `packages/frontend/src/components/withdraw/BankWithdrawTab.tsx`
- `useWireOutFlow.ts`: `useWireOutGate`, `WIRE_OUT_KYB_REASON`
- `useWireOutList.ts`: `useKybPassed`
- `WireOutInfoCard.tsx`
- spec `docs/frontend/bank-transfers.md#wire-out`, `docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app`

1. **Source.** Expose the LP's `settlement_bank_account` (and `writable`) from `AuthFlowContext`, next to `lpRead` and
   `kybStatus`. Add a `useSettlementBankAccount()` hook beside `useKybPassed()` that returns
   `{ account: SettlementBankAccountSummary | null, writable: boolean }`. Use only the served values; derive nothing.
2. **Destination.**
   - When `account` is present, the `ConversionCard` output `tokenLabel` becomes
     `` `USD to the account ending ${account_last4}` ``.
   - When `account_last4` is `null`: `` `USD to ${account_holder_name}, ${bank_name}` ``.
   - The info block (`WireOutInfoCard`) gains a body-s line `Paid to {account_holder_name}, {bankAccountDetail(account)}`
     (testid `wire-out-destination`).
   - With no account, `tokenLabel` stays `USD to your bank account`.
3. **Gate.** `useWireOutGate` takes `bankAccount: SettlementBankAccountSummary | null` and `lpWritable: boolean`.
   - Order:
     1. unavailable
     2. KYB not passed
     3. **no bank account**
     4. paused
     5. not authorised
   - Reasons:
     - **KYB not passed, account `null`, `lpWritable`:**
       `Complete KYB and add a bank account on the Account page to withdraw to a bank account.` It replaces
       `WIRE_OUT_KYB_REASON` in that case only, and adds a link to `/account`.
     - **`Passed` with account `null`** (the record is frozen, so changes are ops-only, TD-182): the new
       `WIRE_OUT_NO_BANK_ACCOUNT_REASON = "Contact support to add a bank account for wire-outs."`.
   - The reason feeds the existing `hint`, and `disabled` stays true. The approve and request steps stay disabled, so
     the request is never sent.
4. **Tests.**
   - `useWireOutFlow.test.tsx`: the gate order, both new reasons, and enabled once an account is present.
   - `BankWithdrawTab.test.tsx`: destination label with and without last4, the info line, and the disabled request with
     the support hint at `Passed` + `null`.
5. **Docs.**
   - `bank-transfers.md#wire-out`: destination plus gate rows.
   - `withdrawals.md`: one line.
   - Story 7 appended to `docs/user-stories/epic-1795/1885-lp-settlement-bank-account-ui.md`, or a new doc for the
     sub-issue: "Bank tab shows the destination and blocks the request without an account".
