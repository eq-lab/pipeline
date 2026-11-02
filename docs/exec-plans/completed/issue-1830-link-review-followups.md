# Issue #1830: Backend: PR #1828 review follow-ups — 500 on a corrupt kyb_status in link_refusal, dedupe kind_name / iso

Source: https://github.com/eq-lab/pipeline/issues/1830

## Scope

Three small backend cleanups left over from the review of PR #1828 (#1824). They do not change behaviour except for the corrupt-data case.

1. **A corrupt `kyb_status` gives 500, not 409.** Today `link_refusal` (`packages/api/src/routes/lp_settlement_address.rs`) parses `lp.kyb_status` with `KybStatus::from_str(...)?` inside a `Result<(), String>`. Both callers (`issue_link_challenge`, `verify_link`) map every `Err` to `ApiError::Conflict`, so a bad status becomes a 409 whose body is the parse error. After the fix the status is parsed by the callers, a parse failure becomes `ApiError::Internal` (500, generic `{"error":"internal error"}` body), and `link_refusal` only returns real eligibility refusals (409).
2. **One chain-kind label helper.** Replace `kind_name` (`lp_settlement_address.rs:75`) and the inline `match kind { … }` in `payment_details_access` (`packages/api/src/routes/lp_bank_deposits.rs:390`) with one shared helper.
3. **One ISO formatter.** Remove `wallet::iso` (`packages/api/src/routes/auth/wallet.rs:104`) and use `crate::formatting::iso_utc` in both challenge-message builders. The message bytes stay the same.

