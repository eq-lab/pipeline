# Issue #1788: Stellar DealTokenFactory: DEBT-only DealRegistered after contracts #38 (collateral token removed)

Source: https://github.com/eq-lab/pipeline/issues/1788

Parent epic: #1776. **Merge order step 1:** this must be merged and running on pipeline-test
before `pipeline-stellar-contracts` #38 (`ee87852`) is deployed to testnet. A HEAD
`deal_registered` that the indexer drops cannot be recovered once it is older than Soroban RPC
retention (~7 days, `docs/references/backend.md:383`).

No Figma reference is attached to this Issue or to #1776, so there is no visual verification step.

## Scope

### In scope

1. **Stellar parser** (`packages/worker/src/indexer/stellar/deal_token_factory_parsers.rs`)
   - `parse_deal_registered` accepts both shapes, per event and with no per-address mode:
     legacy `{debt, cargo}` and HEAD `{debt}`. `debt` stays required. `cargo` is optional:
     absent gives `"cargo": null` in `params`. A `cargo` key that is present but is not an
     address still rejects the whole event, as today (D2).
   - `DealTokenSet::insert_deal`, `seed`, `absorb_deal_registered`, and the validation helper
     take an optional CARGO. A HEAD deal tracks only its DEBT token.
   - `parse_cargo_synced` and `"cargo_synced"` in `DEAL_TOKEN_FACTORY_EVENT_TOPICS` stay, for
     historical and legacy-factory events.
   - Tests pin that `loan_registry_set` / `debt_issuer_set` (HEAD) and `registries_set` /
     `issuers_set` (legacy) are not collected and produce no warning.
2. **Shared** (`packages/shared/src/contract_logs_repo.rs`)
   - `DealRegistrationRow.cargo: Option<String>`.
   - `list_deal_registrations` drops the `params->>'cargo' IS NOT NULL` predicate. Every row
     with `loan_id` and `debt` is returned, and `cargo` is `NULL` when the key is absent or JSON
     `null`.
3. **EVM** (`packages/worker/src/indexer/deal_tokens.rs`)
   - `DealTokenRegistry::seed` takes the `Option`. EVM rows always carry `cargo`, so their
     behaviour does not change: both tokens are seeded, the return value still counts rows, and
     an unparseable address still skips the row with a warning. A `None` CARGO seeds the DEBT
     token alone (D4). The public `insert_deal(loan_id, debt, cargo: Address)` and `observe`
     signatures stay the same.
4. **Audit log** (`packages/api/src/routes/audit_log.rs`): no logic change. `pass()` already
   returns `cargo: null`. The change is tests plus one sentence in the `AuditLogItem.details`
   OpenAPI description.
5. **Docs:** `docs/references/backend.md` (Stellar section 368–383 and one line in the EVM
   section), `docs/product-specs/audit-logging.md`, and a new user-stories doc for epic #1776.

### Out of scope

- Contract or deployment changes (contracts are frozen).
- Rewording the `"Deal tokens registered"` action string for a single-token deal. It is display
  text the trustee UI shows verbatim; changing it is a UI-copy decision, not part of this fix.
- Pruning or topic-filter polling (#1708, TD-144). After this change each new deal adds one
  tracked contract instead of two. #1708 is being rescoped around that.
- `.env.example` factory id and comments. #1794 owns the contract-id sync (its line 151 comment
  still says "DEBT/CARGO movements").
- `argocd/pipeline/test.yaml` (other repo). See Open Questions Q1.
- The EVM `DealRegistered` ABI and parser. EVM contracts are unchanged.
- Contracts #39 (security registry replaces the collateral registry). See Open Questions Q2.

## Findings from research

