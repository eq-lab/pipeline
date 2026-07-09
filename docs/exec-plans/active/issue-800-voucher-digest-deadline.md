# Issue #800: Voucher digest drift: shared crate hashes 4 fields (incl. deadline), deployed contract digest is 3-arg

Source: https://github.com/eq-lab/pipeline/issues/800

Sub-issue of epic #498 (Deposit/withdraw page). Branch: `fix/800-voucher-digest-deadline`.

## Scope

The deployed testnet Stellar `request-queue` contracts (DepositManager + WithdrawalQueue) were changed so that:

- The **signed voucher digest drops `deadline`** — `digest(request_id, sender, amount)` is 3-arg on-chain (confirmed via contract spec + simulate; a 4-arg call fails `MismatchingParameterLen`).
- **`deadline` moves to a `claim_request` parameter**, supplied at claim time from the API rather than baked into the signature. This applies to BOTH deposit and withdraw flows.

In scope:

1. **`packages/shared/src/stellar_voucher.rs`** — make `voucher_digest` / `voucher_xdr` / `sign_voucher` sign the 3-field preimage `{ request_id, sender, amount }` (drop `deadline`); re-enable and correct the `golden_digest_fixture`; regenerate signature-dependent tests.
2. **`packages/api/src/routes/vouchers.rs`** — `sign_voucher` call no longer takes `deadline`. The API still computes a `deadline` (now + `CLAIM_DEADLINE_SECS`) and still returns it in `VoucherResponse.deadline` (now purely for the caller to pass to `claim_request`, not part of the signature). Update comments/docstrings accordingly.
3. **Frontend claim wiring** (deposit + withdraw): pass `deadline` (from the voucher API response) into the `claim_request` builder call. Touches `packages/frontend/src/wallet/stellar/contracts/depositManager.ts` + `withdrawalQueue.ts` (`buildClaimRequest`), `useStellarDepositManager.ts` + `useStellarWithdrawalQueue.ts` (`useStellarClaim` / `useStellarClaimWithdrawal` `write`), the voucher API hooks/types (`VoucherResponse`, `useStellarDepositVoucher.ts`, `useStellarWithdrawalVoucher.ts`), and the claim invocation in `packages/frontend/src/wallet/useDepositFlow.ts` (~line 1300). **CONDITIONAL on confirming the new on-chain `claim_request` signature — see Open Questions.**
4. **Docs**: update `docs/generated/stellar-protocol-contracts.md` (the two `claim_request` interface lines still show the old 2-arg form), and add a short note to `docs/design-docs/multi-chain-kyc-sharding.md` (the digest scheme there is already 3-field, but it should state that `deadline` is now a `claim_request` parameter and not signed). Evaluate whether a Stellar-specific note belongs in `docs/product-specs/deposits.md` / `withdrawals.md` (see Docs to Update).

Out of scope:

- Any change to the Soroban contracts themselves (already deployed/changed by the human).
- The EVM EIP-712 path (unaffected — its `deadline` handling lives in the on-chain attestation and is untouched).
- Seeding `lp_profiles` for Stellar wallets (tracked separately in tech-debt-tracker TD entry).

## Assumptions and Risks

- **Digest field-name sort.** Removing `deadline` changes the `to_xdr` `ScVal::Map`: the sorted entries drop from `[amount, deadline, request_id, sender]` to `[amount, request_id, sender]`. `voucher_xdr` must be rebuilt to match exactly; the golden fixture is the correctness gate (the on-chain 3-arg value is the source of truth).
- **The 3-arg on-chain digest value `fd9f0b2b…e42e86d1`** is asserted in the issue for `request_id=1, sender=GDH66JAF…, amount=1000000` against DepositManager `CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO`. The updated `voucher_digest` must reproduce it byte-for-byte. If it does not, our `stellar-xdr` reproduction diverges from `soroban-sdk`'s `to_xdr` for the 3-field struct — do NOT paper over by pasting our own output; investigate the XDR encoding.
- **Contract-address discrepancy (risk).** The shared-crate test constant and the issue both use DM `CB62UZDT…`, but `.env.example` / `VITE_STELLAR_DEPOSIT_MANAGER_ID` reference different addresses (`CARFA…` indexer default, `CBN4P3NY…` frontend default). The golden fixture is domain-specific (the domain separator includes the contract address), so the golden test must keep using `CB62UZDT…` — the same address the on-chain digest was captured against. Do not "fix" the test constant to match `.env`. Flag whether the deployed/active testnet DM is actually `CB62UZDT…` (Open Question).
- **Frontend `claim_request` signature is unconfirmed from the repo.** `docs/generated/stellar-protocol-contracts.md` and both frontend builders currently encode `claim_request(request_id: u128, verifier_signature: BytesN<64>)` — 2-arg, no deadline. The issue's resolution direction says the new on-chain `claim_request` takes `deadline`, but the exact new signature (arg name, position, type — presumably `deadline: u64` appended) cannot be verified from the repo and there is no live-RPC access in the planning environment. The frontend wiring step is blocked on confirming this (Open Question). The backend/shared-crate digest fix is NOT blocked and can proceed independently.
- **Signature test vectors need the signing key.** Any test that asserts a fixed `sign_voucher` output over the new digest needs deterministic key material. The existing `signature_round_trip` test uses the well-known seed `[1u8; 32]` and verifies via the derived verifying key (no hardcoded signature bytes), so it regenerates deterministically. If a new test hardcodes signature bytes it must use that same seed; flag if any test cannot be made deterministic.
- **`CLAIM_DEADLINE_SECS` / `now_unix` retained.** The API still needs to compute and return a `deadline`; only its role changes (claim param, not signed field). Keep the constant and helper.

