# Issue #1793: Delete the Stellar yield-mint relayer (Phase 4); rename yield_minter_id to minter_id

Source: https://github.com/eq-lab/pipeline/issues/1793

Parent epic: #1776. Merge order step 2 (after #1788, before #1794).

## Scope

The Stellar relayer's Phase 4 (yield-mint) calls `mint_yield` / `can_yield_be_minted`. Neither
exists in `pipeline-stellar-contracts` at HEAD:

- `rg mint_yield|can_yield_be_minted|consume_yield` over `contracts/` returns nothing.
- `contracts/yield-minter` holds only `test_snapshots`.
- The testnet and mainnet `addresses.json` list only `minter`.
- `minter.repay` mints interest and fees itself (`contracts/minter/src/lib.rs:311-326`).

Phase 4 is enabled on pipeline-test (argocd `pipeline/test.yaml` on `origin/main`, lines 248-249)
and loops on every `PaymentRecorded` row that carries interest or fees. Per the human decision of
2026-10-29, this issue deletes Phase 4.

**In scope (worker):**

- Delete `packages/worker/src/relayer/stellar/yield_mint.rs` and its `pub mod` line.
- Remove the Phase-4 wiring in `packages/worker/src/relayer/stellar/job.rs`:
  - lines 26 and 31-33 (imports);
  - lines 62-93 (setup);
  - lines 159-165 (the loop call);
  - the header lines 15-16.
- Rewrite the Phase-5 "disabled" log text at `job.rs:105-110` so it no longer names
  `RELAYER_STELLAR_YIELD_MINTER_ID`.
- Remove the `yield_minter_id` / `loan_registry_id` fields from `StellarRelayerSettings`
  (`relayer/config.rs:66-70, 138-139, 176-177`) and the `parse_opt_contract` closure
  (`:126-137`), which only those two fields use.
- Add a boot-time deprecation warning. When `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` and/or
  `CHAIN_<id>_RELAYER_STELLAR_LOAN_REGISTRY_ID` is still present, log **one** `warn!` per Stellar
  chain that names every such key. Their values are no longer parsed, so a malformed value no
  longer fails startup.
- Rename the **Rust field only**, `yield_minter_id` → `minter_id`, in:
  - `indexer/config.rs:50, 121, 247-249, 284`;
  - `indexer/stellar/parsers.rs:564-568, 582, 601, 618-621`;
  - `indexer/stellar/poller.rs:84, 108, 125, 151, 180, 390`.

  Also rename the local `ym_key` (`config.rs:110`) and `ym_id` (`poller.rs:151`). Fix the doc
  comments that say "under its former name", which the rename makes false.
- Delete `pub fn u32_val` from `packages/worker/src/stellar/tx.rs:175-178`. Its only caller is
  `yield_mint.rs`. `tests/stellar_loan_reader.rs` has its own local helper.

**In scope (shared):**

- Delete the whole module `packages/shared/src/yield_mint_outbox_repo.rs` (human decision
  2026-10-30) and its `pub mod yield_mint_outbox_repo;` line (`packages/shared/src/lib.rs:51`).
  This removes:
  - `YieldMintOutboxRow` and `OutboxKey`;
  - the `OutboxStore` trait and its impl (`list_pending`, `list_submitted`, `mark_submitted`,
    `mark_submitted_stellar`, `mark_confirmed`, `mark_failed`, `mark_skipped_already_minted`);
  - `YieldMintOutboxRepo` with `new`, `discover_pending`, `discover_pending_stellar` and
    `skip_nothing_to_mint_stellar`.

  The module has no re-exports. Its only users are the Stellar phase (`yield_mint.rs`, `job.rs`)
  and the `stellar_yield_mint.rs` test, all deleted here.
- **Kept:**
  - the `yield_mint_outbox` table and all its rows (no migration);
  - `LEGACY_YIELD_MINTED_SQL` and `legacy_yield_minted_raw_for_loan` in
    `packages/shared/src/contract_logs_repo.rs`, which are raw SQL over the table and do not use
    the module.
