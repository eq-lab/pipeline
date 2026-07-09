# Issue #800: Voucher digest drift: shared crate hashes 4 fields (incl. deadline), deployed contract digest is 3-arg

Source: https://github.com/eq-lab/pipeline/issues/800

Sub-issue of epic #498 (Deposit/withdraw page). Branch: `fix/800-voucher-digest-deadline`.

> **Corrected direction (supersedes the original plan).** The original plan proposed dropping `deadline`
> from the signed digest. That was WRONG — it was derived against a STALE contract. The facts below were
> confirmed via Soroban RPC against the deployed contracts and the human confirmed the direction in-conversation.
> The signed digest stays 4-field (deadline IS signed); the only contract-shape change is that
> `claim_request` now takes `deadline` as a parameter. This plan is ready-to-implement (no park/approval gate).

## Scope

Two DepositManager contracts exist on testnet. The `shared` golden test was pinned to a STALE one
(`CB62UZDT…`, whose `digest` view is 3-arg). The LIVE contract used by the app config
(`VITE_STELLAR_DEPOSIT_MANAGER_ID` in `.env` / `.env.example`) is
`CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX`, introspected from its on-chain spec as:

- `digest(request_id: u128, sender: Address, amount: i128, deadline: u64)` — **4-arg; deadline IS signed.**
- `claim_request(request_id: u128, verifier_signature: BytesN<64>, deadline: u64)` — **3-arg; takes deadline.**

Consequences:

- `shared::stellar_voucher` (`voucher_digest` / `sign_voucher` / `voucher_xdr`) is **already correct** — it
  hashes the 4-field preimage `{ request_id, sender, amount, deadline }`. **No change to the digest / signing
  code.** The only fix in `shared` is repointing the golden test to the LIVE contract and re-enabling it.
- The backend (`packages/api/src/routes/vouchers.rs`) is **already correct** — `sign_and_respond_stellar`
  already passes `deadline` into `sign_voucher` (deposit + withdraw) and already returns it in
  `VoucherResponse.deadline`. **No backend change.** (Confirmed live on stage:
  `GET /v1/deposits/{id}/voucher` → `"deadline": 1783512369`.)
- The frontend `claim_request` call is now 3-arg. It must thread the API's `deadline` into
  `buildClaimRequest` for BOTH the deposit and withdraw flows. This is the substantive code change.
- Docs (`docs/generated/stellar-protocol-contracts.md`, `docs/design-docs/multi-chain-kyc-sharding.md`)
  document the STALE contract shape and must be corrected to the LIVE 4-arg `digest` / 3-arg `claim_request`.

In scope:

1. **`packages/shared/src/stellar_voucher.rs`** — golden-test-only fix (no digest/signing change): repoint the
   test contract constant to the LIVE DM, set the verified `GOLDEN_DIGEST_HEX`, remove the `#[ignore]`,
   restore the 4-arg CLI comment.
2. **Frontend claim wiring (deposit + withdraw)** — add `deadline` to the FE voucher types, thread it through
   the claim hooks and `buildClaimRequest`, and pass it at the claim call site in `useDepositFlow.ts`.
3. **Docs** — correct the generated contract reference and add a one-line note to the design doc.

Out of scope:

- Any Soroban contract change (the LIVE contract already has the 4-arg digest / 3-arg claim shape).
- Any `shared` digest/signing-code change (already correct — verified byte-for-byte against the LIVE contract).
- Any backend/API change (already returns and signs with `deadline`).
- The EVM EIP-712 path (unaffected; its `VoucherResponse.deadline` is `None` and its claim signature is unchanged).

## Assumptions and Risks

- **The golden fix is a verified, mechanical repoint.** Repointing `TESTNET_DM_STRKEY` `CB62…` → `CBN4P3NY…`
  and setting `GOLDEN_DIGEST_HEX = 123b18a9c758ee483498fe4517f9cced3cd8de8b8cf96f525eafeab905cb01f3` (the live
  on-chain `digest(1, GDH66JAF…, 1000000, 1800000000)`) was verified to make `golden_digest_fixture` pass. The
  domain separator includes the contract address, so the golden fixture MUST use the LIVE DM `CBN4P3NY…`, not
  the stale `CB62…`. No change to `voucher_xdr`/`voucher_digest` byte layout is needed.
