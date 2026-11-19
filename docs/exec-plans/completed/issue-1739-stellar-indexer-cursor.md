# Issue #1739: Stellar indexer: stalls past RPC retention, can skip a ledger behind a load-balanced RPC, no HTTP timeouts

Source: https://github.com/eq-lab/pipeline/issues/1739

Parent epic: #2129 (math correctness, 2026-11-19 review). Branch `fix/1739-stellar-indexer-cursor`, based on
`origin/main` at `b75cf30b`. No Figma reference, so there is no visual verification step. Contracts are
frozen: nothing here touches contracts, deploy scripts or upgrades.

## Scope

All three problems in the issue body were checked against `origin/main` (`b75cf30b`) and are still real.

1. [x] **Skipped ledger behind a load-balanced RPC (the main fix, epic item 7).**
   `index_once` (`packages/worker/src/indexer/mod.rs:376-417`) takes `latest` from
   `poller.get_latest_block()` (Stellar: `getLatestLedger`), polls `[cursor, end]` and commits
   `end + 1`. `StellarEventPoller::poll` (`packages/worker/src/indexer/stellar/poller.rs:200` and `:297`)
   throws away the `latestLedger` that each `getEvents` response returns. `getEvents` is sent with
   `startLedger` only, with no `endLedger`. Events are trimmed to `<= end` on the client side
   (`rpc.rs::parse_event_json`). When `getLatestLedger` reaches node A (head N) and `getEvents` reaches node B
   (head N-1), B returns events up to N-1 without an error, the cursor is committed as N+1, and ledger N is
   never indexed. Two more defects in `StellarRpc::get_events` (`rpc.rs:70-93`) make this worse:
   - it combines `latestLedger` across the 25-id request chunks with `max`, which is the wrong direction;
   - a missing `latestLedger` silently falls back to `end_ledger` (`rpc.rs:129-132`).
2. [x] **Cursor below RPC retention.** `getEvents` returns an error when `startLedger < oldestLedger` (as
   documented by SDF). `index_loop` (`mod.rs:350-374`) logs the generic `"indexer error — retrying in 5s"`
   every poll interval forever. It does not say that the cursor fell out of retention, it does not report how
   many ledgers are lost, and it gives the operator no next step. `StellarRpc` has no `getHealth` call yet.
3. [x] **No HTTP timeouts.** These clients are built with `reqwest::Client::new()` or a plain alloy `on_http`,
   so they have no request or connect timeout:
   - `StellarRpc::new` (`indexer/stellar/rpc.rs:48`). This client is shared by the Stellar indexer, the
     price poller (`price_poller/stellar/poller.rs:27`) and the relayer whitelist
     (`relayer/stellar/whitelist.rs:62`).
   - The worker IPFS `MetadataFetcher` clients (`indexer/mod.rs:139`, `indexer/stellar/poller.rs:366`) and
     the API one (`packages/api/src/main.rs:99`).
   - The shared vendor clients: Crystal (`shared/src/crystal/client.rs:14`), Elliptic
     (`shared/src/elliptic/client.rs:17`), Sumsub (`shared/src/sumsub/client.rs:22`) and MetalpriceAPI
     (`shared/src/metal_price.rs:144`).
   - The worker alloy HTTP providers: `indexer/poller.rs:163`, `indexer/loan_registry_reader.rs:124`,
     `indexer/security_registry_views.rs:510`, `price_poller/evm/job.rs:22` and `relayer/evm/job.rs:37-42`.
   - SendGrid (`email/sendgrid.rs:21`, 10 s) and captcha (`api/src/captcha.rs:96`, 5 s) already set a
     timeout.

### In scope

- **A. Cursor commits only what the RPC has ingested.**
  - `poll` reports the highest ledger it actually covered.
  - The Stellar poller sets it to `min(to, every latestLedger seen)`. That covers every chunk, every page
    and both phases (core contracts, then deal tokens).
  - `index_once` commits `covered + 1` and drops mappers above `covered`.
  - If `covered < cursor`, nothing is committed.
  - EVM behaviour is unchanged: it reports `covered = to`.