- `shared::bitgo` is **not** deleted here. It stays as #1705's remainder.

**In scope (api, comments only):** two comments cite the deleted module as the reader of
`params->'event'->>'repayment_id'`: `packages/api/src/routes/audit_log.rs:286` and
`packages/api/tests/audit_log.rs:315`. Repoint them to `LEGACY_YIELD_MINTED_SQL`
(`shared::contract_logs_repo`), which still does that read. No code change.

**In scope (tests):** delete `packages/worker/tests/stellar_yield_mint.rs`, the only test that
exercises the module (it holds the `InMemoryOutbox` fake). Add the deprecation and regression tests
listed under Test Strategy.

**In scope (config/docs):**

- Remove `.env.example:178-186`, the "Phase 4 yield-mint" block plus its trailing blank line.
- Rewrite `docs/references/backend.md:604-632` and the Phase-4 aside at `:652-653`.
- Fix the related doc lines (see Docs to Update).

**Out of scope (explicitly kept):**

- **Phase 5 (wire-in matching).** Leave `job.rs:95-104, 167-173`, `relayer/wire_in_match.rs`,
  `tests/wire_in_match.rs` and the `stellar_relayer_minter_id_*` tests in
  `tests/stellar_relayer_config.rs` alone. The only Phase-5 change is the log string at
  `:105-110`.
- **The env key `CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS`** (`indexer/config.rs:110`;
  `relayer/config.rs:141-160`). It is not renamed.
- **The `yield_mint_outbox` table, its rows and `LEGACY_YIELD_MINTED_SQL`**
  (`packages/shared/src/contract_logs_repo.rs:147-171`, read by
  `api/src/routes/loan_financials.rs:177`). No migration.
- **EVM identifiers:** `yield_minter_contracts` (`indexer/mod.rs:101`, `indexer/evm_parsers.rs`)
  and all EVM relayer config.
- **Frontend env:** `VITE_STELLAR_YIELD_MINTER_ID` and every frontend file.
- **`shared::bitgo`** (`packages/shared/src/bitgo/`, `lib.rs:8`). It has no caller outside its own
  module and remains #1705's scope.
- **Ops follow-ups:** argocd manifests live in a separate repo (`eq-lab/argocd`). Only the
  `test.yaml` clean-up is a post-merge step (see Rollout below). `prod.yaml` is out of scope.

## Assumptions and Risks

**Verified line ranges.** Every range the issue cites was re-checked at `a54ad106`:

- `job.rs:62-93 / 95-112 / 159-165 / 167-173 / 107-109`;
- `relayer/config.rs:67, 70, 138-139, 141-160, 176-177`;
- `indexer/config.rs:50, 110, 121, 247-249, 284`;
- `parsers.rs:564-568, 582, 601, 618`;
- `poller.rs:84, 108, 125, 151, 180, 390`;
- `.env.example:178-185`;
- `backend.md:604-632` (executor note at `:631`);
- `contract_logs_repo.rs:147-171`;
- `loan_financials.rs:177`;
- argocd `origin/main` `test.yaml:240, 248-249`.

The local argocd checkout is on `pipeline-v2`, where the same keys sit at `232, 240-241`. Use
`origin/main` line numbers.

**"EVM still uses the outbox" is not true in code today.** No Rust caller of any
`YieldMintOutboxRepo` / `OutboxStore` method exists outside the Stellar phase and its test. The
EVM yield-mint phase was already deleted by `evm-relayer-v5`, and TD-140 / #1705 track the
leftovers. The only live reader of the table is `LEGACY_YIELD_MINTED_SQL`, which is raw SQL in
`contract_logs_repo.rs`, not a repo method. That is why the human decided on 2026-10-30 to delete
the whole module here (see Resolved questions).

**One warning vs one per key.** The issue body says to log **one** warning, and acceptance says
"logs one deprecation warning". The manager brief says "one deprecation warning … for each legacy
env var". The plan follows the issue body: one `warn!` per Stellar chain, naming every legacy key
that is set. Each key is still named, so both readings are satisfied in substance.