- **No signing-code change means the other `shared` tests stay green.** `voucher_xdr_is_deterministic`,
  `voucher_hash_reproducible`, `digest_changes_on_input_change` (incl. its `diff_deadline` case),
  `signature_round_trip`, `negative_amount_differs_from_positive` all keep their 4-field calls and their
  current `GOLDEN_DEADLINE` usage unchanged. They should remain green; verify after the golden repoint.
- **Two-contract discrepancy is real and load-bearing.** `CB62…` (stale) and `CBN4P3NY…` (live) coexist on
  testnet with DIFFERENT `digest` arities. The stale one is 3-arg; the live one is 4-arg. Do NOT "simplify"
  the digest to 3-field — that would match the stale contract and break the live one. The generated doc's
  interface was captured against yet another id (`CARFA…`, the indexer default) — see Docs.
- **Frontend deposit vs withdraw voucher types differ.** The deposit path (`useStellarDepositVoucher.ts`)
  reuses `VoucherResponse` from `useDepositVoucher.ts` via `type StellarVoucherResponse = VoucherResponse`, so
  adding `deadline` to `VoucherResponse` covers deposit. The withdraw path
  (`useStellarWithdrawalVoucher.ts`) has its OWN `StellarWithdrawalVoucherResponse` interface — `deadline`
  must be added there separately.
- **`deadline` is a `u64` on-chain; the API returns it as a string.** The FE currently drops it. It must be
  parsed to `bigint` and encoded as `nativeToScVal(deadline, { type: "u64" })` in `buildClaimRequest`. A
  missing/invalid `deadline` must be guarded the same way `signatureBytes` is (claim stays a no-op).
- **Arg position for `deadline` in `claim_request` is appended last:**
  `claim_request(request_id, verifier_signature, deadline)` — verified from the live spec. Encode in that order.
- **Vitest sandbox quirk.** If the workspace runner breaks under the sandbox, run
  `node node_modules/.bin/vitest run` under Node 20 (see Test Strategy).

## Open Questions

_None_ — direction is human-confirmed and the facts are on-chain-verified. The withdraw claim path was
confirmed to mirror the deposit path exactly (same `buildClaimRequest(requestId, verifierSignature,
sourceAccount)` shape, same `write(requestId, verifierSignature)` hook signature); the only difference is that
the withdraw voucher response uses a distinct `StellarWithdrawalVoucherResponse` type that needs `deadline`
added separately (captured in the steps below).

## Implementation Steps

### A. Shared crate — golden test repoint only (NO digest/signing change)

1. `packages/shared/src/stellar_voucher.rs` — DO NOT touch `voucher_xdr`, `voucher_digest`, `sign_voucher`, or
   any of the module/function docstrings describing the 4-field `Voucher { request_id, sender, amount,
   deadline }` preimage. They are already correct.