- **B. Retention gap is loud and needs an operator.**
  - When `getEvents` fails, the Stellar poller calls `getHealth`.
  - If `cursor < oldestLedger`, it logs a stable `error!` line with `chain_id`, `cursor`, `oldest_ledger`
    and `missing_ledgers`, and returns a typed error.
  - The indexer never moves the cursor on its own; recovery is an operator step, described in a runbook in
    `docs/references/backend.md`.
  - The same path covers a `START_BLOCK` / `START_LEDGER` that is too old.
- **C. HTTP timeouts.**
  - Add one shared reqwest builder with a request timeout and a connect timeout.
  - Use it for every client listed in problem 3 except BitGo (see Out of scope).
  - Build the worker alloy HTTP providers on a reqwest client from that builder (`Http::with_client` +
    `RpcClient` + `ProviderBuilder::on_client`).

### Out of scope

- **BitGo client (`shared/src/bitgo/client.rs:41`).** The issue does not list it. Its
  `POST /txrequests` sends no idempotency key, so a client-side timeout after BitGo has accepted the request
  would turn a slow success into an error that the callers may retry, which risks a duplicate payout. This
  is logged as tech debt (see Docs to Update).
- **The same lagging-node problem on EVM.** `eth_getLogs` on a node behind the head often clamps to its own
  head without an error. This is reduced, but not removed, by `LOG_CONFIRMATIONS_DELAY`. The change in A
  leaves EVM at `covered = to`. This is logged as tech debt.
- **Archival backfill** of a gap that is past retention (for example Mercury, or an archival RPC
  integration). The runbook names "point `…_STELLAR_RPC_URL` at an archival RPC" as an operator option, but
  no code is written for it.
- **A DB table that records accepted gaps.** This would need a migration. See Open Questions.
- **Contracts, migrations, API routes and the frontend.**

## Assumptions and Risks

- **`latestLedger` semantics.** SDF documents it as "the sequence number of the latest ledger known to
  Stellar RPC at the time it handled the request". So `min(latestLedger)` over every response is a safe
  upper bound on what was scanned. We assume a node never returns events above its own `latestLedger`.
- **A lagging node can also make `getEvents` fail.** If `startLedger > latestLedger` on node B, the call
  errors ("greater than the latest ledger seen by this node"). That is safe, because the cursor does not
  move and the next poll retries. It does add `error!` noise during lag blips. The B-path `getHealth` probe
  treats this case as a plain retry, not a retention gap.
- **`getHealth` can reach a third node.** Its `oldestLedger` is only used to choose the alert, never to move
  the cursor, so a node with a different retention can at worst mislabel one log line.
- **Making a missing `latestLedger` a hard error** turns a malformed RPC response into a retry instead of a
  silent skip. Every supported Stellar RPC version returns the field, so this should not regress.
- **Changing `ChainEventPoller::poll`'s return type** touches both implementations
  (`indexer/poller.rs:305`, `indexer/stellar/poller.rs:159`) and `index_once`. No test implements the trait
  today: `grep -rn "ChainEventPoller" packages` finds only these.
- **Timeouts:**
  - 30 s per request and 5 s to connect. Stellar `getEvents` pages of up to 10 000 events and
    `eth_getLogs` over 1 000 blocks normally take well under 30 s. If a provider is slower, the chunk now
    fails and is retried instead of hanging.
  - `MetadataFetcher` retries transport errors 3 times with backoffs of 1 s, 5 s and 30 s. A hung IPFS
    gateway therefore costs about 156 s per mapper inside `index_once` instead of forever.
  - On the Stellar relayer path (`sendTransaction`) and the EVM relayer path (`eth_sendRawTransaction`), a
    timeout after the node accepted the transaction comes back as an error. A resubmit with the same
    sequence or nonce should be rejected by the chain (`DUPLICATE`, `TX_BAD_SEQ`, "nonce too low"), so no
    double effect is expected. This is **not verified** in the relayer code yet; the coder confirms it in
    Step 7 and stops if it does not hold.