- **F1: HEAD event shape.** `contracts/deal-token-factory/src/event.rs` at `ee87852`:
  `DealRegistered { #[topic] loan_id: u32, debt: Address }`. `#[contractevent]` encodes
  non-topic fields as an `ScVal::Map`, so HEAD data is `Map{debt}` and legacy data is
  `Map{cargo, debt}`. The topic is still `["deal_registered", loan_id]`.
  `extract_address_from_map(.., "debt")` decodes both shapes, so only the `cargo` lookup has to
  change. `CargoSynced`, `RegistriesSet` and `IssuersSet` are removed. `LoanRegistrySet` and
  `DebtIssuerSet` are new. Contracts HEAD is `7646cef` (#39), which does not touch
  `deal-token-factory`.
- **F2: in-place upgrade is possible.** `DealTokenFactory` implements `Upgradeable`
  (`lib.rs:223`), and `justfile:749` maps `upgrade` to UPGRADER. Both shapes can therefore come
  from `CAIBACM6…` (the testnet factory in `addresses.json`, and the value of
  `CHAIN_99000001_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` on pipeline-test). The parser
  decides per event, so it needs no per-address state.
- **F3: today's failure mode.** For a HEAD event, `parse_deal_registered` returns `None` at the
  `cargo` lookup. `dispatch_parser` then logs "deal-token-factory event recognised by name but
  not decodable" (`stellar/parsers.rs:653-667`) and writes no row. The DEBT token never enters
  `DealTokenSet`, so no `DealTokenTransfer` is ever written for it.
- **F4: the shared seed query is chain-scoped, not kind-scoped.** `list_deal_registrations`
  (`contract_logs_repo.rs:1465-1481`) filters on `chain_id` and `event_name` only. It feeds the
  Stellar `DealTokenSet::seed` (`stellar/poller.rs:367-379`) and the EVM
  `DealTokenRegistry::seed` (`indexer/mod.rs:146-155`). pipeline-test sets
  `CHAIN_560048_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`, so the EVM seed runs live on Hoodi
  (checked in `argocd/pipeline/test.yaml:203`).
- **F5: the seed is in-memory only.** Both seeds only fill an in-memory map, so a restart
  re-seeds and nothing is written or duplicated.
- **F6: audit log.** `pass(params, &["debt", "cargo"])` uses `param_str`. That gives `None`
  (JSON `null`) for both an absent key and JSON `null`. The trustee `useAuditLog.ts` types
  `details` as `Record<string, unknown>` and does not read `cargo`.
- **F7: no tracing-capture helper exists in the repo.** `tracing-subscriber` (with `fmt`) is a
  normal dependency of `pipeline-worker`, so an integration test can install a scoped `fmt`
  subscriber with an in-memory `MakeWriter`. No new crate is needed.
- **F8: an existing test changes meaning.**
  `deal_registered_rejects_wrong_name_missing_topic_and_missing_key`
  (`tests/stellar_deal_token_parsers.rs`) asserts that `{debt}` alone is rejected. It must
  become "missing `debt` is rejected".

## Decisions

- **D1: `"cargo": null` rather than omitting the key.** The `DealRegistered` key set stays
  `loan_id, debt, cargo` for both shapes, which matches the "absent side is JSON `null`" rule
  used by `DealTokenTransfer`. `params->>'cargo'` is SQL `NULL` either way, and the audit log
  renders `null` either way.
- **D2: a present but undecodable `cargo` rejects the event.** Use `get_map_entry` (`pub(crate)`
  in `loan_registry_parsers.rs`) to tell "key absent" apart from "key present but not an
  `Address`". Absent gives `None`. Present and decodable gives `Some(strkey)`. Present and
  undecodable makes the whole parser return `None`, so the existing warning fires, as it does
  today. A malformed legacy event is therefore never stored as a DEBT-only deal.
- **D3: Stellar validation stays strict per token.** A row or log is tracked only if `debt` is a
  `C…` contract id and `cargo`, when present, is one too. Otherwise it is skipped with the
  existing warning, as today. The helper becomes `fn is_contract_id(&str) -> bool`, used as
  `is_contract_id(debt) && cargo.is_none_or(is_contract_id)`.
- **D4: EVM `seed` with `cargo: None` seeds DEBT alone.** The SQL used to filter such rows out.
  The EVM parser always writes `cargo`, so no EVM row lacks it and behaviour on Hoodi is
  unchanged. Seeding DEBT alone keeps the two arms symmetric. Implementation: a private
  `insert_tokens(&self, loan_id, &[(Address, DealTokenKind)]) -> Vec<Address>`, with
  `insert_deal` delegating to it, so the public signature is unchanged. Return-value semantics
  stay the same: EVM counts rows that added at least one token, and Stellar counts tokens added.
- **D5: Stellar `insert_deal` becomes `insert_deal(&mut self, loan_id: &str, debt: &str, cargo: Option<&str>) -> usize`.**
  Its only callers are in this module and in tests.

## Rollout safety (pipeline-test)

Each item maps to the epic's mandatory section:

- **Migrations:** none. No schema change, and no `contract_logs` / `log_collector_state`
  truncation.
- **The previous image keeps booting and a rollback works.** The old worker's seed SQL still has
  `cargo IS NOT NULL`, so it skips HEAD rows without a decode error. During a rollback window the
  old image does not track the DEBT token of a HEAD deal, and its new `deal_registered` events
  produce the old warning and no row. Recovery after rolling forward: rewind the Stellar cursor
  to before the first missed registration, within RPC retention. The old API renders
  `cargo: null` through the same `pass()`.
- **New env keys:** none.
- **EVM behaviour is unchanged.** `DealRegistrationRow` and `list_deal_registrations` are shared
  and chain-scoped. EVM rows always carry `cargo`, so the dropped predicate never matters there.
  The EVM regression tests (Test Strategy, part 3) pin that both tokens are still seeded with the
  same kinds and the same return count.
- **RPC reads:** none added. The parser and the set are pure, and nothing new can fail
  `index_once`.
- **The API change is additive.** `details.cargo` on `DealRegistered` was already allowed to be
  `null` (from `pass()`). It is now `null` for HEAD deals. No field is removed or renamed, and no
  frontend reads it.
- **Post-deploy check on pipeline-test.** Before merging, note the worker's startup lines
  `Stellar deal-token set seeded from contract_logs` (`deals`, `tokens`) for 99000001 and
  `deal-token registry seeded` (`deals`) for 560048. After the image rolls, the same counts must
  appear. Legacy rows still seed two tokens each, and Hoodi is unchanged.

## Open Questions

_None_ — both answered below.

### Resolved questions (human, 2026-10-30)

- **Q1 → the manager prepares the argocd change on deploy notice.** When the contracts team
  announces #38 with a new factory id, the manager switches
  `CHAIN_99000001_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` in `argocd/pipeline/test.yaml`
  before the first `register_deal` on it. This PR does not touch argocd.
- **Q2 → already covered.** #39 (SecurityRegistry) has its own epic, #1775 (indexer #1779; the
  CollateralRegistry stays legacy-only). Nothing to add to #1776.

