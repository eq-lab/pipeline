# Issue #1435: Indexer: per-chain overrides for polling range, interval and confirmation delay

Source: https://github.com/eq-lab/pipeline/issues/1435

Parent epic: #1431. Independent of #1432 / #1433 / #1434 — all three are merged, so this
lands on a clean tree and touches no file they changed. #1436 (Ethereum mainnet config)
is blocked on this Issue: its `.env.example` block references
`CHAIN_1_INDEXER_LOG_CONFIRMATIONS_DELAY` and `CHAIN_1_INDEXER_POLLING_BLOCK_RANGE`,
which do not exist until this ships.

No Figma reference is attached to this Issue or to #1431 — no visual verification step.

## Scope

### In scope

1. **`packages/worker/src/indexer/config.rs`** — a shared chain-then-job-then-default
   resolution helper, applied to:
   - `IndexerJobSettings::from_chain_env` (lines 329–331) — `polling_block_range`,
     `polling_interval_ms`, `log_confirmations_delay`.
   - `StellarIndexerSettings::from_chain_env` (lines 260–261) — `polling_interval_ms`,
     `polling_ledger_range`.
2. **New env vars** (all optional, all additive):
   - `CHAIN_<id>_INDEXER_POLLING_BLOCK_RANGE`
   - `CHAIN_<id>_INDEXER_POLLING_INTERVAL_MS`
   - `CHAIN_<id>_INDEXER_LOG_CONFIRMATIONS_DELAY`
3. **`.env.example`** — document the three in the per-chain section (both the EVM and the
   Stellar example block) and mark the `JOB_INDEXER_*` forms as the all-chain fallback.
4. **`ARCHITECTURE.md:122`** — extend the per-chain task-model paragraph to cover tuning.
5. **`packages/worker/tests/indexer_tuning_overrides.rs`** — new test binary (see Test
   Strategy for why it is a new file rather than an addition to an existing one).

### Out of scope

- Changing any default value. `1000 / 500 / 12` stay as they are; picking mainnet-grade
  values is #1436's job, and it does it in config, not in code.
- The EVM cadence doubling (Open Question **Q1**) — this Issue preserves current timing
  behaviour exactly.
- Per-chain overrides for `ipfs_gateway_url` or for the job-level Stellar asset-transfer
  vars (`JOB_INDEXER_STELLAR_ASSET_ID` / `_CUSTODY_ADDRESSES` / `_RAMP_ADDRESSES`).
- Per-chain tuning for the relayer and price-poller. Both have their own `JOB_*` knobs
  (`JOB_RELAYER_INTERVAL_SECS`, `JOB_PRICE_POLLER_*`) and are untouched here.
- A per-chain confirmation delay on the **Stellar** arm — see decision **D5**.
- Adding `1` to `CHAINS`. That is #1436, and it ships dark.

## Findings from research

- **F1 — the knobs are read in exactly two places.** `grep` across the repo (excluding
  `node_modules`, `target`, `.git`) finds `JOB_INDEXER_POLLING_BLOCK_RANGE` /
  `JOB_INDEXER_LOG_CONFIRMATIONS_DELAY` only at `config.rs:261`, `config.rs:329`,
  `config.rs:331`, in `.env.example:87-89`, and in two historical exec plans
  (`completed/issue-439-multi-chain-prep.md`, `active/issue-528-stellar-soroban-indexer.md`).
  No deployment manifest, script, or product spec reads them. The blast radius is one file.
- **F2 — a resolved range of `0` is a latent panic, on both arms.**
  `index_once` computes `let end = (cursor + block_range - 1).min(...)`
  (`packages/worker/src/indexer/mod.rs:181`) and `EvmEventPoller::poll` computes
  `let chunk_end = (current + self.block_range - 1).min(to_block)`
  (`packages/worker/src/indexer/poller.rs:95`). With `block_range == 0` and `cursor == 0`
  both underflow a `u64`. This is pre-existing, but this Issue multiplies the number of
  places an operator can type the value. See decision **D3**.
- **F3 — `StellarIndexerSettings`' `polling_ledger_range` already reads the EVM-named
  var.** `config.rs:261` reads `JOB_INDEXER_POLLING_BLOCK_RANGE` into a ledger count. The
  per-chain layer mirrors that reuse rather than introducing a second spelling — see **D4**
  and **Q2**.
- **F4 — `packages/worker/tests/stellar_config.rs` has no env mutex.** It relies on each
  test using a unique synthetic `chain_id` so that `CHAIN_<id>_*` writes cannot collide
  (`chain_config.rs:18` takes the opposite approach with a `static ENV_LOCK`). The new
  tests mutate **process-global** `JOB_INDEXER_*` vars, which that scheme cannot isolate —
  hence a separate test binary with its own lock.