## Open Questions

- **Exact new on-chain `claim_request` signature.** Confirm from the deployed testnet DepositManager + WithdrawalQueue contract spec (same `spec.funcs()` / simulate method used to confirm the 3-arg `digest`) the precise new `claim_request` argument list — most likely `claim_request(request_id: u128, verifier_signature: BytesN<64>, deadline: u64)`, but the position and type of `deadline` must be verified, not assumed. The frontend builder/hook changes (Scope item 3) cannot be implemented safely without this.
- **Does the API already expose `deadline` to the frontend claim path?** Backend: yes — `VoucherResponse.deadline: Option<String>` is already populated for Stellar (`sign_and_respond_stellar`). Frontend: NO — `VoucherResponse` in `packages/frontend/src/api/useDepositVoucher.ts` has no `deadline` field, so the value is dropped client-side today. Adding it to the FE type + threading it into the claim hook is required (no backend field needs to be added). Confirm this is the intended source (the same `deadline` the API returns is the one `claim_request` expects).
- **Is the active testnet DM actually `CB62UZDT…`?** The golden fixture and issue use `CB62UZDT…`; `.env.example` uses other addresses. Confirm which contract is authoritative for the golden fixture so the domain separator is correct.

## Implementation Steps

### A. Shared crate — 3-field digest (not blocked)

1. `packages/shared/src/stellar_voucher.rs`:
   - `voucher_xdr(...)`: remove the `deadline: u64` parameter and the `deadline` map entry; sorted entries become `[amount, request_id, sender]`. Update the doc comment on `voucher_xdr` (the `Voucher { … deadline }` field list and the "alphabetical sort" line).
   - `voucher_digest(...)`: remove the `deadline` parameter; update its call to `voucher_xdr`. Update the module-level and function docstrings that show `Voucher { request_id, sender, amount, deadline }` to the 3-field form.
   - `sign_voucher(...)`: remove the `deadline` parameter; update its call to `voucher_digest`.
   - Decide the fate of `CLAIM_DEADLINE_SECS`: it is consumed by the API route (`vouchers.rs`), not by the digest anymore. Keep it (the API still uses it to compute the returned `deadline`). Its docstring ("signed deadlines are set…", "part of the signed voucher") must be reworded — the deadline is now a claim-time `claim_request` parameter, not signed.
2. Update the golden fixture in the same file's `tests` module:
   - Remove `#[ignore = …]` from `golden_digest_fixture`.
   - Set `GOLDEN_DIGEST_HEX = "fd9f0b2b2dfceba03c3444c3ae5398ca3b8e9fc7722416d34b9b18c4e42e86d1"`.
   - Drop the `GOLDEN_DEADLINE` constant if no longer referenced (it is used across several tests below — remove only from calls that lost the param; delete the const only if fully unused).
   - Update the CLI comment block: drop the `--deadline 1800000000` line; keep the 3-arg `digest` invocation.
   - Remove/rewrite the `TODO(#800)` block explaining the drift.
   - Update every test that calls `voucher_digest`/`sign_voucher`/`voucher_xdr` with a `deadline` arg: `voucher_xdr_is_deterministic`, `voucher_hash_reproducible`, `digest_changes_on_input_change` (delete the `diff_deadline` assertion — deadline is no longer an input), `signature_round_trip`, `negative_amount_differs_from_positive`.
3. Run `cargo test -p shared stellar_voucher` — `golden_digest_fixture` must pass genuinely against the on-chain value.

### B. API route (not blocked)

4. `packages/api/src/routes/vouchers.rs`, `sign_and_respond_stellar`:
   - Update the `sign_voucher(...)` call to drop the `deadline` argument.
   - Keep computing `deadline` (now + `CLAIM_DEADLINE_SECS`) and keep returning it in `VoucherResponse { deadline: Some(deadline.to_string()) }` — reword the comment: the deadline is no longer signed; the caller passes it to `claim_request`.
   - Update the `VoucherResponse.deadline` field docstring ("Part of the signed Stellar voucher") to reflect the new meaning (a `claim_request` parameter the caller must pass verbatim; still verifier-supplied so the claim window is enforced by the verifier, not the signature).