**`JOB_RELAYER_YIELD_MINTER_BATCH_SIZE`** is not read anywhere in Rust today (`rg` returns
nothing). It is global, not per chain. It is not added to the deprecation warning. It is only
removed from the argocd manifests post-merge.

**"Set" means present.** A legacy key counts as set when `env::var_os(key).is_some()`, even if
blank, because a blank leftover is still something ops should delete.

**Behaviour change on bad legacy values.** Today a malformed `…_YIELD_MINTER_ID` fails worker
startup. After this PR it only warns. This is strictly more lenient, so no environment that boots
today stops booting.

**Leftover Stellar outbox rows.** Rows in `pending`, `submitted`, `failed`,
`skipped_already_minted` or `skipped_nothing_to_mint` are left as they are and inert:

- nothing lists or mutates them any more;
- `LEGACY_YIELD_MINTED_SQL` reads only `status = 'confirmed'`;
- the dashboard does not read the outbox. In `packages/api`, `rg yield_mint_outbox` matches only
  comments: the `loan_financials.rs` module doc (still accurate), plus `audit_log.rs:286` and
  `tests/audit_log.rs:315`, which name the deleted module and are repointed (step 4).

So `minted_yield` is unchanged.

**Futurenet** still lists a `yield_minter` (`deployments/networks/futurenet/addresses.json:9`).
No environment we run targets futurenet (test = testnet `99000001`, prod = mainnet `99000002`),
and the human decision deletes Phase 4 everywhere.

**Prod also sets the legacy keys.** argocd `origin/main` `prod.yaml:286, 294-295` set them, and
the mainnet values equal the new minter (`CDFWWQ…`). Prod runs tagged images (`v0.0.4`), so it
picks up this change only on the next release tag. After that release it logs the deprecation
warning until those lines are removed. The prod clean-up is handled separately and is out of
scope (human, 2026-10-30).

**Merge conflicts with #1788.** #1788 is in `planning`, merges first, and likely touches
`indexer/stellar/parsers.rs`, `poller.rs` and `indexer/config.rs` (DealTokenFactory). The rename
here is mechanical, so rebase onto #1788 and re-run the rename if it lands first.

**Merge conflicts with #1794.** #1794 merges after this issue and edits `.env.example` and
`backend.md`. This PR only deletes blocks there, so conflicts should be trivial.

**Rollout safety (pipeline-test), per the epic's mandatory checklist:**

- **Migrations are additive only:** no migration. `yield_mint_outbox` and `contract_logs` are not
  touched, and no `TRUNCATE`. Deleting the Rust module drops no table, column or row; the table
  stays for `LEGACY_YIELD_MINTED_SQL`.
- **The previous image keeps booting:** the schema is unchanged, so a rollback works.
  - Rolling back while the legacy keys are still set resumes the old Phase-4 loop. That is the
    pre-existing behaviour, with no data damage: the phase cannot mint, because the functions do
    not exist.
  - Rolling back after the argocd clean-up leaves Phase 4 disabled, because both keys are unset
    and they were optional.
- **New env keys are optional:** no new key is added and nothing new is required at boot. The
  removed keys become ignored rather than parsed.
- **EVM behaviour is unchanged:**
  - no EVM source file is edited;
  - the deleted outbox module has no EVM caller: `relayer/evm/*`, `indexer/mod.rs` and
    `indexer/evm_parsers.rs` never import it, as `rg` confirms at `a54ad106`;
  - `LEGACY_YIELD_MINTED_SQL` is untouched and gets a regression test pinning its
    chain-scoped, kind-agnostic, confirmed-only shape;
  - `minted_yield` tests for EVM and Stellar stay green.
- **RPC reads in the indexer are best-effort:** the indexer change is a pure field rename, with
  no new RPC call and no change to `index_once`. The deleted phase was the relayer's only
  `can_yield_be_minted` simulate.