2. In the `tests` module, fix `golden_digest_fixture` ONLY:
   - Repoint `TESTNET_DM_STRKEY`: `"CB62UZDTBJOQWTLTQCHQUJJAYO4BSZC6QHVDHCJWD3XOPWP4M3ALJCOO"` →
     `"CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX"`. Update its doc comment ("Deployed testnet
     DepositManager (from .env.example)") to note this is the LIVE DM matching `VITE_STELLAR_DEPOSIT_MANAGER_ID`.
   - Set `GOLDEN_DIGEST_HEX = "123b18a9c758ee483498fe4517f9cced3cd8de8b8cf96f525eafeab905cb01f3"`.
   - Remove the `#[ignore = "voucher digest drift: 3-arg on-chain vs 4-field local — see #800"]` attribute on
     `golden_digest_fixture`.
   - Delete the `TODO(#800)` comment block above the test (the drift is resolved: the live contract is 4-arg).
   - Restore the CLI comment block to the 4-arg form: keep the `--deadline 1800000000` line, and update
     `--id` to `CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX`, `--source-account` and `--sender`
     to `GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU`.
   - Leave `GOLDEN_DEADLINE`, `TESTNET_VERIFIER`, `testnet_domain()`, `testnet_sender()` unchanged (still used).
3. Run `cargo test -p shared stellar_voucher` — `golden_digest_fixture` must PASS against
   `123b18a9…905cb01f3`, and every other test in the module must remain green.

### B. Frontend claim wiring (deposit + withdraw)

4. `packages/frontend/src/api/useDepositVoucher.ts`: add an optional `deadline?: string` field to the
   `VoucherResponse` interface (with a doc comment: "Claim deadline (u64 seconds) — pass to
   `claim_request`; still part of the signed digest"). This propagates to the deposit path automatically via
   `StellarVoucherResponse = VoucherResponse` in `useStellarDepositVoucher.ts`.
5. `packages/frontend/src/api/useStellarWithdrawalVoucher.ts`: add the same `deadline?: string` field to the
   `StellarWithdrawalVoucherResponse` interface.
6. `packages/frontend/src/wallet/stellar/contracts/depositManager.ts` `buildClaimRequest(...)`: add a
   `deadline: bigint` parameter (after `verifierSignature`, before `sourceAccount`), document it, and append
   `nativeToScVal(deadline, { type: "u64" })` as the third arg to the `this.contract.call("claim_request", …)`
   op (after the signature `scvBytes`). Update the method docstring to list the new param.
7. `packages/frontend/src/wallet/stellar/contracts/withdrawalQueue.ts` `buildClaimRequest(...)`: apply the
   identical change (new `deadline: bigint` param + third `nativeToScVal(deadline, { type: "u64" })` op arg).
8. `packages/frontend/src/wallet/stellar/useStellarDepositManager.ts` `useStellarClaim`: extend the `write`
   callback signature (line ~75 in the `StellarClaimResult` type and line ~368 in the `useCallback`) from
   `(requestId, verifierSignature)` to `(requestId, verifierSignature, deadline: bigint)`; thread `deadline`
   into the `client.buildClaimRequest(requestId, verifierSignature, deadline, sourceAccount)` call (line ~430).
9. `packages/frontend/src/wallet/stellar/useStellarWithdrawalQueue.ts` `useStellarClaimWithdrawal`: apply the
   identical `write` signature + `buildClaimRequest` threading change (lines ~75, ~370, ~431).
10. `packages/frontend/src/wallet/useDepositFlow.ts` claim call site (lines ~1293-1303):
    - Read `deadline` from the active voucher response: `stellarVoucher.data?.deadline` (parse to `bigint`).
    - Extend the existing `sig` guard: derive `const deadline = stellarVoucher.status === "ready" &&
      stellarVoucher.data?.deadline !== undefined ? BigInt(stellarVoucher.data.deadline) : undefined;` and
      `if (!sig || deadline === undefined) return;`.
    - Pass `deadline` as the third arg: `stellarClaim.write(stellarRequestIdBigInt, sig, deadline)` and
      `stellarClaimWithdrawal.write(stellarRequestIdBigInt, sig, deadline)`.
11. Run `npx tsc --noEmit` (or the workspace typecheck) to confirm the new arg threads cleanly end-to-end.

### C. Docs

12. `docs/generated/stellar-protocol-contracts.md`:
    - In BOTH the `deposit_manager` and `withdrawal_queue` interface blocks, change the `digest` line from
      `fn digest(request_id: u128, sender: Address, amount: i128) -> BytesN<32>;` to
      `fn digest(request_id: u128, sender: Address, amount: i128, deadline: u64) -> BytesN<32>;`.
    - In both blocks, change the `claim_request` line from
      `fn claim_request(request_id: u128, verifier_signature: BytesN<64>) -> i128;` to
      `fn claim_request(request_id: u128, verifier_signature: BytesN<64>, deadline: u64) -> i128;`.
    - Add a one-line note under the addresses table (or in the generation-provenance header) that the LIVE
      app-config contract is `deposit_manager = CBN4P3NY…` / `withdrawal_queue = CCWP3P4C…`
      (`VITE_STELLAR_DEPOSIT_MANAGER_ID` / `VITE_STELLAR_WITHDRAWAL_QUEUE_ID`), distinct from the indexer
      defaults shown, and that the 4-arg `digest` / 3-arg `claim_request` interface above reflects the LIVE
      contract. This doc is hand-maintained (fetched via `stellar contract info interface`, no generator
      script) — edit in place.
13. `docs/design-docs/multi-chain-kyc-sharding.md` "Stellar Voucher Signing" section:
    - In the digest-scheme code block, restore `deadline` to the `Voucher` preimage:
      `voucher_hash = sha256( XDR(Voucher { request_id: u128, sender: Address, amount: i128, deadline: u64 }) )`.
    - Add one line: `deadline` is part of the signed digest AND is passed to `claim_request` at claim time
      (sourced from the voucher API `deadline` field).
    - Update the "A live golden-fixture test … requires manual execution" sentence: the golden fixture
      (`golden_digest_fixture`) is now enabled and asserts the on-chain 4-arg `digest` value against the LIVE
      DepositManager `CBN4P3NY…`.

## Test Strategy

- **`shared` (primary correctness gate):** `golden_digest_fixture` re-enabled and passing against the LIVE DM
  `CBN4P3NY…` with `GOLDEN_DIGEST_HEX = 123b18a9…905cb01f3`. This is the byte-for-byte reproduction check.
- **Other `shared`/`api` tests:** no signing-code change, so `voucher_xdr_is_deterministic`,
  `voucher_hash_reproducible`, `digest_changes_on_input_change`, `signature_round_trip`,
  `negative_amount_differs_from_positive`, and the API voucher tests should be unaffected — verify they stay
  green (`cargo test -p shared`, `cargo test -p api voucher`).
- **Frontend unit tests:** update the claim builder/hook tests to assert `deadline` is threaded into
  `claim_request` for BOTH deposit and withdraw:
  - `packages/frontend/src/wallet/stellar/contracts/depositManager.test.ts` — assert the third
    `claim_request` op arg is the `u64` deadline; add a `deadline` arg to `buildClaimRequest` calls.
  - Withdrawal builder tests (`withdrawalQueue`) if present — same assertion.
  - `useStellarDepositManager.test.tsx` / `useStellarWithdrawalQueue.test.tsx` — extend `write(...)` calls
    with a `deadline` arg.
  - Voucher-hook / route tests whose mock voucher fixtures feed the claim path
    (`useStellarDepositVoucher.test.tsx`, `useStellarWithdrawalVoucher.test.tsx`, and any
    `routes/-deposit.test.tsx` / `routes/test/-scenarios.ts` mock vouchers) — add `deadline` to mock voucher
    payloads so the claim call site is exercised.
  - Add/adjust a `VoucherResponse` / `StellarWithdrawalVoucherResponse` type-level assertion if one exists.
- **Edge case:** a voucher response missing `deadline` → the claim call site returns early (mirrors the
  existing `sig` guard); assert the claim `write` is not invoked in that case.
- **Sandbox quirk:** if the workspace vitest runner breaks under the sandbox, run
  `node node_modules/.bin/vitest run` under Node 20.
- **Lint:** `cargo clippy --all -- -D warnings` after the Rust change; `npx tsx scripts/lint-docs.ts` after
  the doc/TS changes.

## Docs to Update

- `docs/generated/stellar-protocol-contracts.md` — `digest` → 4-arg (add `deadline: u64`) and `claim_request`
  → 3-arg (add `deadline: u64`) in both contract blocks; note the LIVE app-config addresses vs the indexer defaults.
- `docs/design-docs/multi-chain-kyc-sharding.md` — restore `deadline` to the `Voucher` digest preimage; note
  it is both signed and passed to `claim_request`; note the golden fixture is now enabled against `CBN4P3NY…`.
- No change to `docs/product-specs/deposits.md` / `docs/product-specs/withdrawals.md` — they are EVM-only.
