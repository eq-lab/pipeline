# Relayer Service

## Overview

The Pipeline Relayer Service is a backend operated by the Pipeline team. It watches on-chain events, reconciles protocol state, signs yield attestations and KYT attestations off-chain, and submits a narrow set of operational transactions. **Relayer never writes state-flips on DepositManager or WithdrawalQueue.** It signs off-chain `ClaimAttestation` and `EnrolAttestation` payloads that the lender or address holder submits at claim or enrol time. A Relayer compromise cannot mint PLUSD on its own. Yield minting also requires a custodian EIP-1271 signature.

---

## Behavior

### 1. Deposit Observation

Relayer observes `DepositManager.DepositRequested` and `Deposited` events for reconciliation, exposes deposit history via the LP API, and cross-checks `sum(Deposited.amount) == PLUSD.cumulativeLPDeposits()`. Relayer is not a state-mutator on the deposit flow. Relayer exposes live rate-limit state (`maxPerWindow`, `maxPerLenderPerWindow`, window
utilisation, per-LP utilisation) via `GET /v1/protocol/limits` so the deposit UI can display
cap status before the LP submits.

### 1b. Deposit Claim Attestation

When a `DepositRequested` event is observed, Relayer:

1. Runs KYT screening on the lender address and the inbound USDC transaction via the configured KYT vendor.
2. **On clean result.** Builds and signs an EIP-712 `ClaimAttestation` for the deposit (DepositManager's domain). Stores the signed attestation in the Relayer's API store and serves it via `GET /v1/deposits/{depositId}/attestation`. The Relayer makes no on-chain write.
3. **On soft fail.** Routes the ticket to the compliance review queue (see operations-console-team.md). No attestation is signed. If compliance approves, the Relayer signs and serves the attestation. If compliance rejects, the Trustee + Team co-sign the off-chain refund, and Trustee calls `DepositManager.markRefunded` to flip the ticket on-chain.
4. **On hard fail.** No attestation. Ticket stays `Pending` indefinitely. Trustee disposition is off-chain under legal direction.

Attestations carry a short deadline (default 1 hour). If the lender does not claim before the deadline, the frontend re-fetches a fresh attestation from the API. The Relayer re-runs KYT or returns the cached fresh result depending on the configured cadence.

If the KYT vendor is unreachable, Relayer halts attestation signing and alerts ops. Tickets stay `Pending` until the vendor is restored. PLUSD is never minted without a valid attestation submitted by the lender to `claim`.

### 2. Withdrawal Claim Attestation and Wallet Monitoring

The Relayer signs withdrawal claim attestations on the same pattern as deposits. When a `WithdrawalRequested` event is observed:

1. Runs KYT screening on the holder address.
2. **On clean result.** Signs an EIP-712 `ClaimAttestation` for the queue entry (WithdrawalQueue's domain). Serves via `GET /v1/withdrawals/{queueId}/attestation`. No on-chain write.
3. **On soft fail.** Routes to compliance review.
4. **On hard fail.** No attestation. ADMIN takes disposition via `adminRelease`.

Beyond claim attestations, Relayer monitors the Withdrawal Queue Wallet:

1. **Balance monitoring.** Relayer tracks `WithdrawalQueue.totalClaimable` against the Withdrawal Queue Wallet's USDC balance. When the buffer thins below an operational threshold, Relayer signals the Trustee to initiate a top-up.
2. **Passive sanctions re-screening.** Relayer runs scheduled re-screening against whitelisted addresses. On a sanctions hit landing on a lender with one or more `Pending` queue entries or `Pending` deposit tickets, Relayer calls `WhitelistRegistry.revokeAccess(lender)` directly. This is the narrow on-chain action retained by the Relayer (a defensive action that needs to land fast). The lender's subsequent claim attempts fail at the queue's `isAllowed` re-check, and the Relayer also stops issuing fresh attestations for the holder. _Chain-specific mechanism:_ on Stellar the equivalent on-chain action is `access_manager.execute(set_authorized(addr, false))` against the PLUSD SAC (see `docs/design-docs/multi-chain-kyc-sharding.md::Stellar Relayer Whitelist`). Revocation is currently EVM-only; Stellar Phase 3 only adds, matching the rest of the relayer's behaviour.
3. **Vendor-down handling.** If the KYT vendor is unreachable during scheduled re-screening, Relayer halts revocation calls until the vendor is restored. Existing whitelist entries that were valid before the outage stay valid until their freshness window expires.

Relayer does NOT call `requestWithdrawal`, does NOT call `claim`, and does NOT fund queue entries. All three are user-pulled by the lender themselves.

### 3. Yield Minting — Repayment

When a loan repayment USDC inflow is detected at the Capital Wallet:

1. Relayer presents the detected repayment to the Trustee via `GET /v1/trustee/repayments/pending`.
2. Trustee submits final split amounts via `POST /v1/trustee/repayments/{id}/approve` and
   broadcasts `LoanRegistry.recordPayment` from the Trustee key, crediting the per-loan
   counters. This must land before any loan-tied mint, because the YieldMinter cap reads
   those counters.
3. Relayer reads the new counters and builds one `LoanYieldAttestation` per leg, each bound
   to `loanId`, signing each with the `relayerYieldAttestor` key:
   ```
   LoanYieldAttestation {
     bytes32 repaymentRef;  // keccak256(chainId, repaymentTxHash, loanId, leg)
     uint256 loanId;
     uint8   leg;           // Vault OR Treasury
     address destination;   // sPLUSD vault OR Treasury Wallet (bound to leg)
     uint256 amount;
     uint64  deadline;
     uint256 salt;
   }
   ```
4. Relayer posts structs + Relayer sigs to the custodian's co-signing API (Fireblocks / BitGo).
   Custodian independently verifies the USDC inflow and returns EIP-1271 signatures.
5. Relayer calls `YieldMinter.mintLoanYield(att, relayerSig, custodianSig)` for each leg via
   the transaction outbox. YieldMinter verifies both signatures, enforces the per-loan cap
   (Vault leg `<= min(seniorInterestRecorded, ceiling(loanId))`, Treasury leg `<=` recorded
   fees), asserts the PLUSD ledger invariant, and mints to the leg-bound destination.

Neither Relayer alone nor the custodian alone can mint yield — both sigs plus YieldMinter
holding the YIELD_MINTER role are required.

### 4. Yield Minting — USYC (Lazy, Stake/Unstake-Triggered)

USYC NAV accrues continuously. To keep sPLUSD share price current without a time-based cron,
yield is minted **lazily** on every sPLUSD `Deposit` or `Withdraw` event:

1. Relayer reads current USYC NAV from the Hashnote API.
2. Computes `yield_delta = current_NAV - last_minted_NAV` (applied to Capital Wallet USYC
   holdings). If `delta <= 0`, skip.
3. If `delta > 0`: builds two `TbillYieldAttestation` structs (vault + treasury), gets
   Relayer sig + custodian co-sig (same flow as repayment), submits both
   `YieldMinter.mintTbillYield` calls. These carry no `loanId` and no per-loan cap; replay is
   gated by `usedTbillRefs[navRef]`.
4. Advances `last_minted_NAV` baseline only after both legs confirm on-chain.

Between mints, Relayer polls USYC NAV (e.g., every minute) and exposes
accrued-but-undistributed yield via `GET /v1/vault/stats` for dashboard display.

### 5. WhitelistRegistry Maintenance

- **On clean KYT (deposit-triggered):** Relayer signs a `ClaimAttestation`. The lender calls `DepositManager.claim`, which internally calls `WhitelistRegistry.setAccess` to enrol the lender as a side effect.
- **On clean KYT (standalone enrolment):** Relayer signs an `EnrolAttestation`. The address holder calls `WhitelistRegistry.enrol(addr, att, sig)` themselves.
- **On failed passive re-screen:** Relayer calls `revokeAccess(addr)` directly under the `WHITELIST_REVOKER` role. Any in-flight deposit ticket or queue entry routes to compliance review queue.
- **On manual compliance approval:** Relayer signs the appropriate attestation (claim or enrol) and serves it via API. The address holder submits on-chain.
- **Periodic batch re-screen:** For freshness maintenance, the Relayer offers fresh `EnrolAttestation` payloads through the standalone enrolment endpoint. Holders refresh by calling `enrol` again with the new attestation. There is no Relayer-direct refresh path.

### 6. Price Feed and CCR Monitoring

Relayer monitors every active loan in the LoanRegistry, polling Platts/Argus commodity prices
on a configurable cadence (working assumption: every 15 minutes during market hours). Computes
CCR = collateral_value / outstanding_senior_principal in basis points. On threshold crossings,
notifies recipients and queues a `LoanRegistry.updateMutable` call to update `ccrBps`.

| Event | Trigger | Recipients |
|---|---|---|
| Watchlist | CCR < 130% | Team, Originator, Trustee |
| Maintenance margin call | CCR < 120% | Team, Originator, Borrower, Trustee |
| Margin call | CCR < 110% | Team, Originator, Borrower, Trustee |
| Payment delay (amber) | Repayment > 7 days late | Team, Originator, Trustee |
| Payment delay (red) | Repayment > 21 days late | Team, Originator, Trustee |
| AIS blackout | Vessel tracking loss > 12h | Team, Originator, Trustee |
| CMA discrepancy | Reported collateral > 3% from CMA | Team, Originator, Trustee |
| Status transition | Any LoanRegistry mutable status change | Team, Originator, Trustee |

### 7. Reserve Reconciliation

After every state-changing event, Relayer evaluates and publishes the full backing invariant:

```
PLUSD totalSupply  ==  USDC in Capital Wallet
                     +  USYC NAV in Capital Wallet
                     +  USDC out on active loans
                     +  USDC in transit
```

| Drift | Status | Action |
|---|---|---|
| < 0.01% | Green | Normal |
| 0.01%–1% | Amber | Alert on-call + Trustee |
| > 1% | Red | Page on-call + Trustee; consider pausing DepositManager |

---

## On-Chain Events Monitored

| Contract | Event | Purpose |
|---|---|---|
| DepositManager | `Deposited(lp, amount)` | Reconciliation; deposit history for LP API |
| USDC | `Transfer(*, capitalWallet, amount)` | Repayment inflow classification |
| PLUSD | `Transfer(0x0, lp, amount)` | Mint cross-check vs DepositManager.Deposited |
| WithdrawalQueue | `WithdrawalRequested` | Flow 2 trigger |
| WithdrawalQueue | `WithdrawalFunded / WithdrawalClaimed / WithdrawalSanctionedSkip / WithdrawalAdminReleased` | Status tracking |
| sPLUSD | `Deposit / Withdraw` | Trigger lazy USYC yield |
| LoanRegistry | `LoanMinted / LoanStatusChanged / LoanRolledOver / PaymentRecorded / LoanClosed` | Loan book mirror |
| PLUSD | `RateLimitsChanged / MaxTotalSupplyChanged` | Update local cache |
| WhitelistRegistry | `LPApproved / ScreeningRefreshed / LPRevoked` | Whitelist sync |
| ShutdownController | `ShutdownEntered` | Halt all normal flows |
| All pausable | `Paused() / Unpaused()` | Halt/resume flows |

---

## Service Decomposition

For the internal architecture diagram and blast-radius analysis per service, see
[relayer-service-internals.md](./relayer-service-internals.md).

---

## Role Assignments on Contracts

Relayer holds: **WHITELIST_REVOKER** (WhitelistRegistry, narrow defensive role). The Relayer also holds the `kytAttestor` signing key, which is referenced as a configured address on DepositManager, WithdrawalQueue, and WhitelistRegistry (not a role grant). The yield-attestation key (`relayerYieldAttestor`) is similarly referenced by YieldMinter as a signing-key address, not a role grant.

Relayer **does not write `setAccess`, `markClaimable`, or any other state-flip on DepositManager or WithdrawalQueue**. Enrolment lands via DepositManager.claim (auto-enrol side effect) or via the address holder calling `enrol` with an off-chain attestation. Claims land via the lender submitting an off-chain attestation.

Relayer has **no role on LoanRegistry**. Loan NFT writes are done by the Trustee key directly.
Relayer **does not sign loan disbursements**. Trustee + Team co-sign on Capital Wallet.
Relayer **does not manage the USDC/USYC ratio**. Custody MPC policy and Trustee manage the band. Relayer only signals the Trustee when Withdrawal Queue Wallet headroom is thin.
Relayer **does not fund withdrawals**. The Withdrawal Queue Wallet is topped up by Trustee + Team out-of-band.

---

## Security Considerations

**Two-party yield attestation.** Yield minting requires Relayer ECDSA sig + custodian EIP-1271 sig + the YieldMinter contract holding YIELD_MINTER on PLUSD. Relayer alone cannot mint yield PLUSD.

**Single-party deposit and withdrawal attestation.** `kytAttestor` signs `ClaimAttestation` and `EnrolAttestation` payloads off-chain. The lender submits the attestation at claim or enrol time. The contract verifies the signature against the configured `kytAttestor` address. A compromised key can sign valid attestations for any depositId, queueId, or address, but cannot bypass the underlying state requirements (a deposit ticket or queue entry must already exist, or for enrolment the address holder must submit).

**Narrow on-chain role.** `WHITELIST_REVOKER` allows direct `revokeAccess`. This is a defensive action for fast sanctions response. It cannot mint, cannot enrol, cannot affect deposit or withdrawal claims directly. GUARDIAN can revoke this role instantly.

**Relayer compromise is bounded to KYT bypass.** A compromised Relayer can sign valid attestations and revoke arbitrary whitelist entries. Neither action mints PLUSD on its own. PLUSD is only minted when the lender calls `claim` against their own deposited USDC. Whitelist enrolment lands only when DepositManager.claim succeeds (against a real ticket and attestation) or when the address holder themselves submits `enrol`. The risk is AML (illicit USDC entering the Capital Wallet via a bypassed KYT, illicit addresses gaining transfer eligibility), not direct theft. PLUSD remains 1:1 backed in every state.

**Key storage.** Relayer hot keys (on-chain caller) are held in a hardware-isolated KMS
with per-call authorisation and full audit logging. The `relayerYieldAttestor` key (yield
EIP-712 signing) is held in a separate air-gapped signer with no internet egress and is
exercised only via the co-signing flow defined in the yield-attestation sections above.
MPC key shares for cash-rail actions are managed through the custodian vendor's key
ceremony.

**Audit log.** Every relayer action is recorded in an append-only log mirrored to an
independent third-party sink. Relayer cannot delete or modify historical entries.
