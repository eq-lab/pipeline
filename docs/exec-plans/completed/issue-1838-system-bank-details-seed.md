# Issue #1838: Ops: seed system_configuration.system_bank_details with the real trust-account details before the LP funding modal ships

Source: https://github.com/eq-lab/pipeline/issues/1838

Part of epic #1247. Backend flow. No Figma link: the modal (#1817) already renders this record's
values, and its existing generic error notice covers the new refusal (see Scope). The issue has no
comments.

## Scope

Today the #1815 migration seeds `system_configuration.system_bank_details` with six empty strings.
`GET /v1/lps/me/payment-details` serves those blanks with `200`, and it still mints and stores a
`PL-…` reference in `lp_requested_bank_details` that the LP cannot use. This issue has three parts:

1. **Repeatable fill mechanism (decision: documented manual SQL).** A runbook subsection in
   `docs/product-specs/deposits.md` § LP Funding Details. It gives one transactional
   `UPDATE … SET value = jsonb_build_object(…)` template with placeholders, a verification `SELECT`,
   and a `curl` check. An operator runs it per environment (staging, production). No real values go
   into git.
2. **API refuses an unconfigured record (decision: `503`, nothing issued).** When the record exists
   and is well-formed but a required field is blank, `request_payment_details` answers
   `503 Service Unavailable` with a JSON `error` message. This check runs before any reference is
   generated or inserted. It also logs a server-side `error!` that names the blank fields, never
   their values. Precedence is unchanged otherwise: `400` chain → `404` no LP → `409` access gate →
   bank read (`500` missing/malformed, new `503` unconfigured) → issue.
3. **Ops data step (human-only).** Fill staging and production with the real trust-account details
   using the runbook. The agent never sees, invents, or commits these values (see Open Questions).

**Why manual SQL, not the alternatives**

| Option | Verdict | Reason |
| --- | --- | --- |
| Migration with real values | Rejected | `eq-lab/pipeline` is a **public** repo, so the trust account would be published in git. Migrations run unchanged in every environment at API startup (`shared::migrations::MIGRATOR`), so staging and production cannot differ. A typo fix would need another migration. |
| Trustee/admin write endpoint (`PUT …/bank-details`) | Rejected | It adds endpoint surface (user preference: minimal surface), plus authz, audit-log and UI work for a value that changes about once per environment lifetime. A stolen Trustee session could redirect LP wires, which is a high-impact target for an endpoint used about once. The current spec states "There is no write endpoint". |
| Startup seed from an env var / secret (`SYSTEM_BANK_DETAILS_JSON`) | Rejected (noted as fallback) | It would silently overwrite hand edits on every boot, adds startup code and a new config surface, and adds nothing the DB `CHECK` does not already give. If ops has no direct DB access, this becomes the fallback (Open Question 3). |
| **Documented manual SQL** | **Chosen** | Zero code and zero surface. The DB `CHECK` (`system_configuration_bank_details_shape_ck`) already rejects a malformed edit. The API reads the row on every request, so no restart is needed. The values stay out of git. |

**Frontend impact: none.** `usePaymentDetails` turns any error into `unavailable`, and
`toUnavailableView` maps everything except `409` to `reason: "error"`. The modal therefore shows
the existing copy "Bank details are unavailable right now. Close this window and try again, or
contact support." with every row at `—` and copy disabled. That is the right UX for an
unconfigured system. `retry: false` means one `503` costs one request and mints nothing.

**Out of scope**

- Any write endpoint, admin UI, or env-var seed for `system_configuration`.
- Editing the #1815 migration. Migrations are immutable, and the empty seed stays as the
  "unconfigured" sentinel.
- A DB-level non-empty `CHECK`. It cannot be added while the seeded row is blank, and the required-field
  rule belongs in the API so that it can return `503` rather than make the operator's `UPDATE` fail
  half-way through filling the record.
- Rate limiting references (TD-159), frontend copy changes, contract changes.

## Assumptions and Risks