- **F5 — the Stellar confirmation delay is a call-site literal, not a setting.**
  `packages/worker/src/indexer/stellar/poller.rs:323` passes `0` to `index_loop` with the
  comment that Stellar has deterministic finality at ledger close.
  `StellarIndexerSettings` has no `log_confirmations_delay` field at all.

## Decisions

- **D1 — resolution order and helper shape.** One private helper in `config.rs`:
  `CHAIN_<id>_INDEXER_<SUFFIX>` → `JOB_INDEXER_<SUFFIX>` → hard-coded default. Both
  settings structs call it, so the two cannot drift (the Issue's explicit ask).
- **D2 — a blank per-chain value means "unset".** `CHAIN_1_INDEXER_POLLING_BLOCK_RANGE=`
  (or whitespace) falls through to the job-level value, matching how every other optional
  per-chain var in this file treats blank (`loan_registry_id`, `yield_minter_id`,
  `withdrawal_queue_wallet_id` all use `filter(|s| !s.trim().is_empty())`). The per-chain
  value is trimmed before parsing. The **job-level** path keeps today's strict
  `env_parse` behaviour untouched, so the no-override case stays byte-identical.
- **D3 — a resolved polling range of `0` is rejected at startup**, on both arms, with an
  error naming the key that produced it. Interval `0` stays legal (it means "no sleep")
  and confirmation delay `0` stays legal (Stellar passes exactly that). This hardens the
  job-level path too, which is a deliberate, narrow deviation from "byte-identical" —
  see **Q3**; the alternative is to let F2 stand.
- **D4 — Stellar's `polling_ledger_range` resolves from
  `CHAIN_<id>_INDEXER_POLLING_BLOCK_RANGE`**, exactly mirroring the job-level reuse at
  `config.rs:261`. No fourth variable name. See **Q2**.
- **D5 — no per-chain confirmation delay on the Stellar arm.** Per F5 there is no field
  to override; adding one would mean plumbing a value into `index_loop` whose only correct
  value is `0`. `CHAIN_<id>_INDEXER_LOG_CONFIRMATIONS_DELAY` set on a Stellar chain is
  silently inert, and `.env.example` says so.

## Assumptions and Risks

- **Backwards compatibility is the acceptance bar.** With no `CHAIN_<id>_INDEXER_*` set,
  every resolved value must equal today's. The "both unset" and "job-level only" tests
  below are what proves it; D3 is the one audited exception.
- **Generic inference.** The existing `env_parse` infers `T` from the struct field type.
  The new helper must keep the same signature shape (`default: T` with
  `T: FromStr, T::Err: std::error::Error + Send + Sync + 'static`) or the call sites need
  turbofish. Low risk, caught by `cargo build`.
- **Env-var tests are process-global.** Covered by F4 and the Test Strategy; getting this
  wrong produces a flaky suite rather than a failing one, which is worse.
- **Comment policy.** `AGENTS.md` allows at most one 2–3-line spec-pointer header per
  file and no per-field/function doc comments. `config.rs` carries a lot of pre-rule doc
  comments; this change **edits** the one that becomes wrong (`config.rs:73`, which states
  that `polling_interval_ms` is "shared with EVM via JOB_INDEXER_POLLING_INTERVAL_MS") and
  adds no new ones.
- **No DB, no network.** Nothing here touches Postgres or an RPC endpoint, so the whole
  change is verifiable with `cargo test` + `cargo clippy` offline.

## Open Questions

_None_ — all three were greenlit by the user on 2026-10-09, each as recommended. Kept
below as the resolution record.

- **Q1 (resolved: preserve) — the EVM cadence doubling is left alone.**
  `POLLING_INTERVAL_MS` is slept twice per cycle: once between chunks in
  `EvmEventPoller::poll` (`poller.rs:121`) and once per loop in `index_loop`
  (`mod.rs:163`). Since `index_once` caps `end` at `cursor + block_range - 1`, `poll` runs
  exactly one chunk per cycle under normal operation, so the effective cadence is ≈ 2× the
  configured value and a per-chain override inherits that. This Issue stays additive: the
  ≈2× effect is stated in `.env.example` and logged in
  `docs/exec-plans/tech-debt-tracker.md`.
- **Q2 (resolved: no alias) — the Stellar arm reads `…_POLLING_BLOCK_RANGE` only.** The
  `START_LEDGER` → `START_BLOCK` precedent (`config.rs:99-104`) is not followed; ship the
  three names the Issue lists, and revisit a ledger-named alias only if operators ask.
- **Q3 (resolved: yes) — D3 applies to both layers.** A resolved polling range of `0` is
  rejected at startup whether it came from the per-chain or the job-level key, trading a
  pre-existing runtime underflow panic for a boot-time error with a readable message.

## Implementation Steps

1. ✅ **Add the resolution helper** at the bottom of
   `packages/worker/src/indexer/config.rs`, next to `env_parse` (currently ends at line
   397):

   ```rust
   fn env_parse_chain_or_job<T: std::str::FromStr>(
       chain_id: i64,
       suffix: &str,
       default: T,
   ) -> Result<T>
   where
       T::Err: std::error::Error + Send + Sync + 'static,
   {
       let chain_key = format!("CHAIN_{chain_id}_INDEXER_{suffix}");
       if let Ok(raw) = env::var(&chain_key) {
           let trimmed = raw.trim();
           if !trimmed.is_empty() {
               return trimmed
                   .parse::<T>()
                   .with_context(|| format!("{chain_key} must be a valid number"));
           }
       }
       env_parse(&format!("JOB_INDEXER_{suffix}"), default)
   }
   ```

   Per **D2**, a blank per-chain value falls through; per **D1**, the job-level branch is
   the untouched existing `env_parse`.

2. ✅ **Add a range guard** beside it, used by both arms (**D3**):

   ```rust
   fn require_nonzero(chain_id: i64, suffix: &str, value: u64) -> Result<u64> {
       if value == 0 {
           anyhow::bail!(
               "indexer polling range for chain {chain_id} resolved to 0 \
                (CHAIN_{chain_id}_INDEXER_{suffix} or JOB_INDEXER_{suffix}); must be >= 1"
           );
       }
       Ok(value)
   }
   ```

3. ✅ **EVM arm** — replace `config.rs:329-331` inside `IndexerJobSettings::from_chain_env`:

   ```rust
   polling_block_range: require_nonzero(
       chain_id,
       "POLLING_BLOCK_RANGE",
       env_parse_chain_or_job(chain_id, "POLLING_BLOCK_RANGE", 1000)?,
   )?,
   polling_interval_ms: env_parse_chain_or_job(chain_id, "POLLING_INTERVAL_MS", 500)?,
   log_confirmations_delay: env_parse_chain_or_job(
       chain_id,
       "LOG_CONFIRMATIONS_DELAY",
       12,
   )?,
   ```

   Note the existing `let p = format!("CHAIN_{chain_id}_");` prefix is *not* reused — the
   new keys carry an extra `INDEXER_` segment, which is what distinguishes them from the
   contract/RPC vars in the same function.

4. ✅ **Stellar arm** — replace `config.rs:260-261` inside
   `StellarIndexerSettings::from_chain_env`:

   ```rust
   polling_interval_ms: env_parse_chain_or_job(chain_id, "POLLING_INTERVAL_MS", 500)?,
   polling_ledger_range: require_nonzero(
       chain_id,
       "POLLING_BLOCK_RANGE",
       env_parse_chain_or_job(chain_id, "POLLING_BLOCK_RANGE", 1000)?,
   )?,
   ```

   Per **D4** the ledger range reads the block-range key. Per **D5** no confirmation-delay
   resolution is added here.

5. ✅ **Fix the now-wrong field comment** at `config.rs:73`: `polling_interval_ms` is no
   longer "shared with EVM via JOB_INDEXER_POLLING_INTERVAL_MS" — it resolves
   `CHAIN_<id>_INDEXER_POLLING_INTERVAL_MS` first. Keep the replacement to one line; add
   no other comments (`AGENTS.md` comment policy). Check `config.rs:74-75`
   (`polling_ledger_range`) for the same staleness.

6. ✅ **`.env.example`**:
   - Line 86 (`# Indexer tuning (job-level, applies to all chains):`) — extend to say these
     are the **fallback** for every chain and are overridden per chain by
     `CHAIN_<id>_INDEXER_*`.
   - In `# ── Worker: Per-chain config ──` (after the `CHAIN_1_YIELD_MINTER_CONTRACTS`
     line, currently ~line 157), add three commented lines with the default each falls back
     to, and — per **Q1**'s recommendation — a note that the EVM arm sleeps
     `POLLING_INTERVAL_MS` twice per cycle, so the effective cadence is roughly double.
   - In `# ── Stellar chain example (Worker: Indexer) ──` (~line 162+), add
     `CHAIN_99000001_INDEXER_POLLING_INTERVAL_MS` and
     `CHAIN_99000001_INDEXER_POLLING_BLOCK_RANGE` (noting it sizes a **ledger** range on
     this arm), plus a line stating that `LOG_CONFIRMATIONS_DELAY` is inert on Stellar
     (**D5**).

7. ✅ **`ARCHITECTURE.md:122`** — in the "Per-chain task model" paragraph, extend the
   sentence `each chain is configured via CHAIN_<id>_* prefixed variables` to note that
   indexer tuning (polling range, polling interval, confirmation delay) is per-chain too,
   via `CHAIN_<id>_INDEXER_*`, falling back to the job-level `JOB_INDEXER_*` form. One or
   two sentences — the file is a map, not a manual.

8. ✅ **Tests** — add `packages/worker/tests/indexer_tuning_overrides.rs` per Test Strategy.

9. ✅ **Verify**:
   ```bash
   cargo test -p pipeline-worker --test indexer_tuning_overrides
   cargo test -p pipeline-worker --test chain_config --test stellar_config
   cargo clippy --all -- -D warnings
   npx tsx scripts/lint-docs.ts
   ```

## Test Strategy

New file `packages/worker/tests/indexer_tuning_overrides.rs` — its own test binary, so its
`JOB_INDEXER_*` writes cannot leak into `chain_config.rs` or `stellar_config.rs` (**F4**).
Pure unit tests: no `DATABASE_URL`, no Postgres, no RPC.

Mechanics, mirroring `chain_config.rs:14-31`:

- `static ENV_LOCK: Mutex<()>` guarding **every** test in the file, taken with
  `.unwrap_or_else(std::sync::PoisonError::into_inner)` so one failing test does not
  cascade. Required here (unlike `stellar_config.rs`) because `JOB_INDEXER_*` is not
  chain-scoped.
- Two helpers: one that sets the six vars `IndexerJobSettings::from_chain_env` requires
  (`ETH_RPC_URL`, `DM_/WQ_/SPLUSD_/LOAN_REGISTRY_/YIELD_MINTER_CONTRACTS`) for a synthetic
  chain id, and one that removes every var a test touched. Each test clears both the
  chain-level and the job-level keys on entry *and* exit — the job-level ones are global.
- Synthetic chain ids outside any real range (e.g. `70001`, `70002`, `79000001` for the
  Stellar case) to avoid colliding with fixtures elsewhere.

EVM cases (`IndexerJobSettings::from_chain_env`):

1. Per-chain set, job-level set → per-chain wins, for all three knobs independently.
2. Per-chain unset, job-level set → job-level wins.
3. Both unset → `1000 / 500 / 12` (the byte-identical guarantee).
4. Per-chain set blank → falls through to job-level (**D2**).
5. Per-chain set to a non-number → `Err`, and the message names the `CHAIN_…` key, not the
   `JOB_…` one.
6. Resolved range `0`, set per-chain and (separately) job-level → `Err` (**D3**).
7. Two chains in `CHAINS` with different per-chain values → `IndexerSettings::all_from_env()`
   returns both, each with its own resolved values, with a job-level value set to a third
   number that neither inherits.

Stellar cases (`StellarIndexerSettings::from_chain_env`, required vars per
`stellar_config.rs:60-96`):

8. Cases 1–4 repeated for `polling_interval_ms` and `polling_ledger_range`, confirming the
   ledger range reads `…_POLLING_BLOCK_RANGE` (**D4**).
9. `CHAIN_<id>_INDEXER_LOG_CONFIRMATIONS_DELAY` set on a Stellar chain → parse still
   succeeds and nothing changes (**D5**, inert by construction).

Regression: `cargo test -p pipeline-worker --test chain_config --test stellar_config` must
stay green — `stellar_config.rs` exercises `from_chain_env` ~18 times with no job-level
vars set, which is case 3 repeated.

## Docs to Update

- `.env.example` — step 6 (job-level section, EVM per-chain block, Stellar example block).
- `ARCHITECTURE.md:122` — step 7.
- `docs/exec-plans/tech-debt-tracker.md` — the EVM cadence doubling (**Q1**), if the
  recommendation to preserve it is accepted.
- No product spec change: this is operational configuration with no user- or agent-facing
  behaviour change. No `docs/product-specs/` or `docs/design-docs/` edit is required.

## Execution log

Implemented on branch `feat/1435-per-chain-indexer-tuning`, 2026-10-09. All nine steps
done as written; no deviation from the plan.

Two notes for the record:

- `IndexerJobSettings` and `StellarIndexerSettings` do not derive `Debug`, so the
  error-path tests use `.err().expect(...)` rather than `Result::expect_err`, which
  requires `T: Debug`. No production type was changed to suit the tests.
- Step 5 found the stale wording on both Stellar fields (`config.rs:72-75`), not just
  `polling_interval_ms`; both were rewritten to name the resolution order.

Verification: `cargo test -p pipeline-worker --test indexer_tuning_overrides` — 15 passed;
`cargo clippy --all --tests -- -D warnings` — clean; `npx tsx scripts/lint-docs.ts` —
0 errors; `cd packages/frontend && npx tsc --noEmit` — 0 errors; `cargo test --all` —
1058 passed, 0 failed, 1 ignored across 80 test binaries.
