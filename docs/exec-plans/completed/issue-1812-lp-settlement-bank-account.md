# Issue #1812: Backend: capture and serve the LP's settlement bank account for bank wire-outs (KYB file → API, Trustee settle view)

Source: https://github.com/eq-lab/pipeline/issues/1812

Backend flow. Filed from #1757 (LP wire-out request; decision 2026-10-30: "a passed KYB is taken as
proof of a verified bank account") and for #1764 (Trustee settle / cancel, merged into
`feat/1763-trustee-escrowed-wires`, PR #1875). No Figma link: backend only. The issue has no parent
epic. Its siblings #1757 and #1764 sit under epic #1795, so the user-stories doc goes to
`docs/user-stories/epic-1795/`. The manager should attach #1812 to #1795, or name another epic.

## Scope

### What changes

1. **Storage.** A new nullable JSONB column `lps.settlement_bank_account` holds one USD settlement
   bank account per LP. Its shape is enforced by a CHECK constraint, like `system_configuration`.
2. **Capture: inline on the existing KYB profile upsert.** No new route. `POST /v1/lps/me` gets an
   optional `settlement_bank_account` object. It is validated and normalized server-side.
   - It counts as part of the KYB record. It can be written only while
     `KybStatus::allows_owner_writes()` (`NotStarted` / `InProgress` / `ChangesRequested`), and it is
     frozen at `UnderReview` / `Passed` / `Failed`.
   - The Trustee therefore reviews it together with the documents. Passing KYB is what "verifies" it
     (decision 2026-10-30).
   - Absent or `null` means *do not change*, like `notify_on_review`. The owner only ever reads a
     masked view, so it cannot resend the full value on every profile save.
3. **Read: LP owner, masked.** `LpResponse` gets `settlement_bank_account: { account_holder_name,
   bank_name, account_last4 } | null`. It appears on every owner response that returns an
   `LpResponse`:
   - `GET /v1/lps/me` and `POST /v1/lps/me`
   - `POST /v1/lps/me/documents` (inside `lp`)
   - `POST /v1/lps/me/submit`
   - `POST /v1/lps/me/link-address/verify`

   This feeds the LP Bank tab line "to the account ending 1234".
4. **Read: Trustee, in full.**
   - **Trustee LP detail.** `GET /v1/lps/{id}` and the `POST /v1/lps/{id}/kyb` response carry the
     masked summary plus `settlement_bank_account_details` (every field). The reviewer checks it
     against the uploaded bank letter. The owner never receives `settlement_bank_account_details`:
     the key is omitted, not `null`.
   - **Trustee cash book.** `GET /v1/cash-book` `wire_outs[]` items with `status = "Pending"` and a
     resolved `lp_id` carry `bank_account` (full details) of that LP. This is the list the Trustee
     console's wire-out settle page (#1764, `useWireOuts` → `/v1/cash-book`) already reads. The
     destination is therefore on the row the Trustee settles from, with no new endpoint
     (minimal-surface preference). Settled and cancelled rows, and rows with no resolved LP, never
     carry it.
5. **Validation and normalization** live in a pure module, `shared::bank_account`. It also does the
   masking and a redacting `Debug` impl.
6. **Specs, user-stories doc, tech-debt entry** (see Docs to Update).

### Settled design decisions (planner; revisit only if the user overrides)