- **alloy 0.8.3 API.** `alloy::rpc::client::RpcClient` (feature `rpc-client`, enabled by `providers`) and
  `alloy::transports::http::Http::with_client` both exist in 0.8.3. The resulting provider type stays
  `RootProvider<Http<reqwest::Client>>`, so the `HttpProvider` aliases do not change. For the relayer with
  fillers, use `.on_client(..)` in place of `.on_http(..)`.
- **Concurrent work.** None of these files are touched by the in-flight #1786 Phase 2 branch, which works
  in `packages/api` routes and `shared/src/collateral_valuation`. The tech-debt tracker is edited by many
  branches, so take the next free `TD-` number when committing (the last one on `b75cf30b` is TD-190).

## Open Questions

- **How should an accepted retention gap be recorded?** The issue asks to "record the gap". The plan
  records it through the loud log line plus an operator runbook entry (operator notes chain, ledger range,
  date and reason in the ops log), and adds no migration. Alternative: add an `indexer_gaps` table
  (`chain_id, from_ledger, to_ledger, accepted_at, reason`), written by the documented operator SQL and
  possibly shown somewhere. Confirm runbook-only, or ask for the table.
- **Should C cover the four shared vendor clients and the five alloy providers here, or only the Stellar
  path?** The Stellar path is the `StellarRpc` client and the indexer `MetadataFetcher`s. The issue lists
  all of these clients and the plan includes them, but they reach beyond the Stellar indexer (KYC,
  screening and price paths in the API and worker). If the reviewer wants #1739 kept narrow, Steps 6-7
  split cleanly into a follow-up issue.
- **Is 30 s / 5 s the right budget for every client?** The plan uses one shared default.

Resolved 2026-11-19: runbook + log only (no table); vendor and alloy timeouts stay in this issue; one 30 s / 5 s budget. Step 7 relayer check holds (EVM nonce from `eth_getTransactionCount(pending)`, Stellar fresh sequence per attempt, both pre-check the on-chain allow state). TD-194 (BitGo) and TD-195 (EVM head cap) filed.

## Implementation Steps

1. [x] **Cursor helpers (pure)** — new `packages/worker/src/indexer/cursor.rs`, declared `pub mod cursor;` in
   `indexer/mod.rs`:
   - `pub struct PolledRange { pub mappers: Vec<Box<dyn LogMapper>>, pub covered_to: u64 }`.
   - `pub fn commit_end(cursor: u64, requested_end: u64, covered_to: u64) -> Option<u64>`. It returns
     `Some(min(requested_end, covered_to))` when that value is `>= cursor`, otherwise `None`.
   - `pub fn covered_to(requested_end: u64, latest_ledgers: impl IntoIterator<Item = u64>) -> u64`. It
     returns `min(requested_end, min(latest_ledgers))`, or `requested_end` when the iterator is empty.

2. [x] **Trait and loop** — `packages/worker/src/indexer/chain_poller.rs`, `indexer/mod.rs`,
   `indexer/poller.rs`:
   - Change `ChainEventPoller::poll` to return `anyhow::Result<PolledRange>`.
   - The EVM impl (`poller.rs:310`) wraps its result as `PolledRange { mappers, covered_to: to }`.
     `EvmEventPoller::poll` (the inherent method) is unchanged.
   - In `index_once`:
     - call `poller.poll(cursor, end)`;
     - `let Some(commit) = commit_end(cursor, end, polled.covered_to) else { log at debug that the RPC is
       behind the cursor; return Ok(()) }`;
     - `polled.mappers.retain(|m| m.block_number() <= commit)`;
     - insert as today;
     - `set_cursor(commit + 1)`;
     - log `to = commit` and `requested_to = end`.

