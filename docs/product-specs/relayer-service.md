# Relayer Service

## Overview

The Pipeline Relayer Service is a backend operated by the Pipeline team. It watches on-chain
events, reconciles protocol state, co-signs yield attestations, and submits operational
transactions. **Relayer is not in the critical path for deposits** — deposits are atomic
user-driven calls to DepositManager. Relayer also has no role in loan disbursements or
USDC↔USYC rebalancing; those are managed by the Trustee and custodian MPC policy engine.

A Relayer compromise cannot produce unbacked PLUSD. Yield minting requires a second independent
EIP-1271 signature from the custodian; compromising Relayer alone mints zero PLUSD.

---

## Behavior

### 1. Deposit Observation (Relayer not in critical path)

Deposits are fully atomic and user-driven via DepositManager. Relayer observes
`DepositManager.Deposited` events for reconciliation, exposes deposit history via the LP API,
and cross-checks `sum(Deposited.amount) == PLUSD.cumulativeLPDeposits()`. Relayer is not a
signer or gate on the deposit flow.

Relayer also exposes live rate-limit state (`maxPerWindow`, `maxPerLPPerWindow`, window
utilisation, per-LP utilisation) via `GET /v1/protocol/limits` so the deposit UI can display
cap status before the LP submits.

### 2. Withdrawal Queue Funding

When a `WithdrawalRequested` event is observed, Relayer processes the queue head:

1. **Whitelist check.** If `WhitelistRegistry.isAllowed(requester)` is false, calls
   `WQ.skipSanctionedHead()` to unblock the queue.
2. **Freshness check (Relayer-side).** If stale but not revoked, Relayer calls Chainalysis API.
   On clean result: `WhitelistRegistry.refreshScreening(lp, newTs)`, then proceeds. On flag:
   `revokeAccess` then `skipSanctionedHead`. If Chainalysis is unreachable, Relayer halts and
   alerts ops — head is stuck pending manual `adminRelease`.
3. **Balance check.** If Capital Wallet USDC is insufficient, Relayer requests a USYC → USDC
   redemption via the custodian MPC API and retries after settlement.
4. **Fund.** Calls `WQ.fundRequest(queueId)`. WQ pulls USDC from Capital Wallet via
   pre-approved allowance. LP's entry moves to `Funded`; LP then calls `WQ.claim()` to burn
   PLUSD and receive USDC.

### 3. Yield Minting — Repayment

When a loan repayment USDC inflow is detected at the Capital Wallet:

1. Relayer presents the detected repayment to the Trustee via `GET /v1/trustee/repayments/pending`.
2. Trustee submits final split amounts via `POST /v1/trustee/repayments/{id}/approve`.
3. Relayer builds two `YieldAttestation` structs (vault leg and treasury leg) and signs each
   with the `relayerYieldAttestor` key:
   ```
   YieldAttestation {
     bytes32 repaymentRef;  // keccak256(chainId, repaymentTxHash, destinationTag)
     address destination;   // sPLUSD vault OR Treasury Wallet
     uint256 amount;
     uint64  deadline;
     uint256 salt;
   }
   ```
4. Relayer posts structs + Relayer sigs to the custodian's co-signing API (Fireblocks / BitGo).
   Custodian independently verifies the USDC inflow and returns EIP-1271 signatures.
5. Relayer calls `PLUSD.yieldMint(att, relayerSig, custodianSig)` for each leg via the
   transaction outbox. PLUSD verifies both signatures on-chain, checks the reserve invariant,
   and mints to destination.

Neither Relayer alone nor the custodian alone can mint yield — both sigs plus YIELD_MINTER
caller role are required.

### 4. Yield Minting — USYC (Lazy, Stake/Unstake-Triggered)

USYC NAV accrues continuously. To keep sPLUSD share price current without a time-based cron,
yield is minted **lazily** on every sPLUSD `Deposit` or `Withdraw` event:

1. Relayer reads current USYC NAV from the Hashnote API.
2. Computes `yield_delta = current_NAV - last_minted_NAV` (applied to Capital Wallet USYC
   holdings). If `delta <= 0`, skip.
3. If `delta > 0`: builds two `YieldAttestation` structs (vault + treasury), gets Relayer sig
   + custodian co-sig (same flow as repayment), submits both `yieldMint` calls.
4. Advances `last_minted_NAV` baseline only after both legs confirm on-chain.

Between mints, Relayer polls USYC NAV (e.g., every minute) and exposes
accrued-but-undistributed yield via `GET /v1/vault/stats` for dashboard display.

### 5. WhitelistRegistry Maintenance

- **On Sumsub APPROVED + Chainalysis clean result:** `WhitelistRegistry.setAccess(lp, ts)`.
- **On failed passive re-screen:** `revokeAccess(lp)`, route to compliance review queue.
- **On manual compliance approval:** `setAccess(lp, approvedAt)`.
- **Periodic batch re-screen:** `refreshScreening(lp, newTs)` for each LP on a configurable
  cadence to maintain freshness.

### 6. Price Feed and CCR Monitoring

Relayer monitors every active loan in the LoanRegistry, polling Platts/Argus commodity prices
on a configurable cadence (working assumption: every 15 minutes during market hours). Computes
CCR = collateral_value / outstanding_senior_principal in basis points. On threshold crossings,
notifies recipients and queues a `LoanRegistry.updateMutable` call to update `lastReportedCCR`.

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
| LoanRegistry | `LoanMinted / LoanUpdated / LoanClosed` | Loan book mirror |
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

Relayer holds: **YIELD_MINTER** (PLUSD), **FUNDER** (WithdrawalQueue), **WHITELIST_ADMIN**
(WhitelistRegistry).

Relayer has **no role on LoanRegistry** — loan NFT writes are done by the Trustee key directly.
Relayer **does not sign loan disbursements** — Trustee + Team co-sign on Capital Wallet.
Relayer **does not manage the USDC↔USYC ratio** — custodian MPC policy engine and Trustee
manage the band; Relayer only requests a USYC redemption when Capital Wallet USDC is
insufficient at withdrawal funding time.

---

## Security Considerations

**Two-party yield attestation.** Yield minting requires Relayer ECDSA sig + custodian EIP-1271
sig + YIELD_MINTER caller role. Relayer alone cannot mint yield PLUSD.

**Narrow on-chain roles.** FUNDER can only trigger WQ pulls for existing queue entries;
WHITELIST_ADMIN cannot mint; YIELD_MINTER still requires custodian co-sig.

**Deposit path is Relayer-free.** A complete Relayer compromise does not stop deposits or allow
unbacked deposit-leg mints.

**Key storage.** Relayer hot keys (on-chain caller) are held in a hardware-isolated KMS
with per-call authorisation and full audit logging. The `relayerYieldAttestor` key (yield
EIP-712 signing) is held in a separate air-gapped signer with no internet egress and is
exercised only via the co-signing flow defined in the yield-attestation sections above.
MPC key shares for cash-rail actions are managed through the custodian vendor's key
ceremony.

**Audit log.** Every relayer action is recorded in an append-only log mirrored to an
independent third-party sink. Relayer cannot delete or modify historical entries.