- **D1. Inline on `POST /v1/lps/me`, not a new route.** Follows the user preference (consolidated
  `/me` upserts, inline child data). The issue names no method or path for capture ("KYB /
  onboarding flow or an account-settings endpoint").
- **D2. Frozen with the KYB profile.** The issue says "fixed once passed; a change is a Trustee/KYB
  action, not a self-service edit". It also says this mirrors the settlement address. That analogy is
  out of date: since #1831 (2026-11-02) settlement addresses are relinkable at any status except
  `Failed`, including `Passed`. The plan follows the explicit rule ("fixed once passed"), not the
  analogy. Q1 covers the post-`Passed` change path.
- **D3. Trustee destination on the cash-book row and the LP detail.** The issue offered
  `GET /v1/wire-outs/{id}` or audit-log enrichment as examples. Instead, the destination goes on:
  - the cash-book `wire_outs[]` row (the console's settle list), and
  - `GET /v1/lps/{id}` (the console's LP detail; also the only Trustee read for EVM wire-outs, since
    the cash book is Stellar-only and answers `404 minter_not_configured` on EVM).

  `GET /v1/audit-log` and `GET /v1/requests` are **public** (no auth). They must never carry bank
  data.
- **D4. Full details on `Pending` cash-book rows only.**
  - Settle needs the destination. A finished row does not.
  - The stored account is the LP's *current* one, which is not necessarily where an old wire went.
  - Showing it on history rows would read as a record of the payee. It is not one.
- **D5. Two fields on `LpResponse`, chosen by audience.** The masked summary goes to both audiences.
  The full details go to the trustee only, with `skip_serializing_if = "Option::is_none"`. A union
  (`oneOf`) in one field was rejected: it would make every client branch on shape. Masking inside the
  full schema was rejected because a masked IBAN string looks like data.
- **D6. Masking rule.** `account_last4` is the last 4 characters of the normalized IBAN when one is
  present, otherwise of the account number. It is `null` when that identifier has 4 characters or
  fewer, so a mask never reveals a whole identifier. Spaces are stripped and letters uppercased
  before taking the suffix.
- **D7. Optional at submit (pending Q2).** User docs (`lenders/onboarding.md` line 14) say "USDC …
  *or* a bank account for a USD wire". A USDC-only LP must still be able to pass KYB, so
  `submit_blockers` / `pass_blockers` do not require an account. The LP app gates the wire-out
  action on `settlement_bank_account != null` (frontend follow-up).
- **D8. No change history and no read audit in this issue.**
  - **Writes.** They happen only while the record is open for KYB correction. The Trustee then
    reviews the final value, the same way the profile has no history.
  - **Reads.** There is no read-audit infrastructure. KYB documents (which already contain bank
    letters) are served the same way, through presigned URLs with no read log.
  - **Storage.** Plaintext JSONB in Postgres, like `legal_name` / `contact_email`.
  - Logged as tech debt. Q5 asks whether the user wants stronger handling now.

### Out of scope

- Any frontend work. Follow-ups for the manager to file:
  1. LP KYB modal and Account page: capture the account (`POST /v1/lps/me` with
     `settlement_bank_account`) and show the masked summary.
  2. LP Bank tab / wire-out modal: "to the account ending 1234", and disable the request when no
     account is on file (amends #1757's gate).
  3. Trustee wire-out settle row: show `bank_account`.
  4. Trustee LP detail page: show `settlement_bank_account_details`.
- A post-`Passed` change path (Q1), backfill of LPs already `Passed` (Q1), a dedicated wire-out
  endpoint (D3), and multiple accounts per LP.
- Stellar / EVM contracts (frozen). The wire-out flow is untouched. `ref_hash` stays the Trustee's
  bank reference.
- Matching an LP's bank account to incoming wires (the `lp_requested_bank_details` reference is the
  matching key, #1815).

## Assumptions and Risks

- **Already-`Passed` LPs have no account and, under D2, no way to add one.** Their wire-outs show no
  destination until Q1 is answered (ops SQL, trustee action, or a reopen transition). The default is
  manual entry by ops. Before release, the manager should check staging and production for `Passed`
  LPs (`SELECT id FROM lps WHERE kyb_status = 'Passed'`).
- **PII leakage paths.**
  - `LpRow` derives `Debug` and is in scope of `tracing` calls. `SettlementBankAccount` therefore
    gets a manual `Debug` that redacts `account_number` / `iban` / `routing_number`.
  - Validation errors must name the field, never echo the value.
  - No handler may log the request body.
- **Freeze race.** The handler reads, then writes. A trustee may freeze the record in between, so
  the bank-account comparison must be inside the upsert's SQL `WHERE`, next to the profile
  comparison. A Rust-side check is not enough. This is the same rule `upsert_by_owner_account_id`
  already documents.
- **JSONB equality.** The frozen-but-unchanged path compares
  `lps.settlement_bank_account IS NOT DISTINCT FROM $9::jsonb`. Both sides must come from the same
  serializer (normalized struct, `Option` fields serialized as `null`, never skipped). If they do
  not, an identical resubmission reads as a change and returns 409. JSONB equality ignores key order,
  so only the null-versus-missing difference matters.
- **`sqlx::types::Json<T>` in `FromRow` structs.** The workspace sqlx has default features, so
  `json` is on (`collateral_valuation_repo.rs` already uses `Json`). `StellarAddressHolder` derives
  `PartialEq, Eq`. `SettlementBankAccount` must derive `PartialEq, Eq` too. Check that
  `Json<T>: Eq` compiles, or compare through `.0` in tests.
- **Shared fixtures.** Adding a field to `LpRow` / `StellarAddressHolder` breaks the struct literals
  in `packages/api/tests/lp_settlement_address.rs`, `packages/shared/tests/settlement_address.rs`
  and `packages/api/tests/cash_book.rs`. Update them with `settlement_bank_account: None` (or a
  fixture).
- **Migration ordering.** The latest migration on `main` is
  `20261110000001_plusd_balance_seeds.sql`. Use `20261110000002_lps_settlement_bank_account.sql`.
  Re-check `main` and the open PRs (e.g. #1875) at implementation time, and bump the number if it is
  taken.
- **Tech-debt number.** The next free number on `main` is TD-178. Re-check at implementation time, in
  case a branch merged in between took it.
- **Dependency.** #1764's settle UI lives on `feat/1763-trustee-escrowed-wires` (PR #1875, not yet on
  `main`). This backend change does not depend on it. Adding a key to the cash-book row is
  backward-compatible.

## Open Questions

1. **Change after `Passed`, and LPs already `Passed`.**
   - Under D2 nothing in the API can change the account once KYB is `Passed`: `Passed` has no
     outgoing transition.
   - Which path should a change take?
     - (a) Manual ops SQL, with a TD entry. This is the plan's default, and it also covers backfilling
       LPs that passed before this feature.
     - (b) A trustee-only write, e.g. a `settlement_bank_account` body on a trustee LP route.
     - (c) A new trustee transition `Passed → ChangesRequested` that reopens the whole KYB record.
   - (The issue's "same path as the settlement address" no longer applies: addresses are relinkable
     at `Passed` since #1831.)
2. **Required for KYB?** Should submitting or passing KYB require a bank account? The plan's
   default is no, because a USDC-only LP needs none (D7). The other choice is that every `Passed` LP
   must have one.
3. **Field set.** The plan's default fields:
   - `account_holder_name` (required)
   - `bank_name` (required)
   - `bank_address` (optional)
   - `account_number` / `iban`: at least one required, IBAN mod-97 checked
   - `swift_bic_code` / `routing_number` (ABA, 9 digits): at least one required

   Confirm. Also say whether the Trustee needs anything more for a USD wire: an intermediary or
   correspondent bank, the beneficiary's address, or a currency other than USD.
4. **Owner view while the record is open.** The plan masks the account for the owner at every
   status, so correcting it during `ChangesRequested` means re-entering it in full. Should the owner
   see the full value while `writable = true` instead?
5. **PII handling.** Is plaintext JSONB with no change history and no read audit (D8 + TD) acceptable
   for now? Or should this issue already add any of these:
   - application-level encryption of the account number / IBAN
   - an append-only `lp_settlement_bank_account_history`
   - a log of Trustee reads

**Resolved by the user (2026-11-10)** — all plan defaults accepted:

1. (a) Manual ops SQL plus a TD entry for changes after `Passed` and for backfilling LPs that already
   passed; a trustee-only write (b) may follow as a separate issue.
2. Not required for KYB submit or pass.
3. Field set as listed; no intermediary bank, beneficiary address or non-USD currency for now.
4. Owner always sees the masked view; correcting during `ChangesRequested` means re-entering in full.
5. Plaintext JSONB, no history, no read audit for now — recorded as a TD entry. **TD number:** open PR
   #1875 takes TD-178–TD-181, so use the next free number on `main` at commit time (re-check the
   tracker's "Next free number" line).

#1812 is attached to epic #1795; the user-stories doc goes under `docs/user-stories/epic-1795/`.

## Implementation Steps

1. **Migration**: `packages/shared/migrations/20261110000002_lps_settlement_bank_account.sql`.
   - Header comment with the spec pointer (`docs/product-specs/kyb-lp-verification.md#settlement-bank-account`)
     and a `-- Rollback:` block (`ALTER TABLE lps DROP CONSTRAINT …; ALTER TABLE lps DROP COLUMN …;`),
     as in `20261102000001_system_configuration_lp_payment_details.sql`.
   - `ALTER TABLE lps ADD COLUMN settlement_bank_account JSONB;` (nullable, no default, no backfill).
   - `ADD CONSTRAINT lps_settlement_bank_account_shape_ck CHECK (settlement_bank_account IS NULL OR (
     jsonb_typeof(settlement_bank_account) = 'object'
     AND jsonb_typeof(settlement_bank_account->'account_holder_name') IS NOT DISTINCT FROM 'string'
     AND jsonb_typeof(settlement_bank_account->'bank_name') IS NOT DISTINCT FROM 'string'
     AND COALESCE(jsonb_typeof(settlement_bank_account->'bank_address'), 'missing') IN ('string','null')
     AND COALESCE(jsonb_typeof(settlement_bank_account->'account_number'), 'missing') IN ('string','null')
     AND COALESCE(jsonb_typeof(settlement_bank_account->'iban'), 'missing') IN ('string','null')
     AND COALESCE(jsonb_typeof(settlement_bank_account->'swift_bic_code'), 'missing') IN ('string','null')
     AND COALESCE(jsonb_typeof(settlement_bank_account->'routing_number'), 'missing') IN ('string','null')))`.
     Optional keys must be present, even as JSON `null`. A missing key makes `jsonb_typeof` return SQL
     `NULL`, and `NULL IN (…)` is `NULL`, which a CHECK passes. The `COALESCE(…, 'missing')` is what
     rejects a missing key.

2. **Pure domain module**: new `packages/shared/src/bank_account.rs`, registered in
   `packages/shared/src/lib.rs`. One-line spec-pointer header only (comment-less code rule).
   - `pub struct SettlementBankAccount { account_holder_name: String, bank_name: String,
     bank_address: Option<String>, account_number: Option<String>, iban: Option<String>,
     swift_bic_code: Option<String>, routing_number: Option<String> }`. It derives `Clone, PartialEq,
     Eq, Serialize, Deserialize`, with no `skip_serializing_if`, so `None` serializes as `null` (see
     the JSONB equality risk). It gets a **manual `Debug`** that prints `bank_name` and `"<redacted>"`
     for account_number / iban / routing_number.
   - `pub struct SettlementBankAccountInput` (the same seven fields, all `Option<String>`,
     `#[serde(deny_unknown_fields)]`) for the request body.
   - `pub fn normalize(input: &SettlementBankAccountInput) -> Result<SettlementBankAccount,
     BankAccountError>`. Its rules:
     - Trim every field. A blank optional field becomes `None`.
     - `account_holder_name`, `bank_name`: required, ≤ 140 characters (chars, not bytes, as in
       `validate_profile`). `bank_address`: ≤ 280 characters.
     - `iban`: remove spaces, uppercase, `^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`, ISO 13616 mod-97 == 1.
     - `account_number`: remove spaces and `-`, uppercase, `[A-Z0-9]{1,34}`.
     - At least one of `iban` / `account_number`.
     - `swift_bic_code`: uppercase, 8 or 11 characters, `[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?`.
     - `routing_number`: exactly 9 digits plus the ABA checksum
       (3·(d1+d4+d7) + 7·(d2+d5+d8) + (d3+d6+d9) ≡ 0 mod 10).
     - At least one of `swift_bic_code` / `routing_number`.

     Hand-rolled character checks. Do not add a `regex` dependency for this.
   - `BankAccountError` carries a field name and a reason, **never the value**. Implement `Display`.
   - `pub fn account_last4(account: &SettlementBankAccount) -> Option<String>` (D6).
   - Field sets, limits and checksums follow Q3's default. If the user changes Q3, only this module,
     the migration CHECK and the spec change.

3. **Repo** (`packages/shared/src/lp_repo.rs`):
   - `LpRow` gets `pub settlement_bank_account: Option<sqlx::types::Json<SettlementBankAccount>>`.
     Add the column to `COLUMNS`. `LpSummary` (`GET /v1/lps`) does **not** map it.
   - Extract the `upsert_by_owner_account_id` SQL into `pub const UPSERT_LP_BY_OWNER_SQL: &str` so a
     pure test can assert on it. Add bind `$9::jsonb` (the normalized account as
     `Option<Json<SettlementBankAccount>>`, or `None` for *unchanged*):
     - `INSERT … VALUES (…, $9::jsonb)`. Insert the column directly; `NULL` is the column default.
     - In `DO UPDATE SET`, add
       `settlement_bank_account = COALESCE($9::jsonb, lps.settlement_bank_account)`.
     - Extend the narrowed freeze in the `WHERE`:
       `OR (… profile IS NOT DISTINCT FROM … AND ($9::jsonb IS NULL OR lps.settlement_bank_account IS NOT DISTINCT FROM $9::jsonb))`.
     - Add a doc line to the function comment stating the same rule as `decide_upsert`.
   - `STELLAR_ADDRESS_HOLDERS_SQL`: also select `l.settlement_bank_account`.
     `StellarAddressHolder` gets `pub settlement_bank_account: Option<Json<SettlementBankAccount>>`.
     This avoids a second query in the cash book.

4. **API: request side** (`packages/api/src/routes/lps.rs`):
   - `UpsertLpRequest` gets `#[serde(default)] pub settlement_bank_account:
     Option<SettlementBankAccountInput>`, documented: absent or `null` = unchanged; frozen at
     `UnderReview` / `Passed` / `Failed`.
   - `ValidatedProfile` gets `pub bank_account: Option<SettlementBankAccount>` (owned).
     `validate_profile` calls `shared::bank_account::normalize` and maps `BankAccountError` →
     `ApiError::BadRequest("settlement_bank_account.<field>: <reason>")`.
   - `StoredProfile` gets `pub bank_account: Option<&'a SettlementBankAccount>`, filled in
     `From<&LpRow>`. `profile_is_unchanged` additionally requires
     `submitted.bank_account.as_ref().is_none_or(|b| stored.bank_account == Some(b))`. `decide_upsert`
     keeps its structure. Update the 409 message to say the profile and settlement bank account are
     frozen.
   - `upsert_my_lp` passes `profile.bank_account` to the repo.
   - Update the utoipa docs for the 400/409 descriptions, and register the new schemas in `LpsDoc`.

5. **API: response side** (`packages/api/src/routes/lps.rs`):
   - New DTOs:
     - `SettlementBankAccountSummary { account_holder_name, bank_name, account_last4: Option<String> }`
     - `SettlementBankAccountDetails`: all seven fields, with `From<&SettlementBankAccount>`.
     - Both are registered in `LpsDoc`. `SettlementBankAccountDetails` is also registered in
       `CashBookDoc`.
   - `pub enum LpAudience { Owner, Trustee }`.
     `pub fn bank_account_views(account: Option<&SettlementBankAccount>, audience: LpAudience) ->
     (Option<SettlementBankAccountSummary>, Option<SettlementBankAccountDetails>)`. It is pure; the
     owner always gets `None` for details.
   - `LpResponse` gets
     - `settlement_bank_account: Option<SettlementBankAccountSummary>` (always serialized), and
     - `#[serde(skip_serializing_if = "Option::is_none")] settlement_bank_account_details:
       Option<SettlementBankAccountDetails>`.

     `LpResponse::new` takes the audience.
   - Thread `audience` through `with_documents` and `with_documents_rows`:
     - `Trustee`: `get_lp`, `decide_kyb`.
     - `Owner`: `get_my_lp`, `upsert_my_lp`, `upload_my_documents`, `submit_my_lp` (`delete_my_document` returns a bare status), and `routes/lp_settlement_address.rs::verify` (line ~367).
     - Grep every `with_documents(` call and make each one pass an audience explicitly, so a new
       caller cannot get a default.

6. **API: cash book** (`packages/api/src/routes/cash_book.rs`):
   - `CashBookWireOutItem` gets `#[serde(skip_serializing_if = "Option::is_none")] pub bank_account:
     Option<SettlementBankAccountDetails>`.
   - In `build_response`, set it only when `w.status == WireOutStatus::Pending` and the holder
     resolved with a stored account:
     `holder.and_then(|h| h.settlement_bank_account.as_ref()).filter(|_| pending).map(|a| (&a.0).into())`.
   - No new query, since step 3 widened the holder query.
   - Keep `require_trustee`. The handler is unchanged otherwise.

7. **Lint and build.** Run `cargo clippy --all -- -D warnings`, `cargo test -p shared -p pipeline-api`
   (pure tests only) and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure unit tests, in external files. None reads `DATABASE_URL` / `POSTGRES_URL` or any
env var, and none connects to Postgres. `connect_lazy` placeholders already used in `cash_book.rs`
tests are fine because they never connect.

- **New `packages/shared/tests/bank_account.rs`**
  - `normalize`:
    - trims; a blank optional field becomes `None`
    - IBAN spaces are stripped and the IBAN uppercased
    - valid IBANs (e.g. `GB82 WEST 1234 5698 7654 32`, `DE89370400440532013000`) pass; one changed
      digit fails mod-97
    - the BIC accepts 8 and 11 characters and rejects 9 / 10 and lowercase-after-normalization edge
      cases
    - ABA `021000021` passes; one changed digit fails
    - the "at least one of" rules both fail when empty
    - length limits are counted in characters, using a multibyte name
  - `BankAccountError`'s `Display` never contains the submitted value (assert on an IBAN substring).
  - `Debug` of `SettlementBankAccount` contains no account number, IBAN or routing number.
  - `account_last4`:
    - IBAN preferred over account number
    - `null` when the identifier has ≤ 4 characters
    - spaces ignored
  - Serde: `None` serializes as `null` (key present). A round trip through `serde_json::Value` is
    equal, which protects the JSONB equality.
- **New `packages/shared/tests/migration_lps_settlement_bank_account.rs`** (pattern:
  `migration_lp_settlement_address_history.rs`, `include_str!` of the SQL):
  - the column is added nullable
  - the CHECK names every key, with `COALESCE(…,'missing')` on the optional keys
  - there is a rollback block
- **`packages/shared/tests/settlement_address.rs`**:
  - fixture update
  - assert `STELLAR_ADDRESS_HOLDERS_SQL` selects `l.settlement_bank_account`
  - assert `UPSERT_LP_BY_OWNER_SQL` contains the `COALESCE($9::jsonb, lps.settlement_bank_account)`
    and the `$9::jsonb IS NULL OR … IS NOT DISTINCT FROM $9::jsonb` freeze clause
- **`packages/api/tests/lps.rs`**:
  - `validate_profile` with and without `settlement_bank_account`; an invalid IBAN gives 400, and the
    message names the field, not the value.
  - `deny_unknown_fields` on the input.
  - `profile_is_unchanged` / `decide_upsert`:
    - frozen + absent account + same profile → `PreferenceOnly`
    - frozen + identical account → `PreferenceOnly`
    - frozen + different account → `Refuse`
    - writable + any account → `Write`
    - no stored account + frozen + submitted account → `Refuse`
  - `bank_account_views`:
    - the owner gets the summary and no details
    - the trustee gets both
    - `None` in, `(None, None)` out
  - Serializing an owner `LpResponse` (build via `bank_account_views` + DTOs) has no
    `settlement_bank_account_details` key.
  - OpenAPI (`LpsDoc::openapi()`): `LpResponse` has both properties, `UpsertLpRequest` has
    `settlement_bank_account`.
- **`packages/api/tests/cash_book.rs`**:
  - `build_response` with holders that carry an account:
    - a `Pending` wire-out carries `bank_account` with every field
    - `Settled` and `Cancelled` wire-outs of the same LP omit the key
    - an unresolved wire-out (no holder) omits it
    - a holder without an account omits it
  - `CashBookDoc` schema includes `bank_account`.
  - Update the existing `StellarAddressHolder` fixtures.
- **`packages/api/tests/lp_settlement_address.rs`**: `LpRow` fixture update only.
- **Manual acceptance on test** (in the user-stories doc, not automated):
  - an LP saves an account during KYB and sees it masked
  - the Trustee sees it in full on `GET /v1/lps/{id}`
  - after `Passed`, a different account gets 409
  - a `Pending` wire-out in `GET /v1/cash-book` carries `bank_account`
  - `GET /v1/requests` and `GET /v1/audit-log` carry no bank fields

## Docs to Update

1. **`docs/product-specs/kyb-lp-verification.md`**
   - New `### Settlement Bank Account` section after `### Settlement Address`, covering:
     - the purpose (USD wire-outs)
     - capture on `POST /v1/lps/me`, including absent = unchanged
     - the field set and validation
     - the KYB freeze (D2) and why it differs from the settlement address
     - "passed KYB = verified account" (2026-10-30)
     - the masked owner view versus the full trustee view (D5, D6)
     - the post-`Passed` change path per the answer to Q1
   - Update the "Two things sit outside the freeze" sentence to state that the bank account is
     *inside* it.
   - Add a Security Considerations bullet covering:
     - who reads the full account (trustee only)
     - masking
     - never logged (redacting `Debug`)
     - plaintext at rest, no history, no read audit (TD-178)
2. **`docs/product-specs/minter-cash-book.md`**, § API Contract: add `"bank_account?": {…}` to the
   `wire_outs` example, plus one sentence: full details of the resolved LP's current account, on
   `Pending` rows only. The `trustee` role note already covers it.
3. **`docs/product-specs/withdrawals.md`**, § API Contract: one sentence. The Trustee reads a
   wire-out's destination from the cash-book row (`bank_account`) or the LP detail. The LP reads only
   the masked `settlement_bank_account` on `GET /v1/lps/me`. The public `GET /v1/requests` never
   carries bank data.
4. **`docs/product-specs/lp-onboarding.md`** § LP Entity Registration and KYB Documents: add "settlement
   bank account" to the list of what `kyb-lp-verification.md` specifies.
5. **`docs/exec-plans/tech-debt-tracker.md`**: **TD-178** (re-check the number) "LP settlement bank
   account: plaintext at rest, no change history, no read audit, no post-`Passed` change path". Bump
   "Next free number". Drop the parts the answers to Q1 or Q5 resolve.
6. **User-stories doc**: `docs/user-stories/epic-1795/1812-lp-settlement-bank-account.md`, in the
   format of the existing epic-1795 docs, with the manual acceptance cases above. Link it from
   `docs/user-stories/index.md` under epic 1795.
7. No change to `docs/user-docs/` (the user docs already say "a bank account for a USD wire").
   `docs/frontend/*` changes belong to the frontend follow-ups.
