# Issue #555: [BE] Vouchers API: support Stellar/Soroban ed25519 signing alongside EVM

Source: https://github.com/eq-lab/pipeline/issues/555

## Scope

Extend the existing voucher endpoints `GET /v1/deposits/{request_id}/voucher` and `GET /v1/withdrawals/{request_id}/voucher` (`packages/api/src/routes/vouchers.rs`) so they dispatch by `chain_id` and return either:

- an EIP-712 `secp256k1` signature for EVM chains (existing behaviour, unchanged), or
- a Soroban-compatible ed25519 signature for Stellar chains (new), reproducing the on-chain digest used by `request-queue::verify_request` (`pipeline-stellar-contracts/contracts/request-queue/src/crypto.rs`):
  - `domain_separator = sha256( XDR(Domain { contract_separator: <contract_addr>, network_id: <ledger.network_id> }) )`
  - `voucher_hash    = sha256( XDR(Voucher { request_id: u128, sender: Address, amount: i128 }) )`
  - `digest          = sha256( domain_separator || voucher_hash )`
  - signature: 64-byte ed25519 over `digest` by the operator verifier key.

This deliberately reuses the EVM voucher route, query-parameter shape, and response JSON. The only new public surface is the secret env var `STELLAR_VERIFIER_SECRET` (Strkey `S…` seed) plus per-chain Stellar voucher-config env vars (passphrase, contract addresses).

### In scope

