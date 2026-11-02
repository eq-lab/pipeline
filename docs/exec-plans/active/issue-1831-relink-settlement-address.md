# Issue #1831: Backend: let an LP change its linked settlement address at any time (including after KYB Passed)

Source: https://github.com/eq-lab/pipeline/issues/1831

## Scope

User decision of 2026-11-02 (issue body). These points are not reopened here:

- An LP may link **and relink** its Stellar and EVM settlement address at `NotStarted`, `InProgress`, `UnderReview`, `ChangesRequested` and `Passed`. Only `Failed` is refused.
- The flow stays the signed challenge → verify flow from #1824. There is no extra protection after `Passed`: no signature by the old address and no Trustee approval. The trade-off is recorded as a new tech-debt entry, **TD-163**.
- Every successful link or relink appends one row to a new history table, `lp_settlement_address_history`. The row is written **in the same SQL statement** as the guarded `UPDATE lps`. The migration backfills one row per address currently set. There is no read endpoint.

What changes:

1. **Rule.** `KybStatus::allows_address_write` stops depending on whether an address is held. It refuses only `Failed`. The `has_address` parameter is removed because it no longer affects the answer.
2. **Guard SQL.** `LINK_STELLAR_ADDRESS_SQL` / `LINK_EVM_ADDRESS_SQL` lose the `AND (<addr> IS NULL OR kyb_status <> 'Passed')` clause. Each becomes one data-modifying statement: it locks and reads the previous address and signer, runs the guarded `UPDATE lps`, and inserts the history row.
3. **Refusal.** `link_refusal` loses the "has passed KYB; its … settlement address is fixed" branch. The utoipa `409` descriptions on challenge and verify change to match.
4. **History table.** New migration `20261102000004_lp_settlement_address_history.sql` with the table, index, backfill and `NOT VALID` checks. There is a repo read method, `LpRepo::settlement_address_history`, but no endpoint.
5. **Who linked.** `verify_link` gets the authenticated `claims.account_id` from the handler and passes it to the store as `linked_by_account_id`, together with the verify call's `chain_id`.
6. **Docs.** KYB spec, deposits spec (receiver race + mint-to-current rule), api-authorization table row, lender onboarding doc, user stories, and TD-163.

Out of scope:

- Frontend: `settlementWritable` (`packages/frontend/src/components/account/settlementAddress.ts:28`), its captions, and `docs/frontend/account-page.md` § settlement address (lines ~251–252). #1825 owns these, and its body already notes the `settlementWritable` change. See Risks for a note #1825 needs.
- Trustee UI (#1826). It already mints to the LP's current address per chain.
- A read endpoint for the history.
- Notifications, old-address signature, Trustee approval. These are listed only as mitigations in TD-163.
- Stellar contracts, which are frozen. Nothing on-chain changes.
- Editing applied migrations. `20261102000003`'s header says "Passed fixes that address". That was true when its backfill ran, and editing an applied migration would change its sqlx checksum. Leave it as it is.
- `docs/user-stories/epic-1376/1379-ungate-link-address.md` Story 4 and `verification-runbook.md` step 19. They exercise the unsigned `POST /v1/lps/me/link-address`, which #1824 deleted (it now answers `404`), so they were already stale before this issue. This issue does not change them.

**#1829 becomes obsolete.** A `Passed` LP proves a legacy unsigned Stellar address by relinking the **same** address through the signed flow. That is exactly what #1829 asked for. The PR body should say `Closes #1831` and also close #1829 as superseded (manager action: closing or commenting on #1829 is not the planner's job).

## Assumptions and Risks

- **Stacked on #1830 (PR #1832, in review).** This branch is built on `fix/1830-link-review-followups`. It assumes `link_refusal(lp, status: KybStatus, kind, holder, address)`, `lp_kyb_status`, `ChainKind::label()` and `iso_utc` as they are on that branch. If review changes #1832, rebase this branch onto the new head before implementing. If #1832 merges first, retarget the PR to `main`.
- **Migration number.** The latest migration on `main` and on this branch is `20261102000003`. No open PR branch has `…000004` (checked across all remote branches). Use `20261102000004_lp_settlement_address_history.sql`. If `main` gains a later migration before merge, renumber the file and the `include_str!` path in its test.
- **TD number.** The tracker says "Next free number: TD-163", on `main`, on #1832's branch and on #1833's branch. Take TD-163 and bump the line to TD-164. If another PR takes TD-163 first, renumber.
- **Single statement = same transaction.** The guarded `UPDATE` and the history `INSERT` are one SQL statement (a data-modifying CTE). The statement is atomic on its own, so the history and `lps` cannot disagree, and the pure tests can prove that from the SQL text. An explicit `pool.begin()` transaction would be equally correct, but a pure test cannot see it.
  - A UNIQUE violation on `lps` aborts the whole statement, so no history row is written (→ `AddressTaken`).
  - A guard miss (`Failed`) updates nothing, so `INSERT … SELECT … FROM linked` inserts nothing (→ `Ineligible`).
- **Reading the previous values.** `UPDATE … RETURNING` returns new values only (`RETURNING old.*` needs Postgres 18, and nothing pins the server version). So the statement reads the pre-update row in a CTE with `FOR UPDATE` and joins it into the `UPDATE … FROM`. Under READ COMMITTED, `FOR UPDATE` waits for and returns the latest committed row version. Two concurrent links of the same LP (for example Stellar and EVM verifies at the same time) therefore serialise on the row lock, and each one's `previous_*` is exact.
- **Backfilled rows have unknowns.** A backfilled row cannot know the verify `chain_id` (the kind comes from `CHAIN_<id>_TYPE` env, as in `20261102000003`) or who linked it. So `chain_id`, `signer_address` (NULL for legacy unproven Stellar links) and `linked_by_account_id` are nullable columns with `NOT VALID` NOT NULL checks, added **after** the backfill `INSERT`. Every new row must carry all three. The table is insert-only, so Postgres never re-checks the backfilled rows. The migration header must say "never VALIDATE these constraints". The same pattern is used in `20261102000003`. A backfilled row can be recognised by `chain_id IS NULL`.
  - `linked_by_account_id` is NULL rather than `owner_account_id`. In an investigation table, "unknown" is more honest than an inference, and the owner is one join away (`lps.owner_account_id`).
- **Backfill `created_at`.** `created_at = *_linked_at`, as the issue says. `evm_address_linked_at` is non-null whenever `evm_address` is, because `lps_evm_link_complete_ck` enforces it. No DB constraint pairs `address_linked_at` with `stellar_address`. Every code path that ever wrote the address also set it, but a hand edit could have left it NULL. `created_at` is NOT NULL, so use `COALESCE(address_linked_at, updated_at)` to stop one hand-edited row from failing the migration in production, and say so in the header. This is the only deviation from the literal issue text.
- **Payment-details receiver race: accept and document (decided here).** `get_my_payment_details` reads the LP once and passes `lp.settlement_address(kind)` to the insert. A relink that commits between that read and the insert stores the address that was current just before. Reading the receiver inside the insert (`INSERT … SELECT … FROM lps`) is rejected:
  - it only shrinks the window. The LP can legitimately relink one second after getting the response, and that leaves exactly the same stale `receiver_address` on the reference;
  - `receiver_address` records what was **shown** with the reference. It does not decide the mint. The mint goes to the LP's **current** address (next bullet), so a stale recorded receiver never redirects money;
  - only the LP itself can cause the race, by relinking during its own request;
  - it would change `PaymentDetailsStore::insert`, its fake and the 638-line test file for no safety gain.

  The gate itself cannot become wrong: `Passed` is still terminal, and an address can be replaced but never cleared, so "Passed with an address of this kind" stays true between the check and the insert.
- **Minting rule.** A wire is minted to the LP's **current** settlement address of the deposit's chain kind, read at mint time. It is never minted to a reference's recorded `receiver_address`. This is already how the Trustee app behaves (`wireInReceiver` reads `stellar_address`), and it is what #1826 specifies per chain. It is written into `deposits.md`. Wire matching (follow-up) still finds the LP by any reference it was ever issued.
- **Security trade-off, accepted.** With the address no longer fixed, and with a separate signer allowed for any address (TD-162), a hijacked LP session can redirect all future mints by linking an address it controls. This is TD-163. The history table at least leaves a trail: who, when, old → new.
- **Note for #1825 (frontend).** `useSettlementAddressLink` used to link automatically when a different wallet connected, and `settlementWritable` was the only thing stopping that for a `Passed` LP. Once #1825 allows relinking at `Passed`, connecting a different wallet must **not** silently start a relink; relinking has to be an explicit user action. Raise this on #1825 (manager action). This plan changes no frontend code.
- **Note for #1826 (Trustee).** Its item 5 shows the receiver recorded on a reference. After a relink, that can differ from the address the mint uses. #1826 should display the mint receiver as the current address (manager may add a comment).
- **Comment rule.** AGENTS.md: comment-less code. Stale doc comments that describe "fixed at Passed" are deleted, not rewritten into new prose; the rule lives in the spec. Exception: the `LpResponse.stellar_address` field doc is emitted as an OpenAPI schema description, so it is corrected to one line instead of deleted.

## Open Questions

_None_

## Implementation Steps

1. **Migration `packages/shared/migrations/20261102000004_lp_settlement_address_history.sql`.**
   - Header, a few lines:
     - `-- Migration: append-only settlement-address link history per LP (#1831).`
     - spec pointer `docs/product-specs/kyb-lp-verification.md#link-history`;
     - the backfill rule: one row per set address; `chain_id` / `linked_by_account_id` NULL; `signer_address` NULL for legacy unproven Stellar links; `created_at = *_linked_at`, with `updated_at` as a fallback for a hand-edited NULL;
     - "insert-only; never VALIDATE these constraints";
     - `-- Rollback:` with `-- DROP TABLE lp_settlement_address_history;`.
   - Body:
     ```sql
     CREATE TABLE lp_settlement_address_history (
         id                      BIGSERIAL   PRIMARY KEY,
         lp_id                   BIGINT      NOT NULL REFERENCES lps(id),
         chain_kind              TEXT        NOT NULL
             CONSTRAINT lp_settlement_address_history_kind_ck CHECK (chain_kind IN ('stellar', 'evm')),
         chain_id                BIGINT,
         address                 TEXT        NOT NULL,
         signer_address          TEXT,
         previous_address        TEXT,
         previous_signer_address TEXT,
         linked_by_account_id    UUID        REFERENCES accounts(id),
         created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
     );

     CREATE INDEX lp_settlement_address_history_lp_created_idx
         ON lp_settlement_address_history (lp_id, created_at);

     INSERT INTO lp_settlement_address_history (lp_id, chain_kind, address, signer_address, created_at)
     SELECT id, 'stellar', stellar_address, stellar_signer_address, COALESCE(address_linked_at, updated_at)
       FROM lps WHERE stellar_address IS NOT NULL;

     INSERT INTO lp_settlement_address_history (lp_id, chain_kind, address, signer_address, created_at)
     SELECT id, 'evm', evm_address, evm_signer_address, evm_address_linked_at
       FROM lps WHERE evm_address IS NOT NULL;

     ALTER TABLE lp_settlement_address_history
         ADD CONSTRAINT lp_settlement_address_history_chain_id_nn CHECK (chain_id IS NOT NULL) NOT VALID,
         ADD CONSTRAINT lp_settlement_address_history_signer_nn CHECK (signer_address IS NOT NULL) NOT VALID,
         ADD CONSTRAINT lp_settlement_address_history_linked_by_nn CHECK (linked_by_account_id IS NOT NULL) NOT VALID;
     ```

2. **`packages/shared/src/lp_repo.rs`: the rule.**
   - Replace `allows_address_write(&self, has_address: bool)` with `pub fn allows_address_write(&self) -> bool`. Keep an exhaustive `match`: `Failed => false`, and every other variant listed explicitly `=> true`. A new status must then be classified on purpose.
   - Delete the stale doc block above it (current lines ~154–178).
   - Delete the stale field doc on `LpRow::stellar_address` (lines ~235–237).
   - In the `KybStatus` type doc (lines ~36–44), keep the pointer to `allows_address_write` and drop the "`stellar_address` may be written" wording only if it now reads wrong. Make no other doc edits.

3. **`packages/shared/src/lp_repo.rs`: link SQL + history.**
   - Rewrite both constants as one statement each. Binds: `$1` lp_id, `$2` address, `$3` signer_address, `$4` chain_id, `$5` linked_by_account_id. Stellar shown; EVM is the same with `evm_address`, `evm_signer_address`, `evm_address_linked_at` and `'evm'`:
     ```sql
     WITH prev AS (
         SELECT id, stellar_address, stellar_signer_address FROM lps WHERE id = $1 FOR UPDATE
     ), linked AS (
         UPDATE lps SET stellar_address = $2, stellar_signer_address = $3, address_linked_at = now(), updated_at = now()
           FROM prev
          WHERE lps.id = prev.id AND lps.kyb_status <> 'Failed'
         RETURNING lps.id, prev.stellar_address AS previous_address,
                   prev.stellar_signer_address AS previous_signer_address, lps.address_linked_at
     )
     INSERT INTO lp_settlement_address_history
         (lp_id, chain_kind, chain_id, address, signer_address, previous_address,
          previous_signer_address, linked_by_account_id, created_at)
     SELECT id, 'stellar', $4, $2, $3, previous_address, previous_signer_address, $5, address_linked_at
       FROM linked
     RETURNING id
     ```
     `created_at = address_linked_at` (the same `now()`), so a history row and the `lps` timestamp match exactly.
   - Add a link descriptor and change the trait method to take it. This keeps the arity low and lets the fake record exactly what was asked:
     ```rust
     #[derive(Debug, Clone, PartialEq, Eq)]
     pub struct SettlementLink {
         pub lp_id: i64,
         pub kind: ChainKind,
         pub chain_id: i64,
         pub address: String,
         pub signer_address: String,
         pub linked_by_account_id: Uuid,
     }
     async fn link_settlement_address(&self, link: &SettlementLink) -> Result<LinkOutcome, sqlx::Error>;
     ```
   - `LpRepo` impl:
     - `sqlx::query_as::<_, (i64,)>(sql)` with the five binds, then `.fetch_optional(&self.pool)`;
     - `Ok(Some(_)) → Linked`, `Ok(None) → Ineligible`;
     - a unique violation maps to `AddressTaken` as today; any other error propagates.
   - History read, with no endpoint:
     - `pub const LIST_SETTLEMENT_ADDRESS_HISTORY_SQL`: `SELECT id, lp_id, chain_kind, chain_id, address, signer_address, previous_address, previous_signer_address, linked_by_account_id, created_at FROM lp_settlement_address_history WHERE lp_id = $1 ORDER BY created_at DESC, id DESC`;
     - `#[derive(Debug, Clone, sqlx::FromRow)] pub struct SettlementAddressHistoryRow` with matching fields. `chain_id`, `signer_address`, `previous_*` and `linked_by_account_id` are `Option`;
     - `impl LpRepo { pub async fn settlement_address_history(&self, lp_id: i64) -> Result<Vec<SettlementAddressHistoryRow>, sqlx::Error> }`.
   - No other code in the crate may `UPDATE` or `DELETE` from the table (append-only).

4. **`packages/api/src/routes/lp_settlement_address.rs`.**
   - `link_refusal`: replace the eligibility block with `if !status.allows_address_write() { return Err(format!("LP {} was refused at KYB and cannot set a settlement address", lp.id)); }`. The holder check stays unchanged. `lp.settlement_address(kind)` is no longer used here; the method stays because payment-details uses it.
   - `verify_link`: add a final parameter `linked_by: Uuid` (7 parameters, within clippy's limit). After the post-consume `link_refusal`, call `store.link_settlement_address(&SettlementLink { lp_id: lp.id, kind: target.kind, chain_id: chain.chain_id, address: consumed.address.clone(), signer_address: consumed.signer_address.clone(), linked_by_account_id: linked_by })`. The outcome mapping and messages stay unchanged.
   - `link_verify` handler: `verify_link(&state.lp_repo, &lp, chain, &target, &req.signature, &domain, claims.account_id)`. `claims.account_id` is the authenticated account, the same one `my_lp` resolved the LP by (`find_by_owner_account_id(claims.account_id)`).
   - utoipa `409` on both paths: `"The LP was refused at KYB, or the address belongs to another LP"`.
   - Imports: add `SettlementLink`. `Uuid` is already imported.

5. **`packages/api/src/routes/lps.rs`.** `LpResponse.stellar_address` field doc (line ~110) becomes one line: `/// Replaceable at any status except \`Failed\` (signed link).` The module doc (lines ~35–52) is still accurate, so leave it.

6. **Docs.** See Docs to Update. The text follows the decisions in Assumptions and Risks.

7. **Lint and checks.**
   - `cargo fmt --all -- --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `npx tsx scripts/lint-docs.ts`
   - `grep -rn "allows_address_write(\(true\|false\)" packages` returns nothing.
   - `grep -rn "settlement address is fixed" packages/api packages/shared` returns nothing. Frontend strings are #1825's.

## Test Strategy

All tests are pure: no DB, and no `DATABASE_URL`, `POSTGRES_URL` or other env vars. They go only in `packages/<pkg>/tests/<topic>.rs`, never in inline `#[cfg(test)]`. SQL is checked as text. DB behaviour (row locks, actual history rows) is covered by the user-stories doc in step 6 for QA.

**`packages/shared/tests/settlement_address.rs` (update):**
- Replace `an_unlinked_lp_may_set_…`, `a_linked_address_may_be_replaced_…`, `the_two_terminal_statuses_close_…` and the total-classification test with:
  - `every_status_but_failed_allows_a_link_or_relink`: an exhaustive `expected(status)` match over `KybStatus::ALL`. `Passed => true` and `Failed => false`, each asserted explicitly.
  - `passed_allows_a_relink`: names the user decision.
- `the_policy_is_independent_of_the_write_freeze`: update for the arity change. `Passed` is now address-writable while the profile is frozen.
- `the_*_link_sql_…` (both kinds):
  - the text contains the `SET … = $2, … = $3, …linked_at = now()` fragment;
  - contains `lps.kyb_status <> 'Failed'`;
  - does **not** contain `kyb_status <> 'Passed'` or `IS NULL OR`;
  - contains `FOR UPDATE`;
  - contains `INSERT INTO lp_settlement_address_history`, followed by `FROM linked` and `RETURNING id`;
  - the chain-kind literal is `'stellar'` / `'evm'` respectively;
  - `previous_address` comes from `prev.<kind>_address`;
  - `$4` is in the `chain_id` position and `$5` in the `linked_by_account_id` position;
  - the other kind's columns are absent (keep the `!contains("evm_")` / `!contains("stellar_")` checks).
- `the_link_is_one_statement`: each constant has exactly one `INSERT` and one `UPDATE lps`, and no `;`.
- `history_is_listed_newest_first_for_one_lp`: text of `LIST_SETTLEMENT_ADDRESS_HISTORY_SQL`.
- `history_is_append_only_in_code`: `include_str!("../src/lp_repo.rs")` contains neither `UPDATE lp_settlement_address_history` nor `DELETE FROM lp_settlement_address_history`.

**`packages/shared/tests/kyb_status.rs` (update):** `the_three_status_policies_are_independent` uses the new arity.

**`packages/shared/tests/migration_lp_settlement_address_history.rs` (new, `include_str!`):**
- The table and every column with its type. `lp_id … REFERENCES lps(id)` and `linked_by_account_id UUID REFERENCES accounts(id)`. The kind CHECK.
- The index `(lp_id, created_at)`.
- Backfill: both `INSERT … SELECT` statements, with `WHERE stellar_address IS NOT NULL` / `WHERE evm_address IS NOT NULL`, the signer column copied, `COALESCE(address_linked_at, updated_at)` and `evm_address_linked_at`. Neither backfill names `chain_id`, `previous_*` or `linked_by_account_id`, so they stay NULL.
- The three `… NOT VALID` constraints, positioned **after** both backfill inserts (byte-offset order check, as in `migrations.rs`).
- No `VALIDATE CONSTRAINT`. No `UPDATE lps` (the migration does not touch `lps`).
- The header has `-- Rollback:` and `DROP TABLE lp_settlement_address_history`.

**`packages/api/tests/lp_settlement_address.rs` (update):**
- **Fake store.** `links: Vec<SettlementLink>`. `link_settlement_address(&SettlementLink)` records the link when the outcome is `Linked`. Add a `const ACCOUNT: Uuid` (for example `Uuid::from_u128(7)`) passed to every `verify_link`.
- **Helpers.**
  - `issue_for(store, lp, chain, target, nonce)` replaces the `open_lp()`-only `issue` helper, so tests can issue for a linked or `Passed` LP with distinct nonces.
  - `link_for(&lp, chain, address, signer)` builds the expected `SettlementLink`.
- **`link_refusal` tests:**
  - Delete `a_passed_lp_with_that_kind_set_is_fixed`.
  - Add `a_passed_lp_may_relink_either_kind`: `Passed` with both slots set is `Ok` for both kinds.
  - `a_failed_lp_is_refused_with_or_without_an_address` and the holder tests are unchanged.
- **"At any time".** `relink_succeeds_at_every_non_failed_status_for_both_kinds`: loop over `[NotStarted, InProgress, UnderReview, ChangesRequested, Passed]` × `[STELLAR, EVM]`.
  - The LP row already holds a different address of that kind.
  - Issue a challenge, sign it with the new key, verify.
  - Assert `Ok` and exactly one recorded `SettlementLink` with the new address and signer, `chain_id` of the chain, and `linked_by_account_id == ACCOUNT`.
  - Assert the challenge is gone.
- **`a_passed_lp_relinks_through_challenge_and_verify`** replaces `a_passed_lp_with_that_kind_already_set_is_a_conflict`. Challenge-time (`issue_link_challenge` returns a message) and verify-time `Ok` for `lp("Passed", Some(old_g), None)`.
- **Repeated relinks.** `repeated_relinks_each_need_a_fresh_challenge`:
  - Stellar A → B → A → A, each with its own issue (nonces `n-1`…`n-4`) and signature.
  - Four links are recorded in order.
  - Re-sending the first verify's signature afterwards is `422 settlement address proof failed`, and no fifth link is recorded.
  - Repeat with EVM.
- **Back and same address.**
  - `relinking_back_to_a_previous_address_is_allowed` (holder `Some(LP_ID)`).
  - `a_passed_lp_proves_its_legacy_unsigned_address_by_relinking_it`: the row is `Passed`, `stellar_address = G` and `stellar_signer_address = None`, with holder `Some(LP_ID)`. Challenge and verify for `G` with signer `G` give `Ok`, and the recorded link has `signer_address = G`. This is the #1829 case.
- **No history on refusal or proof failure.** Every existing refusal and proof-failure test also asserts `store.links().is_empty()` where it does not already. That covers wrong key, expired, never issued, replay, sign-in signature, address mismatch, signer mismatch, `Failed` after the challenge, lost consume race, corrupt status. For `AddressTaken` / `Ineligible`, the fake records nothing, which mirrors the single statement aborting or inserting nothing.
- **Still refused.** `a_failed_lp_is_still_a_409_at_challenge_and_verify` (existing tests suffice; keep them). `an_address_held_by_another_lp_is_refused_at_challenge_time` stays.
- **OpenAPI.** Assert the `409` description on both paths no longer mentions "fixed".

**`packages/api/tests/lp_payment_details.rs` (add one test):** `a_relink_changes_the_receiver_of_new_references_only`:
- Call `request_payment_details` with `Some(OLD_ADDR)`, then again with `Some(NEW_ADDR)` (same LP, `Passed`, same chain). This simulates the LP row re-read after a relink.
- The store holds two rows: the first keeps `OLD_ADDR` and the second has `NEW_ADDR`.
- The second response echoes `NEW_ADDR`.
- Do the same for EVM.

**Run:**
- `cargo test -p shared --test settlement_address --test kyb_status --test migration_lp_settlement_address_history`
- `cargo test -p pipeline-api --test lp_settlement_address --test lp_payment_details`
- clippy as in step 7.

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md` § Settlement Address**
  - **Line ~72 (status rule).** Rewrite: an address of each kind may be linked and relinked at any status except `Failed`, including `Passed` (user decision 2026-11-02, #1831), with no limit on relinks. Each needs its own signed challenge, and nothing else (no old-address signature, no Trustee approval; TD-163). A relink replaces the address, the signer and `*_linked_at`. The previous address is released and another LP may then link it. Keep the `Failed` paragraph and its rationale.
  - **Line ~74.** "The fixing rule above does not depend on that" becomes "The `Failed` refusal above does not depend on that."
  - **Line ~102.** The `409` list drops "or `Passed` with the slot of that kind already set".
  - **Line ~110 (§ Existing unsigned addresses).** Replace "An unproven address is still fixed at `Passed` … where the status rule above allows." with: an unproven address still serves payment details. The LP proves it by relinking the **same** address through the signed flow, at any status except `Failed`, including `Passed`. The signer then becomes non-null. This supersedes #1829.
  - **New `#### Link history` subsection.** Cover:
    - `lp_settlement_address_history`, append-only, with its columns;
    - one row per successful link or relink, written in the same statement as the guarded update, with `created_at` equal to `*_linked_at`; no row on a refusal or a failed proof;
    - backfill: one row per address set at migration time, with `chain_id`, `linked_by_account_id` and `previous_*` NULL, and the signer NULL for legacy unproven links;
    - no read endpoint yet (Trustee view, investigations and wire matching are later consumers).
  - **§ Security Considerations.** Add a bullet: the settlement address can be changed at any time with a valid signed challenge, so a hijacked LP session can redirect future mints (TD-163). The history table records every change.
- **`docs/product-specs/deposits.md` § LP Funding Details**
  - **Access bullet.** Replace the "address is fixed once `Passed` holds one, so the gate cannot stop being true…" sentence. The gate still cannot stop being true (`Passed` is terminal, and an address is replaced but never cleared). Because the address can now change (#1831), the receiver is read once per request, and a relink racing the call can record the address that was current just before. This is accepted, with the reasons from Assumptions and Risks.
  - **New "Receiver vs mint" bullet.**
    - A reference's `receiver_address` records the address served with it. References issued before a relink keep theirs, and new references record the new address.
    - Minting does not use it: a wire is minted to the LP's **current** settlement address of the deposit's chain kind, read at mint time.
  - **§ Stellar PLUSD Mint Leg.** Add "read at mint time (the LP's current address)" to the `receiver` sentence.
- **`docs/product-specs/api-authorization.md` line ~93.** The challenge row's `409` list drops "a fixed address of that kind".
- **`docs/user-docs/lenders/onboarding.md:30`.** Replace "It is fixed once the entity passes." with plain user wording: you can change it at any time by signing with the new wallet, unless the entity is refused. Deposits are minted to the address linked when they are processed.
- **`docs/exec-plans/tech-debt-tracker.md`.** New **TD-163** directly after TD-162:
  - Title: "A settlement address can be relinked at any time on session authority alone".
  - Date 2026-11-02.
  - Location: `routes/lp_settlement_address.rs` `verify_link`, `KybStatus::allows_address_write`.
  - Gap: no old-address signature, no Trustee approval, no notification on change.
  - Impact: a hijacked LP session links an address it controls (with TD-162, even one it does not own) and receives every later mint.
  - Suggested fix: any of a signature by the current address, Trustee approval of a change after `Passed`, or an email to the account's verified address on every change. The history table makes it auditable.
  - Bump "Next free number" to TD-164.
- **User stories.**
  - `docs/user-stories/epic-1247/1824-signed-settlement-address.md` Story 5: drop the `Passed`-with-address persona, step 2 and its expected outcome, and point to the #1831 stories. Story 1's persona drops "not `Passed` with a Stellar address".
  - New `docs/user-stories/epic-1247/1831-relink-settlement-address.md`, in the same format, backend-only, `curl` plus a DB check. Stories:
    1. relink at every non-`Failed` status, both kinds;
    2. repeated relinks, and a replay of an old challenge is `422`;
    3. relink back to a previous address, and to the same address (legacy proof: signer becomes non-null);
    4. payment-details after a relink (old reference keeps its receiver, new one gets the new one);
    5. one history row per link (`SELECT … FROM lp_settlement_address_history WHERE lp_id = …`), with `previous_*` NULL on the first link and set on a relink;
    6. no history row on `Failed`, on an address held by another LP, or on a failed proof;
    7. a released address can be linked by another LP.
- **Not changed here:** `docs/frontend/account-page.md` and the frontend captions (#1825), `docs/user-stories/epic-1247/1813-link-wallet-address.md` Story 5 (a frontend story, #1825), and the epic-1376 stories (already stale since #1824's endpoint removal).
- This plan moves to `docs/exec-plans/completed/` when the PR lands (manager/coder convention).