- **API changes are additive:** no API change. The `shared` crate is recompiled into the API, but
  no method the API calls changes. The API never imports `yield_mint_outbox_repo`; it reads the
  table only through `legacy_yield_minted_raw_for_loan`. The two API edits are comments.
- **API and worker roll independently:** only worker behaviour changes, so order does not matter.

**Post-merge ops (manager or human, outside this repo).** Remove these lines from argocd
`pipeline/test.yaml` (`origin/main` line numbers):

- `JOB_RELAYER_YIELD_MINTER_BATCH_SIZE` (`:240`);
- `CHAIN_99000001_RELAYER_STELLAR_LOAN_REGISTRY_ID` (`:248`);
- `CHAIN_99000001_RELAYER_STELLAR_YIELD_MINTER_ID` (`:249`).

Prod (`pipeline/prod.yaml:286, 294-295`) still sets the same keys and will log the deprecation
warning after its next release. Its clean-up is out of scope here.

## Open Questions

_None_

### Resolved questions (human, 2026-10-30)

1. **#1705 hand-off.** Decision: delete the whole `yield_mint_outbox_repo` module in this PR.
   - Deleted: the trait, the impl, every method, the `pub mod` line, and the only test or fake that
     exercises it.
   - Kept: the `yield_mint_outbox` table and rows, plus `LEGACY_YIELD_MINTED_SQL` with its new
     regression test.
   - #1705 (`gh issue view 1705`) covers `shared::bitgo`, `discover_pending` and
     `mark_submitted`. After this PR it becomes the **BitGo-client-only remainder**, not obsolete:
     delete `packages/shared/src/bitgo/` and the `pub mod bitgo;` line, and update the BitGo
     mention in `ARCHITECTURE.md:115`. The client still has no caller outside its own module.
2. **Prod manifest clean-up.** Decision: only `test.yaml` is in scope. `prod.yaml` is handled
   separately. Prod still sets the keys and will log the deprecation warning after its next
   release.

## Implementation Steps

1. **Delete the phase module.**
   - Delete `packages/worker/src/relayer/stellar/yield_mint.rs`.
   - In `packages/worker/src/relayer/stellar/mod.rs`, remove `pub mod yield_mint;` (line 15).
   - In `packages/worker/src/relayer/stellar/sim_decode.rs`, reword header lines 3-4 so they no
     longer mention the yield-mint phase. `whitelist.rs` is now its only user. Keep a single
     2-3-line header at most.

2. **Unwire Phase 4 in `packages/worker/src/relayer/stellar/job.rs`.**
   - Remove the imports `shared::yield_mint_outbox_repo::YieldMintOutboxRepo` (line 26) and
     `crate::relayer::stellar::yield_mint::{…}` (lines 31-33).
   - Remove the `let yield_mint = …` block (lines 62-93) and the Phase-4 call in the loop
     (lines 159-165).
   - Trim the header (lines 15-16) so it lists Phases 0, 2, 3 and 5 only.
   - Replace the Phase-5 disabled message (lines 105-110) with a single string that names only the
     indexer key, for example
     `"stellar wire-in matching phase disabled — set CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS"`.
     Do not touch the rest of Phase 5 (lines 95-104 and 167-173).
   - Right after the "stellar relayer job running" `info!` (line 51-60), add the deprecation
     warning:

     ```rust
     if !settings.legacy_env_keys.is_empty() {
         tracing::warn!(
             chain_id = settings.chain_id,
             keys = ?settings.legacy_env_keys,
             "deprecated Stellar relayer env vars are set and ignored — the yield-mint phase was removed; delete them"
         );
     }
     ```

     This runs once per chain task at startup, before the loop.