- **Required-field rule (recommended default, needs confirmation in OQ 2).** "Configured" means
  `company_name`, `bank_name` and `swift_bic_code` are non-blank, and **at least one of**
  `account_number` / `iban` is non-blank. `bank_address` is optional. "Blank" means empty after
  `trim()`. This matches the minimum an international wire needs (beneficiary name, bank and BIC,
  plus an account or IBAN). It keeps the #1815 contract that an individual empty field is served as
  `""` / `—`: a US trust account has no IBAN, so "all six required" would block a valid setup. The
  existing `filled_details()` fixture (blank `bank_address`) stays a valid "configured" record, so no
  current happy-path test changes.
- **`503` vs `500` vs `409`.** `409` is wrong because it is the LP-precondition status and the
  modal maps it to "link your wallet / Go to Account". `500` would hide the cause. `503` is
  `ApiError::ServiceUnavailable(String)` (already used by captcha fail-closed): the server is not
  ready yet and the LP can try later. A missing row (`None`) and a malformed row stay `500`
  (`ApiError::Internal`), which is unchanged #1815 behaviour (Story 5). Those are corruption, not a
  "not yet filled" state.
- **Deploy order is safe either way.** If the code ships before the data, eligible LPs see the
  generic notice instead of blank rows, and no references are minted. If the data lands first, the
  `200` responses are correct at once. The code PR does not block on the human data.
