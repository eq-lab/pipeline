# Issue #1314: Backend: merged LP activity feed (on-chain + bank transfers)

Source: https://github.com/eq-lab/pipeline/issues/1314

Parent epic: #1247 (V1.0). Scope is the **Rescope (2026-11-10)** section of the Issue body,
which replaces the original "merged feed" framing: the backend adds the missing LP-scoped
wire-in rows; the frontend merges `requests` + `wire_ins` + `wire_outs` client-side in a
follow-up on #1282 (not in this Issue).

Figma: LP home Recent activity, frame `6701-97136` ("Add funds / Withdraw funds — Bank
transfer" rows). The Figma MCP was not authenticated during planning, so the row was not
inspected; the field set below carries every value such a row can show (amount, status,
bank value date, on-chain time, reference). Visual verification belongs to the #1282
follow-up that renders the row, not to this backend change.

## Scope

### In scope

1. **`GET /v1/requests`** (`packages/api/src/routes/analytics.rs`) gains an optional
   `wire_ins` list beside `wire_outs`, with the same behaviour:
   - present only when an in-scope chain has a minter address (`minter_chains_in_scope`);
     the key is **omitted** (not `null`) otherwise — EVM-only and unconfigured-chain
     responses are byte-for-byte unchanged, exactly as `wire_outs` today;
   - a lookup error is logged at `warn` and the key is omitted (degrade, never 500);
   - newest first across chains.
2. **Row shape** `LpWireInItem`:

   | Field | Type | Source |
   |---|---|---|
   | `chain_id` | `i64` | chain of the minter |
   | `id` | `i64` | on-chain wire id |
   | `status` | `"Direct"` \| `"Assigned"` | `WireInStatus::as_str()` |
   | `amount` | dollar string, 6 dp (`"1.234567"`) | `to_base6_string(amount)` — same as `wire_outs.amount` |
   | `value_date` | ISO UTC | `WireIn.value_date` |
   | `ref_hash` | lowercase hex | `WireIn.ref_hash` |
   | `recorded_at` | ISO UTC | block time of `WireIn` |
   | `assigned_at?` | ISO UTC, omitted when absent | block time of `WireInAssigned` |

   Sort: `assigned_at.unwrap_or(recorded_at)` descending (the moment the wire became the
   LP's — the Issue's "row belongs to the LP from assignment"), then `chain_id`, then `id`
   ascending as tie-breakers (mirrors the `wire_outs` sort).
3. **Which rows are the LP's** (receiver = the caller's wallet):
   - `WireIn` whose `receiver` is the wallet → `Direct`;
   - escrowed `WireIn` (receiver = minter) later `WireInAssigned` to the wallet → `Assigned`;
   - escrowed rows never assigned (still `Escrowed`, or `Returned`) are never listed for any
     wallet.