3. [x] **RPC: `latestLedger` handling** — `packages/worker/src/indexer/stellar/rpc.rs`:
   - Add `pub struct EventsPage { pub events: Vec<RawEvent>, pub latest_ledger: u64, pub oldest_ledger:
     Option<u64>, pub cursor: Option<String>, pub page_size: usize }`.
   - Add `pub fn parse_get_events_page(resp: &Value, start: u64, end: u64) -> Result<EventsPage>`, moving
     the body of the current page loop into it. Missing `latestLedger` becomes an error:
     `"getEvents response missing 'latestLedger'"`.
   - `get_events_single` loops over pages through it and keeps the **minimum** `latest_ledger` across pages.
   - `get_events` keeps the **minimum** across the 25-id chunks, replacing the current `max`.
   - Return type: `Result<(Vec<RawEvent>, u64)>`, where the `u64` is now that minimum. `get_events` has no
     other callers (`grep -rn "get_events(" packages`).

4. [x] **Stellar poll** — `packages/worker/src/indexer/stellar/poller.rs`:
   - Collect `latest` from the core `get_events` call (`:200`) and from the deal-token call (`:297`).
   - Compute `covered = cursor::covered_to(to, [latest_core, latest_tokens…])`.
   - Drop raw events with `ledger > covered` before building mappers. This is defensive, since `index_once`
     also filters.
   - Return `PolledRange { mappers, covered_to: covered }`.
   - `DealTokenSet::absorb_deal_registered` stays as it is. It is idempotent, so a `DealRegistered` above
     `covered` that is absorbed now and re-read on the next poll is harmless.

5. [x] **Retention gap** — `rpc.rs`, plus a new `packages/worker/src/indexer/stellar/retention.rs`
   (`pub mod retention;` in `stellar/mod.rs`):
   - `StellarRpc::get_health(&self) -> Result<RpcHealth>` calls `getHealth`, with
     `pub struct RpcHealth { pub latest_ledger: u64, pub oldest_ledger: u64, pub retention_window:
     Option<u64> }` and `pub fn parse_health(v: &Value) -> Result<RpcHealth>`.
   - In `retention.rs`:
     - `#[derive(Debug, Clone, PartialEq, Eq)] pub struct CursorBelowRetention { pub chain_id: i64, pub
       cursor: u64, pub oldest_ledger: u64, pub missing_ledgers: u64 }` with `Display` and
       `std::error::Error`.
     - `pub fn retention_gap(chain_id: i64, cursor: u64, oldest_ledger: u64) ->
       Option<CursorBelowRetention>`, which returns `Some` only when `cursor < oldest_ledger`.
   - In `StellarEventPoller::poll`, wrap the first `get_events` call. On `Err(e)`, call
     `self.rpc.get_health()`:
     - If it succeeds and `retention_gap(..)` is `Some(gap)`, emit `tracing::error!(chain_id, cursor,
       oldest_ledger, missing_ledgers, "stellar indexer cursor is below RPC retention; indexing halted until
       an operator resets the cursor")` and return `Err(anyhow::Error::new(gap).context(e))`.
     - Otherwise return the original `e`.
     - The deal-token call needs no probe. It runs only after the core call succeeded for the same
       `from`.
   - The cursor is never advanced automatically.

6. [x] **Shared HTTP client builder** — new `packages/shared/src/http_client.rs` (`pub mod http_client;` in
   `shared/src/lib.rs`):
   - `pub const REQUEST_TIMEOUT: Duration = 30 s`.
   - `pub const CONNECT_TIMEOUT: Duration = 5 s`.
   - `pub fn http_client() -> reqwest::Client`, equal to `http_client_with(REQUEST_TIMEOUT)`.
   - `pub fn http_client_with(timeout: Duration) -> reqwest::Client`, which is
     `Client::builder().timeout(timeout).connect_timeout(CONNECT_TIMEOUT.min(timeout)).build().expect(..)`,
     the same pattern as SendGrid.
   - Replace `reqwest::Client::new()` with `shared::http_client::http_client()` in `StellarRpc::new`,
     `indexer/mod.rs:139`, `indexer/stellar/poller.rs:366`, `api/src/main.rs:99`, `crystal/client.rs`,
     `elliptic/client.rs`, `sumsub/client.rs` and `metal_price.rs`.
   - Leave `bitgo/client.rs` unchanged.
   - Leave `api/tests/*` unchanged; they are test fixtures.