3. **Settings in `packages/worker/src/relayer/config.rs`.**
   - Delete the fields `yield_minter_id` and `loan_registry_id`, with their doc comments
     (lines 66-70).
   - Delete the `parse_opt_contract` closure and its two calls (lines 126-139), and remove the two
     fields from the struct literal (lines 176-177).
   - Add `pub legacy_env_keys: Vec<String>` to `StellarRelayerSettings`.
   - Add a pure helper next to the impl:

     ```rust
     pub fn legacy_stellar_relayer_keys(chain_id: i64, is_set: impl Fn(&str) -> bool) -> Vec<String>
     ```

     It returns, in this fixed order, those of `CHAIN_{id}_RELAYER_STELLAR_YIELD_MINTER_ID` and
     `CHAIN_{id}_RELAYER_STELLAR_LOAN_REGISTRY_ID` for which `is_set` is true.
   - In `from_chain_env`, populate the field with
     `legacy_stellar_relayer_keys(chain_id, |k| env::var_os(k).is_some())`.
   - Leave the `minter_id` block (lines 141-160) and its comments unchanged.
   - Update the struct doc (lines 53-58) only if it would otherwise be wrong. It already lists only
     Phases 0, 2 and 3. Adding Phase 5 is optional.

4. **Delete the outbox repo module.**
   - Delete `packages/shared/src/yield_mint_outbox_repo.rs` (the whole file).
   - Remove `pub mod yield_mint_outbox_repo;` from `packages/shared/src/lib.rs:51`. There are no
     re-exports to remove.
   - Leave `packages/shared/src/contract_logs_repo.rs` (`LEGACY_YIELD_MINTED_SQL` at
     lines 147-171, `legacy_yield_minted_raw_for_loan` at about 1033), the migration
     `packages/shared/migrations/20260602000001_yield_mint_outbox.sql` and `shared::bitgo`
     untouched.
   - Repoint the two stale comments, which are comment-only edits:
     - In `packages/api/src/routes/audit_log.rs:286`, replace "which is why
       `yield_mint_outbox_repo` reads" with "which is why `LEGACY_YIELD_MINTED_SQL`
       (`shared::contract_logs_repo`) reads".
     - Make the same substitution in `packages/api/tests/audit_log.rs:315`.
   - Confirm nothing else references the module:
     `rg -n "yield_mint_outbox_repo|YieldMintOutboxRepo|OutboxStore|OutboxKey|YieldMintOutboxRow" packages`
     must return nothing.

5. **Rename the indexer field `yield_minter_id` → `minter_id` (Rust only).**
   - `packages/worker/src/indexer/config.rs`:
     - Rename the field (line 50), the local (line 121), the distinctness block (lines 247-249)
       and the struct literal (line 284).
     - Rename the local `ym_key` → `minter_key` (line 110, and its uses at lines 121, 123 and 130).
     - Keep the env string `"{ip}MINTER_ADDRESS"` exactly.
     - Shorten the field doc (lines 39-49) to drop the "Named for the contract's former identity"
       history. Keep the `Read from CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS` pointer.
     - Lines 247 and 125-128 are inline comments. Drop the one at 247 if it only restates the
       code.
   - `packages/worker/src/indexer/stellar/parsers.rs`:
     - Rename the parameter (line 582) and its uses (lines 601 and 618).
     - Update the doc paragraph (lines 564-568) and the inline comment (lines 619-621) so they no
       longer say "under its former name". Keep the note that config/role events and `snapshot`
       are not collected, or drop it per the comment-less rule.
   - `packages/worker/src/indexer/stellar/poller.rs`:
     - Rename the struct field (line 84), the constructor parameter (line 108), the initializer
       (line 125) and the read at line 180.
     - Rename `ym_id` → `minter_id` at line 151.
     - Rename the setting read at line 390.
   - Do **not** touch `yield_minter_contracts` in `indexer/mod.rs` or `indexer/evm_parsers.rs`.

6. **Remove the dead helper.** Delete `pub fn u32_val` (and its doc line) from
   `packages/worker/src/stellar/tx.rs:175-178`. Confirm with `rg -n "u32_val" packages/worker/src`
   that nothing else uses it. If the `ScVal` import is still needed by other functions, leave it.