5. `packages/api/tests/voucher_signing.rs`: no direct `sign_voucher`/digest assertions today (pure dispatch/normalisation helpers) — verify nothing references the removed `deadline` param; add coverage only if a signing assertion is introduced.

### C. Frontend claim wiring (BLOCKED on Open Question — confirm `claim_request` signature first)

6. Once the new `claim_request` signature is confirmed:
   - `packages/frontend/src/api/useDepositVoucher.ts`: add `deadline?: string` to `VoucherResponse`.
   - `useStellarDepositVoucher.ts` / `useStellarWithdrawalVoucher.ts`: surface `deadline` (parse to `bigint` for the `u64` claim arg) alongside `signatureBytes`.
   - `contracts/depositManager.ts` + `contracts/withdrawalQueue.ts` `buildClaimRequest(...)`: add a `deadline: bigint` parameter and append `nativeToScVal(deadline, { type: "u64" })` to the `claim_request` op args (position per the confirmed signature).
   - `useStellarDepositManager.ts` (`useStellarClaim`) + `useStellarWithdrawalQueue.ts` (`useStellarClaimWithdrawal`): extend `write(requestId, verifierSignature, deadline)`; thread `deadline` into `buildClaimRequest`.
   - `packages/frontend/src/wallet/useDepositFlow.ts` (~line 1293-1303): read `deadline` from the voucher response and pass it into `stellarClaim.write(...)` / `stellarClaimWithdrawal.write(...)`. Guard for a missing/undefined deadline the same way `sig` is guarded.
7. Update the affected frontend hook/builder tests (`useStellarDepositManager.test.tsx`, `useStellarWithdrawalQueue.test.tsx`, `useStellarDepositVoucher.test.tsx`, `useStellarWithdrawalVoucher.test.tsx`, `routes/-deposit.test.tsx`, `routes/test/-scenarios.ts`) for the new arg. Mock vouchers must now carry a `deadline`.

### D. Docs

8. `docs/generated/stellar-protocol-contracts.md`: update BOTH `claim_request(request_id: u128, verifier_signature: BytesN<64>) -> i128;` lines to the confirmed new signature (e.g. `claim_request(request_id: u128, verifier_signature: BytesN<64>, deadline: u64) -> i128;`). Note it is generated — confirm whether it is hand-maintained or regenerated; if regenerated, update the generator/source; otherwise edit in place with a note.
9. `docs/design-docs/multi-chain-kyc-sharding.md` "Stellar Voucher Signing" section: the digest scheme is already 3-field; add one line stating `deadline` is no longer part of the signed digest and is passed to `claim_request` at claim time (sourced from the voucher API `deadline` field). Update the "live golden-fixture test … requires manual execution" sentence — the golden fixture is now enabled and asserts the on-chain 3-arg value.

## Test Strategy

- **Shared crate (primary gate):** `golden_digest_fixture` must be un-ignored and pass against `fd9f0b2b…e42e86d1`. This is the single authoritative check that the 3-field XDR reproduction matches the deployed contract. Keep the determinism/collision tests (`voucher_xdr_is_deterministic`, `voucher_hash_reproducible`, `digest_changes_on_input_change` minus the deadline case, `negative_amount_differs_from_positive`) and the `signature_round_trip` (deterministic via seed `[1u8;32]`, no hardcoded signature bytes).
- **API:** existing pure-helper tests must still compile/pass with the changed `sign_voucher` arity. No new DB-backed test required.
- **Frontend:** update hook/builder unit tests to assert the new `deadline` arg is threaded into `buildClaimRequest`; update mock voucher fixtures to include `deadline`. (No QA phase for frontend per AGENTS.md; verify via vitest.)
- **Lint:** `cargo clippy --all -- -D warnings` after Rust changes; `npx tsx scripts/lint-docs.ts` after doc/TS changes.
- **Edge cases:** missing `deadline` in the FE voucher response → claim button stays disabled / no-op (mirror the existing `sig` guard); negative/zero deadline not expected (API always sets now+TTL).

## Docs to Update

- `docs/generated/stellar-protocol-contracts.md` — `claim_request` signature (both contracts).
- `docs/design-docs/multi-chain-kyc-sharding.md` — deadline is a claim param, not signed; golden fixture now enabled.
- `docs/product-specs/deposits.md` / `docs/product-specs/withdrawals.md` — these currently document only the EVM EIP-712 attestation flow (no Stellar voucher section). Signing/claim behavior for the Stellar path changes, so add a short Stellar-voucher note (or a pointer to `multi-chain-kyc-sharding.md`) stating that the ed25519 voucher signs `{request_id, sender, amount}` and that the claim deadline is supplied to `claim_request` from the API. Confirm with the plan reviewer whether the product spec is the right home or whether the design doc suffices (flagged in Open Questions is the signature; the spec-location choice is a lighter call the reviewer can confirm).
- Consider a tech-debt entry if the frontend wiring is deferred pending the `claim_request` signature confirmation.