4. **`status=pending`** → `wire_ins` is an empty list (key still present when a minter chain
   is in scope) and no DB query runs. Justification: both LP-visible states are terminal —
   the contract stakes the PLUSD for the LP inside the same call that emits `WireIn`
   (direct) or `WireInAssigned` (assigned), so no on-chain wire-in is ever "pending" for the
   LP. A bank deposit that is not yet minted is the off-chain `pending_bank_deposits` total
   on `/v1/lps/me` (#1285), which the Issue keeps out of scope. Keeping the key present
   (empty) rather than omitting it keeps "key present ⇔ minter chain in scope" true for
   both lists.
5. **Repo query** `ContractLogsRepo::list_lp_wire_in_events` in
   `packages/shared/src/contract_logs_repo.rs`, matched through the existing GIN index
   `idx_contract_logs_params ON contract_logs USING GIN (params)`
   (`packages/shared/migrations/20260521000001_contract_logs_jsonb.sql:24`) with
   `params @> jsonb_build_object(...)`, never `params->>'receiver' = …` / `LOWER(...)`.
6. Docs + user-stories doc (see "Docs to Update").

### Out of scope

- Any new route, any contract change (contracts are frozen), any migration (the GIN index
  already exists).
- Off-chain `lp_bank_deposits` not yet minted (already the `pending_bank_deposits` total).
- EVM: no minter address is ever configured for an EVM chain
  (`config.rs::load_minter_cash_book` returns early for non-Stellar), so `wire_ins` is
  omitted there, same as `wire_outs`.
- Frontend: `packages/frontend/src/api/useRequests.ts` types and the merged Recent-activity
  timeline — follow-up on #1282.
- Re-writing `LP_WIRE_OUT_EVENTS_SQL` onto the GIN index (it still uses
  `LOWER(params->>'lp')`; covered by TD-173's "older reads", not touched here).

## Assumptions and Risks

- **`WireInReturned` can never reach an LP row — so it is not queried.** In the frozen
  Stellar minter (`pipeline-stellar-contracts/contracts/minter/src/lib.rs`
  `return_wire_in`, ~line 168) a wire can be returned **only while `Escrowed`**; the same
  guard exists on `assign_wire_in`. `Direct` and `Assigned` are terminal. A returned wire
  therefore always has `receiver = minter` and is "unassigned escrow", which the Issue says
  is never shown. The Issue's bullet "`WireInReturned` → row stays, status `returned`" is
  unreachable for any LP-owned row; the plan drops `returned_at` / `return_ref_hash` from
  `LpWireInItem` and does not fetch `WireInReturned` rows. Flagged in Open Questions in
  case the product intent was to show returned escrow tied to the LP off-chain.
- **Status casing.** The Issue proposes `direct` / `assigned` / `returned`; the plan uses
  `Direct` / `Assigned`, the strings `WireInStatus::as_str()` already serves on
  `GET /v1/cash-book` and the casing `wire_outs` uses (`Pending` / `Settled` /
  `Cancelled`) on the same response.
- **Wallet case.** The handler lower-cases `wallet` for `requests` and `wire_outs`
  (`LOWER(params->>'lp') = $3`). `@>` is an exact JSON match and the indexer stores Stellar
  addresses as canonical upper-case strkeys (`sc_address_to_strkey`). The wire-in lookup
  must bind `query.wallet.trim().to_uppercase()` — **not** the lower-cased `wallet` — or it
  matches nothing. Strkey alphabet is `A–Z2–7`, so upper-casing is lossless.
- **`params.id` type drift.** `WireIn` and `WireInAssigned` store `id` as a JSON number,
  `WireInReturned` as a string (spec `minter-cash-book.md` § Data Model). The parent
  lookup builds both `{"id": <number>}` and `{"id": "<text>"}` probes so a future parser
  change on either side cannot silently drop assigned rows.
- **Index use is planner-dependent.** The OR of two `@>` predicates (one with
  `@> ANY(ARRAY(...))`) is expected to plan as a `BitmapOr` of GIN bitmap index scans
  (non-native `ScalarArrayOpExpr` is supported in bitmap scans). Tests cannot prove this
  without a database (pure unit tests only). An optional manual `EXPLAIN` on pipeline-test
  can be noted in the PR; it is not a gate.
- **Wallet equal to the minter.** Calling with `wallet=<minter C…>` would `@>`-match every
  escrowed `WireIn`. The handler skips that chain (returns no rows) and the fold filter
  drops `Escrowed` rows anyway — no escrow leaks, no wasted scan.
- **Doc merge conflict.** Open PR #1875 (trustee escrowed wires) edits
  `docs/product-specs/minter-cash-book.md` and `docs/product-specs/deposits.md`. Whichever
  lands second rebases; the edits here are one paragraph each.
- **GIN index exists.** Migration `20260521000001` created `idx_contract_logs_params`
  (default `jsonb_ops`, supports `@>`); TD-173 on `main` already says so. The wire-in query
  is written with `@>` only, so it is not a new TD-173 site.
- No dependency on unmerged work: `build_wire_ins` (#1790) and `wire_outs` on
  `/v1/requests` are on `main`.

## Open Questions

- Escrowed wires that were **returned** (never assigned) are not listed for any LP, because on-chain they never had an LP receiver (contract only returns `Escrowed` wires). Should an LP nevertheless see "Add funds — returned" when the off-chain `lp_bank_deposits.ref_hash` ties that wire to them? Default in this plan: **no** (on-chain only, per the Issue's "unassigned escrow never shown"); a yes would add an `lp_bank_deposits` join and is better as its own Issue.

## Implementation Steps

1. **Repo SQL** — `packages/shared/src/contract_logs_repo.rs`, next to
   `LP_WIRE_OUT_EVENTS_SQL`:

   ```sql
   pub const LP_WIRE_IN_EVENTS_SQL: &str = "WITH assigned AS (
            SELECT params->'id' AS id
              FROM contract_logs
             WHERE chain_id = $1
               AND contract_address = $2
               AND event_name = 'WireInAssigned'
               AND params @> jsonb_build_object('receiver', $3::text))
        SELECT event_name, block_number, log_index, block_timestamp, params
          FROM contract_logs
         WHERE chain_id = $1
           AND contract_address = $2
           AND (
                (event_name IN ('WireIn', 'WireInAssigned')
                 AND params @> jsonb_build_object('receiver', $3::text))
             OR (event_name = 'WireIn'
                 AND params @> ANY(ARRAY(
                     SELECT jsonb_build_object('id', (id #>> '{}')::bigint) FROM assigned
                     UNION ALL
                     SELECT jsonb_build_object('id', id #>> '{}') FROM assigned)))
           )
         ORDER BY block_number, log_index";
   ```

   - Add `pub async fn list_lp_wire_in_events(&self, chain_id: i64, minter: &str,
     wallet_strkey: &str) -> anyhow::Result<Vec<MinterEventRow>>` mirroring
     `list_lp_wire_out_events` (bind `chain_id`, `minter`, `wallet_strkey`).
   - Exact text may be adjusted (e.g. a CTE for the probe array) as long as: every
     `contract_logs` reference is scoped by `chain_id = $1` and `contract_address = $2`;
     the receiver and id matches use `@>`; there is no `->>'receiver'`, no `LOWER(`;
     `WireInReturned` is not selected; rows come back in `(block_number, log_index)` order
     (the fold needs `WireIn` before its `WireInAssigned`).
   - Header/comment rules: no new comments beyond what the file already has (AGENTS.md
     comment-less rule).

2. **Fold filter** — `packages/api/src/minter_cash_book.rs`:
   - `pub fn build_lp_wire_ins(rows: &[MinterEventRow], minter: &str, wallet: &str) ->
     Vec<CashBookWireIn>` = `build_wire_ins(rows, minter)` keeping only
     `status ∈ {Direct, Assigned}` **and** `receiver == wallet`. Reuses the existing fold;
     no change to `build_wire_ins`.

3. **API item + mapping** — `packages/api/src/routes/analytics.rs`:
   - `#[derive(Debug, Serialize, ToSchema)] pub struct LpWireInItem { chain_id, id, status,
     amount, value_date, ref_hash, recorded_at, #[serde(skip_serializing_if =
     "Option::is_none")] assigned_at: Option<String> }`.
   - `pub fn lp_wire_in_items(per_chain: Vec<(i64, Vec<CashBookWireIn>)>) ->
     Vec<LpWireInItem>`: maps each wire (`to_base6_string`, `iso_utc_from_unix`) and sorts
     by `assigned_at.unwrap_or(recorded_at)` desc, then `chain_id`, then `id`. Pure — the
     unit-test seam.
   - `async fn lp_wire_ins(state, scope, wallet_strkey: &str, pending_only: bool) ->
     anyhow::Result<Option<Vec<LpWireInItem>>>`:
     - `minters = minter_chains_in_scope(...)`; empty → `Ok(None)`;
     - `pending_only` → `Ok(Some(Vec::new()))` with no query;
     - per chain: skip when `wallet_strkey == minter`; else
       `list_lp_wire_in_events(chain_id, &minter, wallet_strkey)` →
       `build_lp_wire_ins(&rows, &minter, wallet_strkey)`;
     - `Ok(Some(lp_wire_in_items(per_chain)))`.
   - Degrade: replace `degrade_wire_outs` with a generic
     `pub fn degrade_minter_list<T>(what: &str, result: anyhow::Result<Option<Vec<T>>>) ->
     Option<Vec<T>>` (warn `"failed to fetch {what}; omitting them"`, field `error`), and
     call it for both lists (`"wire-outs"`, `"wire-ins"`). Update the one existing caller
     in `packages/api/tests/analytics_pnl_positions_chain.rs`.
   - `RequestsResponse` gains `#[serde(skip_serializing_if = "Option::is_none")] pub
     wire_ins: Option<Vec<LpWireInItem>>` (placed after `wire_outs`).
   - `get_requests`: the `Unconfigured` early return sets `wire_ins: None`; add
     `lp_wire_ins(&state, scope, &query.wallet.trim().to_uppercase(), pending_only)` as a
     fourth future in the existing `tokio::join!`; degrade it; pass it into the success
     response.
   - `AnalyticsDoc` components: add `LpWireInItem`.
   - Fix every other `RequestsResponse { .. }` literal (currently
     `packages/api/tests/analytics_pocket_claims.rs:40` and
     `packages/api/tests/analytics_pnl_positions_chain.rs:296,307`) with `wire_ins: None`.

4. **Docs** — see "Docs to Update"; write the user-stories doc.

5. **Lint/verify** — `cargo fmt`, `cargo clippy --all -- -D warnings`,
   `cargo test -p shared --test contract_logs_repo`,
   `cargo test -p pipeline-api --test minter_cash_book --test analytics_pnl_positions_chain --test analytics_pocket_claims`,
   then `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Pure unit tests only, in existing external test files (no inline `#[cfg(test)]`, no
`DATABASE_URL` / `POSTGRES_URL` / any env-var DB connection).

- **`packages/shared/tests/contract_logs_repo.rs`** — `lp_wire_in_events_sql_*` shape test
  on the normalized `LP_WIRE_IN_EVENTS_SQL`:
  - contains `params @> jsonb_build_object('receiver', $3::text)`, `event_name =
    'WireInAssigned'`, `event_name IN ('WireIn', 'WireInAssigned')`, `@> ANY(`,
    `ORDER BY block_number, log_index`;
  - `contract_address = $2` and `chain_id = $1` each appear twice (CTE + outer);
  - does **not** contain `->>'receiver'`, `LOWER(`, or `WireInReturned`;
  - contains both id probe forms (`::bigint` and the text form).
- **`packages/api/tests/minter_cash_book.rs`** — `build_lp_wire_ins` on fixture rows:
  - direct `WireIn` to `LP` → one `Direct` row;
  - escrowed `WireIn` + `WireInAssigned` to `LP` (numeric and string `id` variants) → one
    `Assigned` row with `assigned_at`;
  - escrowed `WireIn` only, and escrowed `WireIn` + `WireInReturned` → empty;
  - `WireIn` direct to another wallet, and escrow assigned to another wallet → empty;
  - `wallet == MINTER` → empty (no escrow leak);
  - an orphan `WireInAssigned` whose `WireIn` is not in the rows → empty.
- **`packages/api/tests/analytics_pnl_positions_chain.rs`** (next to the `wire_outs` tests):
  - `lp_wire_in_items` maps amount (`raw 12345678` → `"1.234567"`), ISO dates, omits
    `assigned_at` for `Direct`, and sorts by `assigned_at ?? recorded_at` desc with
    `chain_id`, `id` tie-breakers across two chains (an old wire assigned late sorts above
    a newer direct one);
  - `RequestsResponse` with `wire_ins: None` serialises without the key (extend the
    existing exact-JSON assertion); with `Some(vec![])` serialises `"wire_ins": []`;
  - OpenAPI: `wire_ins` is a property of `RequestsResponse`, not in `required`, and
    `LpWireInItem` is a component;
  - `degrade_minter_list` (renamed from `degrade_wire_outs`): `Err` → `None`,
    `Ok(Some([]))` → `Some([])`, `Ok(None)` → `None`.
- The `pending_only` short-circuit and the wallet-upper-casing live in the async handler
  (DB-bound, not unit-testable here); keep them one-liners and cover them in the
  user-stories doc. If the coder wants a unit seam, extract `fn wire_in_wallet(raw: &str)
  -> String` and test it.

## Docs to Update

- **`docs/product-specs/minter-cash-book.md`**
  - Overview: "The LP's own wire-outs ride on `GET /v1/requests`" → wire-ins and wire-outs.
  - API Contract: a paragraph after the `wire_outs` one — `wire_ins` list on
    `GET /v1/requests`: the wallet's own wire-ins on in-scope minter chains as
    `{ chain_id, id, status, amount, value_date, ref_hash, recorded_at, assigned_at? }`;
    `status` is `Direct` or `Assigned`; an escrowed wire appears only once assigned to the
    wallet and never if returned; ordered by `assigned_at ?? recorded_at`, newest first;
    `status=pending` returns it empty; key omitted when no in-scope chain has a minter;
    the wallet matches the stored strkey case-insensitively (upper-cased before matching).
- **`docs/product-specs/deposits.md`** § API Contract — one line mirroring
  `withdrawals.md:67`: on Stellar the LP's minted bank wires are listed under the optional
  `wire_ins` key of `GET /v1/requests`; link to `minter-cash-book.md`.
- **`docs/references/backend.md:775`** — `/v1/requests` row: mention `wire_ins` /
  `wire_outs` (Stellar minter lists, #1314 / #1790).
- **`docs/exec-plans/tech-debt-tracker.md`**
  - Line ~2297 (EVM has no minter): "the LP `wire_outs` list" → "the LP `wire_ins` /
    `wire_outs` lists".
- **`docs/user-stories/epic-1247/1314-lp-wire-ins-activity.md`** (new) + link row in
  `docs/user-stories/index.md`. Stories: (1) direct wire to the LP's `G…` appears as
  `Direct`; (2) escrowed wire assigned to the LP appears as `Assigned` with `assigned_at`,
  sorted at assignment time; (3) escrowed wire not yet assigned / returned is absent for
  every LP; (4) `status=pending` → `wire_ins: []`; (5) lower-case `wallet` still matches;
  (6) EVM-only scope / unconfigured `chain_id` → no `wire_ins` key; (7) another LP's wire
  is never listed.
- Move this plan to `docs/exec-plans/completed/` at completion (per the usual flow).