Out of scope (per the issue and the manager's brief):

- A transient DB error after the challenge is consumed (handled on the frontend in #1825, by user decision of 2026-11-02).
- Legacy unproven addresses for `Passed` LPs (#1829).
- The other `KybStatus::from_str(...).map_err(|e| ApiError::Internal(...))` copies in `lps.rs` / `lp_bank_deposits.rs`. They already answer 500 and are not part of this issue.
- `chain_kind_token` in `packages/worker/src/indexer/config.rs:585`. It builds env-var tokens (`"STELLAR"`), not display labels, so it is a different thing.

## Assumptions and Risks

- **Byte-identical timestamps.** `iso` is `to_rfc3339_opts(SecondsFormat::Secs, true)` and `iso_utc` is `format("%Y-%m-%dT%H:%M:%SZ")`. They give the same output for years 0000–9999. Challenge times are always "now + 5 min", so they never fall outside that range. The existing byte-exact tests (`the_message_is_byte_exact_to_the_template` in `packages/api/tests/lp_settlement_address.rs`, plus the pins in `packages/api/tests/auth_wallet_challenge.rs`) must pass **unchanged**. If any of them needs editing, stop and report it, because that would mean the bytes changed.
- **Where verify parses the status.** `verify_link` will parse the status at the very top, before `find_challenge` and `consume_challenge`. A corrupt row then answers 500 **without spending the LP's challenge**. Eligibility refusals still run after the consume, as they do now (the `an_lp_that_failed_after_the_challenge_is_a_conflict_and_the_challenge_is_spent` test keeps passing). `lp` is loaded once per request and never re-read, so parsing earlier returns the same value as parsing later.
- **Signature change.** `link_refusal` is `pub` and is called from the test file, so its signature changes. The 5 existing call sites in `packages/api/tests/lp_settlement_address.rs` are updated as described below. There are no other callers (checked with grep).
- **Home of the label helper.** It goes on `ChainKind` itself in `packages/shared/src/chains.rs`, where the enum is defined, because both API modules already import `ChainKind` from there. It is a named method, **not** `Display`: `ChainKind` serializes as lowercase `"evm"`/`"stellar"`, and a `Display` that printed `"EVM"`/`"Stellar"` would invite misuse.

## Open Questions

_None_

## Implementation Steps

1. **Chain-kind label helper** in `packages/shared/src/chains.rs`:
   - Add `impl ChainKind { pub const fn label(self) -> &'static str { match self { ChainKind::Evm => "EVM", ChainKind::Stellar => "Stellar" } } }` with a one-line doc comment saying it is the human-readable name used in API messages.
2. **`packages/api/src/routes/lp_bank_deposits.rs`**: in `payment_details_access`, replace the inline `let kind_name = match kind { … };` with `let kind_name = kind.label();`. Leave the rest of the function as is, so the messages do not change.
3. **`packages/api/src/routes/lp_settlement_address.rs`**:
   - Delete `fn kind_name`. Replace its 3 uses (in `link_refusal` and the two `LinkOutcome` arms of `verify_link`) with `kind.label()` / `target.kind.label()`.
   - Change `link_refusal` to take the parsed status: `pub fn link_refusal(lp: &LpRow, status: KybStatus, kind: ChainKind, holder: Option<i64>, address: &str) -> Result<(), String>`. Remove the `KybStatus::from_str` line from its body. The error type stays `String`, and every `Err` it returns is now an eligibility refusal.
   - Add a private helper `fn lp_kyb_status(lp: &LpRow) -> Result<KybStatus, ApiError>` that does `KybStatus::from_str(&lp.kyb_status).map_err(|e| ApiError::Internal(anyhow::anyhow!("LP {} has an unparseable kyb_status: {e}", lp.id)))`. This text is only logged (see `ApiError::Internal` in `packages/api/src/error.rs`) and never sent in the response.
   - `issue_link_challenge`: first line `let status = lp_kyb_status(lp)?;`, before `address_holder`. Then `link_refusal(lp, status, target.kind, holder, &target.address).map_err(ApiError::Conflict)?;`.
   - `verify_link`: first line `let status = lp_kyb_status(lp)?;`, before `find_challenge`. The post-consume check becomes `link_refusal(lp, status, target.kind, holder, &consumed.address).map_err(ApiError::Conflict)?;`.
   - Imports: remove `iso` from the `crate::routes::auth::wallet::{…}` import and add `use crate::formatting::iso_utc;`. `std::str::FromStr` is still needed by the helper.
   - In `link_challenge_message`: `issued = iso_utc(&issued_at), expires = iso_utc(&expires_at)`.
4. **`packages/api/src/routes/auth/wallet.rs`**:
   - Delete `pub(crate) fn iso`.
   - In `challenge_message`: `issued = iso_utc(&issued_at), expires = iso_utc(&expires_at)`. Add `use crate::formatting::iso_utc;` and remove `SecondsFormat` from the `chrono` import.
   - Run `grep -rn "wallet::iso\|\biso(" packages/api` to confirm nothing else used it.
5. **Lint:** `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all -- --check`.

## Test Strategy

All tests are pure: no DB and no env vars (`DATABASE_URL`, `POSTGRES_URL` or any other). They go in external test files only, never in inline `#[cfg(test)]` modules.

1. **`packages/shared/tests/chains.rs`**: add `chain_kind_label_is_the_display_name`, which asserts `ChainKind::Evm.label() == "EVM"` and `ChainKind::Stellar.label() == "Stellar"`.
2. **`packages/api/tests/lp_settlement_address.rs`**:
   - Update the 5 existing `link_refusal(...)` calls (tests around lines 439–483) to pass the status, e.g. `link_refusal(&row, row.kyb_status.parse().unwrap(), ChainKind::Stellar, None, "GNEW")`, or a small local helper `fn refusal(row, kind, holder, addr)` that parses and forwards. The assertions do not change.
   - New `a_corrupt_kyb_status_is_a_500_at_challenge_time`: `lp("Bogus", None, None)` passed to `issue_link_challenge` returns `ApiError::Internal(_)` (not `Conflict`), and `issue_calls == 0`. Convert it with `err.into_response()`. Assert the status is `500`, and read the body with `axum::body::to_bytes(resp.into_body(), usize::MAX)`. The body equals `{"error":"internal error"}` and contains neither `"unknown kyb status"` nor `"Bogus"`.
   - New `a_corrupt_kyb_status_is_a_500_at_verify_and_keeps_the_challenge`: issue a challenge with `open_lp()`, sign it with the right key, then call `verify_link` with a clone of the row whose `kyb_status = "Bogus"`. It returns `ApiError::Internal(_)`, `store.challenge_present()` is still `true`, `store.links()` is empty, and the response body checks are the same as above. A shared `assert_opaque_500(err)` helper keeps the two tests short.
   - Eligibility refusals stay 409: the existing tests `a_refused_lp_never_reaches_the_issue_call`, `an_address_held_by_another_lp_is_refused_at_challenge_time`, `an_lp_that_failed_after_the_challenge_is_a_conflict_and_the_challenge_is_spent` and `a_passed_lp_with_that_kind_already_set_is_a_conflict` must pass unchanged.
3. **Byte pins (unchanged):** `the_message_is_byte_exact_to_the_template` and the rest of the message tests in `lp_settlement_address.rs`, plus `packages/api/tests/auth_wallet_challenge.rs`, must pass without edits.
4. **`packages/api/tests/lp_payment_details.rs`** must pass unchanged. It covers the `payment_details_access` messages that now use `label()`.
5. Run `cargo test -p shared --test chains` and `cargo test -p api --test lp_settlement_address --test auth_wallet_challenge --test lp_payment_details`, then `cargo clippy --workspace --all-targets -- -D warnings`.

## Docs to Update

- None for product specs. Eligibility behaviour and the documented 409/422 responses are unchanged. The corrupt-data 500 is the generic internal-error path, which the utoipa annotations of other endpoints do not list either.
- This exec plan moves to `docs/exec-plans/completed/` when the PR lands (manager/coder convention).