- **References already minted against blank details** (staging, and production if #1817 is live
  there) stay valid and keep their owner. The wire-matching spec (#1839) needs nothing new.
- **The issue's "Done when" depends on human data.** After the code PR merges, the issue cannot be
  closed until a human runs the runbook on staging and confirms Story 1 of
  `docs/user-stories/epic-1247/1817-funding-details-payment-reference.md`. The manager should keep it
  parked (`needs-feedback`) for that step rather than close it on merge.
- **Quoting.** Bank addresses may contain `'`. The runbook must say to double single quotes inside
  SQL literals. Better: use psql `\set` variables with `:'var'` interpolation so that psql does the
  quoting.
- **Staging data sensitivity.** Real trust-account details on staging are visible to anyone with a
  Passed staging LP, so a tester could wire real money to them. See OQ 4.
- No dependency on open issues or PRs: #1815, #1817, #1824 and #1839 are merged.

## Open Questions

All resolved by the latest Issue comment.

1. **Real values.** Resolved: a human ops data step outside this PR. The real details and the staging
   account are never put in the repo; placeholders only.
2. **Required-field rule.** Resolved: confirmed as the default (`company_name`, `bank_name`,
   `swift_bic_code` required, at least one of `account_number` / `iban`, `bank_address` optional).
3. **DB access / mechanism.** Resolved: a documented SQL template run via `psql`; no env-var seed.
4. **Staging values.** Resolved: the staging account is an ops data step outside this PR.
5. **Status code.** Resolved: an unfilled record answers `503`; no payment reference is minted or stored.

## Implementation Steps

1. **Shared: required-field rule** in `packages/shared/src/system_configuration_repo.rs`.
   - Add `impl SystemBankDetails { pub fn missing_required_fields(&self) -> Vec<&'static str> }`.
     It returns, in this fixed order, `"company_name"`, `"bank_name"`, `"swift_bic_code"` for each
     one that is blank after `trim()`, then `"account_number or iban"` when both are blank. An empty
     `Vec` means configured.
   - Add `pub fn is_configured(&self) -> bool { self.missing_required_fields().is_empty() }`.
   - Do not change the `BankDetailsSource` trait, `SystemConfigurationRepo`, or serde behaviour.
     Values are still served verbatim and are not trimmed in the response.
2. **API: refuse an unconfigured record** in `packages/api/src/routes/lp_bank_deposits.rs`,
   `request_payment_details`.
   - After `bank.bank_details().await?…ok_or_else(…)` and **before** `issue_payment_details`, call
     `details.missing_required_fields()`. If the result is non-empty, emit
     `tracing::error!(missing = ?missing, "system_bank_details is not configured; no payment reference issued")`
     (field names only) and return
     `Err(ApiError::ServiceUnavailable("funding details are not configured yet; no payment reference was issued, try again later".to_owned()))`.
   - Keep the order: access gate (`409`) first, then bank read, then the new check, then issue.
     A refused caller still reads nothing.
   - `#[utoipa::path]` on `get_my_payment_details`: add
     `(status = 500, description = "The bank-details record is missing or malformed, or a unique reference could not be issued")`
     and
     `(status = 503, description = "The bank-details record is not configured yet (a required field is blank); no reference is issued")`.
   - Keep the file's comment rule (spec-pointer header only). Add no doc comments.
3. **Docs: `docs/product-specs/deposits.md` § LP Funding Details.**
   - Rewrite the **Bank details** bullet: the record is seeded empty and filled per environment by an
     operator with the runbook below, and there is still no write endpoint. Values are served
     verbatim. An individual optional empty field is served as `""` / `—`. State the required-field
     rule (as decided in OQ 2).
   - Extend the **Access** bullet: a well-formed record with a blank required field is `503` with a
     JSON `error`, no reference is issued and the server logs the blank field names. A missing or
     malformed record stays `500`.
   - Replace the **Deploy prerequisite** bullet with a short `### Filling the bank details` runbook
     subsection placed after the bullets. Keep it agent-readable and free of acceptance criteria.
     It contains:
     - When: once per environment before LPs can fund, and again whenever the account changes.
       The API re-reads the row on each request, so no restart is needed.
     - The psql template using `\set` variables with placeholders such as `<COMPANY_NAME>`, never
       real values, and a note that values never go into git (the repo is public):
       ```sql
       \set company_name '<COMPANY_NAME>'
       … (one \set per field)
       BEGIN;
       UPDATE system_configuration
          SET value = jsonb_build_object(
                'company_name', :'company_name', 'bank_name', :'bank_name',
                'bank_address', :'bank_address', 'account_number', :'account_number',
                'iban', :'iban', 'swift_bic_code', :'swift_bic_code')
        WHERE type = 'system_bank_details';
       -- expect UPDATE 1; if UPDATE 0 the row was deleted: INSERT it with the same value
       SELECT value FROM system_configuration WHERE type = 'system_bank_details';
       COMMIT;
       ```
     - Verify: `curl -i -H "Authorization: Bearer $TOKEN" "$API/v1/lps/me/payment-details?chain_id=$CHAIN_ID"`
       as a Passed, linked LP returns `200` with the filled fields. Note that this call mints one
       reference.
     - The `CHECK` rejects a missing key or non-string value, and the API answers `503` until the
       required fields are filled.
4. **Docs: `docs/frontend/bank-transfers.md`.** In the Out-of-scope table, point the
   "Filling `system_configuration.system_bank_details`" row to
   `deposits.md#filling-the-bank-details` (ops, per environment). In the **States** bullet, add that a
   `503` (bank details not configured) falls under "Any other failure: generic notice". This is a
   doc-only change. Do not change frontend code.
5. **User stories.**
   - `docs/user-stories/epic-1247/1815-lp-payment-details.md`: change Story 1's pre-condition to
     "filled per the runbook in deposits.md § Filling the bank details". Add **Story 7: An
     unconfigured bank-details record is refused and issues nothing**. Steps: with the seeded
     all-empty row (or with `swift_bic_code` set to `""`), call as an eligible LP. Expected: `503`
     with a JSON `error` naming the unconfigured state, no new `lp_requested_bank_details` row, an
     ineligible LP still gets `409`, and filling the record then gives `200`. Add **Story 8: an
     operator fills the record with the runbook** (UPDATE 1, then the `SELECT` shows the values, then
     the next call serves them without a restart).
   - `docs/user-stories/epic-1247/1817-funding-details-payment-reference.md`: add a short story or
     expected outcome. With the record unfilled, `Add Funds` shows the generic notice "Bank details
     are unavailable right now…", the rows show `—`, and the Network tab shows one `503`.
   - `docs/user-stories/index.md`: change the #1815 row status to `Amended by #1838` and the #1817
     row to `Amends #1283; amended by #1838`.
6. **Lint and checks.** `cargo fmt --all`, `cargo clippy --all -- -D warnings`,
   `cargo test -p shared --test system_configuration`,
   `cargo test -p pipeline-api --test lp_payment_details`, then the full `cargo test -p shared -p pipeline-api`
   (no DB needed), and `npx tsx scripts/lint-docs.ts`.
7. **Hand-off note for the manager (not coder work).** After merge, the human runs the runbook on
   staging (and production) with the real values from OQ 1, then verifies Story 1 of the #1817
   user stories on staging. Only then is the issue's "Done when" met.

## Test Strategy

All tests are pure unit tests in external files. None reads `DATABASE_URL` / `POSTGRES_URL` or
connects to Postgres. No inline `#[cfg(test)]` in `src/`.

**`packages/shared/tests/system_configuration.rs`** (extend)

- `the_seeded_all_empty_record_is_unconfigured`: `missing_required_fields()` equals
  `["company_name", "bank_name", "swift_bic_code", "account_number or iban"]` and
  `is_configured()` is false.
- `whitespace_only_counts_as_blank`: `"  \t"` in `company_name` is reported missing.
- `a_record_without_bank_address_is_configured`: every field filled except `bank_address`, so the
  result is configured.
- `iban_alone_or_account_number_alone_is_enough`: two cases, both configured.
- `both_account_number_and_iban_blank_is_reported_once`: the result is exactly `["account_number or iban"]`.
- `each_required_field_blank_is_named`: loop over `company_name`, `bank_name` and `swift_bic_code`,
  blanking each in turn and asserting that exactly that name is reported.

**`packages/api/tests/lp_payment_details.rs`** (extend, reusing `FakeBankDetails`, `FakeStore`,
`Scripted`, `empty_details()` and `filled_details()`)

- `an_unconfigured_record_is_503_and_issues_nothing`: `BankMode::Present(empty_details())` with a
  Passed, linked LP gives `ApiError::ServiceUnavailable(_)`. The store is empty, `script.calls == 0`
  and `bank.reads() == 1`.
- `a_record_missing_only_swift_is_503`: `filled_details()` with `swift_bic_code = ""` gives `503`
  with no row.
- `an_ineligible_caller_on_an_unconfigured_system_still_gets_409`: the gate wins and
  `bank.reads() == 0`.
- `the_unconfigured_refusal_is_a_503_json_error`: `ApiError::ServiceUnavailable(..).into_response()`
  has status `503` and a body `{"error": …}` that contains "not configured", and no `payment_details`.
- Extend `the_documented_responses_are_200_400_401_404_409` (or add a sibling test) to assert that
  `500` and `503` are documented.
- Existing tests stay green unchanged. `a_misconfigured_system_creates_no_row` still expects
  `Internal` for `Missing` and `Broken`. Happy paths use `filled_details()` (configured under the
  rule).

**Manual / staging (human, after merge)**: Story 7 and Story 8 of the #1815 user stories on staging
before the fill (`503`) and after it (`200`), then Story 1 of the #1817 user stories in the browser.

## Docs to Update

- `docs/product-specs/deposits.md` § LP Funding Details: the Bank details and Access bullets, and a
  new `### Filling the bank details` runbook that replaces the "Deploy prerequisite" bullet.
- `docs/frontend/bank-transfers.md`: the Out-of-scope row link, and `503` under the generic-notice
  state.
- `docs/user-stories/epic-1247/1815-lp-payment-details.md`: Story 1 pre-condition, plus new Stories 7 and 8.
- `docs/user-stories/epic-1247/1817-funding-details-payment-reference.md`: the unconfigured outcome.
- `docs/user-stories/index.md`: the #1815 and #1817 row statuses.
- OpenAPI is generated from `utoipa` annotations, so there is no checked-in file to regenerate.