7. **Tests.** See Test Strategy for the details.
   - Delete `packages/worker/tests/stellar_yield_mint.rs`.
   - Update `packages/worker/tests/stellar_relayer_config.rs`:
     - Add `"RELAYER_STELLAR_YIELD_MINTER_ID"` and `"RELAYER_STELLAR_LOAN_REGISTRY_ID"` to the
       suffix list in `clear_chain_env` (lines 29-40).
     - Append the new deprecation tests.
   - Rename `yield_minter_id_rejects_a_bad_strkey_checksum` →
     `minter_id_rejects_a_bad_strkey_checksum` in `packages/worker/tests/stellar_config.rs:624`.
     Its body is unchanged.
   - Delete the stale doc lines 276-277 above `dispatched_event_name` in
     `packages/worker/tests/stellar_minter_parsers.rs`, which say "configured under its former
     name". Test code is comment-less.
   - Add the `LEGACY_YIELD_MINTED_SQL` regression test to
     `packages/shared/tests/contract_logs_repo.rs`.

8. **`.env.example`.** Delete lines 178-186 (the
   `# ── Stellar chain example (Relayer: Phase 4 yield-mint)` block and the blank line after it).
   Do not touch `VITE_STELLAR_YIELD_MINTER_ID` (line 258) or `VITE_STELLAR_LOAN_REGISTRY_ID`
   (line 256).

9. **Docs.** Apply every edit listed under Docs to Update.

10. **Verify** (run all of these in the worktree):

    ```bash
    rg -n "yield_mint" packages/worker/src/relayer/stellar
    rg -n "discover_pending|skip_nothing_to_mint_stellar|mark_submitted|StellarYield|InMemoryOutbox|yield_minter_id" packages
    rg -n "yield_mint_outbox_repo|YieldMintOutboxRepo|OutboxStore|OutboxKey|YieldMintOutboxRow" packages
    rg -n "yield_mint_outbox" packages
    git diff --stat -- packages/worker/tests/wire_in_match.rs packages/worker/src/relayer/wire_in_match.rs packages/worker/src/relayer/evm packages/worker/src/indexer/mod.rs packages/worker/src/indexer/evm_parsers.rs packages/shared/migrations packages/shared/src/contract_logs_repo.rs packages/shared/src/bitgo
    cargo test -p pipeline-worker
    cargo test -p shared
    cargo test -p pipeline-api
    cargo clippy --all -- -D warnings
    npx tsx scripts/lint-docs.ts
    ```

    Expected results:
    - The first `rg` returns nothing (acceptance criterion).
    - The second and third `rg` return nothing.
    - The fourth `rg` matches only these, all of which are SQL or comments about the table, which
      is kept:
      - the migration;
      - `LEGACY_YIELD_MINTED_SQL` and its doc in `contract_logs_repo.rs`;
      - the `loan_financials.rs` module doc;
      - `shared/tests/contract_logs_repo.rs`.
    - The `git diff --stat` is empty, which shows the EVM relayer/indexer, Phase 5, the migrations,
      `contract_logs_repo.rs` and `bitgo` are untouched.
    - All tests pass and clippy is clean.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. None connects to Postgres or
reads `DATABASE_URL` / `POSTGRES_URL`. Env-mutating tests take the existing `ENV_LOCK` in
`stellar_relayer_config.rs`.

**Deprecation warning: the pure helper** (`packages/worker/tests/stellar_relayer_config.rs`):

- `legacy_keys_none_set_is_empty`: `is_set = |_| false` returns `[]`.
- `legacy_keys_both_set_are_named_in_order`: `is_set = |_| true` returns
  `["CHAIN_99000001_RELAYER_STELLAR_YIELD_MINTER_ID", "CHAIN_99000001_RELAYER_STELLAR_LOAN_REGISTRY_ID"]`.
- `legacy_keys_only_loan_registry_set`: one key in, exactly that one key out. This pins that the
  helper does not require both keys, unlike the old "both or neither" gating.

