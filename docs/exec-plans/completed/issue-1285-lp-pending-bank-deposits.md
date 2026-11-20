# Issue #1285: Backend: LP trust-account USD balance + bank withdraw

Source: https://github.com/eq-lab/pipeline/issues/1285

## Scope

### The premise is outdated (evidence)

The issue (2026-09-21) assumed an LP holds a standing USD balance at the trust account, tops it up by wire and withdraws from it. The current model does not work that way:

- **Wire-in has no parked USD.** Stellar `record_wire_in` (pipeline-stellar-contracts @ e9881ac, `contracts/minter/src/lib.rs:103-147`) books the cash, mints PLUSD and stakes it straight into the vault for an LP `receiver` (`WireInStatus::Direct`). Only `receiver == minter` escrows (`Escrowed`), and that escrow names no LP on-chain until `assign_wire_in` (`:152`) stakes it or `return_wire_in` (`:168`) burns it. The EVM `PipelineMinter.recordWireIn` branches the same way (`WireInRecorded`, `packages/worker/src/indexer/parsers.rs:52`). User docs agree: "You receive sPLUSD, not PLUSD" (`docs/user-docs/lenders/deposit.md` § Bank wire deposits).
- **Wire-out is a PLUSD action.** `request_wire_out(lp, amount)` (`:413`) escrows the LP's PLUSD. `settle_wire_out` burns it, `cancel_wire_out` returns it. The LP signs it in the frontend (#1757). The backend already serves the LP's wire-outs with status as `wire_outs` on `GET /v1/requests` (#1790, `packages/api/src/routes/analytics.rs:87`, `docs/product-specs/minter-cash-book.md` § API Contract). The issue's "bank-withdraw request path (amount → recorded)" is therefore superseded. **No backend work for Withdraw.**
- **Trust-account wire details** (comment 2) are served by `GET /v1/lps/me/payment-details` (#1815). Settled.
- **`GET /v1/lp-ledger` is not an LP balance.** Its `balance` is the sum of every `lp_ledger` delta (`packages/shared/src/lp_ledger_repo.rs`). The only writer is the Trustee deposit record, and nothing debits it when the wire is minted. It is lifetime committed USD, already held as sPLUSD. Showing it to the LP, or adding it to a PLUSD + sPLUSD total (#1313), would count every wire twice. It stays Trustee-only and is not the source here.

### What "LP USD on the trust account" means today

The only USD attributable to one LP that sits at the trust account and is not yet in the LP's on-chain position is a **pending bank deposit**. This is a wire the Trustee has recorded for the LP (`POST /v1/lps/{id}/bank-deposits`, `lp_bank_deposits.lp_id`), whose PLUSD has not reached the LP and which has not been returned:

- `is_minted = false`. The relayer's wire-in matching phase (#1416, run by the Stellar and the EVM relayer, `packages/worker/src/relayer/wire_in_match.rs`) sets it once a `WireIn` stakes the wire straight to a receiver (Rule A) or a `WireInAssigned` resolves its escrow (Rule B). An escrowed wire recorded for this LP therefore stays pending until it is assigned. That is the only per-LP form "escrowed-but-unassigned" can take, because on-chain the escrow carries no LP.
- **Not returned.** `WireInReturned` is indexed on both chains (#1480; `minter_parsers.rs:51`, `parsers.rs:489`). `lp_bank_deposits` has no terminal state (TD-116), so the read excludes a deposit whose `WireIn` (matched by `ref_hash`) has a `WireInReturned` with the same `(chain_id, contract_address, id)`.

The window is usually short: the Trustee mints right after recording. It is long when the mint is blocked, for example no authorized PLUSD trustline, a budget limit, or EVM before #1501 lands. Per chain it is the same rule, because deposits carry no chain (TD-117 / TD-164). On EVM the matching phase runs when `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS` is set. Until #1501 ships the EVM mint, an EVM-bound deposit stays pending, which is accurate.

Not included: wires that arrived but the Trustee has not recorded (unknown to the system); escrowed wire-ins with no deposit row (no LP); pending wire-outs (PLUSD in escrow, already served on `/v1/requests`, Stellar only, see Open Questions).

### What changes

1. A new read `LpBankDepositRepo::pending_total_for_lp(lp_id)` over a `pub const PENDING_TOTAL_FOR_LP_SQL`.
2. `LpResponse` (every single-LP read: `GET /v1/lps/me`, `POST /v1/lps/me`, document upload/delete, submit, settlement-address verify, and the Trustee `GET /v1/lps/{id}` / review / verdict responses) gains one required field, inline, with no new route:

```json
"pending_bank_deposits": "1500.00"
```

It is a plain dollar string with exactly 2 decimals (matches `lp_bank_deposits.amount NUMERIC(20,2)`), and `"0.00"` when nothing is pending. `LpSummary` (`GET /v1/lps` listing) is unchanged.

3. Specs and frontend docs are re-pointed: the funded card's balance seam reads this field, and its Withdraw seam belongs to #1757. The issue should be **rescoped** (manager edits the body): title "Backend: serve the LP's pending bank deposits inline on `GET /v1/lps/me`". The withdraw half and the wire-details half are marked superseded by #1757 + #1790 and #1815.

### Conclusion for #1313 (composite Total Balance)

The "USD trust" component is `pending_bank_deposits`, never `lp_ledger.balance`. Over time, a deposit counts from its `occurred_at` (or `created_at`; #1313 decides) until the `block_timestamp` of its matching `WireIn` (direct), `WireInAssigned` (escrow) or `WireInReturned`. After that, the value is in sPLUSD, or gone. Whether pending wire-outs (PLUSD escrowed for a bank withdrawal, which leaves the wallet balance until it is settled or cancelled) belong in the composite is a product choice for #1313, listed below.

### Out of scope

- Any withdraw endpoint (the LP signs `request_wire_out`, #1757). EVM `wire_outs` on `/v1/requests` (TD-169).
- The LP-visible list of bank deposits / merged activity feed rows "Add funds — Bank transfer" (#1314).
- A terminal "returned off-chain" state on `lp_bank_deposits` or a Trustee write for it (TD-116).
- Frontend wiring of the funded card (#1820) and state 5 (#1425).
- Contract changes (frozen).

## Assumptions and Risks

- **Deposit returned without ever being minted.** If the Trustee sends a recorded wire back off-chain without calling `record_wire_in`, nothing on-chain or in the DB records it, and it stays pending indefinitely. Mitigation: documented and appended to TD-116. A Trustee "mark returned" write is a follow-up if product wants it (Open Questions).
- **Rule A mints to the capital wallet.** When the LP had no linked address at mint time, the Trustee mints `Direct` to the capital wallet, Rule A marks the deposit minted, and the pending figure drops to zero with no LP position. This already exists, and the payment-details gate makes it rare (the LP must have a linked address to be issued a reference). Note it in `deposits.md` and do not fix it here.
- **Unscoped ref_hash join.** The returned-check joins `contract_logs` on `ref_hash` across chains and minter deployments, because deposits have no chain (TD-117). A `ref_hash` is `sha256` of a globally unique `payment_reference`, so a cross-deployment collision means the same wire. The join uses `encode(d.ref_hash, 'hex') = w.params->>'ref_hash'`, not `decode(params…)`, so a malformed indexed hex cannot fail the whole LP read. Both parsers write bare lowercase hex.
- **Extra query on every single-LP read.** It runs one indexed aggregate (`idx_lp_bank_deposits_lp_id_occurred_at`) plus a bounded `NOT EXISTS` over `contract_logs` filtered by `event_name` (indexed). The cost is acceptable. Wire-in event volume is small.
- **Field added to the Trustee read too.** `GET /v1/lps/{id}` returns the same DTO, which is harmless and useful before a mint. Adding a required field is additive for both frontends (TS clients ignore unknown keys).
- **Not a "balance".** The card copy "USD Balance … on Trust account" overstates a transient in-transit amount. The copy is a product decision (Open Questions). The backend name says what it is.
- Depends on nothing unmerged. #1501 (EVM mint) only changes how fast EVM deposits leave the pending state.

## Open Questions

_None_

### Resolved questions (human, 2026-11-09)

1. **#1820 card:** show it only while `pending_bank_deposits > 0`, with copy like "Bank deposit being processed" — never "USD Balance". The manager comments this on #1820.
2. **Pending wire-outs:** not in this field; #1313 owns them (`wire_out_escrow`).
3. **Withdraw:** opens the #1757 wire-out flow.
4. **Deposit returned off-chain without a mint:** accepted — it stays pending; log it in the tech-debt tracker (a Trustee "mark returned" write is a later follow-up).
5. **Rescope:** the issue is retitled to serving the LP's pending bank deposits inline on `GET /v1/lps/me`; the withdraw half is done by #1757 + #1790 and the wire-details half by #1815.

## Implementation Steps

1. **Repo read** in `packages/shared/src/lp_bank_deposit_repo.rs`:
   - Add `pub const PENDING_TOTAL_FOR_LP_SQL: &str` with these clauses:
     - `SELECT COALESCE(SUM(d.amount), 0) FROM lp_bank_deposits d WHERE d.lp_id = $1 AND NOT d.is_minted`
     - `AND NOT EXISTS (SELECT 1 FROM contract_logs w JOIN contract_logs r ON r.chain_id = w.chain_id AND r.contract_address = w.contract_address AND r.event_name = 'WireInReturned' AND r.params->>'id' = w.params->>'id' WHERE w.event_name = 'WireIn' AND w.params->>'ref_hash' = encode(d.ref_hash, 'hex'))`
   - Add `pub async fn pending_total_for_lp(&self, lp_id: i64) -> Result<BigDecimal, sqlx::Error>` (`query_scalar`, `fetch_one`) on `LpBankDepositRepo` (inherent impl, not the `WireInMatcher` trait).
   - No comments in new code beyond the existing file header.
2. **Pure formatter** in `packages/api/src/routes/lp_bank_deposits.rs`: add `pub fn pending_bank_deposits_display(total: &BigDecimal) -> String` returning `total.with_scale(2).to_plain_string()`. The SQL `COALESCE(…, 0)` yields scale 0 on an empty set, so this pins `"0.00"`. Amounts are already 2 dp, so `with_scale` never truncates real data.
3. **DTO** in `packages/api/src/routes/lps.rs`:
   - Add `pub pending_bank_deposits: String` to `LpResponse`, after `kyb_decision_reason`. Put the schema text in `#[schema(example = "1500.00")]` only. If utoipa needs a description, keep it to one line: "Plain dollar string, 2 dp; Trustee-recorded wires for this LP not yet minted or returned".
   - Change `LpResponse::new(row, documents)` to `LpResponse::new(row, documents, pending_bank_deposits: String)`.
   - In `with_documents_rows`, call `state.lp_bank_deposit_repo.pending_total_for_lp(lp.id).await?` and pass `pending_bank_deposits_display(&total)`. Every single-LP response then carries it. `LpSummary` stays untouched.
   - A DB error fails the read (`ApiError::from`), the same as the documents read.
4. **Clippy / build**: `cargo clippy --all -- -D warnings`. Check that nothing else constructs `LpResponse` (only `with_documents_rows` does today; grep `LpResponse {` / `LpResponse::new`).
5. **Docs** (see Docs to Update), then `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts`.

## Test Strategy

These are pure unit tests only. No DB and no env-var connection. Tests live in `tests/` files.

- `packages/shared/tests/lp_bank_deposit_repo_sql.rs` (new), needle tests on `PENDING_TOTAL_FOR_LP_SQL`:
  - contains `d.lp_id = $1`, `NOT d.is_minted` and `COALESCE(SUM(d.amount), 0)`;
  - contains `'WireInReturned'`, `'WireIn'`, and the id join `r.params->>'id' = w.params->>'id'`, plus the chain/contract pairing `r.chain_id = w.chain_id` and `r.contract_address = w.contract_address`;
  - matches on `encode(d.ref_hash, 'hex')` and does **not** contain `decode(` (a malformed indexed hex must not fail the read);
  - does not reference `lp_ledger` (the double-counting source);
  - has exactly one `$1` placeholder and no `$2`, so the read stays unscoped by chain (TD-117).
- `packages/api/tests/lp_bank_deposits.rs`, `pending_bank_deposits_display`:
  - `0` → `"0.00"`
  - `0.00` → `"0.00"`
  - `1500` → `"1500.00"`
  - `1500.5` → `"1500.50"`
  - `999999999999999999.99` → unchanged
  - no exponent notation for large values
- `packages/api/tests/lps.rs`, OpenAPI:
  - `LpResponse.properties.pending_bank_deposits` exists, is type `string`, and is in `required`;
  - `LpSummary` has no `pending_bank_deposits`.
- Run `cargo test -p shared -p pipeline-api` and `cargo clippy --all -- -D warnings`.

## Docs to Update

- `docs/product-specs/deposits.md`: new section **"LP Pending Bank Deposits"** after "LP Funding Details". Cover:
  - the field and shape on `GET /v1/lps/me` (and the Trustee single-LP reads);
  - the definition (recorded, `is_minted = false`, no `WireInReturned` for the matching `WireIn`) and why escrow is covered;
  - chain-agnostic behavior (TD-117), and EVM before #1501;
  - the two known gaps (off-chain return, capital-wallet Rule A);
  - that `GET /v1/lp-ledger` `balance` is lifetime committed and is not an LP balance.
  - Update `docs/product-specs/index.md`'s deposits row to mention it.
- `docs/product-specs/home-screen-states.md`: one sentence beside the "Bank transfer unlocked … not a served flag" line saying `GET /v1/lps/me` serves `pending_bank_deposits` (#1285). Which card uses it is #1820's to specify.
- `docs/frontend/bank-transfers.md`:
  - re-point the "#1285" owners: the `AddUsdCard.usdBalanceLabel` seam → `pending_bank_deposits` on `GET /v1/lps/me` (wiring #1820); `AddUsdCard.onWithdraw` → #1757 (wire-out); the Out-of-scope row;
  - fix the "A real trust-account USD balance and the Withdraw flow … are #1285's" sentence.
- `docs/product-specs/withdrawals.md`: no change. Bank wire-outs are #1757's section.
- `docs/exec-plans/tech-debt-tracker.md`: append an update line to **TD-116**. The LP pending read excludes returned wires at read time. A deposit returned off-chain with no on-chain mint still reads as pending.
- `docs/references/backend.md` § Phase 5: one line saying the LP pending read is the first consumer of `is_minted`, with a link to `deposits.md`.
