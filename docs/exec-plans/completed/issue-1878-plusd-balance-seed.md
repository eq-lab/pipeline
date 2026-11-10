# Issue #1878: Backend: seed per-holder PLUSD balances (Stellar SAC) so plusd_balance can be enabled on testnet / mainnet

Source: https://github.com/eq-lab/pipeline/issues/1878

Parent epic: #1247. Follow-up of #1865 (TD-175). The design starts from the "Follow-up: PLUSD balance
seed" section of `docs/exec-plans/completed/issue-1865-plusd-balance-indexing.md` and the #1789
Pocket view-seed pattern (`pocket_seeds`, `stellar/pocket_seed.rs`, `simulate_view`, `KeyedBackoff`,
`spawn_supervised`). Where this plan differs from that section, it says so and gives the reason.

## Scope

### What changes

1. **Seed table (additive migration).** New `plusd_balance_seeds`. Each row is one on-chain
   `balance(holder)` read of the PLUSD SAC at a known ledger (`as_of_ledger`, the simulation's
   `latestLedger`). It is keyed by `(chain_id, token_address, holder, as_of_ledger)`. Rows are only
   ever inserted, never updated. The first row of a holder is `kind = 'initial'`. Later rows are
   `kind = 'reanchor'`, written only when a drift check finds a mismatch.
2. **Worker seed loop (Stellar only).** `stellar/plusd_seed.rs` runs as a `spawn_supervised` task
   started from `run_stellar_indexer_job` whenever `CHAIN_<id>_STELLAR_INDEXER_PLUSD_ADDRESS` is
   set. It never runs inside `index_once`. Each one-minute cycle has three phases:
   - **Seed.** Read the candidate holders that have no seed row yet, at most 50 per cycle. For each,
     simulate `balance(holder)` and insert an `initial` seed. The holder's `KeyedBackoff` gates
     every read. A missing trustline (`Error(Contract, #13)`) is a fact, so it is stored as a zero
     seed.
   - **Verify read (drift check).** Pick seeded holders whose next check is due, at most 10 per
     cycle, with one check per holder every 6 h. For each, simulate `balance(holder)`; the result is
     `(B, L')`. Keep it in memory as pending.
   - **Verify compare.** Read the Stellar cursor (`EventRepo::get_cursor`). For each pending read
     with `L' < cursor` (ledger `L'` is fully indexed), compute the DB value at `L'`: the holder's
     latest seed plus the indexed rows in `(as_of_ledger, L']`.
     - A match logs at debug level and schedules the next check.
     - A mismatch logs a `warn` with the holder, the ledger, the expected and actual values and
       the difference. It then inserts a `reanchor` seed `(B, L')`.
3. **API fold uses the seed, back-computed down to the coverage bound** (human decision
   2026-11-10; the full rule is in "PLUSD fold with a seed" below).
   - **Stellar.** `plusd_balance` is served only for a wallet that has a seed row.
     - The wallet's latest seed `(B, L)` is the anchor.
     - When it is an `initial` seed, the balance is back-computed below `L` down to the chain's
       coverage bound `C`, the earliest indexed `PlusdTransfer` ledger of that PLUSD contract:
       `balance_t = B − Σ deltas in (t, L]`.
     - The rows after `L` are folded forward.
     - The series is complete from the bucket that contains `C`.
     - Buckets before that bucket get no `plusd_balance`. They also get no `total_balance` when
       the wallet's PLUSD at the bound is non-zero, so the graph never shows a false step. A
       wallet with zero PLUSD at the bound has no exposure there and keeps today's total.
     - A negative or overflowing back-computed balance makes the pre-seed part incomplete. The
       bound then moves to the seed, and those buckets omit both `plusd_balance` and
       `total_balance`, with a `warn`.
     - A Stellar wallet with no seed omits the term (debug log), exactly as an unset key does
       today.
   - **EVM.** Unchanged: it folds from zero, with no seed read and no coverage read. The seed is
     Stellar-only.
4. **Enabling.** No new env key. Ops set the existing `CHAIN_<id>_STELLAR_API_PLUSD_ADDRESS` on
   99000001 (and later 99000002) only after:
   - the seed loop has seeded the candidates;
   - one full verify round has passed with no drift `warn`;
   - the manual acceptance check passes (Test Strategy, manual step 2).
   The per-wallet "no seed → omitted" rule makes the flip safe even while seeding is still running.

### Decisions (the points the caller asked to settle)