Original questions:

- **Q1 (deploy coordination, does not block implementation):** Will contracts #38 reach testnet
  as an **in-place `upgrade`** of `CAIBACM6…` or as a **new factory id**? If it is a new id,
  `CHAIN_99000001_STELLAR_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS` in `argocd/pipeline/test.yaml`
  must be switched before the first `register_deal` on the new factory. Otherwise its events
  fall outside the RPC `contractIds` filter. Seeding stays correct across the switch, because
  it covers any factory address. Who owns that argocd edit (#1794, or the person deploying #38)?
- **Q2 (FYI, outside this Issue):** Contracts HEAD is now #39 (`7646cef`), which deletes
  `collateral-registry` and adds `security-registry`. Epic #1776 lists #38 but not #39. If #39
  is deployed together with #38, the Stellar collateral-registry indexer (#1481) and the
  factory's `collateral_registry` assumptions in the docs go stale. Should #39 get its own
  sub-issue before deployment?

## Implementation Steps

1. **Shared row type and query** (`packages/shared/src/contract_logs_repo.rs`)
   - `DealRegistrationRow.cargo: Option<String>`.
   - In `list_deal_registrations`, delete the line `AND params->>'cargo' IS NOT NULL`. Keep the
     select list, the `loan_id` / `debt` predicates and the ordering.
2. **EVM registry** (`packages/worker/src/indexer/deal_tokens.rs`)
   - Add a private `insert_tokens` (D4). `insert_deal` delegates to it with both tokens.
   - `seed`: parse `debt`, and parse `cargo` only when it is `Some`. Any parse failure skips the
     row with the existing warning (log `cargo = ?row.cargo`). On success, call `insert_tokens`
     with DEBT plus CARGO when it is present. Count the row when anything was added.
   - `observe` and `decode_deal_registered` do not change.
3. **Stellar set and parser** (`packages/worker/src/indexer/stellar/deal_token_factory_parsers.rs`)
   - `insert_deal(loan_id, debt, cargo: Option<&str>)` loops over DEBT plus the optional CARGO.
   - Replace `is_contract_pair` with `is_contract_id` (D3).
   - `seed`: validate with `is_contract_id(&row.debt) && row.cargo.as_deref().is_none_or(is_contract_id)`.
     Change the warn fields to `cargo = ?row.cargo`, then call
     `insert_deal(&row.loan_id, &row.debt, row.cargo.as_deref())`.
   - `absorb_deal_registered`: require `loan_id` and `debt`. `cargo` is
     `params.get("cargo").and_then(Value::as_str)`, which is `None` for JSON `null` or an absent
     key. Validate as in `seed`, keep the warning with `cargo = ?cargo`, then insert.
   - `parse_deal_registered`: decode `debt` as today. Decode `cargo` per D2 by importing
     `get_map_entry` from `loan_registry_parsers`. Emit
     `json!({ "loan_id": …, "debt": debt, "cargo": cargo })`, where `cargo: Option<String>`
     serialises to `null`.
   - Leave `DEAL_TOKEN_FACTORY_EVENT_TOPICS`, `parse_debt_synced` and `parse_cargo_synced` as
     they are.
   - `stellar/parsers.rs` (dispatch) and `stellar/poller.rs` need no changes. Verify that both
     compile against the new signatures.
4. **Audit-log OpenAPI description** (`packages/api/src/routes/audit_log.rs`): add one sentence
   to the existing `AuditLogItem.details` doc text: `DealRegistered.cargo` is `null` when the
   deal has no CARGO token (Stellar, from contracts #38). Do not change the code.
5. **Tests** (see Test Strategy). Everything goes in `packages/<pkg>/tests/*.rs`. No inline
   `#[cfg(test)]`, no Postgres, no `DATABASE_URL` / `POSTGRES_URL`.
6. **Docs** (see Docs to Update).
7. **Verify:** `cargo clippy --all -- -D warnings`;
   `cargo test -p pipeline-worker --test stellar_deal_token_parsers --test deal_token_registry --test deal_token_parsers --test evm_dynamic_poll`;
   `cargo test -p pipeline-api --test dashboard_auditlog_chain`; `cargo test -p shared` (it must
   compile); `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure unit tests built from XDR or ABI fixtures.

**1. `packages/worker/tests/stellar_deal_token_parsers.rs` (Stellar)**

- Add a `deal_registered_head_event()` fixture: the same topics as the legacy fixture, with
  value `encode_map(vec![("debt", contract_val(DEBT))])`.
- `head_deal_registered_decodes_debt_and_null_cargo`: `params ==
  {"loan_id":"42","debt":DEBT,"cargo":null}`, `event_name == "DealRegistered"`,
  `contract_address == FACTORY`.
- Keep `deal_registered_decodes_loan_id_and_token_ids` for the legacy shape, unchanged.
- Rework `deal_registered_rejects_wrong_name_missing_topic_and_missing_key` (F8). A map with only
  `cargo` (no `debt`) gives `None`. A map whose `cargo` is `ScVal::U32(1)` gives `None` (D2). A
  map whose `debt` is not an address gives `None`.
- `legacy_and_head_deal_registered_from_the_same_factory_both_parse`: both raw events have
  `contract_id = FACTORY`, and the HEAD one uses loan `43` with `DEBT_2`. Both go through
  `dispatch(.., Some(FACTORY))` and give `"DealRegistered"`. Both parsed logs go into one
  `DealTokenSet` via `absorb_deal_registered`, which gives 3 tokens: `DEBT`/`CARGO` for 42
  (kinds Debt/Cargo) and `DEBT_2` for 43 (Debt). `get(CARGO_2)` is `None`. Run the events in
  both orders (legacy then HEAD, and HEAD then legacy).
- `head_deal_debt_movements_become_deal_token_transfers`: absorb a HEAD deal, then run
  `route_deal_token_events` over DEBT `mint`, `clawback` and `transfer` raws from that DEBT id.
  That gives 3 `DealTokenTransfer` logs with `token_kind = "debt"`, `loan_id = "42"`, and the
  expected `from`/`to` nulls.
- `absorb_head_log_tracks_debt_only` and `absorb_rejects_null_cargo_with_non_contract_debt`.
  Rework `absorb_rejects_non_contract_token_addresses`: a non-contract `cargo` still rejects,
  and `cargo: null` with a valid `debt` is accepted.
- Seed: change the existing rows to `cargo: Some(..)`. Add
  `seed_mixes_legacy_and_debt_only_rows`: a legacy row seeds 2 tokens, a `cargo: None` row seeds
  1, and a `cargo: Some("0x…")` row with a contract `debt` is skipped. `seed` returns 3.
  Legacy two-token rows still seed both tokens.
- `insert_deal` tests use `Some(..)` / `None`. Re-inserting a debt-only deal returns 0.
- `dispatch_ignores_head_and_legacy_factory_admin_events`: `loan_registry_set`,
  `debt_issuer_set`, `registries_set` and `issuers_set` (data `Map{loan_registry}` etc.) give
  `None`. Also assert that none of the four is in `DEAL_TOKEN_FACTORY_EVENT_TOPICS`.
- `head_deal_registered_and_admin_events_log_no_warning`: install a scoped
  `tracing_subscriber::fmt()` subscriber whose `MakeWriter` appends to an `Arc<Mutex<Vec<u8>>>`
  (`tracing::subscriber::with_default`). Dispatch the HEAD `deal_registered`,
  `loan_registry_set` and `debt_issuer_set`, and assert that the captured output has no
  `WARN`. Positive control in the same test: dispatch a `deal_registered` with a non-address
  `debt` and assert the capture contains "not decodable". This proves the capture works, so the
  negative assertion cannot pass by accident.

**2. `packages/api/tests/dashboard_auditlog_chain.rs` (audit log)**

- Extend `deal_token_factory_events_render_on_both_arms`. A Stellar `DealRegistered` with
  `"cargo": null` and one without a `cargo` key both give action `"Deal tokens registered"` and
  `details == {"debt": "C…", "cargo": null}`. The legacy EVM assertion stays.

**3. `packages/worker/tests/deal_token_registry.rs` (EVM regression)**

- Change `seed_skips_malformed_rows` to `cargo: Some(..)`. The expectations stay the same:
  returns 1, 2 addresses.
- Add `seed_evm_rows_track_debt_and_cargo_as_before`: two EVM rows built with `to_checksum` and
  `cargo: Some`. They return `2`, give 4 addresses, and `lookup` gives the right `loan_id` and
  `DealTokenKind` for each.
- Add `seed_debt_only_row_tracks_debt` (D4): `cargo: None` returns `1`, gives 1 address, and
  `lookup(&DEBT)` is `Debt`.
- Add `seed_skips_row_with_unparseable_cargo`: debt is valid and `cargo: Some("nope")`. It
  returns `0` and the registry stays empty.
- `deal_token_parsers.rs` and `evm_dynamic_poll.rs` stay unchanged and must stay green. They pin
  the EVM `DealRegistered` row shape (with `cargo`) and `observe`.

**Not covered by automated tests:** the SQL predicate change, because the project rule forbids
Postgres in tests. It is covered by review and by the pipeline-test seed-count check in Rollout
safety.

## Docs to Update

- `docs/references/backend.md`, section "Stellar deal-token-factory indexing" (lines 368–383):
  - Table: `DealRegistered` params are `loan_id`, `debt`, `cargo`. Add that `cargo` is JSON
    `null` for deals registered after contracts #38, and that both shapes are accepted from the
    same factory address (in-place upgrade or redeploy).
  - `cargo_synced` row: legacy factories only (removed in #38). The parser is kept for history.
  - Per-deal token row: CARGO is tracked only for pre-#38 deals.
  - New sentence: factory admin events (`loan_registry_set`, `debt_issuer_set`, legacy
    `registries_set`, `issuers_set`) are not collected.
  - Seed paragraph: rows without `cargo` seed DEBT only.
  - Qualify the "shapes are identical on the EVM arm" sentence (line 370): EVM `cargo` is never
    `null`.
- `docs/references/backend.md`, section "EVM DealTokenFactory (#1485)", "Runtime address
  discovery": one clause saying that the seed query is shared with Stellar and a row without
  `cargo` seeds DEBT only, which never happens on EVM.
- `docs/product-specs/audit-logging.md:71`: `DealRegistered.details.cargo` is `null` for Stellar
  deals registered after contracts #38.
- `packages/api/src/routes/audit_log.rs`: the `AuditLogItem.details` OpenAPI description (step 4).
- New user-stories doc `docs/user-stories/epic-1776/1788-stellar-debt-only-deal-registered.md`
  (ISSUE_PROTOCOL §6), with these stories:
  1. A HEAD `register_deal` on testnet gives a `DealRegistered` row with `cargo: null` and no
     "not decodable" warning in the worker log.
  2. A DEBT `sync_debt` mint or clawback gives `DealTokenTransfer` rows with `token_kind = "debt"`.
  3. After a worker restart, the legacy deals' seed counts are unchanged (two tokens each) and
     the HEAD deal's DEBT is still tracked.
  4. The Hoodi (560048) `deal-token registry seeded` count is unchanged.
  5. The trustee audit log shows "Deal tokens registered" for the HEAD deal.
- `docs/user-stories/index.md`: add an "Epic #1776 — Stellar minter-era read models" section with
  the row for #1788.
- Not touched (owned elsewhere): `.env.example:151` (#1794), TD-144 in
  `docs/exec-plans/tech-debt-tracker.md` (#1708).