**Deprecation warning: boot path** (same file, env-based, under `ENV_LOCK`):

- `stellar_relayer_boots_with_legacy_yield_mint_keys_set`:
  - Use `set_base_env(id)`, then set `…_YIELD_MINTER_ID` to a valid `C…` id and
    `…_LOAN_REGISTRY_ID` to `"NOTASTRKEY"`.
  - `from_chain_env` must return `Ok`. A malformed legacy value no longer fails boot.
  - `legacy_env_keys` must list both keys.
  - `minter_id` must be unaffected (`None` when `STELLAR_INDEXER_MINTER_ADDRESS` is unset).
- `stellar_relayer_without_legacy_keys_has_none`: the base env only gives an empty
  `legacy_env_keys`.
- `RelayerSettings::all_from_env` with `CHAINS=99000001`, `CHAIN_99000001_TYPE=stellar` and the
  legacy keys set returns one `Stellar` entry, with `Ok`. This mirrors
  `relayer_settings_dispatch_evm_and_stellar` and confirms the worker boot path accepts them.
- The "logs exactly one warning" property is structural: one `if` with one `warn!` before the
  loop. The worker has no `tracing-test` dependency, and adding one is not justified for this.
  The reviewer checks it by reading `job.rs`.

**`minted_yield` regression** (`packages/shared/tests/contract_logs_repo.rs`):

- New `legacy_yield_minted_sql_reads_confirmed_outbox_rows_for_any_chain_kind`, asserting on
  `normalized(LEGACY_YIELD_MINTED_SQL)`:
  - it contains `FROM yield_mint_outbox o`, `o.chain_id = $1`, `o.loan_id = $2`,
    `o.status = 'confirmed'`, `o.tx_hash IS NOT NULL` and `cl.event_name = 'YieldMinted'`;
  - it does **not** contain `yield_minter_address`. The read is chain-scoped, not minter-scoped
    or kind-scoped, so EVM and Stellar confirmed rows both still count.
- The existing tests stay unchanged and must pass:
  - `legacy_yield_minted_sql_requires_registry_scoped_payment_recorded`;
  - `packages/shared/tests/minted_yield.rs` (`evm_legacy_only`,
    `stellar_sums_raw_then_normalises_once`, …);
  - `packages/api/tests/loan_financials.rs`
    (`legacy_minted_yield_includes_the_treasury_leg_so_not_minted_is_zero`, …).

**Phase 5 unchanged:**

- `packages/worker/tests/wire_in_match.rs` and the four `stellar_relayer_minter_id_*` tests are
  not edited and must pass. The `clear_chain_env` suffix addition only removes more keys and does
  not change what those tests set.

**Rename coverage:**

- The existing `stellar_config.rs`, `stellar_parsers.rs`, `stellar_minter_parsers.rs` and
  `stellar_event_poller.rs` suites cover the indexer config and dispatch. Callers pass the minter
  id positionally, so they compile unchanged and must stay green.

**Removed tests:** all of `stellar_yield_mint.rs`. These covered only deleted code:

- the mock submitter;
- the in-memory `OutboxStore` fake;
- `map_get_transaction_status`, `u32_from_bigdecimal` and `u32_val`.

It is the only test in `packages/*` that touches `yield_mint_outbox_repo`. No shared or api test
imports the module, so nothing else is removed. The api `audit_log.rs` test only gets a comment
edit.

**Module deletion coverage:** compilation is the check. `cargo test` and `cargo clippy` across the
workspace fail if anything still imports the module. The `rg` checks in step 10 back that up.
`minted_yield` keeps reading the table through `LEGACY_YIELD_MINTED_SQL`, which the regression
test above pins.

## Docs to Update

No product-spec behaviour is added. The one spec edit below fixes a sentence this change makes
false.

**`docs/references/backend.md`:**