- New `shared::stellar_voucher` module that mirrors `shared::eip712::sign_verified_request`: pure functions to build the `Domain`/`Voucher` XDR, hash, and sign with `ed25519-dalek`. Fully unit-testable.
- New `StellarVoucherChainConfig` resolved from env (`packages/api/src/config.rs`), keyed off the same `chain_id: i64` used for EVM. `AppState` (`packages/api/src/lib.rs`) gains `stellar_voucher_signers: HashMap<i64, StellarVoucherSigner>` populated alongside `voucher_signers`.
- Route refactor in `packages/api/src/routes/vouchers.rs`: replace the unconditional `to_lowercase()` and `Address: alloy::primitives::Address` parse with chain-kind dispatch; for Stellar reuse `kyc_repo.get_deposit_request/get_withdrawal_request` and `is_request_claimed` against the Stellar `chain_id`; signature is hex-encoded 64-byte ed25519 (no leading `0x`-prefix change vs EVM).
- Wallet normalisation helper: EVM lowercases (today's behaviour); Stellar passes through unchanged (Strkey `G…` is case-sensitive and carries a CRC-16 checksum).
- `kyc_repo` lookup helpers updated so the `params->>'user' / 'withdrawer'` comparison is case-sensitive for Stellar rows (the indexer in #528 stores Strkey verbatim — see `packages/worker/src/indexer/stellar/parsers.rs` and the indexer plan's Q4 resolution). The existing `LOWER(...)` on the JSON value must be skipped for Stellar chains.
- Updated `.env.example` with the new Stellar voucher block.

### Out of scope (explicit)

- Crystal KYT for Stellar addresses — fall through the existing `crystal_enabled` gate. Crystal does not return a `crystal_kyt_status` for Stellar today; behaviour is "screened-as-clean" via the indexer's untouched `crystal_kyt_status` column. A dedicated Issue can revisit this.
- Production key management (KMS/BitGo). `STELLAR_VERIFIER_SECRET` (Strkey `S…` seed) is the only provisioning path for this iteration. Note as a follow-up.
- Indexing changes — already shipped in #528.
- Frontend changes — Issue #550/#551 owns dropping the `VITE_STELLAR_VERIFIER_SECRET` dev fallback after this lands.
- A second EVM EIP-712 vs Stellar `scheme` discriminator in the response JSON — keep `VoucherResponse` shape stable; the caller already knows the chain it asked for (see Open Questions for reconsideration).

## Assumptions and Risks

- **Stellar `chain_id` representation is the existing 99M-range sentinel.** Per `docs/exec-plans/active/issue-528-stellar-soroban-indexer.md` (Q3) and `.env.example` lines 86–109, Stellar testnet is `99000001` and mainnet is reserved as `99000002`. The voucher endpoint will reuse this — no new column or DDL. **Risk:** the deployed env must already be on the post-#528 multi-chain layout (`CHAINS=...,99000001`, `CHAIN_99000001_TYPE=stellar`). On a stage/prod box that has not yet rolled out #528, adding the voucher block is a no-op until the chain is enabled in `CHAINS`.
- **XDR encoding parity is load-bearing.** The on-chain digest is computed by `Domain::to_xdr(e)` / `Voucher::to_xdr(e)`, where `to_xdr` is the `soroban-sdk` impl on `#[contracttype]` structs. We cannot pull `soroban-sdk` into `shared/` (it targets wasm32-unknown-unknown and is build-time hostile on the API server). We will reproduce the equivalent XDR via the `stellar-xdr` crate (already a workspace dep, v25). The encoding `to_xdr` produces is `ScVal::Map(sorted-by-key map of field-name → ScVal-of-value)` wrapped in a `WriteXdr` round-trip; verifying parity against a known on-chain digest is a hard requirement of the test plan. **Risk:** if our `stellar-xdr`-based reproduction diverges from `soroban-sdk`'s `to_xdr` by even one byte the signature will fail `ed25519_verify` on-chain. **Mitigation:** record one known-good `digest(...)` view-call output from the deployed testnet `request-queue` against a fixed `(request_id, user, amount)` triple and use it as a golden fixture; if the byte-for-byte reproduction proves brittle, fall back to invoking the `digest(...)` view over Soroban RPC and signing that (extra RPC hop, but always correct). Both options are budgeted in Implementation Steps §3.
- **`kyc_repo` lookups currently lowercase the wallet in SQL.** `get_deposit_request` uses `LOWER(params->>'user') = $3` (line 650 of `packages/shared/src/kyc_repo.rs`); Stellar rows are stored uppercase by the indexer (`stellar/parsers.rs::sc_address_to_strkey`). The route hands the bound parameter lowercased today. **Risk:** Stellar lookups would silently return zero rows. **Mitigation:** add chain-kind-aware variants (or a `chain_kind` enum parameter) so the SQL comparison drops `LOWER` for Stellar and the bound parameter is passed verbatim. `is_on_chain_allowed` and `is_request_claimed` also need the same audit.
- **`u128` request_id round-trip vs `U256`.** EVM `RequestInfo.request_id` is a `BigDecimal` parsed into `U256`; Soroban `request_id: u128` (`pipeline-stellar-contracts/contracts/request-queue/src/types.rs:14`) and the indexer writes it as a base-10 string (`stellar/parsers.rs:60`). We parse the string into `u128` for the Stellar XDR path. `BigDecimal → u128` will succeed as long as `request_id < 2^128`, which it always is for the Soroban schema. We must reject (HTTP 500 with a clear error) any value that overflows, mirroring the existing EVM `parse::<U256>()` failure path.
- **`network_id` is `sha256(passphrase)`.** Stellar's `ledger.network_id()` returns the SHA-256 of the network passphrase (`"Test SDF Network ; September 2015"` for testnet). The API config must compute this at startup from the passphrase env var; we already have the passphrase via `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE` in the indexer config and can reuse the same env var (Open Q1).
- **Strkey `G…` validation.** The wallet query param for Stellar must be validated as a 56-char Strkey starting with `G` (account ed25519 pubkey). We reuse `stellar-strkey::ed25519::PublicKey::from_string` (workspace dep) for that check; a malformed input returns HTTP 400 mirroring the existing `Address::parse` failure path.
- **The deployed verifier secret is operator-controlled.** The testnet on-chain verifier today is `GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM` per the Issue body. The plan does not introduce a key rotation path — that follows from any future `set_verifier` call on the Soroban contracts and an env update.
- **Dependency on #528.** The indexer plan ships `stellar-xdr` and `stellar-strkey` to `packages/worker`. For this issue both crates must be promoted/used from `shared/` (workspace deps already exist at the root `Cargo.toml`). No version bumps required.

## Resolved Decisions

The Issue body's open questions and the planner's surfaced design choices were resolved with the user before implementation:

1. **Per-chain config env vars.** **B** — introduce parallel API-specific vars `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID`, `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID`, `CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE`. The API is not coupled to the indexer's env var names; both are free to evolve independently. Document the rationale in `.env.example`.
2. **`STELLAR_VERIFIER_SECRET` cardinality.** Keep it **flat** — one chain-agnostic `STELLAR_VERIFIER_SECRET` env var as specified in the Issue body. A rename to per-chain naming is a tracked tech-debt item, not blocking this iteration.
3. **`debug_digest` field on `VoucherResponse`.** **Skip.** `VoucherResponse` shape stays exactly as today; the digest is derivable from the signed inputs anyway. FE can request the field later if it needs it.
4. **`is_on_chain_allowed` for Stellar.** **Same SQL as EVM** — no Stellar short-circuit. Stellar voucher requests will return HTTP 403 until an `lp_profiles` row exists for the Stellar wallet. Populating those rows is explicitly an ops/separate-Issue concern, not in scope here. The planner's recommended short-circuit is **rejected** for this Issue.

## Implementation Steps

### 1. Add ed25519 + Stellar crate access to `shared/`

- In `packages/shared/Cargo.toml`, add:
  - `ed25519-dalek = "2"` (matches the version used by the contracts repo at `contracts/request-queue/Cargo.toml:18`; check `cargo tree` to ensure the workspace doesn't already pull a conflicting version).
  - `stellar-xdr = { workspace = true }` (already in workspace at v25).
  - `stellar-strkey = { workspace = true }` (workspace at 0.0.16).
  - `rand_core = { version = "0.6", optional = true }` only if needed for tests; otherwise drop.
- Run `cargo build -p shared` to confirm the additions don't fan out into a problematic dep tree on the API target.

### 2. New module `packages/shared/src/stellar_voucher.rs`

Pure module, no DB, no async I/O. Public surface:

```rust
pub struct StellarVoucherSigner {
    signing_key: ed25519_dalek::SigningKey, // 32-byte seed
    pub verifier_pubkey: [u8; 32],          // for logging/diagnostics
}

pub struct StellarVoucherDomain {
    pub contract_id: stellar_strkey::Contract, // C… Strkey
    pub network_id: [u8; 32],                  // sha256(passphrase)
}

impl StellarVoucherDomain {
    pub fn from_passphrase(contract_id: stellar_strkey::Contract, passphrase: &str) -> Self;
}

/// Build the digest exactly as `request-queue::crypto::digest` does on-chain.
pub fn voucher_digest(
    domain: &StellarVoucherDomain,
    request_id: u128,
    sender: &stellar_strkey::ed25519::PublicKey, // 56-char G… account
    amount: i128,
) -> [u8; 32];

/// Sign the digest with ed25519; returns the 64-byte signature.
pub fn sign_voucher(
    signer: &StellarVoucherSigner,
    domain: &StellarVoucherDomain,
    request_id: u128,
    sender: &stellar_strkey::ed25519::PublicKey,
    amount: i128,
) -> [u8; 64];
```

Internally, `voucher_digest` reproduces the `to_xdr` output for the two `#[contracttype]` structs using `stellar-xdr` (`ScVal::Map` of sorted-by-field-name `(ScSymbol, ScVal)` entries, then `WriteXdr::to_xdr` with `Limits::none()`):

- **`Domain`**: `ScMap` of `{"contract_separator": ScVal::Address(ScAddress::Contract(...)), "network_id": ScVal::Bytes(network_id)}`. Sort the entries by key — `contract_separator` < `network_id` alphabetically.
- **`Voucher`**: `ScMap` of `{"amount": ScVal::I128(i128_parts), "request_id": ScVal::U128(u128_parts), "sender": ScVal::Address(ScAddress::Account(...))}`. Sort alphabetically: `amount` < `request_id` < `sender`.
- `sha256` via `sha2::Sha256` (already a `shared/` dep). Concatenate the two 32-byte hashes and SHA-256 once more.

**Reference for the encoding:** `stellar-xdr` exposes `ScVal::{U128, I128, Address, Map, Bytes, Symbol}` and `WriteXdr` for byte serialization. `pipeline/packages/worker/src/indexer/stellar/parsers.rs` already decodes the equivalent shapes (`ScVal::U128`, `ScVal::I128`, `ScVal::Address`, `ScVal::Map`) — invert that to encode.

### 3. Golden-fixture test against the on-chain `digest(...)` view

Before merging, the coder must:

1. Invoke the deployed testnet `request-queue::digest(request_id, user, amount)` view-call once via the Stellar CLI (`stellar contract invoke --id <deposit_manager_id> -- digest --request_id <N> --user <G…> --amount <M>`) for a fixed triple, e.g. `(request_id=1u128, user="GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM", amount=1_000_000_i128)`.
2. Record the returned 32-byte `BytesN<32>` digest as a hex string.
3. Add a unit test in `packages/shared/src/stellar_voucher.rs` that calls `voucher_digest(...)` with the same inputs (and the deployed DM contract id `CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO`, plus `network_id = sha256("Test SDF Network ; September 2015")`) and asserts byte-for-byte equality. This is the only safe way to guarantee XDR parity with `soroban-sdk::to_xdr`.

If byte-for-byte parity proves infeasible within the coding budget (i.e. `stellar-xdr` cannot reproduce the `soroban-sdk` `#[contracttype]` map layout), the planner-recommended fallback is to invoke the Soroban RPC `simulateTransaction` for the contract's `digest(...)` view to fetch the digest live before signing — one extra RPC call per voucher, but always correct. Note this fallback in the PR description if taken.

### 4. Wire the config + AppState

`packages/api/src/config.rs`:

- Add `StellarVoucherChainConfig { signer: StellarVoucherSigner, domain_dm: StellarVoucherDomain, domain_wq: StellarVoucherDomain }`.
- Extend `ChainsConfig` with `pub stellar_voucher: HashMap<i64, StellarVoucherChainConfig>`.
- In `ChainsConfig::from_env`, after the EVM loop, iterate the same `chains` again and, when `CHAIN_<id>_TYPE=stellar` (reusing the `parse_chain_type` helper from the worker — promote it to `shared::chains` so both crates share it), read (per **Resolved Decisions** §1–§2):
  - `STELLAR_VERIFIER_SECRET` (flat, chain-agnostic). Parse as `stellar_strkey::ed25519::PrivateKey`, extract the 32-byte seed, build `ed25519_dalek::SigningKey::from_bytes`.
  - `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID` and `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` — **parallel API-specific vars**, deliberately not reusing the indexer's `CHAIN_<id>_STELLAR_DEPOSIT_MANAGER_ID` / `WITHDRAWAL_QUEUE_ID`. Coder MUST document this rationale in `.env.example`.
  - `CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE` (with the testnet default for `chain_id == 99_000_001` to mirror the worker — see `packages/worker/src/indexer/config.rs:51`).
  - Compute the two `StellarVoucherDomain` values from `(contract_id, network_id)`.

`packages/api/src/lib.rs::AppState`:

- Add `pub stellar_voucher_signers: HashMap<i64, StellarVoucherChainConfig>`.

`packages/api/src/main.rs`:

- Decompose `chains_config.stellar_voucher` into the new `AppState` field in the same loop block as the EVM signers.

### 5. Promote `parse_chain_type` to `shared::chains`

Currently lives in `packages/worker/src/indexer/config.rs:17`. Move to `packages/shared/src/chains.rs` so the API can use it too. Keep the worker's `pub use shared::chains::parse_chain_type;` so the existing call sites are unchanged.

### 6. Chain-aware wallet normalisation + lookups

Add a small enum to `shared::chains`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainKind { Evm, Stellar }
```

with `pub fn from_env(chain_id: i64) -> Result<ChainKind>` that wraps `parse_chain_type` (collapses to the same two variants — there is no third). In `packages/api/src/routes/common.rs` cache the kind on `AppState` (or recompute per request via `parse_chain_type` — startup-only env lookup, negligible overhead).

`packages/shared/src/kyc_repo.rs`:

- Add `get_deposit_request_case_sensitive(chain_id, request_id, wallet) -> Option<RequestInfo>` (SQL: drop `LOWER(...)` around `params->>'user'`, bind wallet verbatim). Mirror for `get_withdrawal_request_case_sensitive` (drops `LOWER` around `params->>'withdrawer'`).
- Alternatively (cleaner): add a `chain_kind: ChainKind` parameter to both existing functions and branch the SQL string at the function level. Pick this if it doesn't ripple into many other callers — `grep -rn 'get_deposit_request\|get_withdrawal_request' packages/` first.
- `is_on_chain_allowed(chain_id, wallet)`: **Resolved to identical EVM behaviour** (Decision #4). The check runs unchanged for Stellar — the SQL `wallet_address = $2` comparison stays case-sensitive at the column level and the chain-aware wallet normaliser (above) feeds the verbatim Strkey for Stellar wallets. Consequence: Stellar voucher requests return HTTP 403 until an `lp_profiles` row exists for the wallet on the Stellar chain. Populating those rows is out of scope for this Issue. **No short-circuit, no warn-log shortcut.**

`packages/api/src/routes/vouchers.rs`:

- Replace `let wallet = query.wallet.to_lowercase()` with `let wallet = normalise_wallet(chain_kind, &query.wallet)` where the helper lowercases for EVM and returns the input verbatim for Stellar (with a 56-char Strkey-shape sanity check that returns 400 on failure).

### 7. Route dispatch in `vouchers.rs`

Refactor `deposit_voucher` and `withdrawal_voucher` to dispatch on `chain_kind`:

- **EVM branch:** keep existing code path (calls `shared::eip712::sign_verified_request`). No behaviour change.
- **Stellar branch:**
  1. Look up the request via the new case-sensitive `kyc_repo` helper (using the verbatim Stellar wallet).
  2. Apply Crystal-KYT skip + on-chain-allowed skip per §6 (no Crystal Stellar today, no Stellar whitelist).
  3. `is_request_claimed(chain_id, "RequestClaimed", &request_id, &dm_or_wq_contract_id)` — the contract id is the Stellar `C…` Strkey from the resolved `StellarVoucherDomain`. The kyc_repo query already does `LOWER(contract_address) = LOWER($4)` which works for both EVM (lowercased columns) and Stellar (uppercased columns); no change needed there.
  4. Parse `req.request_id` (`BigDecimal`) into `u128` via the string parse path (rejecting overflow with HTTP 500 — mirrors EVM `U256` parse). Parse `req.amount` into `i128` similarly. Parse `wallet` into `stellar_strkey::ed25519::PublicKey`.
  5. Call `shared::stellar_voucher::sign_voucher(&signer, &domain, request_id, &sender_pk, amount)` → 64-byte signature.
  6. Return `VoucherResponse` with `signature: format!("0x{}", hex::encode(sig))`. Keep the `0x` prefix for consistency even though Stellar tooling typically renders ed25519 sigs un-prefixed — the existing EVM response uses `0x…`, and the chain context tells the caller how to decode.

### 8. Tests

See **Test Strategy** below — covered as its own section.

### 9. Documentation

- Update `.env.example`: add a Stellar voucher block after the existing Stellar indexer block (lines 86–109), documenting the **flat** `STELLAR_VERIFIER_SECRET` plus per-chain `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID`, `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID`, `CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE`. Explicitly note these are **parallel to** (not aliases of) the indexer's `CHAIN_<id>_STELLAR_*` vars — a deliberate decision so the API and indexer can target different deployments.
- Update `packages/api/src/routes/vouchers.rs` doc comment on `VouchersDoc` to mention "EVM EIP-712 secp256k1 or Stellar Soroban ed25519 depending on `chain_id`".
- Add a short paragraph to `docs/design-docs/multi-chain-kyc-sharding.md` (or a new `docs/design-docs/stellar-voucher-signing.md` if the topic is large enough) describing the on-chain digest scheme and the XDR-parity test approach.
- Add a tech-debt entry in `docs/exec-plans/tech-debt-tracker.md` for:
  - "Replace `STELLAR_VERIFIER_SECRET` env var with KMS/BitGo provisioning" (matches the Out of Scope note).
  - "Move flat `STELLAR_VERIFIER_SECRET` to per-chain `CHAIN_<id>_STELLAR_VERIFIER_SECRET`" — when mainnet ships and we need separate signers per network.
  - "Stellar `lp_profiles` whitelist path" — required before Stellar voucher requests can succeed in any non-test environment (Decision §4 keeps the same SQL as EVM, so the API will 403 until rows exist).

## Test Strategy

All tests are pure unit tests (no DB, no env-gated DB connection — per `MEMORY.md`'s "No env-var DB gate in tests" rule).

### `packages/shared/src/stellar_voucher.rs` (new module)

1. **Golden digest fixture** (the critical correctness test). Hard-code the deployed testnet DM Strkey, testnet network passphrase, and a fixed `(request_id, user, amount)` triple. Assert that `voucher_digest(...)` returns the exact byte string returned by the on-chain `digest(...)` view for the same triple (recorded once via the Stellar CLI by the coder — see Implementation Step §3).
2. **Domain separator parity.** A standalone test that computes `sha256(XDR(Domain { ... }))` and compares against a recorded byte fixture for the testnet DM and testnet network_id.
3. **Voucher hash parity.** Same shape for `sha256(XDR(Voucher { ... }))` against a recorded byte fixture.
4. **Signature round-trip.** Generate a known `SigningKey::from_bytes(&[1u8; 32])` (matches the contracts' `test.rs:52` fixture), sign a fixed digest, and verify with `VerifyingKey::verify` using the corresponding pubkey. Sanity check that the signature is 64 bytes.
5. **Strkey seed parsing.** Build a `StellarVoucherSigner` from a known `S…` strkey (workspace `stellar-strkey::ed25519::PrivateKey`), assert the derived pubkey matches the expected `G…`.

### `packages/api/src/routes/vouchers.rs` (route tests — pure unit, no DB)

The existing route code path takes a DB-backed `AppState`. Tests that exercise the full route already exist in the EVM path; for the Stellar path the tests should focus on the **pure dispatch decisions** that can be exercised without a DB:

1. **`resolve_voucher_signing` Stellar lookup.** Given an `AppState` with a populated `stellar_voucher_signers` map but no EVM signer for a given `chain_id`, dispatch returns the Stellar signer; the EVM path returns `ChainNotConfigured`. Mirror for the inverse.
2. **Wallet normalisation helper.** EVM input `"0xAbC…"` → lowercased; Stellar input `"GC5S…ACM"` → unchanged. Invalid Stellar shape (wrong length, lowercase `g…`) → returns the validation error variant (or `None` if the helper is `Option`-returning).
3. **`request_id` overflow handling.** For Stellar, a `BigDecimal` representing `2^128` returns HTTP 500 (parse error path). The test can construct the parse path directly without going through axum.
4. **`u128` and `i128` parse round-trip.** Numeric strings as written by the indexer (`"1234"`) parse to `u128`/`i128`; negative `amount` strings (which the indexer should never produce, but in case) fall through the existing error path.

The full handler-level integration test (axum + DB) for Stellar is **explicitly out of scope** because it would require a Postgres connection (forbidden by `MEMORY.md`). The smoke-test recipe lives in the PR description (see below).

### Existing EVM tests

All existing EVM route tests must continue to pass unmodified. Run the full test suite (`scripts/test-fast.sh` or equivalent) and confirm zero regressions.

### Smoke recipe (PR description, not CI)

Document a manual smoke procedure in the PR description:

1. Set the env block (CHAINS, CHAIN_99000001_TYPE=stellar, STELLAR_VERIFIER_SECRET=…) per the new `.env.example`.
2. `curl -s "http://localhost:8080/v1/deposits/<id>/voucher?wallet=G…&chain_id=99000001"`
3. Take the returned 64-byte ed25519 signature, base64-encode it, and submit `claim_request` via the Stellar CLI against the deployed testnet DepositManager. Assert the call returns 0 (success); the indexer should pick up the `RequestClaimed` event within one poll cycle.

### Lints

After every Rust change run `cargo clippy --all -- -D warnings` (per `AGENTS.md`). Fix any warnings before commit.

## Docs to Update

- `.env.example` — new Stellar voucher block (see Implementation Step §9).
- `packages/api/src/routes/vouchers.rs` doc comments on `VouchersDoc` and `VoucherResponse` (mention scheme dispatch).
- `docs/design-docs/multi-chain-kyc-sharding.md` — short note on the Stellar voucher signing scheme and how it co-exists with the EVM EIP-712 path; or a new file `docs/design-docs/stellar-voucher-signing.md` if the topic warrants its own doc (coder's call; lean toward append-to-existing if the addition is <30 lines).
- `docs/exec-plans/tech-debt-tracker.md` — KMS/BitGo replacement for `STELLAR_VERIFIER_SECRET`; Stellar whitelist path follow-up (if §6 lands the short-circuit).
- No product-spec update is required: this is a backend feature implementing existing user-visible behaviour (claim a Stellar deposit/withdrawal) — the spec for the user-visible flow lives in `docs/product-specs/` already (covered by the deposit/withdrawal/stake flows). If `docs/product-specs/index.md` calls out chain-specific verifier provisioning, append a single bullet noting that Stellar voucher signing is now backend-resident (no dev fallback required).