- **Candidate holder set.** The union of the following, keeping only `^G[A-Z2-7]{55}$` and
  dropping holders that already have a seed:
  - (a) every `from` / `to` of the chain's `PlusdTransfer` rows for this token;
  - (b) `lp_profiles.wallet_address` for the chain. These are the wallets the Stellar relayer
    whitelists, populated from `DepositRequested`; Stellar keeps the strkey case. Every row is
    taken, not only `on_chain_allowed`, because a zero seed is cheap and correct;
  - (c) `lps.stellar_address`, the current KYB settlement address (#1824). sPLUSD from wire-ins is
    staked to it, and an unstake pays PLUSD there;
  - (d) `lp_settlement_address_history.address` where `chain_kind = 'stellar'` and
    `(chain_id = $1 OR chain_id IS NULL)` (#1831), because older addresses may still hold PLUSD;
  - (e) `UPPER(holder)` from `position_events` for the chain. These are sPLUSD holders who may have
    unstaked before indexing began; the view lowercases holders.

  Why this set is safe:
  - Any wallet that moves PLUSD after indexing began enters through (a) within a minute. Its seed
    absorbs all of its earlier history.
  - (b) to (e) cover holders who have not moved since then.
  - A wallet missing from the set only loses the term (rule 3); it never gets a wrong value.
  - Seeding a wallet from the other network (a NULL `chain_id` history row) costs one read, and the
    missing trustline gives a zero seed.
  - `C…`, `B…` and `L…` holders (protocol contracts, claimable balances, pools) are never seeded.
- **Refresh policy.** The #1865 finding "classic PLUSD payments reach `getEvents`" is still
  unverified (TD-175 "Also"). So a periodic drift check with re-anchoring is built in either way:
  - It costs one simulate per seeded holder every 6 h, capped at 10 per minute. For about 500
    holders that is 1.4 simulates a minute.
  - It uses no history and no Horizon.
  - The same check also catches any indexer coverage gap (for example a cursor skip).
  - Once classic events are confirmed (manual step 3), the drift check stays as a cheap
    safeguard. It is not removed.
- **Why the latest seed only** (not segment-by-segment resets between re-anchors):
  - A re-anchor exists only because the rows before it were wrong.
  - The latest seed alone gives an honest "complete from `L`" boundary.
  - It keeps the API read to one row.
  - Re-anchors stay in the table for audit.
  - For the same reason, a `reanchor` seed is never back-computed. The miss it proves lies
    somewhere before it, so its bound is the seed itself (the "inconsistent" case below).
- **Seed timestamp.** `as_of_timestamp` is the worker's wall clock, read right after the simulate
  returns.
  - When there is no back-compute, the API clamps it to the timestamp of the first row after `L`,
    which keeps the steps in order. The error is a few seconds of bucket placement; at worst the
    seed bucket starts one bucket later, which is conservative.
  - With a back-compute the seed adds no step of its own: the running value reaches `B` at `L` by
    construction, so its timestamp is not used.
  - Departure from #1865: getting the exact close time with `getLedgers` would return the full
    `LedgerCloseMeta` for that ledger. That is heavy on mainnet, and the result only places a
    bucket.
- **Coverage bound `C`.** `C` is the earliest `PlusdTransfer` row of the chain and PLUSD contract:
  `(block_number, block_timestamp)` of
  `ORDER BY block_number, log_index LIMIT 1` over `chain_id = $1 AND contract_address = $2 AND event_name = 'PlusdTransfer'`.
  This query is chain-wide, not per wallet. A recorded start ledger was rejected. The reasons:
  - **Safe.** Rows exist only while the indexer PLUSD key is set, because the poller adds the
    PLUSD id to `getEvents` only then. So `C` is at or after the true activation ledger `S`.
    Between `S` and `C` the contract emitted no movement at all, or that movement would be a row
    before `C`. So every delta in `(t, L]` is indexed for any `t` at or after `C`'s close time,
    and the back-compute is exact there. The only window left out is `[S, C)`, where nothing
    moved.
  - **Reaches beyond the wallet's own first row.** Back-computing reaches the wallet's first
    indexed row. Between `C` and that row the wallet did not move, so its balance holds
    unchanged down to `C`. The chain-wide bound is therefore exact and earlier than a per-wallet
    one.
  - **No new state, and retroactive.** It covers the rows that pipeline-test has accumulated since
    eq-lab/argocd#507. A start ledger recorded by this code would begin only when it is deployed,
    or would need a manual backfill.
  - **Rewinds are harmless.** A cursor rewind only extends continuous coverage backwards, and
    duplicates are skipped by the unique key.
  - **Limitation: the indexer key must not be turned off and on again.** The Stellar poller
    never skips ledgers: it errors and retries rather than jump past retention. A coverage gap
    can therefore only come from ops unsetting the indexer key and setting it again later, and
    `C` cannot see such a gap. The ops rule (backend.md): never unset the Stellar indexer PLUSD
    key once it is set. If it was unset, either rewind the cursor over the gap (within RPC
    retention), or delete the `PlusdTransfer` rows before the re-enable ledger so that `C` moves
    past the gap.
  - `C` is usable only when `C.ledger <= L`. A seed taken before any row has no back-compute.
- **PLUSD fold with a seed** (Stellar). The pure function `seeded_plusd(seed, rows, coverage)` in
  `shared/src/plusd_seed.rs` has three cases. Here `pre` is the holder's rows with
  `block_number <= L` and `post` the rows after `L`.
  1. **Covered**: the seed is `initial`, and `C` exists with `C.ledger <= L`.
     - Compute `B0 = B − Σ delta(pre)`. Then walk forward from `B0` over `pre`. Every running
       value must be `>= 0` and must not overflow; it ends at `B` by construction.
     - Steps: `(C.ts, B0)` when `B0 != 0`, then `pre`, then `post`.
     - `from = C.ts`, and `blank_total_before = (B0 != 0)`.
  2. **Inconsistent**: the Covered check fails (`B0 < 0`, an intermediate running value below 0,
     or an overflow), or the seed is a `reanchor`.
     - A negative back-computed point proves a missed movement somewhere between that point and
       `L`, so no value before the seed can be trusted.
     - Steps: `(seed_from, B)` when `B != 0`, then `post`, with `seed_from` clamped as above.
     - `from = seed_from`, and `blank_total_before = true`.
     - The API logs `warn!(chain_id, "PLUSD back-computed balance inconsistent; pre-seed buckets incomplete")`.
       There is no warn for a `reanchor`, because the drift check already warned when it wrote it.
  3. **NoCoverage**: no `C`, or `C.ledger > L`.
     - The steps are the same as Inconsistent.
     - `blank_total_before = (B != 0)`.

  In every case:
  - A malformed amount anywhere returns `None`. The whole term is omitted with a warn, as in
    #1865.
  - The forward fold (`fold_steps`) keeps the #1865 negative guard after the seed. A failure there
    omits `plusd_balance` for the whole response. `total_balance` then keeps the
    present-terms rule in every bucket, so the series stays consistent and shows no step.
- **Buckets before the bound.** A bucket `b` is complete iff `b >= interval.truncate(from)`. Its
  close value, at the bucket end or `now`, is then at or after `from`.
  - For a bucket below that line, `plusd_balance` is absent.
  - Its `total_balance` is absent when `blank_total_before` is true.
  - Otherwise, when the PLUSD at the bound is zero, the total keeps today's present-terms value,
    which is `splusd_value + wire_out_escrow?`.
  - How "no PLUSD exposure" is read: the human said a wallet with a seed loses its pre-bound
    total, while buckets with no PLUSD exposure keep today's behaviour. The plan reads "exposure"
    as a non-zero PLUSD balance at the bound. That is exactly the condition under which keeping
    the total would draw a step at the bound. It includes every wallet that never held PLUSD
    (a zero seed and no rows), and it keeps sPLUSD-only history visible for an LP whose PLUSD
    arrived only after coverage began.
  - When any bucket has no `total_balance`, the response's `total_balance` stat is omitted, as
    the spec already says ("omitted when any bucket lacks its column"). `splusd_value` and its
    stat are unaffected.
- **Zero seeds.** A zero seed with no rows adds no step, so a wallet that has never held PLUSD
  does not become a non-empty history. A wallet that has positions sees
  `plusd_balance "0.000000"` from the bound onward, and its earlier totals are unchanged.
- **EVM.** No seed. Hoodi is backfilled by an ops cursor rewind to block 3 776 304, the PLUSD
  deploy block, after which `CHAIN_<id>_EVM_API_PLUSD_ADDRESS` is set. That is the documented
  #1865 rule and is out of this issue's code. The EVM `Transfer` event covers every movement, so
  there is no drift source.

### Out of scope

- Any contract change (contracts are frozen; the SAC is a built-in).
- AccessManager indexing.
- Horizon backfill.
- Values before the coverage bound `C`. They are never claimed.
- Setting the API key in eq-lab/argocd. That is ops, after acceptance.
- The Hoodi rewind (ops).
- Frontend (#1282 / #1629).
- New routes or query parameters.

## Assumptions and Risks

- **`simulateTransaction` state = `latestLedger`.** stellar-rpc simulates against the ledger state
  of the ledger it reports as `latestLedger` (one read transaction). If a provider were ever off by
  one, the verify round would show it as repeated drift `warn`s on holders that move PLUSD. The
  acceptance check also catches it.
- **SAC `balance` semantics** (soroban-env-host 25 source,
  `stellar_asset_contract/balance.rs`):
  - An account read goes through the trustline. A missing trustline returns
    `ContractError::TrustlineMissingError`, which is `Error(Contract, #13)`. This also happens for
    an account that does not exist, because the trustline key is read before any account check.
  - The issuer reads as `i64::MAX`. That value is treated as "not a holder": it is skipped with a
    debug log and backed off, and never stored.
  - The coder confirms the exact error text on testnet (manual step 1).
- **RPC load.**
  - Initial seeding runs at most 50 simulates a minute, sequentially, with backoff on failure.
  - Verification runs at most 10 a minute.
  - There are no `getEvents` or `getLedgers` calls.
- **Drift re-anchors move the "complete from" point forward** to the re-anchor for that holder.
  This applies even when the old seed was back-computed. Earlier buckets lose `plusd_balance` and
  `total_balance`. This is intended, because the re-anchor proves the rows before it were wrong.
- **The back-compute trusts the rows between `C` and `L`.**
  - The drift check verifies only after the seed.
  - A classic PLUSD payment between `C` and `L` that `getEvents` did not see would shift every
    back-computed value before it. That is silent unless a value goes negative.
  - Manual step 3 settles whether classic payments are visible. If they are not, the coder
    records it in the new TD (step 11) as a known limit of the back-compute. The human chose to
    back-compute, so the plan does not add a switch for it.
- **A missed credit after the seed makes the fold negative.** The term is then omitted for that
  wallet until the next verify re-anchors it: at most 6 h plus the indexer lag, and sooner after a
  restart, since every holder is checked once.
- **Pre-bound absence is a contract nuance.**
  - Today `plusd_balance` is present on every item or on none, and `total_balance` is present
    whenever `splusd_value` is.
  - After this change, on Stellar, both can be absent on items before the bound and present later.
    The `total_balance` stat is omitted for such a window.
  - Both fields stay optional in OpenAPI.
  - The card reads the last item, which is always after the bound. The graph (#1282) shows a gap
    before the bound instead of a false step. The spec states this so the frontend can render the
    gap.
- **One extra read per Stellar request.** The `C` query (`LIMIT 1`, ordered by
  `(block_number, log_index)` inside one contract) is served by the
  `UNIQUE (chain_id, contract_address, block_number, log_index)` index. It runs in the same
  `try_join!` as the steps and seed reads.
- **In-memory schedule.**
  - Verify due times and pending reads live in memory. A restart re-verifies every seeded holder
    once (capped at 10 a minute), which is cheap.
  - No `UPDATE` on the seed table, which stays insert-only.
- **Candidate query cost.**
  - It runs once a minute: a `UNION` over the `PlusdTransfer` rows of one contract, `lp_profiles`,
    `lps`, the history table and `position_events` (served by `idx_contract_logs_event`).
  - It is small on testnet. On mainnet, watch it after rollout, and lengthen the interval if needed
    (Risks only, not code now).
- **Dependencies.** #1865 is merged (`70cb7a2a`). The testnet indexer key is being set
  (eq-lab/argocd#507), so rows already accumulate. Nothing blocks this work.
- **Migration timestamp.** `20261110000001` is newer than every migration on origin/main (latest
  `20261109000001`), and no other remote branch uses a 2026-11-10 prefix. Re-check before
  committing.

## Implementation Steps

All new code is comment-less, with at most one `// spec:` header per new file pointing at
`docs/references/backend.md#plusd-balance-seed` (worker/shared) or
`docs/product-specs/lp-total-balance.md#behavior` (API). SQL is defined as `pub const`. Numbers are
plain strings. Raw amounts are `i128`.

1. [x] **Docs first** (see Docs to Update): write the spec and reference text before the code.

2. [x] **Migration** (new `packages/shared/migrations/20261110000001_plusd_balance_seeds.sql`).
   - The header gives the purpose (#1878), the spec pointer, and the rollback
     `DROP TABLE plusd_balance_seeds;`.
   - Body:
     ```sql
     CREATE TABLE IF NOT EXISTS plusd_balance_seeds (
         chain_id        BIGINT      NOT NULL,
         token_address   TEXT        NOT NULL,
         holder          TEXT        NOT NULL,
         as_of_ledger    BIGINT      NOT NULL,
         as_of_timestamp BIGINT      NOT NULL,
         balance         NUMERIC     NOT NULL CHECK (balance >= 0),
         kind            TEXT        NOT NULL CHECK (kind IN ('initial', 'reanchor')),
         created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (chain_id, token_address, holder, as_of_ledger)
     );
     ```
   - The PK serves the latest-seed lookup and the `NOT EXISTS` candidate filter, so no extra index
     is needed.

3. [x] **Shared pure model** (new `packages/shared/src/plusd_seed.rs`, with `pub mod` in `lib.rs`).
   - `#[derive(Debug, Clone, sqlx::FromRow)] pub struct PlusdSeedRow { as_of_ledger: i64, as_of_timestamp: i64, balance: Option<String>, kind: String }`.
     `balance` is the SQL-guarded text, so a negative-scale NUMERIC never reaches Rust.
   - `pub struct PlusdSeed { as_of_ledger: i64, as_of_timestamp: i64, balance: i128, reanchor: bool }`
     and `pub fn parse_seed(row: &PlusdSeedRow) -> Option<PlusdSeed>`. It returns `None` when the
     balance is missing, not 1 to 39 digits, above `i128::MAX` or negative, or when `kind` is
     neither `initial` nor `reanchor`.
   - `pub fn plusd_delta(row: &PlusdStepRow) -> Option<i128>` gives the signed step (+ in, − out, 0
     for a self-transfer). It is lifted from `api::total_balance::plusd_steps`, which then calls it.
   - `#[derive(Debug, Clone, Copy, sqlx::FromRow)] pub struct PlusdCoverage { pub block_number: i64, pub block_timestamp: i64 }`.
   - `#[derive(Debug, PartialEq, Eq)] pub enum Backfill { Covered, Inconsistent, NoCoverage }`.
   - `pub struct SeededPlusd { pub from: i64, pub steps: Vec<(i64, i128)>, pub blank_total_before: bool, pub backfill: Backfill }`.
   - `pub fn seeded_plusd(seed: &PlusdSeed, rows: &[PlusdStepRow], coverage: Option<PlusdCoverage>) -> Option<SeededPlusd>`
     implements the three cases in Scope → Decisions → "PLUSD fold with a seed":
     - compute every delta first, and return `None` on a malformed one;
     - split `pre` and `post` at `as_of_ledger`;
     - Covered requires `!seed.reanchor` and `coverage.block_number <= as_of_ledger`;
     - compute `B0` with `checked_sub`, then run the forward running check with `checked_add`
       and `>= 0`;
     - a failure becomes Inconsistent;
     - the clamp `seed_from = min(as_of_timestamp, first post row's block_timestamp)` applies only
       to the Inconsistent and NoCoverage cases.
   - `pub fn balance_at(seed: &PlusdSeed, rows: &[PlusdStepRow], ledger: i64) -> Option<i128>`:
     - the seed balance plus the deltas with `as_of_ledger < block_number <= ledger`, with
       `checked_add`;
     - `None` on a malformed amount or an overflow;
     - the result may be negative, and that counts as drift.

4. [x] **Holder steps carry the ledger** (`packages/shared/src/contract_logs_repo.rs`).
   - Add `block_number` to the `PLUSD_HOLDER_STEPS_SQL` select list and to `PlusdStepRow`
     (`pub block_number: i64`).
   - Nothing else changes: the same `@>` filters, the amount guard and the ordering.
   - Add `pub const PLUSD_COVERAGE_START_SQL`:
     `SELECT block_number, block_timestamp FROM contract_logs WHERE chain_id = $1 AND contract_address = $2 AND event_name = 'PlusdTransfer' ORDER BY block_number, log_index LIMIT 1`.
     It has no holder filter, because the bound is chain-wide.
   - Add `ContractLogsRepo::plusd_coverage_start(chain_id, plusd) -> Option<PlusdCoverage>`.

5. [x] **Seed repository** (new `packages/shared/src/plusd_seed_repo.rs`, with `pub mod`).
   `PlusdSeedRepo { pool }` with these `pub const`s:
   - `PLUSD_SEED_CANDIDATES_SQL` (`$1` chain_id, `$2` token, `$3` limit): the union in Scope →
     Decisions (a) to (e). Use `UNION`, not `UNION ALL`. Then
     `WHERE holder ~ '^G[A-Z2-7]{55}$' AND NOT EXISTS (SELECT 1 FROM plusd_balance_seeds s WHERE s.chain_id = $1 AND s.token_address = $2 AND s.holder = c.holder) ORDER BY holder LIMIT $3`.
     The `PlusdTransfer` arms filter `chain_id = $1 AND contract_address = $2 AND event_name = 'PlusdTransfer'`
     and project `params->>'to'` / `params->>'from'` (a projection, not a lookup, so `@>` does not
     apply).
   - `PLUSD_SEED_INSERT_SQL`:
     `INSERT INTO plusd_balance_seeds (chain_id, token_address, holder, as_of_ledger, as_of_timestamp, balance, kind) VALUES ($1, $2, $3, $4, $5, $6::numeric, $7) ON CONFLICT DO NOTHING`.
     The balance is bound as the `i128` decimal string.
   - `PLUSD_LATEST_SEED_SQL` (`$1`, `$2`, `$3` holder):
     `SELECT as_of_ledger, as_of_timestamp, CASE WHEN balance::text ~ '^[0-9]{1,39}$' THEN balance::text END AS balance, kind FROM plusd_balance_seeds WHERE chain_id = $1 AND token_address = $2 AND holder = $3 ORDER BY as_of_ledger DESC LIMIT 1`.
   - `PLUSD_SEEDED_HOLDERS_SQL` (`$1`, `$2`):
     `SELECT DISTINCT holder FROM plusd_balance_seeds WHERE chain_id = $1 AND token_address = $2 ORDER BY holder`.
   - Methods: `list_candidates(chain_id, token, limit) -> Vec<String>`,
     `insert(chain_id, token, holder, ledger, ts, balance: i128, kind: &str) -> bool`,
     `latest(chain_id, token, holder) -> Option<PlusdSeedRow>`,
     `seeded_holders(chain_id, token) -> Vec<String>`.

6. [x] **Worker seed loop** (new `packages/worker/src/indexer/stellar/plusd_seed.rs`, with `pub mod`
   in `stellar/mod.rs`).
   - Constants: `PLUSD_SEED_INTERVAL = 1 min`, `MAX_SEEDS_PER_CYCLE = 50`,
     `MAX_VERIFY_READS_PER_CYCLE = 10`, `PLUSD_VERIFY_INTERVAL = 6 h`.
   - Pure helpers:
     - `holder_key(&str) -> Option<[u8; 32]>`: parses a `G…` with `Ed25519Pub::from_string`. It
       rejects `C…`, `M…`, lowercase and bad CRC. `[u8; 32]` is `Copy`, so it can key
       `KeyedBackoff`.
     - `balance_args(key) -> Vec<ScVal>`: uses `crate::stellar::tx::address_account`.
     - `decode_balance(&ScVal) -> Result<i128>`: `ScVal::I128` through `i128_from_parts`, and
       negative values are rejected.
     - `is_no_balance_error(msg) -> bool`: `Error(Contract, #13)`, through
       `security_registry_views::is_contract_error`.
     - `is_issuer_balance(v) -> bool`: true for `v == i64::MAX as i128`.
     - `enum VerifyOutcome { Matched, Drift }` and
       `verify_outcome(expected: Option<i128>, actual: i128)`. `None` means drift.
   - `pub struct PendingRead { balance: i128, ledger: u64, ts: i64 }`.
   - `pub struct VerifySchedule { next: HashMap<[u8; 32], Instant>, pending: HashMap<[u8; 32], PendingRead> }`
     with these pure methods:
     - `due(&self, holders: &[[u8; 32]], now, cap) -> Vec<[u8; 32]>`: absent or past-due holders
       that are not pending, up to `cap`;
     - `record(key, read)`;
     - `ready(&mut self, cursor: u64) -> Vec<([u8; 32], PendingRead)>`: removes and returns the
       reads with `ledger < cursor`;
     - `schedule(key, now)`: sets `next = now + PLUSD_VERIFY_INTERVAL`.
   - `pub struct PlusdSeedBackoff(KeyedBackoff<[u8; 32]>)` with read and insert warning channels, as
     in `SeedBackoff`.
   - `async fn read_balance(rpc, plusd_id, key) -> Result<(i128, u64, i64)>`:
     - calls `simulate_view(rpc, plusd_id, "balance", balance_args(key))`;
     - takes `ts = Utc::now().timestamp()` right after the call;
     - maps a `#13` error to `(0, latest, ts)`. That needs the `latestLedger` from the failed
       simulate: extend `simulate_view`'s error path, or call `rpc.simulate_transaction` directly
       in this module, so the ledger is kept. The coder picks the smaller change; the pure part is
       testable either way.
   - `seed_cycle`:
     - candidates come from `list_candidates(chain_id, plusd_id, MAX_SEEDS_PER_CYCLE)`;
     - each is gated by backoff, read, then inserted as `initial`;
     - an issuer balance is skipped and backed off;
     - other errors are backed off, with the first-warning-per-holder pattern;
     - a successful insert calls `schedule(key, now)`.
   - `verify_cycle`:
     - `seeded_holders` filtered through `holder_key`, then `due(...)`, then `read_balance`, then
       `record`;
     - read the cursor with `EventRepo::get_cursor(chain_id)`, then take `ready(cursor)`;
     - for each ready read: `latest` + `list_plusd_holder_steps`, then `parse_seed` + `balance_at`,
       then `verify_outcome`;
     - a drift writes a `warn!(chain_id, holder, ledger, expected, actual, "PLUSD balance drift; re-anchoring seed")`
       and inserts a `reanchor` seed;
     - every ready read ends with `schedule`.
     - Skip the compare (and reschedule) when the latest seed's `as_of_ledger >= ledger`.
   - `pub async fn run_plusd_seed_loop(rpc, seed_repo, logs_repo, event_repo, chain_id, plusd_id)`
     runs `seed_cycle`, then `verify_cycle`, then sleeps. A cycle error logs a `warn` and the loop
     continues.

7. [x] **Wire the loop** (`packages/worker/src/indexer/stellar/poller.rs::run_stellar_indexer_job`).
   - Add
     `let _plusd_seed_guard = settings.plusd_id.as_ref().map(|id| spawn_supervised("plusd-seed", chain_id, move || { … run_plusd_seed_loop(...).await; Ok(()) }))`,
     next to `_seed_guard`.
   - Extend the existing "Stellar PLUSD transfer indexing enabled" info log with
     `"(balance seed + drift check on)"`. There is no new env key.

8. [x] **API: seeded term** (`packages/api/src/total_balance.rs`).
   - `pub struct PlusdTerm { pub folded: Folded, pub from: Option<DateTime<Utc>>, pub blank_total_before: bool }`.
   - `pub fn plusd_term_from(kind: ChainKind, seed: Option<&PlusdSeedRow>, coverage: Option<PlusdCoverage>, rows: &[PlusdStepRow], interval, chain_id) -> Option<PlusdTerm>`:
     - EVM: `plusd_steps(rows)`, then `fold_term`. The result has `from: None` and
       `blank_total_before: false`. `seed` and `coverage` are ignored.
     - Stellar:
       - no seed gives `None` (debug log);
       - otherwise call `parse_seed` (warn and `None` on failure), then `seeded_plusd` (warn and
         `None` on a malformed row);
       - on `Backfill::Inconsistent` for an `initial` seed, warn
         "PLUSD back-computed balance inconsistent; pre-seed buckets incomplete";
       - then `fold_term(steps, …)` and `PlusdTerm { from: Some(ts(from)), blank_total_before, … }`.
   - `plusd_steps` keeps its signature and delegates to `shared::plusd_seed::plusd_delta`.
   - `term_outcomes` takes `anyhow::Result<Option<PlusdTerm>>`. `plusd_present` means
     `!term.folded.is_empty()`.
   - `CompositeInputs` gains `pub plusd_from: Option<DateTime<Utc>>` and
     `pub blank_total_before: bool`. In `build_composite_history`, set
     `let complete = plusd_from.is_none_or(|f| bucket >= interval.truncate(f))`. Then:
     - when `!complete`, `plusd_now` is `None`;
     - when `!complete && blank_total_before`, `total` is `None`, so the bucket is not pushed into
       `total_acc` and the stat is omitted by the existing `optional` rule;
     - `exact_held` is already gated on `plusd_now.is_some()`, so a pre-bound bucket whose total
       is kept uses the present-terms total.
   - A PLUSD fold failure (`fold_term` returning `None`) gives no term at all. `plusd_from` and
     `blank_total_before` then do not apply, and every bucket keeps the present-terms total, as in
     #1865.

9. [x] **API handler** (`packages/api/src/routes/pnl.rs::plusd_term`).
   - On Stellar, run `tokio::try_join!` over three reads:
     - `list_plusd_holder_steps`;
     - `PlusdSeedRepo::new(state.pool.clone()).latest(chain_id, plusd, &holder)`;
     - `plusd_coverage_start(chain_id, plusd)`.
     On EVM, only the steps are read.
   - Then call `plusd_term_from`.
   - The callers use `term.folded` for `first_plusd` and for the `CompositeInputs.plusd` slice, and
     `term.from` and `term.blank_total_before` for the two new inputs.
   - Window start: `first_plusd` is the first folded step. In the Covered case with `B0 != 0`
     that step is `C`, so the window reaches the bound.
   - `empty_series` passes `plusd_from: None` and `blank_total_before: false`.
   - No route or query change.

10. [x] **Env, checks and lint.**
    - `.env.example`: change the `CHAIN_99000001_STELLAR_API_PLUSD_ADDRESS` comment to "set only
      after the PLUSD seed ran and the acceptance check passed (#1878)". Change the indexer-key
      comment to mention that it also starts the seed and drift loop.
    - Run:
      - `scripts/check-chain-env-names.sh` (no new keys; it must stay green);
      - `cargo clippy --all -- -D warnings`;
      - `cargo test -p pipeline-worker -p pipeline-api -p shared`;
      - `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts`.

11. [x] **Tech debt.** Mark TD-175 `- **Resolved by #1878:** …`, and record there the outcome of
    the classic-payment check (manual step 3). If classic events are **not** visible, add a new
    TD that states:
    - the drift check is the only guard for classic PLUSD payments after the seed, and its cadence;
    - the pre-seed back-compute cannot see a classic payment between `C` and the seed.

## Test Strategy

The tests are pure unit tests: no Postgres, and no `DATABASE_URL`, `POSTGRES_URL` or other DB env
var. They live in `packages/<pkg>/tests/<topic>.rs`.

**Shared**

- `tests/migration_plusd_balance_seeds.rs` (new):
  - `CREATE TABLE IF NOT EXISTS plusd_balance_seeds (`, with every column, including the
    `balance >= 0` check and the `kind IN ('initial', 'reanchor')` check;
  - `PRIMARY KEY (chain_id, token_address, holder, as_of_ledger)`;
  - the additive-only guard copied from `migration_pocket_seeds.rs`.
- `tests/plusd_seed_sql.rs` (new), needle tests on whitespace-normalised consts:
  - candidates: each of the five sources (`event_name = 'PlusdTransfer'`, `FROM lp_profiles`,
    `FROM lps`, `chain_kind = 'stellar'`, `FROM position_events`), `UPPER(holder)`,
    `'^G[A-Z2-7]{55}$'`, `NOT EXISTS`, `LIMIT $3`, and `contract_address = $2`;
  - insert: `$6::numeric` and `ON CONFLICT DO NOTHING`;
  - latest: `balance::text ~ '^[0-9]{1,39}$'`, `kind`, `ORDER BY as_of_ledger DESC LIMIT 1`, and
    no bare `SELECT balance,`;
  - seeded holders: `DISTINCT holder`.
- `tests/contract_logs_plusd_sql.rs`:
  - add the `block_number` needle to the holder-steps tests; the existing needles stay;
  - new `PLUSD_COVERAGE_START_SQL` needles: `event_name = 'PlusdTransfer'`,
    `contract_address = $2`, `ORDER BY block_number, log_index LIMIT 1`, and no `$3` and no
    `jsonb_build_object`, since the query has no holder filter.
- `tests/plusd_seed_fold.rs` (new). The `seeded_plusd` cases use 7 decimals and the #1865 flow
  amounts:
  - `parse_seed`:
    - a good value;
    - a `None` balance, 40 digits, or a value above `i128::MAX` gives `None`;
    - an unknown `kind` gives `None`;
    - `reanchor` sets the flag.
  - Covered:
    - Setup: `C` sits below every row, and the seed `B = 575` sits at `L` after the pre rows
      +1000, −600, −100, +100, −50, +25, +200. A post row of −75 follows.
    - The result has `backfill == Covered` and `B0 == 0`, so there is no leading step and
      `blank_total_before` is false.
    - The steps are the pre rows plus the post row, and `from == C.ts`.
  - Covered with a non-zero start:
    - Setup: `B = 1575` with the same pre rows.
    - `B0` is 1000, the leading step is `(C.ts, 1000)`, and `blank_total_before` is true.
    - The running value at `L` equals `B`.
  - Covered for a wallet with no rows at all: a seed `B = 300` gives `B0 = 300` at `C.ts`, and the
    value is flat to `L`.
  - Inconsistent, negative start:
    - Setup: `B = 0` with a pre credit of +50.
    - `B0` is −50, so the result is Inconsistent.
    - The steps contain only the post rows, there is no leading step because `B = 0`,
      `from == seed_from`, and `blank_total_before` is true.
  - Inconsistent, negative midway:
    - Setup: `B0 >= 0`, but a pre debit drives the running value below 0 before a later credit.
    - The result is Inconsistent.
  - Inconsistent, overflow: a pre delta that overflows `checked_sub` or `checked_add` makes the
    result Inconsistent.
  - A `reanchor` seed with a valid `C` is Inconsistent (no back-compute), and `blank_total_before`
    is true.
  - NoCoverage:
    - no coverage row: NoCoverage with `blank_total_before == (B != 0)`, checked once with
      `B = 0` and once with `B = 5`;
    - `C.ledger > L`: also NoCoverage.
  - NoCoverage and Inconsistent:
    - rows `<= as_of_ledger` are dropped;
    - `seed_from` is clamped to an earlier first post row;
    - a zero seed has no leading step.
  - A malformed pre or post row gives `None`, and a self-transfer nets to 0.
  - `balance_at`:
    - the window is `(as_of, ledger]`;
    - a row at `ledger + 1` is excluded;
    - the result can be negative;
    - an overflow gives `None`.

**Worker**

- `tests/stellar_plusd_seed.rs` (new):
  - `holder_key`: a `G…` parses; `C…`, `M…`, lowercase and a bad CRC give `None`.
  - `balance_args`: one `ScVal::Address(ScAddress::Account(..))` carrying the key bytes.
  - `decode_balance`: an `I128` (including a value above `u64`) is accepted; a negative value is
    an error; a `U32` or `Void` is an error.
  - `is_no_balance_error`: `Error(Contract, #13)` is true; `#6` and a transport error are false.
  - `is_issuer_balance`: `i64::MAX` is true.
  - `verify_outcome`: equal values give `Matched`; differing values and `None` give `Drift`.
  - `VerifySchedule`:
    - `due` respects the cap and skips pending and not-yet-due holders;
    - `ready` returns only `ledger < cursor` and removes them;
    - `schedule` pushes the next check 6 h out;
    - after `ready` and `schedule`, the holder is not due until then.
  - The backoff wrapper keeps separate warn-once channels for read and insert.

**API**

- `tests/positions_history_plusd_seed.rs` (new), using `plusd_term_from` and
  `build_composite_history` (7 decimals):
  - Stellar, no seed: the result is `None`, and the composite has no `plusd_balance` while the
    total equals splusd plus escrow.
  - Stellar, Covered with `B0 != 0`. Setup: positions start two days before `C`, with daily
    buckets.
    - Every bucket from `truncate(C.ts)` on has `plusd_balance` equal to the hand back-compute
      `B − Σ(deltas in (t, L])`, and later the forward fold.
    - The bucket that contains `C` is present.
    - The buckets before it have **no** `plusd_balance` and **no** `total_balance`, while
      `splusd_value` is still present.
    - The response's `total_balance` stat is absent, and its `splusd_value` stat is present.
    - The last bucket's value is checked.
  - Stellar, Covered with `B0 == 0` (PLUSD first arrived after coverage began): the pre-bound
    buckets have no `plusd_balance`, and `total_balance == splusd_value + wire_out_escrow`. The
    stat is present, and there is no step at the bound.
  - Stellar, Inconsistent (a negative back-compute):
    - the term is present from the seed bucket on;
    - every bucket before the seed bucket, including those at or after `C`, has neither
      `plusd_balance` nor `total_balance`;
    - the warn fires once. Capture it with the thread-scoped subscriber pattern from
      `8ac516f0`, or assert on the returned `Backfill` if capturing is flaky.
  - Stellar, `reanchor` seed: the bound is the seed bucket, and earlier buckets have neither
    field.
  - Stellar, NoCoverage with a zero seed and no rows: the term is present with an empty fold.
    - A wallet with positions gets `"0.000000"` from the seed bucket on. Before it,
      `plusd_balance` is absent and the totals are unchanged.
    - A wallet without positions and without escrow gets `history: []`.
  - Stellar, a seed followed by a post debit larger than the balance: the term is `None` (the
    forward negative guard), and every bucket has the present-terms `total_balance`, with no
    blanking.
  - `days` path: a window that starts after the bound shows no blanking. A window that straddles
    the bound blanks only the buckets before it.
  - EVM: the output is identical to #1865's. Pass `plusd_from: None`,
    `blank_total_before: false`, and a seed and coverage of `Some(..)`. The seed is ignored on EVM,
    and buckets before the first movement are `"0.000000"`.
  - `term_outcomes` with `PlusdTerm`: the same matrix as #1865.
  - No output contains `e` or `E`.
- `tests/positions_history_plusd.rs`, `tests/positions_history_composite.rs`: add `block_number`
  to the `PlusdStepRow` literals, and `plusd_from: None, blank_total_before: false` to the
  `CompositeInputs` literals. Expectations are unchanged.

**Manual verification** (recorded in the user-stories doc; the coder runs steps 1 and 3, ops run
step 2 before setting the key)

1. **SAC errors** (testnet). Simulate `balance` for a `G…` without a PLUSD trustline and for an
   unfunded `G…`. Confirm the error text contains `Error(Contract, #13)`. If it differs, adjust
   `is_no_balance_error` and record the finding.
2. **Acceptance** (99000001, before `CHAIN_99000001_STELLAR_API_PLUSD_ADDRESS` is set).
   1. Deploy the worker with the indexer key set and wait about 15 min.
   2. Check `SELECT kind, count(*) FROM plusd_balance_seeds WHERE chain_id = 99000001 GROUP BY 1`.
      It must cover the candidate count.
   3. Wait for one verify round. Expect no `"PLUSD balance drift"` warn.
   4. Pick at least 5 LP wallets with a non-zero balance. For each wallet `W`:
      - simulate `balance(W)`, giving `(B, L')`;
      - wait until the cursor passes `L'`;
      - the DB value, seed plus rows in `(as_of_ledger, L']`, must equal `B` exactly.
   5. Run a local API against the same DB with the API key set. The last bucket's
      `plusd_balance` must equal `B / 10^7` rounded down to 6 dp, provided `W` has not moved
      since `L'`.
      - For one wallet with pre-seed movements, also check a bucket between `C` and the seed. Its
        value must equal `seed − Σ(rows in (bucket close, L])`, computed by hand from SQL.
      - Buckets before `C` must show neither field when the PLUSD at `C` is non-zero.
   6. Only then set the key in eq-lab/argocd (99000002 follows the same procedure).
3. **Classic events** (testnet). Send PLUSD between two whitelisted G-accounts with a classic
   payment. Record in TD-175 whether a `PlusdTransfer` row appears.
   - If it does not, wait for the next verify. Expect a drift `warn` and a `reanchor` row, after
     which the API value matches `balance(W)` again.

## Docs to Update

- **`docs/product-specs/lp-total-balance.md`** (keep it under 150 lines).
  - PLUSD fold on Stellar:
    - the latest seed anchors the term, and the coverage bound `C` (the chain's earliest
      `PlusdTransfer`) is the start of completeness;
    - the back-compute `B − Σ(deltas in (t, L])` holds down to `C` for an `initial` seed;
    - an inconsistent back-compute or a `reanchor` seed moves the bound to the seed;
    - buckets before the bound have no `plusd_balance`, and no `total_balance` when the PLUSD at
      the bound is non-zero (or the back-compute was inconsistent), in which case the
      `total_balance` stat is omitted;
    - a wallet without a seed omits the term;
    - the zero-seed rule.
  - Terms table: `total_balance` "Present" becomes "Whenever `splusd_value` is present, except
    Stellar buckets before the PLUSD bound (see PLUSD fold)".
  - Coverage rule: replace "off on 99000001 / 99000002 until TD-175" with the seed, the drift
    check, and the enabling order (seed, then verify round, then acceptance, then key).
  - Window and empty rules: "first PLUSD movement" becomes "first PLUSD step (seed or movement)".
  - Data Model: migration `20261110000001_plusd_balance_seeds.sql`; reads `plusd_balance_seeds`;
    implementation pointers to `shared/src/plusd_seed.rs` and `plusd_seed_repo.rs`.
- **`docs/references/backend.md`**:
  - a new `#### PLUSD balance seed` subsection after "PLUSD transfer indexing":
    - the table;
    - the candidate set;
    - the seed and verify phases, with caps and cadence;
    - `#13` gives a zero seed, and the issuer is skipped;
    - the timestamp clamp;
    - the latest-seed rule and re-anchors;
    - the coverage bound `C`, its justification, and the ops rule "never unset the Stellar indexer
      PLUSD key once set; if it was, rewind over the gap or delete the `PlusdTransfer` rows before
      the re-enable ledger";
    - re-running: `DELETE FROM plusd_balance_seeds WHERE chain_id = …` while the worker runs
      re-seeds within minutes;
    - the acceptance procedure;
  - the "Coverage and rewind rule" paragraph: replace the Stellar sentence with a pointer to the
    seed;
  - the Stellar ids table `plusd` row: the API key note becomes "set after the seed and acceptance
    (#1878)".
- **`ARCHITECTURE.md`**: one clause after the PLUSD indexing sentence. With the PLUSD key set, the
  Stellar indexer job also runs a supervised PLUSD balance-seed and drift-check task (simulate
  `balance`), never inside `index_once`.
- **`.env.example`**: the two comments (step 10).
- **`docs/exec-plans/tech-debt-tracker.md`**: TD-175 resolved (step 11).
- **`docs/user-stories/epic-1247/1878-plusd-balance-seed.md`** (new), modelled on
  `1865-plusd-balance.md`. Stories:
  - a seeded Stellar wallet gets `plusd_balance` from the coverage bound, back-computed before
    the seed;
  - buckets before the bound carry no `plusd_balance`, and no `total_balance` when PLUSD was held
    at the bound;
  - an inconsistent back-compute starts at the seed and logs a warning;
  - an unseeded wallet carries no value;
  - a drift re-anchors;
  - the acceptance check (manual steps 1 to 3);
  - pointers to the automated tests.
  Add its row to `docs/user-stories/index.md`. Update `1865-plusd-balance.md`, story 1 and story 6
  ("until TD-175 lands", which becomes "until the #1878 acceptance passes").
- **Frontend docs:** no code or doc change in this issue. Both fields are already optional. The
  product spec now states that early Stellar items may lack `total_balance` (a gap, never a
  step). The manager adds a note to #1282 / #1629 so the graph renders that gap.

### Resolved questions (human, 2026-11-10)

- **Buckets before the seed.** The human chose **(a) + (b)**:
  - Back-compute `plusd_balance` before the seed, with `balance_t = seed − Σ deltas in (t, as_of_ledger]`,
    bounded by the first ledger at which the chain's indexer PLUSD key was active.
  - Before that bound, a wallet whose PLUSD term is expected omits `total_balance` as well, so the
    graph never shows a false step.
  - Buckets with no PLUSD exposure keep today's behaviour.
  - Wallets with no seed are unchanged (the term is omitted).
  - A negative back-computed balance counts as incomplete: the term and the total are omitted for
    those buckets, with a warn.
  - How the plan implements this (Scope → Decisions):
    - the bound is `C`, the earliest indexed `PlusdTransfer` of the chain and contract, with its
      justification and the ops rule;
    - the three-case `seeded_plusd`: Covered, Inconsistent and NoCoverage;
    - "exposure" is read as a non-zero PLUSD balance at the bound;
    - a negative or overflowing back-compute, or a `reanchor` seed, moves the bound to the seed
      and blanks both fields before it.

## Open Questions

_None_