- Replace the `#### Stellar yield-mint phase` section (lines 604-632) with a short paragraph.
  - Below line 596, state that there is no Stellar yield-mint phase either: `minter.repay` mints
    interest and fees in the same call (`pipeline-stellar-contracts` #33), and the phase was
    removed in #1793.
  - `yield_mint_outbox` stays. Its `confirmed` rows feed the legacy `YieldMinted` part of
    `minted_yield` (§Minted yield). Leftover Stellar rows in `pending`, `submitted`, `failed` or
    `skipped_*` are inert, and nothing reads them.
  - If `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` or `…_LOAN_REGISTRY_ID` is still set, the
    relayer ignores it and logs one deprecation warning per chain at startup.
  - Drop the role-grant / `executor` note (line 631).
- Lines 652-653: replace "(The relayer's own `RELAYER_STELLAR_*` contract ids belong to Phase 4,
  which does submit transactions …)" with a version that names Phase 3: the access-manager and
  PLUSD SAC ids, which do submit transactions.
- Lines 325-326: drop "— the minter under its former name". The env key was never the former
  name, and the Rust field no longer is.

**`docs/product-specs/relayer-service.md:49`:** extend "On EVM the relayer mints no yield …" to
cover Stellar too: Soroban `minter.repay` likewise mints interest and fees in one call. Also state
that Sections 3-4 describe a separate yield-minter that no current deployment has.

**`docs/exec-plans/known-bugs.md`:** move to `## Resolved`, each with a "Resolved by #1793 (phase
deleted)" line:

- **BUG-29** (the phase signs a non-existent `mint_yield`);
- **BUG-12** (the Stellar nothing-to-mint skip has no backstop; the code is gone);
- **BUG-11** (the EVM phase has no nothing-to-mint skip). Its EVM phase was deleted by
  `evm-relayer-v5`, and its other location, `yield_mint_outbox_repo.rs::discover_pending`, is
  deleted here. Note "obsolete; #1068 can be closed".

**`docs/exec-plans/tech-debt-tracker.md`:**

- **TD-23** (`discover_pending_stellar` coverage), **TD-24** (NULL `tx_hash` loop, #1698) and
  **TD-25** (duplicate `SIM_FEE`; only `VIEW_PRECHECK_FEE` remains): append
  `[RESOLVED <date> / #1793]` with a one-line "obsolete: Stellar Phase 4 deleted".
- **TD-140:** append `[RESOLVED 2026-10-30 / #1793]` for the outbox half: the whole
  `yield_mint_outbox_repo` module is deleted, and the table plus `LEGACY_YIELD_MINTED_SQL` remain.
  Add one line saying the `shared::bitgo` half is not deleted and moves to #1705, now
  BitGo-client-only. (Alternative, if the manager prefers each TD to have a single status: retitle
  TD-140 to the BitGo client only and leave it open, with a line noting the outbox methods were
  removed in #1793.)
- Leave the historical clippy incident list at about line 1607, which names
  `yield_mint_outbox_repo`, unchanged.
- No new TD number is needed, so the "Next free number" line is unchanged.

**`.env.example`:** delete the Phase 4 block (step 8).

**Not edited:**

- Historical design notes under `docs/superpowers/specs/` and completed exec plans.
- `docs/exec-plans/active/evm-relayer-v5.md`, `issue-1435-per-chain-indexer-tuning.md` and
  `docs/design-docs/multi-chain-kyc-sharding.md:121`. The last one already says Phase 4 is skipped
  on Stellar, which is now true.

**Issues to close as obsolete when the PR merges** (manager's call):

- #1741, #1698 and #1447, which the issue names;
- #1068 (BUG-11), whose code is now gone in full.

#1709 stays open. #1705 stays open but narrows to the BitGo client only: delete
`packages/shared/src/bitgo/` and `pub mod bitgo;`, and update `ARCHITECTURE.md:115`. Its outbox
half (`discover_pending`, `mark_submitted`, narrowing `OutboxStore`) is done by this PR. Comment
that on #1705 when the PR merges.

Run `npx tsx scripts/lint-docs.ts` after the doc edits.
