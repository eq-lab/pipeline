# Issue #1824: Backend: signed settlement-address linking (Stellar + EVM) + chain-aware payment-details — link-address/challenge + verify

Source: https://github.com/eq-lab/pipeline/issues/1824 (epic #1247; closes TD-57; supersedes #1695; absorbs the backend part of #1816 / #1499)

## Scope

In scope (backend only):

1. **Data model.** An LP holds one settlement address per chain kind. The `lps` table keeps `stellar_address` / `address_linked_at` and gains `stellar_signer_address`, `evm_address`, `evm_signer_address`, `evm_address_linked_at`. A new table `lp_address_challenges` holds one live link challenge per `(lp_id, chain_id)`.
2. **Two new endpoints** in a new route module `packages/api/src/routes/lp_settlement_address.rs`:
   - `GET /v1/lps/me/link-address/challenge?chain_id&address&signer_address`
   - `POST /v1/lps/me/link-address/verify` with body `{ chain_id, address, signer_address?, signature }`
3. **Removal.** `POST /v1/lps/me/link-address` is deleted: the route, the handler, `LinkAddressRequest` and `LpRepo::link_address`.
4. **Responses.** `LpResponse` and `LpSummary` gain `stellar_signer_address`, `evm_address`, `evm_signer_address` and `evm_address_linked_at`. `LpSummary` also gains `address_linked_at`, so the summary has both linked-at timestamps. `stellar_address` and `address_linked_at` stay as they are.
5. **`GET /v1/lps/me/payment-details` becomes chain-aware.** It requires `chain_id` (`RequiredChain`). The gate is `Passed` plus a linked address of that chain's kind. Each history row stores `chain_id` and `receiver_address`, added by a new migration. The response echoes `chain_id` and `receiver_address`.
6. **Specs, user stories, tech debt and OpenAPI** for all of the above.