7. [x] **alloy providers with timeouts** — new `packages/worker/src/evm_http.rs` (`pub mod evm_http;` in
   `packages/worker/src/lib.rs`):
   - `pub fn evm_rpc_client(url: reqwest::Url) -> alloy::rpc::client::RpcClient<Http<reqwest::Client>>`,
     built as `RpcClient::new(Http::with_client(shared::http_client::http_client(), url), false)`.
   - Use it with `ProviderBuilder::new().on_client(..)` in `indexer/poller.rs:163`,
     `indexer/loan_registry_reader.rs:124`, `indexer/security_registry_views.rs:510` and
     `price_poller/evm/job.rs:22`.
   - In `relayer/evm/job.rs:37-42`, replace `.on_http(rpc_url)` with `.on_client(evm_rpc_client(rpc_url))`.
   - The `HttpProvider` aliases stay as they are. If an alias stops matching, fix the alias rather than
     adding wrappers.
   - Confirm that the relayer's resubmit path treats "already known" or "nonce too low" after a timed-out
     send as non-fatal. If it does not, stop and raise it to the manager rather than changing relayer
     semantics here.

8. [x] **Comments and lint.**
   - Follow the comment-less rule: no new doc comments or body comments. New files get at most a 1-2 line
     `// spec: docs/references/backend.md#stellar-indexer-cursor-and-rpc-retention` header (and the
     `#http-client-timeouts` anchor for `http_client.rs` and `evm_http.rs`).
   - Update the stale doc comments you touch: `rpc.rs::get_events` ("Returns `(events,
     latest_ledger_from_response)`") and the `chain_poller.rs` `poll` doc. Shorten them; do not add to
     them.
   - Run `cargo fmt`, `cargo clippy --all -- -D warnings`, `cargo nextest run --workspace` (or
     `cargo test --all`) and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure or use in-process mock HTTP. There is no DB and no env-var connection. Tests go in
`packages/<pkg>/tests/`, never in inline `#[cfg(test)]` modules.

- **`packages/worker/tests/indexer_cursor.rs`** (new):
  - `commit_end`:
    - normal case: covered `>=` requested end, so it returns the requested end;
    - lagging case: covered `= end - 1`, so it returns `end - 1`;
    - covered `= cursor`, so it returns `cursor` (one ledger);
    - covered `< cursor`, so it returns `None`;
    - covered `> end`, so it is capped at `end`.
  - `covered_to`:
    - empty iterator;
    - one value;
    - mixed values, where the minimum wins;
    - all values above `requested_end`.
  - A regression case named for the issue: cursor 100, `getLatestLedger` 110, `getEvents` reports 109.
    The commit must be 109, so the next cursor is 110 and ledger 110 is re-polled.
- **`packages/worker/tests/stellar_rpc_events.rs`** (new). Add `mockito = "1"` to `[dev-dependencies]` in
  `packages/worker/Cargo.toml`; it is already in `Cargo.lock` through `shared`.
  - `parse_get_events_page` fixtures:
    - `latestLedger` and `oldestLedger` are parsed;
    - a missing `latestLedger` is an `Err`;
    - an event above `end` is dropped and an event below `start` is dropped;
    - `cursor` and `page_size` are read.
  - `StellarRpc::get_events` against a `mockito::Server`. Use `Matcher::PartialJson` on `method`,
    `startLedger`, `pagination.cursor` and `contractIds`.
    - Two pages, the first with 10 000 events (generate the JSON in the test) and the second with fewer.
      The first reports `latestLedger` 200 and the second 198, so the result is 198.
    - Two contract chunks (26 ids) report 200 and 197, so the result is 197. This is the regression for
      `max`.
    - A JSON-RPC `error` body gives an `Err`.
