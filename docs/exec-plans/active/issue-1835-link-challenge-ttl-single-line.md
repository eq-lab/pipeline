# Issue #1835: Backend: settlement-address link challenge — 1-hour TTL and a single-line message

Source: https://github.com/eq-lab/pipeline/issues/1835
Branch: `feat/1835-link-challenge-ttl-single-line` (from `main`, which has #1824, #1830 and #1831)

## Scope

This change covers only the settlement-address link challenge in `packages/api/src/routes/lp_settlement_address.rs`, which serves `GET /v1/lps/me/link-address/challenge` and `POST /v1/lps/me/link-address/verify`.

1. **TTL 1 hour.** Add a link-specific constant, `LINK_CHALLENGE_TTL_SECS = 60 * 60`. It replaces `CHALLENGE_TTL_SECS` in two places:
   - the `ttl_secs` argument to `issue_or_reuse_challenge`;
   - `issued_at = expires_at - TTL` in `link_challenge_message`.

   The link route stops importing `CHALLENGE_TTL_SECS`. The reuse rule does not change: the stored nonce is reused only for the same address and signer when more than 60 s remain (`NONCE_REUSE_MIN_REMAINING_SECS` in SQL).
2. **One-line message.** `link_challenge_message` returns one line with no `\n`. Each line break, including the blank separator lines, becomes a single space, so there are no double spaces. Content and order stay the same.
3. Docs, utoipa descriptions and user stories are updated to match.

**Out of scope** (must stay byte-identical):
- `packages/api/src/routes/auth/wallet.rs`: `CHALLENGE_TTL_SECS` (5 min), `challenge_message` and the sign-in flow.
- `packages/api/tests/auth_wallet_challenge.rs`: no changes.
- `packages/shared`: `SettlementLinkStore`, `ISSUE_OR_REUSE_LINK_CHALLENGE_SQL` and `NONCE_REUSE_MIN_REMAINING_SECS`. The TTL is already a parameter there.
- Frontend: `packages/frontend/src/api/lps.ts` still calls the deleted unsigned endpoint. That belongs to #1825.

**No migration.** `lp_address_challenges.expires_at` is a plain `TIMESTAMPTZ` with no CHECK tied to the TTL (`packages/shared/migrations/20261102000002_lps_signed_settlement_addresses.sql`). The TTL arrives as a bind parameter (`$6`).

## Assumptions and Risks

- **Deploy effect (put this in the PR).** Verify rebuilds the message from the stored row with `issued_at = expires_at - 1h`. A challenge fetched before the deploy (5-minute TTL, multi-line) therefore no longer verifies after it. Verify returns `422 settlement address proof failed`, and the LP requests a new challenge. Such challenges live at most 5 minutes, so this is acceptable (issue decision).
- **Transitional quirk.** In the first ≤5 minutes after deploy, a new challenge request may reuse a pre-deploy row: same address and signer, more than 60 s left. The response then carries the old nonce and old `expires_at`, and its `Issued At` is computed as `expires_at - 1h`, about 55 minutes before the real issue time. The message is still self-consistent: issue and verify rebuild the same bytes, so a signature over it verifies. Only the displayed `Issued At` is off, and only for that window. No action needed. Mention it in the PR in one line.
- **Security trade-off.** A longer TTL widens the window in which a signed, unconsumed link proof can be replayed. The proof is still single-use and bound to `(lp_id, chain_id, address, signer_address)`. Any new challenge for a different address overwrites the row, and verify still needs the LP's bearer session. This is accepted by user decision, so no TD entry.
- **String-literal pitfall.** When the single line is built with `\` line continuations, every continued segment needs exactly one trailing space before the `\`. Rust strips the newline and the next line's leading whitespace. rustfmt does not reformat string literals. The byte-pin test, plus the no-`\n` and no-double-space assertions, catch mistakes.
- **Sign-in separation.** The sign-in message starts `"<domain> wants you to sign in with your wallet:"` and the link message starts `"<domain> wants you to link a settlement address…"`. They remain distinct, and the existing cross-message tests (`the_message_differs_from_the_sign_in_message`, `a_sign_in_signature_is_a_proof_failure`) cover this.

## Open Questions

_None_

## Implementation Steps

1. **`packages/api/src/routes/lp_settlement_address.rs`**
   - Change the import to `use crate::routes::auth::wallet::{challenge_domain, ChallengeResponse};`, dropping `CHALLENGE_TTL_SECS`.
   - Add `pub const LINK_CHALLENGE_TTL_SECS: i64 = 60 * 60;` next to `LINK_PROOF_FAILED`. It is `i64` like the sign-in constant, because `Duration::seconds` takes `i64`.
   - In `link_challenge_message`, use `Duration::seconds(LINK_CHALLENGE_TTL_SECS)` and rewrite the `format!` literal as one line. The exact output, with spaces only:
     ```
     {domain} wants you to link a settlement address to your Pipeline LP account. Settlement address: {address} Signed by: {signer_address} Sign this message to prove you control this wallet. This request will not trigger a blockchain transaction or cost any gas. LP ID: {lp_id} Chain ID: {chain_id} Nonce: {nonce} Issued At: {issued} Expiration Time: {expires}
     ```
     Either keep one `format!` with `\` continuations, where each segment ends in a single space before the `\`, or write the literal as one long line. Do not use `.join(" ")` over separate `format!`s; that adds allocations for no gain.
   - In `issue_link_challenge`, pass `LINK_CHALLENGE_TTL_SECS as i32` to `issue_or_reuse_challenge`.
   - utoipa text:
     - `link_challenge` 200: `"Challenge to sign with the signer wallet: a single-line message, valid for 1 hour; sign the message string exactly as returned"`.
     - `link_verify` 422: keep the current wording, which tests check for `bad signature` and `consumed challenge`. Change `unknown/expired/consumed challenge` to `unknown/expired (1 hour)/consumed challenge`, or similar, keeping both substrings.
   - No comments added (AGENTS.md comment-less rule). The file's spec header stays.
2. **`packages/api/tests/lp_settlement_address.rs`**: see Test Strategy.
3. **Docs**: see Docs to Update.
4. Run `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test -p pipeline-api --test lp_settlement_address --test auth_wallet_challenge`. Confirm that `git diff --stat` touches neither `wallet.rs` nor `auth_wallet_challenge.rs`.

## Test Strategy

All tests are pure and live in `packages/api/tests/lp_settlement_address.rs`. They use the existing `FakeLinkStore`, with no DB and no env vars. `t(secs)` is `2027-01-15T08:00:00Z + secs`.

- **Imports.** Add `LINK_CHALLENGE_TTL_SECS` to the `lp_settlement_address` import. Keep `CHALLENGE_TTL_SECS` from `auth::wallet`, used only to assert that the sign-in TTL is unchanged.
- **Fake store honours the TTL.** Add `last_ttl: Option<i32>` to `FakeState`. `issue_or_reuse_challenge` records `ttl_secs` and builds a fresh row with `expires_at: t(i64::from(ttl_secs))`, replacing `t(CHALLENGE_TTL_SECS)`. Reuse behaviour is unchanged.
- **Byte pin** (`the_message_is_byte_exact_to_the_template`). Expected value for `message(t(3600))`, as one line:
  `app.pipeline.one wants you to link a settlement address to your Pipeline LP account. Settlement address: GADDR Signed by: GSIGNER Sign this message to prove you control this wallet. This request will not trigger a blockchain transaction or cost any gas. LP ID: 42 Chain ID: 99000001 Nonce: n-1 Issued At: 2027-01-15T08:00:00Z Expiration Time: 2027-01-15T09:00:00Z`
- **TTL test** (rename `issued_at_is_expiry_minus_the_ttl_and_the_message_is_deterministic`):
  - `LINK_CHALLENGE_TTL_SECS == 3600` and `CHALLENGE_TTL_SECS == 300`.
  - `message(t(4200))` contains `Issued At: 2027-01-15T08:10:00Z` and `Expiration Time: 2027-01-15T09:10:00Z`, an exact 1-hour gap.
  - Determinism: `message(t(3600)) == message(t(3600))`.
- **New `the_message_is_one_line_without_double_spaces`.** For realistic Stellar and EVM inputs, with real `g_of(...)` / `evm_addr(...)`, a UUID-like nonce and a real expiry, the message contains no `'\n'`, no `'\r'` and no `"  "`.
- **`issuing_returns_the_stored_nonce_and_the_rebuilt_message`.** Compare against `link_challenge_message(..., t(LINK_CHALLENGE_TTL_SECS))`, and assert `store.with(|s| s.last_ttl) == Some(3600)`. This proves the link TTL reaches `issue_or_reuse_challenge`.
- **Unchanged, must stay green:**
  - `the_message_changes_with_every_bound_field`, where `t(300)` is just an arbitrary input;
  - `the_message_differs_from_the_sign_in_message`;
  - `a_sign_in_signature_is_a_proof_failure`;
  - the expiry, replay, mismatch and race tests.
- **Real-key sign/verify.** These tests go through `issue` → sign → `verify_link`, so they sign the new single-line message:
  - `a_stellar_account_links_with_its_own_signature`;
  - `a_stellar_contract_links_through_a_g_signer_in_base64_and_hex`;
  - `an_evm_address_links_with_the_stored_lowercase_address_and_signer`;
  - `an_evm_address_links_through_a_different_signer`.

  In one Stellar and one EVM test, also assert that the issued message has no `'\n'`, so the real-key path is explicitly covered on the single-line form.
- **OpenAPI.** In `the_challenge_is_a_get_with_required_chain_and_address_and_optional_signer`, assert that the 200 description contains `1 hour` and `exactly as returned`. The existing 422 substring assertions stay green.
- **Sign-in guard.** `packages/api/tests/auth_wallet_challenge.rs` stays untouched and passes as is, which pins the sign-in message bytes and the 300 s TTL.

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md` § Settlement Address → Proof of control.**
  - Replace the multi-line template block with the single-line template.
  - Add one sentence: the message is a single line (no line breaks), so it survives copy-paste from a JSON response, and it must be signed exactly as returned.
  - Add one sentence: a challenge is valid for 1 hour (`Issued At` = `Expiration Time` − 1 hour).
- **`docs/product-specs/api-authorization.md`**
  - § Settlement-address proof, **TTL and reuse**: change "5 minutes" to "1 hour (`LINK_CHALLENGE_TTL_SECS`; the sign-in challenge keeps its 5 minutes)". Add a **Message** bullet: a single line, unlike the multi-line sign-in text; clients sign the `message` string exactly as returned, never its JSON-escaped form. Note that a challenge issued before the TTL change no longer rebuilds to the same bytes, so the LP requests a new one.
  - API Contract row for `GET /v1/lps/me/link-address/challenge`: add "a single-line message valid for 1 hour".
  - `lp_address_challenges` table, `expires_at` row: "5 minutes after issue" → "1 hour after issue".
  - The sign-in paragraphs (SIWE-style multi-line, TTL 5 minutes) stay as they are.
- **`docs/user-stories/epic-1247/1824-signed-settlement-address.md`**
  - Story 1 expected outcome: the message is a single line, contains no line break, and has `Issued At` exactly 1 hour before `Expiration Time`.
  - Story 4 step 2: "Wait past the 5-minute expiry" → "Wait past the 1-hour expiry".
  - Add a step or outcome: signing the `message` after copying it with literal `\n` escapes is unnecessary now, because the message has none.
- **`docs/user-stories/epic-1247/1831-relink-settlement-address.md`**: nothing shows the message or the 5-minute expiry. Re-check during implementation, and leave the file unchanged unless a reference turns up.
- **Tech debt.** No new TD entry.