Out of scope:
- The LP app linking UI (#1825), which switches `useSettlementAddressLink.ts` and `packages/frontend/src/api/lps.ts` to challenge → `signMessage` → verify. Frontend docs that describe the current auto-link (`docs/frontend/account-page.md`, `hooks.md`, `auth-components.md`) are updated by #1825.
- Trustee display and per-chain minting (#1826).
- The Funding details modal (#1817).
- EVM wire-in matching and EVM minting (#1500 / #1501).
- Stellar contracts. They are frozen and nothing here touches them.
- An on-chain check that the signer controls a `C…` contract. This is a known limit and is logged as tech debt.

API shape guaranteed to the frontend issues:

| Call | Request | 200 response |
|---|---|---|
| challenge | `GET /v1/lps/me/link-address/challenge?chain_id=<id>&address=<settlement>&signer_address=<signer, optional>` | `{ "message": string, "nonce": string }` (the `ChallengeResponse` from `routes::auth::wallet`) |
| verify | `POST /v1/lps/me/link-address/verify` `{ "chain_id": int, "address": string, "signer_address": string\|null, "signature": string }`. `signature`: EVM hex (`0x` optional); Stellar base64 or hex (the Freighter `signMessage` output) | `LpResponse` (below) |
| LP record | `GET /v1/lps/me`, `GET /v1/lps/{id}` | `LpResponse` + `stellar_signer_address`, `evm_address`, `evm_signer_address`, `evm_address_linked_at` (all nullable) |
| staff list | `GET /v1/lps` | `LpSummary` + `address_linked_at`, `stellar_signer_address`, `evm_address`, `evm_signer_address`, `evm_address_linked_at` |
| payment details | `GET /v1/lps/me/payment-details?chain_id=<id>` | the 7 existing string keys + `chain_id` (int) + `receiver_address` (string) |

### Decisions settled in this plan

- **Challenge storage: a new table, not columns on `lps`.**
  - The issue keys a challenge by `(lp_id, chain_id)`. Two EVM chains share one EVM slot but get separate challenges, so columns on `lps` could not hold this without one column set per configured chain.
  - A table also keeps nonce churn off the `lps` row, which `decide_kyb`, `submit_for_review` and the profile upsert all update.
  - Table `lp_address_challenges` has `PRIMARY KEY (lp_id, chain_id)`. A challenge is consumed by `DELETE … RETURNING`. There is at most one row per `(lp, chain)`, so stale rows stay bounded and need no cleanup job.
- **Reuse rule.** One SQL upsert on the DB clock, like `ISSUE_OR_REUSE_NONCE_SQL`. The stored nonce is reused only when **all** of these hold:
  - the stored `address` and `signer_address` equal the requested ones;
  - more than `NONCE_REUSE_MIN_REMAINING_SECS` (60 s) remain.

  Otherwise a fresh nonce with a 5-minute expiry overwrites the row, and the new binding replaces the old one. A challenge for a different address therefore invalidates the previous one: one live challenge per `(lp, chain)`.
- **Consume first, then re-check eligibility, then link.** This mirrors `/v1/auth/verify` (#1736), which consumes before the account-status gate.
  - The consume is its own atomic `DELETE … WHERE lp_id AND chain_id AND nonce AND expires_at > now() RETURNING address, signer_address`. Including `nonce` in the WHERE makes sure the challenge consumed is the one whose message was verified, not one re-issued in between.
  - The link `UPDATE` uses the **returned (stored)** address and signer, never the request body.
  - If a valid signature is followed by a refused link (409), the challenge is spent and the LP must request a new one. A refused LP is refused again at challenge time anyway.
  - A bad signature does not consume the challenge (same as `/v1/auth/verify`).
- **`POST /v1/lps/me/link-address` is deleted, not turned into a `410`.**
  - #1825 ships together with this issue, so a `410` handler would be dead code.
  - Deletion follows the minimal-endpoint-surface preference and keeps no handler alive on the old path.
  - The path then answers axum's plain `404`, which is enough to show it "no longer links anything". A router test asserts this.
- **Pre-existing `lp_requested_bank_details` rows.** The migration cannot know which configured chain id is the Stellar chain: kind comes from `CHAIN_<id>_TYPE` env, and the runner GUC only carries `DEFAULT_CHAIN_ID`, which may be an EVM chain. So:
  - `chain_id` stays `NULL` on legacy rows.
  - `receiver_address` **is backfilled** from `lps.stellar_address`. The #1815 gate required `Passed` plus a Stellar address, and `Passed` fixes that address, so the current value is exactly the one in force when the reference was issued.
  - Both columns are nullable, with `CHECK (… IS NOT NULL) NOT VALID` constraints. Every new row must carry both, and legacy rows are exempt.
  - This is safe because the table is insert-only. Postgres re-checks a NOT VALID constraint only on rows that are written. The migration comment says never to `VALIDATE` these constraints.
- **Response echo.** `payment-details` echoes `chain_id` and `receiver_address`. #1817 asks the modal to say which chain and which address the PLUSD lands on. The change only adds keys.
- **`signer_address` defaulting.** If omitted, it defaults to the settlement address for a Stellar `G…` and for an EVM `0x…`. It is required for a Stellar `C…`. A Stellar signer must be a `G…` account; an EVM signer is a `0x…` EOA. A `G…` or `0x…` settlement address may name a different signer. The signer is stored next to the address.
- **A failed link proof is `422 Unprocessable Entity`, not `401` (user decision, 2026-11-02).** The cases are:
  - a bad signature;
  - an unknown, expired or consumed challenge;
  - an address or signer that does not match the challenge.

  All share one body, `settlement address proof failed`, so the response gives nothing away. `401` stays reserved for a missing or invalid JWT (`AuthClaims`), because the LP app ends the session on any authenticated `401` (`packages/frontend/src/api/client.ts:141`). This deliberately departs from the issue body's `401`, and the spec records it.
- **Address validation is stricter than today, for the new endpoints only.** Existing `validate_stellar_address` callers are unchanged.
  - Stellar addresses must also pass the Strkey **checksum**: `stellar_strkey::ed25519::PublicKey::from_string` for `G…`, `stellar_strkey::Contract::from_string` for `C…`. A `C…` typo cannot be caught by the signature, because the signature only proves the signer.
  - An EVM address is `0x` + 40 hex digits. Mixed case must be a valid EIP-55 checksum (`alloy::primitives::Address::parse_checksummed`). All-lower and all-upper input is accepted. The address is stored lowercased.
- **Existing unsigned Stellar addresses are kept (user decision, 2026-11-02).** Rows linked before this change, through the unsigned endpoint or the #1813 auto-link, keep `stellar_address` with `stellar_signer_address = NULL`, and the migration clears nothing. A `NULL` signer next to a non-null address means **unproven**. The spec says so, and #1826 (Trustee) should show such addresses as unproven. So the DB constraint is only `stellar_signer_address IS NULL OR stellar_address IS NOT NULL`. A full pairing CHECK would break every later `UPDATE lps` on a legacy row, including `decide_kyb`, because Postgres re-checks constraints on every written row.

### Error contract (exact)

All bodies are `{"error": "<message>"}` (`ApiError`). `<Kind>` is `Stellar` or `EVM`.

**Challenge** (`GET …/challenge`), checked in this order:

| Status | Condition | Message |
|---|---|---|
| 401 | missing, invalid or expired token | (`AuthClaims`, unchanged) |
| 403 | suspended account | `account_suspended` (`AuthClaims`, unchanged) |
| 400 | `chain_id` missing, malformed or unknown | `chain_id is required` / `invalid chain_id: <v>` / `unknown chain_id: <id> (configured: …)` (`RequiredChain`, unchanged) |
| 400 | bad `address` | Stellar: `address must be a Stellar account (G…) or contract (C…) Strkey with a valid checksum`; EVM: `address must be a 0x-prefixed 20-byte hex EVM address` / `address is not a valid EIP-55 checksum` |
| 400 | bad `signer_address` | Stellar: `signer_address must be a Stellar account (G…) Strkey with a valid checksum`; EVM: same as address, with `signer_address` as the key |
| 400 | Stellar `C…` without a signer | `signer_address is required for a Stellar contract (C…) settlement address` |
| 404 | no LP | `this account has not registered an LP yet` (`my_lp`) |
| 409 | LP is `Failed` | `LP <id> was refused at KYB and cannot set a settlement address` |
| 409 | `Passed` and the slot for this kind is set | `LP <id> has passed KYB; its <Kind> settlement address is fixed` |
| 409 | another LP holds the address in this kind | `<Kind> settlement address <address> is already linked to another LP` |
| 200 | otherwise | `{ message, nonce }` |

**Verify** (`POST …/verify`), checked in this order:

- **401 / 403** from `AuthClaims`, unchanged.
- **400** from `require_chain_id`, same messages as the challenge.
- **400** for the same address, signer and `C…`-without-signer validation as the challenge.
- **404** if there is no LP.
- **422** (`ApiError::UnprocessableEntity`) with the single message `settlement address proof failed` for every one of these (no oracle):
  - no live challenge for `(lp_id, chain_id)` (none ever issued, expired, or already consumed);
  - body `address` or the effective `signer_address` differs from the stored binding;
  - signature does not verify against the stored signer (including a sign-in signature);
  - the consume finds no row (concurrent replay).
- **409** with the same three eligibility messages as the challenge, re-checked after the consume. A unique violation on the link maps to the "already linked to another LP" message. A guarded `UPDATE` that touches 0 rows gives `LP <id> is no longer eligible to set a <Kind> settlement address`.
- **200** with the refreshed `LpResponse`.

**Payment details** (`GET /v1/lps/me/payment-details`):
- **400**: `RequiredChain` messages.
- **404**: `my_lp`.
- **409**: `payment details require <unmet list> (this LP is <status> with[ no] linked <Kind> address)`. The unmet list names `a linked <Kind> settlement address` and/or `KYB status Passed`. No row is inserted.
- **500**: bank details missing, or 3 reference collisions. Unchanged.
- `HEAD` stays `405` with `Allow: GET`.

## Assumptions and Risks

- **Ship together with #1825.**
  - Once this merges, the LP app's automatic unsigned link (`packages/frontend/src/api/lps.ts:96`) gets `404` until #1825 lands. The manager should merge the two PRs back-to-back.
  - #1817 must send `chain_id`. Until it does, `payment-details` answers `400`. The modal is not wired yet, so nothing live breaks.
- **Status code differs from the issue body.** Proof failures are `422`, not `401`, by user decision, so the LP app's session-ending `401` handler is never triggered by a bad proof. #1825 should treat a `422` from verify as "request a new challenge and sign again".
- **Migration numbering.** The latest on `main` is `20261102000001`. This plan uses `20261102000002` and `20261102000003`. If `main` gains a later migration before merge, renumber both files and the `include_str!` paths in their tests.
- **Concurrent first links of one address by two LPs.** The challenge-time "held by another LP" check is advisory. The `UNIQUE` index is what enforces it, and verify maps `23505` to `409`.
- **`C…` limit.** The signature proves control of `signer_address`, not authority over the contract. This is recorded in the spec and as TD-162.
- **No rate limit** on challenge issuance, same as `/v1/auth/challenge`. Each call is one upsert on a bounded row set.
- **Only EOA signers on EVM.** `verify_personal_sign` recovers an EOA. ERC-1271 smart-contract wallets cannot sign. The issue defines the EVM signer as an EOA.
- **`AppState` is not extended.** The challenge store methods go on `LpRepo`, which `AppState` already holds. This avoids editing the 13 test files that build `AppState`.
- **Tests stay pure.** No DB and no env vars. SQL is checked as text (the `auth_wallet_challenge.rs` pattern), and the orchestration runs over trait fakes (the `lp_payment_details.rs` pattern). The guarded-`UPDATE`, `DELETE … RETURNING` and NOT VALID behaviour are verified by the manual checklist in the user stories, not by tests.

## Open Questions

_None_

## Implementation Steps

Code style follows AGENTS.md: new Rust files carry at most a 2–3 line `// spec:` header and no doc or body comments. Existing long doc comments in `lps.rs` / `lp_repo.rs` that mention `link_address` or TD-57 are trimmed or corrected, not extended.

1. **Spec first.** Make the doc changes listed under "Docs to Update" (`kyb-lp-verification.md` § Settlement Address and Security Considerations, `api-authorization.md`, `deposits.md` § LP Funding Details) before the code, so the code follows the spec.

2. **Migration `packages/shared/migrations/20261102000002_lps_signed_settlement_addresses.sql`.** Header: issue, spec pointer, the note that existing Stellar addresses are kept with a `NULL` (unproven) signer, rollback SQL.
   ```sql
   ALTER TABLE lps
       ADD COLUMN stellar_signer_address TEXT
           CONSTRAINT lps_stellar_signer_address_ck CHECK (stellar_signer_address IS NULL OR stellar_signer_address ~ '^G[A-Z2-7]{55}$'),
       ADD COLUMN evm_address TEXT
           CONSTRAINT lps_evm_address_key UNIQUE
           CONSTRAINT lps_evm_address_ck CHECK (evm_address IS NULL OR evm_address ~ '^0x[0-9a-f]{40}$'),
       ADD COLUMN evm_signer_address TEXT
           CONSTRAINT lps_evm_signer_address_ck CHECK (evm_signer_address IS NULL OR evm_signer_address ~ '^0x[0-9a-f]{40}$'),
       ADD COLUMN evm_address_linked_at TIMESTAMPTZ;
   ALTER TABLE lps
       ADD CONSTRAINT lps_stellar_signer_needs_address_ck CHECK (stellar_signer_address IS NULL OR stellar_address IS NOT NULL),
       ADD CONSTRAINT lps_evm_link_complete_ck CHECK ((evm_address IS NULL) = (evm_signer_address IS NULL)
                                                  AND (evm_address IS NULL) = (evm_address_linked_at IS NULL));
   CREATE TABLE lp_address_challenges (
       lp_id          BIGINT      NOT NULL REFERENCES lps(id),
       chain_id       BIGINT      NOT NULL,
       address        TEXT        NOT NULL,
       signer_address TEXT        NOT NULL,
       nonce          TEXT        NOT NULL,
       expires_at     TIMESTAMPTZ NOT NULL,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
       PRIMARY KEY (lp_id, chain_id)
   );
   ```

3. **Migration `packages/shared/migrations/20261102000003_lp_requested_bank_details_chain.sql`.** Header: issue, spec pointer, legacy-row rule, "never VALIDATE these constraints", rollback.
   ```sql
   ALTER TABLE lp_requested_bank_details ADD COLUMN chain_id BIGINT, ADD COLUMN receiver_address TEXT;
   UPDATE lp_requested_bank_details r SET receiver_address = l.stellar_address
     FROM lps l WHERE l.id = r.lp_id AND r.receiver_address IS NULL;
   ALTER TABLE lp_requested_bank_details
       ADD CONSTRAINT lp_requested_bank_details_chain_id_nn CHECK (chain_id IS NOT NULL) NOT VALID,
       ADD CONSTRAINT lp_requested_bank_details_receiver_nn CHECK (receiver_address IS NOT NULL) NOT VALID;
   ```

4. **`packages/shared/src/chains.rs`: validators, next to `validate_stellar_address`.** Existing functions stay unchanged.
   - `validate_evm_address(key: &str, raw: &str) -> Result<String>`: trims; requires `0x` + 40 hex digits; if the hex part is mixed case, requires `Address::parse_checksummed(raw, None)` to succeed; returns lowercase.
   - `validate_stellar_account(key: &str, raw: &str) -> Result<String>`: `validate_strkey(…, &['G'])`, then `stellar_strkey::ed25519::PublicKey::from_string` for the checksum.
   - `validate_stellar_settlement_address(key: &str, raw: &str) -> Result<String>`: `validate_strkey(…, &['G','C'])`, then the checksum by prefix (`ed25519::PublicKey` / `stellar_strkey::Contract`).
   - The error strings are the 400 messages in the error contract.

5. **`packages/shared/src/lp_repo.rs`.**
   - `LpRow` and `COLUMNS` gain the four new columns.
   - Add `LpRow::settlement_address(&self, kind: ChainKind) -> Option<&str>`.
   - Delete `link_address`.
   - Add the pub SQL consts below (static strings, no interpolation), so the tests can assert their shape:
     - `ISSUE_OR_REUSE_LINK_CHALLENGE_SQL`: `INSERT INTO lp_address_challenges (lp_id, chain_id, address, signer_address, nonce, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6::double precision)) ON CONFLICT (lp_id, chain_id) DO UPDATE SET nonce = CASE WHEN <reuse> THEN lp_address_challenges.nonce ELSE EXCLUDED.nonce END, expires_at = CASE WHEN <reuse> THEN lp_address_challenges.expires_at ELSE EXCLUDED.expires_at END, address = EXCLUDED.address, signer_address = EXCLUDED.signer_address RETURNING nonce, expires_at`. Here `<reuse>` = `lp_address_challenges.address = EXCLUDED.address AND lp_address_challenges.signer_address = EXCLUDED.signer_address AND lp_address_challenges.expires_at > now() + make_interval(secs => $7::double precision)`.
     - `FIND_LINK_CHALLENGE_SQL`: `SELECT address, signer_address, nonce, expires_at FROM lp_address_challenges WHERE lp_id = $1 AND chain_id = $2 AND expires_at > now()`.
     - `CONSUME_LINK_CHALLENGE_SQL`: `DELETE FROM lp_address_challenges WHERE lp_id = $1 AND chain_id = $2 AND nonce = $3 AND expires_at > now() RETURNING address, signer_address, nonce, expires_at`.
     - `LINK_STELLAR_ADDRESS_SQL`: `UPDATE lps SET stellar_address = $2, stellar_signer_address = $3, address_linked_at = now(), updated_at = now() WHERE id = $1 AND kyb_status <> 'Failed' AND (stellar_address IS NULL OR kyb_status <> 'Passed')`.
     - `LINK_EVM_ADDRESS_SQL`: the same over `evm_address`, `evm_signer_address`, `evm_address_linked_at`.
     - `ADDRESS_HOLDER_STELLAR_SQL` / `ADDRESS_HOLDER_EVM_SQL`: `SELECT id FROM lps WHERE stellar_address = $1` / `… evm_address = $1`.
   - Add `pub struct LinkChallenge { address, signer_address, nonce, expires_at }`.
   - Add `pub enum LinkOutcome { Linked, Ineligible, AddressTaken }`. `AddressTaken` is mapped from `23505` inside the repo, like `InsertOutcome`.
   - Add `#[async_trait] pub trait SettlementLinkStore: Send + Sync`:
     - `issue_or_reuse_challenge(lp_id, chain_id, address, signer, fresh_nonce, ttl_secs) -> (String, DateTime<Utc>)`
     - `find_challenge(lp_id, chain_id) -> Option<LinkChallenge>`
     - `consume_challenge(lp_id, chain_id, nonce) -> Option<LinkChallenge>`
     - `address_holder(kind, address) -> Option<i64>`
     - `link_settlement_address(lp_id, kind, address, signer) -> LinkOutcome`

     All return `Result<_, sqlx::Error>`. Implement it for `LpRepo`. The reuse threshold binds `shared::auth_user_repo::NONCE_REUSE_MIN_REMAINING_SECS`.
   - Update the `KybStatus::allows_address_write` doc: the rule now applies per chain kind, and callers pass that kind's `has_address`.

6. **`packages/api/src/routes/auth/wallet.rs`.** Make `iso` `pub(crate)` so the link message reuses the exact timestamp format. Reuse `CHALLENGE_TTL_SECS`, `challenge_domain` and `ChallengeResponse`. No behaviour change.

7. **New `packages/api/src/routes/lp_settlement_address.rs`** (spec header → `kyb-lp-verification.md#settlement-address`). Register it in `routes/mod.rs`.
   - DTOs:
     - `LinkChallengeQuery { address: String, signer_address: Option<String> }` (`IntoParams`, Query).
     - `LinkVerifyRequest { #[schema(required = true)] chain_id: Option<i64>, address: String, #[serde(default)] signer_address: Option<String>, signature: String }`.
   - `pub const LINK_PROOF_FAILED: &str = "settlement address proof failed";` Every proof failure returns `ApiError::UnprocessableEntity(LINK_PROOF_FAILED.to_owned())` (422), never `Unauthorized`.
   - Pure functions:
     - `pub struct LinkTarget { pub kind: ChainKind, pub address: String, pub signer_address: String }`.
     - `pub fn resolve_link_target(kind, address: &str, signer_address: Option<&str>) -> Result<LinkTarget, String>`. Calls the step-4 validators; a `C…` without a signer is an error; an omitted signer defaults to the normalized address; a blank `signer_address` counts as omitted.
     - `pub fn link_challenge_message(domain, lp_id, chain_id, address, signer_address, nonce, expires_at) -> String`. Byte-exact to the issue's template; `Issued At` = `expires_at - CHALLENGE_TTL_SECS`; uses `iso`.
     - `pub fn link_refusal(lp: &LpRow, kind, holder: Option<i64>, address) -> Result<(), String>`. Parses `kyb_status` and applies `allows_address_write(lp.settlement_address(kind).is_some())`. Produces the `Failed` / "fixed" / "held by another LP" messages. A holder equal to `lp.id` is not a conflict.
     - `pub fn verify_link_signature(kind, message, signature, signer) -> anyhow::Result<()>`. Dispatches to `verify_personal_sign` (EVM) or `verify_stellar_personal_sign` (Stellar).
   - Async orchestrators, generic over `S: SettlementLinkStore + ?Sized` so tests can drive them with a fake:
     - `pub async fn issue_link_challenge(store, lp: &LpRow, chain: ConfiguredChain, target: &LinkTarget, domain: &str, fresh_nonce: String) -> Result<ChallengeResponse, ApiError>`. Runs `address_holder`, then `link_refusal` → 409, then issue-or-reuse → message.
     - `pub async fn verify_link(store, lp: &LpRow, chain: ConfiguredChain, target: &LinkTarget, signature: &str, domain: &str) -> Result<(), ApiError>`. Steps in order:
       1. `find_challenge` → none → 422.
       2. Stored address/signer ≠ target → 422.
       3. Rebuild the message from the stored row.
       4. Verify against the **stored** signer → error → 422.
       5. `consume_challenge` → none → 422.
       6. `link_refusal(lp, …)` with a fresh `address_holder` → 409.
       7. `link_settlement_address` with the consumed row's address and signer: `Ineligible` → 409 "no longer eligible"; `AddressTaken` → 409 "already linked".
   - Handlers (thin):
     - `link_challenge(AuthClaims, State, RequiredChain, Query<LinkChallengeQuery>)`: `resolve_link_target` → 400, then `my_lp` → 404, then `issue_link_challenge(&state.lp_repo, …, Uuid::new_v4().to_string())`.
     - `link_verify(AuthClaims, State, Json<LinkVerifyRequest>)`: `require_chain_id` → 400, then `resolve_link_target` → 400, then `my_lp`, then `verify_link`, then re-read the LP and return `with_documents` as `Json<LpResponse>`. Make `lps::with_documents` `pub(crate)`.
   - `router()` adds `/lps/me/link-address/challenge` (GET) and `/lps/me/link-address/verify` (POST).
   - `LpSettlementAddressDoc` (`OpenApi`, tag `Lps`, `SecurityAddon`) documents both paths with the statuses in the error contract. Verify lists `(status = 422, description = "Proof failed: bad signature, unknown/expired/consumed challenge, or address/signer not matching the challenge (one shared body)")`, and its `401` says only "Missing, invalid, or expired token".

8. **`packages/api/src/routes/lps.rs`.**
   - Remove the `link_address` handler, its route, `LinkAddressRequest`, its OpenAPI path and schema entries, and the `validate_stellar_address` import.
   - Add the new fields to `LpResponse::new` and `From<LpRow> for LpSummary`, with `iso_utc` for the timestamps and `#[schema]` descriptions.
   - Update the module doc so the owner list names the challenge/verify pair and drops the TD-57 paragraph.
   - Retitle the `LpsDoc` tag description "KYB: LP registration, documents, and settlement address linking".

9. **`packages/api/src/main.rs`.** Add `.nest("/v1", pipeline_api::routes::lp_settlement_address::router())` and `api_docs.merge(pipeline_api::routes::lp_settlement_address::LpSettlementAddressDoc::openapi())`.

10. **`packages/shared/src/lp_requested_bank_details_repo.rs`.** `PaymentDetailsStore::insert(&self, lp_id: i64, chain_id: i64, receiver_address: &str, payment_details: &str)`. The SQL inserts all four columns. Collision mapping is unchanged.

11. **`packages/api/src/routes/lp_bank_deposits.rs`.**
    - `payment_details_access(kyb_status, kind: ChainKind, settlement_address: Option<&str>) -> Result<(), String>`, with the kind-named messages from the error contract.
    - `issue_payment_details(store, lp_id, chain_id, receiver_address, next)`.
    - `request_payment_details(bank, store, lp_id, kyb_status, chain: ConfiguredChain, settlement_address: Option<&str>, next)`. The access check stays first and inserts no row on refusal.
    - `PaymentDetailsResponse` gains `chain_id: i64` and `receiver_address: String`. `new(details, payment_details, chain_id, receiver_address)`.
    - The handler takes `RequiredChain` and passes `lp.settlement_address(chain.kind)`.
    - utoipa: `params(RequiredChain)`, plus a 400 response. Keep `payment_details_reply` (200 + `Cache-Control: no-store`) and the HEAD → 405 route unchanged.

12. **Lint and build.** Run `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test -p shared -p pipeline-api`, and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure and live in `packages/<pkg>/tests/<topic>.rs`. No DB connection, and no `DATABASE_URL`, `POSTGRES_URL` or other env vars. `connect_lazy` pools are fine only in router tests that never reach a handler body, as `lp_payment_details_head.rs` already does.

**`packages/shared/tests/chains.rs` (extend):**
- `validate_evm_address`:
  - all-lower and all-upper inputs pass;
  - a valid EIP-55 mixed-case address passes and comes back lowercase;
  - one flipped case letter fails as an invalid checksum;
  - inputs without `0x`, with 39 or 41 hex digits, or with non-hex characters fail.
- `validate_stellar_account`:
  - a real `G…` passes (built from `ed25519::PublicKey([7;32]).to_string()`);
  - lowercase input is uppercased;
  - a `C…` fails;
  - a `G…` with a corrupted last character fails on the checksum.
- `validate_stellar_settlement_address`: `G…` and `C…` (from `stellar_strkey::Contract([9;32])`) pass, a corrupted checksum fails, and `M…` fails.

**`packages/shared/tests/settlement_address.rs` (extend):**
- The SQL consts:
  - the link SQL per kind writes its own column trio and keeps `kyb_status <> 'Failed' AND (<col> IS NULL OR kyb_status <> 'Passed')`;
  - the EVM SQL never touches `stellar_*`, and the reverse;
  - consume is one `DELETE` guarded by `lp_id`, `chain_id`, `nonce` and `expires_at > now()`, with `RETURNING address, signer_address`;
  - issue-or-reuse is one `INSERT … ON CONFLICT (lp_id, chain_id)`, its reuse predicate compares `address`, `signer_address` and the `$7` threshold (asserted twice), and it uses no app clock.
- `LpRow::settlement_address` returns the matching slot per kind.

**`packages/shared/tests/migration_lp_signed_settlement_addresses.rs` (new, `include_str!`):**
- Every new `lps` column and named constraint is present.
- `lps_evm_address_key UNIQUE` and the lowercase regex are there.
- There is no CHECK that requires `stellar_signer_address` whenever `stellar_address` is set (the guard that keeps existing unsigned addresses valid).
- The `lp_address_challenges` PK is `(lp_id, chain_id)` with an FK to `lps(id)`.
- The header documents rollback.

**`packages/shared/tests/migration_lp_payment_details_chain.rs` (new):**
- Both columns are added nullable.
- The backfill reads `lps.stellar_address`.
- Both CHECKs are `NOT VALID`, and the file never says `VALIDATE CONSTRAINT`.
- `20261102000001_*` is untouched, so `migration_lp_payment_details.rs` keeps passing unchanged.

**`packages/api/tests/lp_settlement_address.rs` (new).** Uses a `FakeLinkStore` implementing `SettlementLinkStore` over a `Mutex`. It has an injectable "expired" flag, removes the challenge on consume, and has a scriptable holder and link outcome. Keys come from alloy `PrivateKeySigner` (EVM) and ed25519 `SigningKey` (Stellar).
- Message:
  - byte-exact against the issue template;
  - `Issued At` = expiry − 300 s;
  - deterministic;
  - changes with each bound field (domain, lp_id, chain_id, address, signer, nonce, expiry);
  - differs from `challenge_message` for the same address, chain and nonce.
- `resolve_link_target`:
  - `G…` with no signer defaults to itself;
  - `C…` with no signer → the exact 400 message;
  - `C…` + `G…` signer is ok;
  - a Stellar signer `C…` → 400;
  - EVM with no signer defaults to the lowercased address;
  - EVM with a different signer is kept;
  - a Stellar address on an EVM chain → 400, and the reverse;
  - a blank signer counts as omitted.
- `link_refusal`:
  - `Failed` with and without an address → 409 message;
  - `Passed` with that kind set → "fixed";
  - `Passed` with the *other* kind set → allowed;
  - another LP holds it → 409;
  - this LP holds it at a non-terminal status → allowed.
- `issue_link_challenge`: returns the fake's nonce and the rebuilt message; refused LPs never reach the store's issue method.
- `verify_link` — the acceptance list, one test each:
  - signature by a key other than `signer_address` → 422 `settlement address proof failed`, and the challenge is still present;
  - expired challenge → 422;
  - replay (a second verify after success) → 422;
  - signature over the sign-in `challenge_message` → 422;
  - body `address` ≠ stored → 422;
  - body `signer_address` ≠ stored → 422;
  - `C…` without a signer → 400 (through `resolve_link_target`);
  - LP turned `Failed` after the challenge → 409, with the challenge consumed;
  - `Passed` with that kind already set → 409;
  - fake consume returns `None` (concurrent second verify) → 422 and no link call;
  - `AddressTaken` → 409 "already linked";
  - `Ineligible` → 409 "no longer eligible";
  - happy paths: Stellar `G…` self-signed; Stellar `C…` with a `G…` signer (SEP-53 over the exact message, base64 and hex); EVM self-signed, where the link call receives the **stored** lowercased address and signer.
- OpenAPI (`LpSettlementAddressDoc`):
  - challenge is a GET with required `chain_id` and `address` params and optional `signer_address`, documenting 200/400/401/404/409;
  - verify is a POST whose body schema requires `chain_id`, `address` and `signature`, with `signer_address` optional, documenting 200/400/401/404/409/422, where the 401 description says only missing, invalid or expired token and the 422 description names the proof failures;
  - 200 references `ChallengeResponse` and `LpResponse` respectively.
- Router (lazy pool, the `lp_payment_details_head.rs` pattern): `POST /lps/me/link-address` on `lps::router(..)` merged with `lp_settlement_address::router()` answers `404`.

**`packages/api/tests/lps.rs` (update):**
- Delete the four `link_address_*` / `LinkAddressRequest` tests.
- Assert `LpsDoc` has no `/v1/lps/me/link-address` path and no `LinkAddressRequest` schema.
- Assert the `LpResponse` and `LpSummary` schemas carry the new nullable fields. Keep `lp_response_stellar_address_no_longer_claims_passed_only`.

**`packages/api/tests/lp_payment_details.rs` (update):**
- `FakeStore` records `(lp_id, chain_id, receiver, value)`.
- Access gate per kind: Stellar chain + Stellar address ok; EVM chain + only a Stellar address → 409 naming "a linked EVM settlement address"; an EVM-only LP on a Stellar chain → 409; status messages as before.
- The happy path stores `chain_id` and `receiver_address` on the row and echoes them.
- The response has exactly 9 keys: 7 strings plus integer `chain_id` and string `receiver_address`.
- OpenAPI: the path now has a required `chain_id` query param (replacing the "no parameters" assertion) and documents 400.
- Unchanged: no row on refusal, collision redraw, 3-attempt cap, `Cache-Control: no-store`.

**`packages/api/tests/lp_payment_details_head.rs`:** still `405` with `Allow: GET`. It must still pass once the GET handler takes `RequiredChain`.

**Manual / QA (user stories, against a running API and DB):**
- the guarded `UPDATE` races;
- the `DELETE … RETURNING` single-use behaviour under two concurrent verifies;
- the NOT VALID constraints refusing a new row without a chain;
- legacy rows keeping `chain_id NULL`.

## Docs to Update

- `docs/product-specs/kyb-lp-verification.md`:
  - **§ Settlement Address** (rewrite):
    - one address per chain kind (Stellar `G…`/`C…`, EVM `0x…`, stored lowercase), each linked independently;
    - the fixing and `Failed` rules apply per kind, and uniqueness holds per kind;
    - `signer_address`: its default, required for `C…`, a `G…` account / EVM EOA, stored next to the address;
    - the challenge → verify flow and its message;
    - the unsigned endpoint is gone;
    - addresses linked before this change are kept with a `NULL` signer and are **unproven**; the Trustee (#1826) shows them as unproven;
    - the known `C…` limit.
  - **Security Considerations:** replace the "unverified" bullet with the signed-proof bullet and the `C…` limit, and mark TD-57 resolved.
- `docs/product-specs/api-authorization.md`:
  - add a "Settlement-address proof" subsection: the second challenge kind on `lp_address_challenges`, the 5-min TTL and 60-s reuse bound to `(lp_id, chain_id, address, signer_address)`, atomic `DELETE` consume, a message distinct from sign-in, and the shared `422 settlement address proof failed` (`401` only for a missing or invalid token);
  - add the two endpoints to the API Contract table;
  - add the `lp_address_challenges` table to the Data Model.
- `docs/product-specs/deposits.md` § LP Funding Details:
  - required `chain_id` (`RequiredChain`) and the per-kind gate;
  - the response JSON with `chain_id` and `receiver_address`;
  - the history row stores `chain_id` and `receiver_address`;
  - legacy rows (`chain_id NULL`, receiver backfilled from `stellar_address`).
- `docs/frontend/bank-transfers.md` (row at line ~286): the call needs `?chain_id=`, and the response echoes `chain_id` and `receiver_address`. Client wiring stays #1817.
- `docs/user-stories/epic-1247/1815-lp-payment-details.md`: add `chain_id` to every curl; 9 keys; a new story for the per-kind 409.
- New `docs/user-stories/epic-1247/1824-signed-settlement-address.md` (curl + DB stories):
  - link a Stellar `G…`, a `C…` with a `G…` signer, and an EVM address;
  - expired, replayed and wrong-signer refusals, each `422` with the shared body and the session still valid afterwards;
  - `Failed` / `Passed`-fixed refusals;
  - a concurrent double verify;
  - the old path returning `404`;
  - `payment-details` per chain.

  Add its row to `docs/user-stories/index.md`.
- `docs/exec-plans/tech-debt-tracker.md`:
  - TD-57 → `[RESOLVED <date> / #1824]` with a one-line pointer;
  - new **TD-162**: a Stellar `C…` settlement address is proven only through its `G…` signer, with no on-chain check that the signer controls the contract;
  - bump "Next free number" to TD-163.
- OpenAPI is generated at runtime through utoipa (`/api-docs/openapi.json`). There is no checked-in artifact in `docs/generated/` to regenerate.