- **`packages/worker/tests/stellar_retention.rs`** (new):
  - `retention_gap`:
    - `cursor < oldest` gives `Some`, with the correct `missing_ledgers`;
    - `cursor == oldest` gives `None`;
    - `cursor > oldest` gives `None`.
  - `CursorBelowRetention`'s `Display` contains the chain, the cursor and the oldest ledger.
  - `parse_health` on a real-shaped `getHealth` body (`status`, `latestLedger`, `oldestLedger`,
    `ledgerRetentionWindow`), and with `ledgerRetentionWindow` missing, which gives `None`.
  - `StellarRpc::get_health` against `mockito`.
- **`packages/shared/tests/http_client.rs`** (new):
  - A `tokio::net::TcpListener` on `127.0.0.1:0` accepts a connection and never answers.
    `http_client_with(Duration::from_millis(200)).get(..).send()` fails with `e.is_timeout()` within about
    2 s, checked with `tokio::time::timeout` around the call so that a regression fails the test instead of
    hanging it.
  - `http_client()` builds without panicking.
- **Existing tests stay green:**
  - `packages/worker/tests/stellar_rpc.rs` (filters, `parse_get_transaction`);
  - `stellar_event_poller.rs`;
  - `evm_dynamic_poll.rs` (it uses `fetch_chunk_logs`, not the trait);
  - `packages/shared/tests/metadata_fetcher.rs`;
  - the vendor client tests;
  - `api/tests/*`.
- **Not tested automatically:** the `StellarEventPoller::poll` / `index_once` wiring needs a `PgPool`, and
  DB-backed tests are not allowed. That glue is covered by the pure helpers above plus a manual testnet
  check in the PR description: run the worker against testnet with `RUST_LOG=info` and confirm that
  `indexed block range` lines show `to` / `requested_to`, and that the cursor in `log_collector_state`
  advances continuously.

## Docs to Update

- **`docs/references/backend.md`** — add `#### Stellar indexer cursor and RPC retention` after the
  Stellar (Soroban) events table (before `#### Stellar deal-token-factory indexing`, about line 389). It
  covers:
  - Cursor rule: the commit is `min(requested end, every getEvents latestLedger) + 1`, which makes a lagging
    load-balanced node safe. EVM still commits the requested end.
  - Retention gap: the log line text and its fields, and that the indexer never skips on its own.
  - Operator runbook:
    1. Stop the worker.
    2. Either point `CHAIN_<id>_STELLAR_RPC_URL` at an RPC whose retention covers the cursor and restart,
       or accept the gap with
       `UPDATE log_collector_state SET last_indexed_block = <oldest_ledger> WHERE chain_id = <id>`.
    3. Record the chain, the ledger range `[cursor, oldest_ledger - 1]`, the date and the reason.
    4. Note the downstream effects: the PLUSD and pocket seeds cover balances, and per-event history in the
       gap is lost.
- **`docs/references/backend.md`** — add a short `#### HTTP client timeouts` note covering the shared
  30 s / 5 s builder, the clients that use it, and BitGo as the deliberate exception.
- **`docs/exec-plans/tech-debt-tracker.md`** — add two entries, using the next free TD numbers:
  - BitGo client has no timeout because `txrequests` has no idempotency key.
  - The EVM indexer commits the requested end and does not cap it at the node's head.
- **`docs/exec-plans/known-bugs.md`** — no entry. This issue is the bug record.
- **Product specs:** none. The change is in indexer reliability and does not change any user-facing or API
  behaviour.
- **On completion,** move this plan to `docs/exec-plans/completed/`.
