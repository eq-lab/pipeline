# Issue #1941: API: pending_operations for EVM chains (calldata args)

Source: https://github.com/eq-lab/pipeline/issues/1941

Parent epic: #1937, merge-order step 2 (in parallel with #1940). It reads what #1939 (merged, PR #1948) writes. The
Stellar counterpart is #1922 (completed plan `docs/exec-plans/completed/issue-1922-pending-operations-api.md`).
Frontend consumers: #1942 and #1943. QA: #1945. Contracts are frozen.

**Directive (human, 2026-11-17, epic #1937).** Everything on EVM uses the same approach as on Stellar. This plan
mirrors the merged #1922 implementation one-to-one: the same DTO, `TargetScope`, `pending_state`, `group_by_loan`,
`pending_for_loan`, `pending_ops_by_loan`, `attach_pending_operations`, `/security` handler, the single
`LIST_PENDING_LOAN_OPS_SQL` with its supersede rule and read-time record → loan `COALESCE`, the same spec section and
the same test files. Every deviation is listed in [Differences from Stellar](#differences-from-stellar), with the
chain-level reason.

## Scope

### Source of truth (checked by the planner on 2026-11-18, base `main` `99b36f41`)

- **Stellar implementation (#1922)**:
  - `packages/api/src/pending_operations.rs`: `PendingOperation` (11 keys, `args_xdr: String`),
    `PendingOperationState`, `PendingTargetKind`, `TargetScope { loan_registry, minter, security_registry }` with
    `targets()` / `kind()` (exact string match), `pending_state`, `pending_operation`, `group_by_loan`,
    `pending_for_loan`.
  - `packages/api/src/routes/loan_book.rs`:
    - `pending_ops_by_loan` (line ~1511) skips every chain whose kind is not Stellar. It builds the scope from
      `loan_registry_addresses`, `minter_addresses` and `security_registry_addresses`.
    - `attach_pending_operations` fills each `loans[]` entry.
  - `packages/api/src/routes/loan_security.rs` `get_loan_security`: scope = the SecurityRegistry only. It returns
    `404 security_registry_not_configured` before any read when `security_registry_addresses` has no entry for the
    chain.
  - `packages/shared/src/access_manager_repo.rs`: `PendingOpRow { …, args_xdr: String, … }`,
    `LIST_PENDING_LOAN_OPS_SQL` (requires `o.args_xdr IS NOT NULL AND o.args_json IS NOT NULL`),
    `list_pending_loan_ops`.
  - Tests: `packages/api/tests/pending_operations.rs` and `packages/shared/tests/access_manager_pending_sql.rs`.
  - Spec: `docs/product-specs/loan-security-state.md#pending-operations`. It says "Empty array: EVM chains".
- **EVM data (#1939, `docs/references/access-manager-events.md#evm`)**:
  - EVM rows set `calldata` (`0x` + lowercase hex, selector included) and leave `args_xdr` `NULL`. The named CHECK
    `access_manager_operations_one_args_encoding` (`args_xdr IS NULL OR calldata IS NULL`) keeps the two exclusive.
  - `function` is the Solidity name (camelCase). An unknown selector or target gives `0x<selector>`, with
    `args_json = NULL`.
  - `args_json` follows the ABI display rules: `uint256` ids are decimal strings, tuples are objects keyed by the
    Solidity component names, and enums are ordinals.
  - `caller` and `target` are EIP-55 (`to_checksum(None)` in `access_manager_evm_parsers.rs`). `operation_id` is
    64 lowercase hex without `0x`, as on Stellar.
  - `schedule_ledger` is the block number. The nonce never resets.
  - A row whose operation id does not verify is stored without `calldata`, `args_json` and `loan_id`.
  - `loan_id` / `record_id` use the Stellar `loan_ref` table with EVM names, and `setInspectors` (RecordNft) gets
    neither.
  - `security_records` and `SecurityRecordRegistered` rows of the EVM SecurityRegistry use its EIP-55 address and
    decimal-string ids (#1938, merged in PR #1947), so the read-time record lookup works unchanged.
- **Contract (`pipeline-contracts@150631a`)**, stock OpenZeppelin `AccessManager.sol`:
  - `_consumeScheduledOp` (:564) reverts `NotReady` while `timepoint > now`. It reverts `Expired` when
    `timepoint + expiration() <= now` (`_isExpired`, :724), and `expiration()` is `1 weeks`. These are exactly
    Stellar's boundaries, so `pending_state` is unchanged.
  - `cancel` (:527) checks only `timepoint != 0`, so on EVM an expired schedule **can** still be canceled.
- **API address config (`packages/api/src/config.rs`)**:
  - `loan_registry_addresses` is required on every chain and is EIP-55 on EVM.
  - `minter_addresses` is **Stellar only** (`load_minter_cash_book`, `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`).
  - `security_registry_addresses` is **Stellar only** today (`load_security_registry_address` returns early for EVM).
    #1940 adds `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` to this same map (#1940 issue body; its plan is not
    written yet, and `pipeline-feat-1940-evm-security-api` has no plan file on 2026-11-18).
  - There is no EVM API Minter key. `.env.example` has only `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS`.
  - `minter_addresses` is also read by `cash_book.rs` (`resolve_minter`), `analytics.rs` (`minter_chains_in_scope`),
    `attention_counts.rs` (Minter events, and the ramp fallback `filter(|_| !minter_addresses.contains_key(..))`),
    `capital_allocation.rs` (gated by the Stellar-only switch) and `pnl.rs` (inside the Stellar arm).
- **Trustee today**:
  - `packages/trustee/src/api/pendingOperations.ts` types `args_xdr: string` and has no `calldata`.
  - The hub and the per-loan pages drop EVM loans through `stellarOnlyActionReason`. This issue therefore changes
    nothing the Trustee renders until #1942 / #1943.

### In scope

1. `pending_operations` is served for EVM loans, on every `loans[]` entry of `GET /v1/loan-book[?chain_id=]` and on
   `GET /v1/loan-book/{loan_id}/security?chain_id=`. The second needs the EVM SecurityRegistry key from #1940; until
   then it returns `404` for EVM, as today.
2. DTO: `args_xdr` becomes `string | null`, and a new `calldata: string | null` sits right after it. Both keys are
   always present, and exactly one is non-null (Stellar: `args_xdr`; EVM: `calldata`). Every other field keeps its
   meaning. `function` and `args` are served verbatim, in the chain's native form (Decision 2).
3. Read SQL: the one statement serves both chains. The `args_xdr IS NOT NULL` filter becomes
   `(o.args_xdr IS NOT NULL OR o.calldata IS NOT NULL)`, and the select list gains `o.calldata`. The supersede rule,
   the `COALESCE` record lookup, the status filter and the order stay unchanged.
4. Target scope on EVM: LoanRegistry from `CHAIN_<id>_EVM_API_LOAN_REGISTRY_ADDRESS` (existing), Minter from a new
   optional `CHAIN_<id>_EVM_API_MINTER_ADDRESS` (Decision 3), and SecurityRegistry from #1940's
   `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` (Decision 4). The comparison is between canonical EIP-55 strings
   (Decision 5). `setInspectors` (RecordNft) is never served, as Stellar's `set_inspectors`.
5. The supersede and expiry rules are the same as #1922. No new route, no migration and no new endpoint. One new
   optional env key, and one new `AppState` map (Decision 3).
6. Docs and user stories (see Docs to Update).

### Out of scope

- The Trustee and wallet-connect: TS types, EVM bindings and the per-chain function-name mapping (#1942, #1943).
- `/security` for EVM and the EVM LTV fields of the loan book: #1940 owns `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS`
  and enabling `security_registry_addresses` on EVM.
- A RecordNft API key. No RecordNft operation is loan-scoped (Decision 4).
- Any change to the #1939 indexer, the table, or the CHECK. Contract changes.
- The EVM cash book, analytics and attention counts on the Minter (Decision 3 keeps them off).
- Stage deploy config: epic merge-order step 3 sets the new key there.

## Decisions (planner; mirror Stellar)

1. **One SQL statement and one DTO for both chains.** Nothing forks per chain in the read path. The only per-chain
   input is the address map that supplies the Minter target (Decision 3). `pending_ops_by_loan` stops skipping EVM
   chains. It skips a chain only when it has no kind (unconfigured) or no target is configured. `PendingOpRow`,
   `pending_operation`, `group_by_loan` and `pending_for_loan` serve both chains.
2. **Presentation for a uniform Trustee: native values, chain-neutral `target_kind`.**
   - `target_kind` is already chain-neutral (`loan_registry`, `minter`, `security_registry`, `other`). It means the
     same on both chains and is derived the same way (the `target` compared with the chain's API addresses). This is
     the field the Trustee keys its pages on (`PENDING_OWNER_KINDS`).
   - `function` and `args` are served verbatim, as stored, exactly as #1922 does. Stellar gives snake_case and XDR
     display shapes. EVM gives Solidity camelCase and ABI display shapes. The API adds no mapping and no extra field.
   - Reasons:
     - The human chose native names in storage (#1939 Decision 2).
     - The Trustee has to decode `args` per chain anyway. EVM ids are decimal strings, `setTerms` carries a 15-field
       camelCase tuple, and enums are ordinals. It also builds per-chain execute and cancel calls (`args_xdr` vs
       `calldata`). The name map is a few lines next to that code (`PENDING_OWNERS` in
       `-risk-council-pending.ts`).
     - A served name stays exactly what the chain executes.
   - The spec publishes the per-chain name table (Docs to Update), so #1942 / #1943 implement the mapping from it.
     See Open Question 2 for the alternative.
3. **EVM Minter: a new key in its own map.** It is `CHAIN_<id>_EVM_API_MINTER_ADDRESS`, optional, normalized to
   EIP-55 by `load_optional_contract`, and stored in a new `ChainsConfig.evm_minter_addresses` /
   `AppState.evm_minter_addresses`. The value must equal `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS`.
   - It is **not** stored in `minter_addresses`. On Stellar that map also switches on `GET /v1/cash-book`, the
     analytics Minter series and the attention-count Minter reads. Those reads are Stellar-shaped (Stellar Minter
     event names, `holders_of_stellar_addresses`). On EVM they would serve wrong data, and they would switch the EVM
     ramp count away from `transfer_addresses`.
   - The new map is read only by the pending-operations scope. See Open Question 1.
4. **SecurityRegistry and RecordNft keys: none added here, so no address has two keys.**
   - #1941 reads `security_registry_addresses`, the map #1940 extends to EVM with
     `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS`.
   - If #1941 merges first, EVM SecurityRegistry operations (`setTerms`, `resolveFlag`, `releaseWithConsent`) are not
     served until #1940 lands. The loan book rows still carry the LoanRegistry and Minter operations, and `/security`
     on EVM stays `404`, as today. No code change is needed when #1940 lands.
   - #1941 does **not** copy #1940's key into its own branch. Doing so would switch on the EVM `/security`, the LTV
     fields and the margin-call counts, which are #1940's scope.
   - RecordNft: `setInspectors` is the only RecordNft operation, and it has no loan, so the RecordNft is not a
     target. If #1940 adds an EVM RecordNft API key for its own reasons, #1941 does not read it.
5. **Address comparison.**
   - EVM addresses are compared as canonical EIP-55 strings. The indexer writes `target` with `to_checksum(None)`.
     The API config normalizes every EVM key with `to_checksum(None)`. So the existing exact comparisons are EIP-55
     comparisons with no code change: `o.target = ANY($2)` in SQL, `contract_address = $3` in the record lookup, and
     `TargetScope::kind`.
   - A `lower()` in SQL would defeat `idx_am_ops_pending_loan`. Tests pin the normalization on both sides.
6. **"Exactly one non-null" is enforced in the mapper as well as by the CHECK.** `pending_operation` returns `None`
   when both `args_xdr` and `calldata` are `None`, or both are `Some`. That is the same defensive style as the
   `nonce` `u32::try_from`. The SQL filter already excludes the first case, and the CHECK excludes the second.

## Differences from Stellar

Everything not listed is identical: routes, DTO key set (plus `calldata`), states and boundaries, sort,
`target_kind` enum, supersede rule, record → loan `COALESCE`, status filter, error policy (`500`), public access,
test layout and docs structure.

| # | Area | Stellar (#1922) | EVM (#1941) | Chain-level reason |
|---|---|---|---|---|
| 1 | Native args field | `args_xdr`: base64 `ScVal::Vec`, non-null; `calldata` is `null` | `calldata`: `0x` + lowercase hex of the whole `data` (selector included), the exact argument of `execute(target, data)` / `cancel(caller, target, data)`; `args_xdr` is `null` | Different native call encodings; #1939's CHECK keeps the two columns exclusive. |
| 2 | Read filter on args | `args_xdr IS NOT NULL` (an absent value means the transaction was out of RPC retention) | `calldata IS NOT NULL` through the same `(args_xdr IS NOT NULL OR calldata IS NOT NULL)`; an absent value means the operation id did not verify. `args_json IS NOT NULL` also drops unknown selectors and undecodable args | Stellar recovers args from the transaction; EVM takes them from the event and verifies them. |
| 3 | `function` | snake_case `Symbol` (`set_default`) | Solidity camelCase (`setDefault`), served verbatim; the Trustee maps per chain (Decision 2) | Both store the contract's native name (#1939 Decision 2). |
| 4 | `args` | XDR display shapes (`u32` ids as numbers, `Symbol`-keyed maps, enums as `[Symbol]`) | ABI display shapes (`uint256` ids as decimal strings, tuples keyed by Solidity names, enums as ordinals) | Different type systems; display only on both. |
| 5 | Address form and comparison | Strkey `C…` / `G…`, exact match | EIP-55, exact match of canonical strings (indexer and API both `to_checksum(None)`) | Per-chain canonical address forms; no code difference. |
| 6 | Minter target key | `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` → `minter_addresses` (shared with the cash book, analytics and attention counts) | `CHAIN_<id>_EVM_API_MINTER_ADDRESS` → `evm_minter_addresses` (pending operations only) | The Minter readers behind `minter_addresses` are Stellar-shaped; EVM has no cash book. |
| 7 | SecurityRegistry target key | `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` | `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` from #1940, same `security_registry_addresses` map | Per-chain key prefix; one key per address. |
| 8 | Inspectors | `set_inspectors` on the SecurityRegistry: a configured target, but it has no loan, so not served | `setInspectors` on the RecordNft: not a target, not served; no RecordNft API key | On EVM `setInspectors` lives on a separate contract. |
| 9 | Expired then canceled | The schedule entry lapses about one day after expiry; after that it can no longer be canceled | `cancel` works on an expired schedule at any time; the cancel closes the row and it leaves the response | OpenZeppelin `cancel` checks only `timepoint != 0`. |
| 10 | Supersede rule | `(schedule_ledger, source_log_id)`, because the nonce can restart at 1 | Same SQL; `schedule_ledger` is the block number, and the order coincides with the nonce order because the nonce never resets | Persistent OpenZeppelin nonce; the chain-neutral rule stays. |
| 11 | `operation_id` as a contract argument | 64 hex, passed as `BytesN<32>` | Same stored form; an EVM `bytes32` is `0x` + the 64 hex | Same storage convention (#1939); a doc note only. |
| 12 | Live data | Stage chain 99000001 has Risk Council schedules | None on Hoodi until #1944 gives the Risk Council roles a delay | All Hoodi role delays are 0. |

## Assumptions and Risks

- **No live EVM data** until #1944. Verification uses pure tests and QA #1945 after #1944 and the merge-order step 3
  config.
- **#1940 in parallel.** Both touch `config.rs` (#1940 edits `load_security_registry_address`; #1941 adds
  `load_evm_minter_address`), `loan_book.rs` (#1940 `security_by_loan`; #1941 `pending_ops_by_loan`), the spec and
  `backend.md`.
  - Expect trivial rebase conflicts.
  - #1941 adds an `AppState` field. If #1940 also adds one (for example an EVM RecordNft map), the 15 test
    `AppState` literals conflict mechanically.
  - If #1940 ends up with a different key name or map for the EVM SecurityRegistry, #1941 changes only the map it
    reads in `chain_scope` (Step 3).
- **DTO type change for TS consumers.** `args_xdr` changes from `string` to `string | null` in the OpenAPI document.
  Stellar rows always carry it, so nothing changes at runtime for the Trustee. The Trustee type
  (`packages/trustee/src/api/pendingOperations.ts`) gains `calldata` and the nullable `args_xdr` in #1942 / #1943.
- **Function-name mapping lives in the frontend** (Decision 2). If #1942 / #1943 prefer a server-side mapping, that
  is an additive field later (Open Question 2).
- **Config drift.** The pending-operation Minter target is not configured unless `CHAIN_<id>_EVM_API_MINTER_ADDRESS`
  is set: `reverseRepay` operations are then not served on EVM. Stellar has the same behaviour without its key. The
  spec and `.env.example` say the API key must equal the indexer key.
- **Record id cast.** The record lookup casts `params->>'record_id'` to `bigint`. EVM ids are `uint256`, but the
  registry counters are sequential (#1938 keeps `u32` plumbing), so this never overflows in practice. The Stellar
  statement has the same cast.
- **Error policy, performance and freshness** are as in #1922. There is one extra statement per EVM chain with a
  target on `/v1/loan-book`. The table is tiny. The lag is one `access-manager-sync` interval (15 s) after the EVM
  indexer passes the block.
- **Unrelated local changes.** The main checkout carries uncommitted #1786 Phase 2 work in `loan_book.rs`. This
  worktree is based on `main` `99b36f41`, and the coder must not pull those changes in.

## Decisions (human, 2026-11-18)

1. **EVM Minter key: shared map, as on Stellar.** This overrides the plan's recommended separate map. `CHAIN_<id>_EVM_API_MINTER_ADDRESS` goes into the existing `minter_addresses`; there is no new `evm_minter_addresses` field. Every existing reader of `minter_addresses` whose logic is Stellar-shaped gets an explicit Stellar-only gate (`ChainKind::Stellar`), so EVM behaviour there is unchanged:
   - the cash book;
   - the analytics Minter series;
   - the attention-count Minter reads, including the ramp count;
   - any other reader found by `grep minter_addresses`.

   Each gate gets a test proving that an EVM chain with the Minter key set behaves exactly as before. Implementation steps, tests and docs follow this decision, not the separate-map text below.
2. **`function` naming:** served as stored, per chain. The Trustee maps names using the spec's name table. No chain-neutral `action` field.

## Open Questions

_None_ (resolved 2026-11-18, see Decisions).

## Implementation Steps

### 1. Shared repo: `packages/shared/src/access_manager_repo.rs`

- `PendingOpRow`: change `args_xdr: String` to `args_xdr: Option<String>`, and add `calldata: Option<String>` right
  after it.
- `LIST_PENDING_LOAN_OPS_SQL`:
  - The select list becomes `r.loan_id, o.operation_id, o.nonce, o.caller, o.target, o.function, o.args_xdr,
    o.calldata, o.args_json, o.ready_at, o.expires_at`.
  - Replace `AND o.args_xdr IS NOT NULL` with `AND (o.args_xdr IS NOT NULL OR o.calldata IS NOT NULL)`.
  - Everything else stays byte-for-byte: the `COALESCE` lateral, `o.target = ANY($2)`,
    `o.args_json IS NOT NULL`, the supersede `NOT EXISTS`, and the `ORDER BY`.
- `list_pending_loan_ops`: no change (binds and early return stay).

### 2. DTO and mapping: `packages/api/src/pending_operations.rs`

- `PendingOperation`:
  - `args_xdr: Option<String>` with `#[schema(required = true, nullable)]` (precedent: `routes/lps.rs`
    `SettlementBankAccountDetails`).
  - New `calldata: Option<String>` right after it, with the same attribute. No `skip_serializing_if`: both keys are
    always present.
- `pending_operation`:
  - Return `None` unless exactly one of `row.args_xdr` / `row.calldata` is `Some` (Decision 6).
  - Copy both verbatim. The rest is unchanged.
- New pure helper. The coder may rename it; the tests pin its behaviour:

  ```rust
  pub fn chain_scope<'a, S: BuildHasher>(
      chain_id: i64,
      kind: ChainKind,
      loan_registry: &'a HashMap<i64, String, S>,
      stellar_minter: &'a HashMap<i64, String, S>,
      evm_minter: &'a HashMap<i64, String, S>,
      security_registry: &'a HashMap<i64, String, S>,
  ) -> TargetScope<'a>
  ```

  - `loan_registry` and `security_registry` are looked up by `chain_id`.
  - `minter` comes from `stellar_minter` for `ChainKind::Stellar`, and from `evm_minter` for `ChainKind::Evm`.
- `TargetScope`, `targets`, `kind`, `pending_state`, `group_by_loan` and `pending_for_loan`: unchanged.
- The header `// spec: docs/product-specs/loan-security-state.md#pending-operations` stays. No other comments.

### 3. Loan book: `packages/api/src/routes/loan_book.rs`

- `pending_ops_by_loan`:
  - Replace `if chain_kind(state, chain_id) != Some(ChainKind::Stellar) { continue; }` with `let Some(kind) =
    chain_kind(state, chain_id) else { continue; };`.
  - Build the scope with `chain_scope(chain_id, kind, &state.loan_registry_addresses, &state.minter_addresses,
    &state.evm_minter_addresses, &state.security_registry_addresses)`.
  - The rest is unchanged: `targets()` empty → `continue`, then `list_pending_loan_ops(chain_id, &targets,
    scope.security_registry, None)` and `group_by_loan`.
- `attach_pending_operations` and `handle_loan_book`: unchanged.
- The `LoanBookDoc` components are unchanged; the `PendingOperation` schema itself gains `calldata`.

### 4. Loan security: `packages/api/src/routes/loan_security.rs`

- No logic change. The handler already builds `TargetScope { security_registry: Some(contract), .. }` from
  `security_registry_addresses`, which serves EVM as soon as #1940 configures it.
- Do not touch `resolve_security_registry` or the tag description (#1940's scope).

### 5. Config: `packages/api/src/config.rs`, `packages/api/src/lib.rs`, `packages/api/src/main.rs`

- New `fn load_evm_minter_address(chain_id, kind, out) -> Result<()>`:
  - It returns early unless `kind == ChainKind::Evm`.
  - Key `CHAIN_{chain_id}_EVM_API_MINTER_ADDRESS`, loaded through `load_optional_contract(chain_id, kind, &key,
    "EVM Minter (pending operations)", out)`. Blank means unset, an invalid value is an error naming the key, and the
    value is normalized to EIP-55.
  - Call it in the per-chain loop next to `load_minter_cash_book`.
- `ChainsConfig.evm_minter_addresses: HashMap<i64, String>`, initialized, filled and returned like the other maps.
- Add the key to the env-key list in the existing `ChainsConfig` doc block (the `# Minter cash book` lines), as one
  line: `CHAIN_<id>_EVM_API_MINTER_ADDRESS=0x... # optional; must equal the indexer's minter; pending_operations
  scope only`.
- `AppState.evm_minter_addresses: HashMap<i64, String>` (`lib.rs`), placed after `minter_addresses`. Wire it in
  `main.rs`.
- Add `evm_minter_addresses: HashMap::new(),` to every test `AppState` literal (15 files under `packages/api/tests/`,
  found by `grep -l "security_registry_addresses:" packages/api/tests`).

### 6. Tests (see Test Strategy)

### 7. Docs and env (see Docs to Update)

### 8. Checks

- `cargo fmt --all --check` and `cargo clippy --all -- -D warnings`.
- `cargo test -p pipeline-api -p shared`.
- `scripts/check-chain-env-names.sh` and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

The tests are pure: no database and no `DATABASE_URL` / `POSTGRES_URL` or any env var to reach Postgres. There is no
inline `#[cfg(test)]`. Each file keeps its one-line spec header and has no other comments. The layout is #1922's.

`packages/api/tests/pending_operations.rs` (extended):

- Fixtures:
  - The Stellar `op_row` sets `args_xdr: Some("AAAAAQ==")` and `calldata: None`.
  - A new `evm_row(loan_id, id, nonce, ready_at, target)`:
    - `caller` / `target` are EIP-55 constants (the Hoodi LoanRegistry `0xdF08fdf0f47272a8Ced33A5f913f6C9D179B0231`,
      Minter `0x621BaAb0ced6b11f88019582183b081A118755f4` and SecurityRegistry
      `0xB51E7f13420D106946376A67Fe5921C63B09BE15`);
    - `function: "setDefault"`, `args_xdr: None`, `calldata: Some("0xe0da6b66" + 64 hex of 7)` and
      `args_json: ["7"]`.
- Mapping:
  - An EVM row keeps `calldata` byte-identical, serves `args_xdr: null`, keeps `function` camelCase and `args`
    verbatim. Its `ready_at` / `expires_at` are ISO and its `state` follows the same boundaries.
  - A Stellar row serves `calldata: null` and `args_xdr` unchanged.
  - A row with neither field, or with both, maps to `None`.
- JSON shape: exactly the 12 spec keys (the 11 of #1922 plus `calldata`). Both `args_xdr` and `calldata` are present
  on each chain, with one of them `null`.
- `TargetScope` with EIP-55 addresses:
  - each configured address maps to its kind;
  - the RecordNft address `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09` gives `other`;
  - the lowercase spelling of a configured address gives `other`. This pins exact canonical comparison; the
    normalization happens in config and in the indexer.
- `chain_scope`:
  - An EVM chain with the LoanRegistry, the EVM Minter and the SecurityRegistry gives all three, in `targets()` order.
  - An EVM chain reads its Minter from `evm_minter` and never from `stellar_minter`, even when the same id is present
    there. A Stellar chain reads it from `stellar_minter` and never from `evm_minter`.
  - An unset Minter or SecurityRegistry gives `None`, and an unknown chain id gives an empty `targets()`.
- `group_by_loan` and `attach_pending_operations` with an EVM chain:
  - EVM rows group under `(EVM, "7")`.
  - The same loan id on the Stellar and EVM chains gets its own list.
  - An EVM entry with no operation serializes `"pending_operations": []`.
- OpenAPI (`LoanBookDoc`, `LoanSecurityDoc`): the `PendingOperation` schema lists `args_xdr` and `calldata` in
  `required`, and both are nullable. Accept `type: ["string","null"]` or `nullable: true`, as `loan_book_security.rs`
  and `lps.rs` do. The existing array and enum assertions stay.

`packages/shared/tests/access_manager_pending_sql.rs` (extended; header unchanged):

- The filter assertions replace `"o.args_xdr IS NOT NULL"` with
  `"(o.args_xdr IS NOT NULL OR o.calldata IS NOT NULL)"`, and keep `"o.args_json IS NOT NULL"`.
- New: the select list contains `o.args_xdr, o.calldata, o.args_json`.
- New: there is no `AND o.args_xdr IS NOT NULL AND` left, so the Stellar-only filter is gone.
- The record fallback, supersede (`(schedule_ledger, source_log_id)`, no `n.nonce >`), status and `ORDER BY`
  assertions stay unchanged. They now cover both chains.

`packages/api/tests/chains_config.rs` (extended; uses the existing `with_env` / `ENV_LOCK` pattern, with no database):

- On an EVM chain, a lowercase or padded `CHAIN_<id>_EVM_API_MINTER_ADDRESS` is stored EIP-55 in
  `evm_minter_addresses`, and `minter_addresses` stays empty (the cash book stays off).
- An unset or whitespace-only key gives no entry.
- An invalid value is an error that names the key.
- The key on a Stellar chain is rejected by the existing stray-key check (`validate_chain_kind_keys`).
- The Stellar Minter tests are unchanged.

Existing suites (`loan_book_security.rs`, `loan_security.rs`, `loan_book.rs` and the others that build `AppState`)
compile with the new field and pass unchanged.

Manual check, after #1944, the merge-order step 3 config and #1940 (QA #1945):

- `GET /v1/loan-book?chain_id=<hoodi>` shows a scheduled `setDefault` / `reverseRepay` with `calldata` and
  `args_xdr: null`.
- `GET /v1/loan-book/<id>/security?chain_id=<hoodi>` shows a scheduled `setTerms`.

## Docs to Update

- `docs/product-specs/loan-security-state.md`:
  - `## Pending operations`:
    - Intro: "the Stellar or EVM AccessManager (#1922, #1941)".
    - DTO table:
      - `args_xdr` is a `string` or `null` (Stellar, base64, verbatim).
      - New row: `calldata` is a `string` or `null` (EVM, `0x` lowercase hex with the selector, verbatim; the
        `data` of `execute(target, data)` / `cancel(caller, target, data)`). Exactly one of the two is non-null.
      - `caller` / `target`: a Strkey on Stellar, EIP-55 on EVM.
      - `function`: the contract's native name.
      - `args`: the chain's native display shape, linking `access-manager-events.md#evm-args-and-operation-id`.
      - `operation_id`: on EVM the `bytes32` is `0x` + the 64 hex.
    - New sub-heading "Function names per chain": a table of the 10 loan-scoped operations, with the owner contract,
      the Stellar name and the EVM name. For example `set_default` / `setDefault`, `reverse_repay` /
      `reverseRepay`, `release_with_consent` / `releaseWithConsent`. State that the API serves names verbatim and
      consumers map them per chain.
    - Selection:
      - Rows are served for configured targets on both chains, compared as canonical Strkey or EIP-55 strings.
      - Rows without native args (`args_xdr` or `calldata`) or without `args_json` are not served. Stellar: the
        transaction was out of retention. EVM: the operation id did not verify, the selector is unknown, or the
        args are undecodable.
      - On EVM, an expired schedule can still be canceled, which removes it.
    - Empty array:
      - Remove "EVM chains".
      - Add "EVM chains until the Risk Council roles have a delay (#1944)".
      - Add the EVM keys: the Minter `CHAIN_<id>_EVM_API_MINTER_ADDRESS`, and the SecurityRegistry
        `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` from #1940.
      - `set_inspectors` / `setInspectors` (RecordNft) is out of scope.
  - API Contract JSON example: add `"calldata": null` after `"args_xdr"`.
  - Loan book fields: the `pending_operations` paragraph covers both chains (Minter `reverse_repay` / `reverseRepay`).
- `docs/references/access-manager-events.md`:
  - `## API read`: one statement per chain with a configured target, Stellar and EVM. Change the filter to
    "`args_xdr` or `calldata` set, and `args_json` set". Note that EIP-55 strings are compared exactly.
  - `### EVM cursor and rollout`: replace "The API does not serve EVM rows until #1941 …" with "The API serves them
    (#1941); see [API read](#api-read)".
  - `### Differences from Stellar`: add rows for the API read: the args filter, the Minter key, and the
    expired-cancel behaviour.
- `docs/references/backend.md`:
  - Line ~441: "`pending_operations` (#1922, EVM #1941) … `args_xdr` on Stellar, `calldata` on EVM".
  - "EVM AccessManager indexing": append "The API serves the pending, loan-scoped rows inline … (#1941)".
  - Add one sentence on `CHAIN_<id>_EVM_API_MINTER_ADDRESS` (optional, must equal the indexer key, pending-operations
    scope only, does not enable the cash book).
- `.env.example`, in the EVM API block after `CHAIN_1_EVM_API_PLUSD_ADDRESS`:

  ```
  # CHAIN_1_EVM_API_MINTER_ADDRESS=0xabc...  # optional — Minter (Hoodi v5 0x621BaAb0ced6b11f88019582183b081A118755f4); must equal CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS; scopes reverseRepay in pending_operations on GET /v1/loan-book (#1941); does not enable the cash book
  ```
- `docs/user-stories/epic-1937/1941-evm-pending-operations-api.md` (new; same format as
  `epic-1920/1922-pending-operations-api.md`). Persona: API consumer. Stories 2 to 5 are marked as needing #1944 on
  Hoodi.
  1. The EVM loan book rows carry LoanRegistry and Minter operations, with `calldata` and `args_xdr: null`.
  2. The EVM `/security` lists `setTerms` / `resolveFlag` / `releaseWithConsent`. This needs #1940's key.
  3. `waiting` → `ready` → `expired`.
  4. An executed (via `AccessManager.execute` or a direct target call) or canceled operation disappears, including
     an expired one that is canceled.
  5. A `resolveFlag` whose record was registered after the schedule is resolved at read time.
  6. The empty cases: indexer key unset, `CHAIN_<id>_EVM_API_MINTER_ADDRESS` unset, `setInspectors`.
  7. Stellar responses are unchanged apart from `"calldata": null`.
- `docs/user-stories/index.md`: add the #1941 row to the "Epic #1937 — EVM parity" table.
- `docs/exec-plans/tech-debt-tracker.md` and `known-bugs.md`: no change.
- Move this plan to `docs/exec-plans/completed/` when the PR merges (manager).
