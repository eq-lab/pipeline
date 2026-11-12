# User Stories: #1889 — Stellar: a wire-only lender's settlement address is never PLUSD-authorised, so record_wire_in traps

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1889](https://github.com/eq-lab/pipeline/issues/1889)
Spec: [docs/design-docs/multi-chain-kyc-sharding.md](../../design-docs/multi-chain-kyc-sharding.md#linked-settlement-addresses-issue-1889), [docs/product-specs/deposits.md](../../product-specs/deposits.md#stellar-plusd-mint-leg), [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md)

Operator and Trustee stories on a Stellar chain. The candidate rule, the receiver classification and the dialog states are also covered by automated tests (listed at the end).

---

## Story 1: A KYB-passed wire-only lender's linked address is authorised without a deposit

**Persona:** Operator watching the Stellar relayer.

**Pre-conditions:** An LP with `kyb_status = 'Passed'` and a linked `G…` `stellar_address` that already holds a PLUSD trustline; no `DepositRequested` for that address; Elliptic KYT on or off.

**Steps:**

1. Wait one relayer cycle (60 s by default).
2. Read `PLUSD.authorized(<address>)` and the `lp_profiles` row.

**Expected outcomes:**

- An `lp_profiles` row exists for the address on the Stellar chain. With Elliptic on it is screened, and authorised only once `kyt_status = 1`.
- `authorized` returns `true` and `on_chain_allowed = TRUE`, with no USDC deposit and no wallet Sumsub review.

---

## Story 2: A linked address without a PLUSD trustline is skipped quietly

**Pre-conditions:** A KYB `Passed` LP whose linked `G…` has no PLUSD trustline; another profile with a qualifying `DepositRequested`.

**Expected outcomes:**

- Each cycle logs the trustline-less address at `debug` only, submits nothing for it, and raises no `error` log.
- It does not count against `batch_size`; the depositor is still authorised in the same cycle.
- Once the lender adds the trustline, the next cycle authorises the address.

---

## Story 3: A linked `C…` contract address is authorised

**Pre-conditions:** A KYB `Passed` LP whose linked settlement address is a `C…` contract; Elliptic off (or the address screens clean).

**Expected outcomes:**

- The relayer submits `set_authorized(C…, true)` and the address reads `authorized == true`.

---

## Story 4: An LP that is not KYB Passed is not authorised through its link

**Pre-conditions:** An LP in `Pending`, `ChangesRequested` or `Refused` with a linked address and no deposit.

**Expected outcomes:**

- No `lp_profiles` row is seeded and the address is not authorised.

---

## Story 5: The Mint PLUSD dialog blocks a receiver that cannot take PLUSD

**Persona:** Trustee (Cash reporter) on Trustee console → LP detail → bank deposits.

**Pre-conditions:** An unminted bank deposit; the wallet connected with the Cash reporter role.

**Steps:**

1. Click `Mint PLUSD` for a receiver with no PLUSD trustline.
2. Repeat for a receiver whose trustline exists but is not authorised.
3. Repeat with an LP that has no linked address, so the capital wallet is the receiver, in the same two states.

**Expected outcomes:**

- Step 1 shows `lp-mint-no-trustline` ("This receiver has no PLUSD trustline. The lender must add PLUSD to this wallet before it can receive a mint."); step 2 shows `lp-mint-not-authorized`. Confirm is disabled and no wallet prompt appears.
- Step 3 says "capital wallet" instead of "lender" in the no-trustline notice.
- A failed authorisation read shows "Could not read this receiver's PLUSD authorisation. Try again." with Retry, and nothing is signed.

---

## Story 6: Authorisation is re-checked at confirm

**Steps:**

1. Open the dialog for an authorised receiver.
2. Before confirming, make the receiver unauthorised (or let the LP relink to one that is).
3. Click confirm.

**Expected outcomes:**

- No transaction is built or signed. The dialog shows the notice for the new state with confirm disabled.

---

## Story 7: A minter `ReceiverNotAuthorized` trap has its own copy

**Expected outcomes:**

- If `record_wire_in` still traps with `Error(Contract, #15)`, the dialog shows "This receiver's PLUSD trustline is not authorised yet. The relayer authorises a KYB-passed lender's linked address automatically; try again in a few minutes." with the raw error in the details. A `#13` trap keeps "The receiver has no authorized PLUSD trustline."

---

## Automated coverage

- `packages/shared/tests/stellar_whitelist_candidates_sql.rs`: both candidate branches, KYT and Sumsub placement for all four toggle combinations, case-sensitive match, and the linked-address seeding SQL.
- `packages/worker/tests/stellar_whitelist.rs`: `G…` and `C…` holder encoding, rejection of garbage and muxed strkeys, and the `authorized` simulate classification including the exact `#13` match.
- `packages/trustee/src/routes/-LpBankDepositsSection.test.tsx`: the pre-flight on open and confirm, both notices, the capital-wallet wording, the failed read with Retry, a flip between open and confirm, and the `#15` copy.
