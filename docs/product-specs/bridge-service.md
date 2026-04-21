# Bridge Service

## Overview

The Pipeline Bridge Service is a backend service operated by the Pipeline team. It is the protocol's sole automated actor on the cash rail and the sole holder of the MINTER role on PLUSD. The bridge connects on-chain token-rail events to off-chain cash-rail execution, maintains the on-chain WhitelistRegistry, and runs the price feed and notification subsystem that monitors active loans.

The bridge is designed so that its compromise does not enable a drain of investor capital. Its MPC permissions are narrowly scoped, counterparty addresses are pinned, and all automated envelopes are bounded.

---

## Behavior

### 1. On-Chain Event Listening

The bridge monitors the following on-chain events continuously:

- **USDC Transfer** into the Capital Wallet — triggers deposit eligibility checks and PLUSD mint (or deposit queue entry).
- **WithdrawalRequested** on the WithdrawalQueue — triggers automated LP payout evaluation.
- **LoanMinted** on the LoanRegistry — triggers loan disbursement transaction preparation.
- **RepaymentSettled** (trustee-signed, consumed by the bridge) — triggers yield minting and senior principal USYC sweep.
- **TreasuryYieldDistributed** (trustee-signed, consumed by the bridge) — triggers weekly yield minting.

On restart, the bridge rebuilds all in-memory state by replaying the relevant event logs from chain. No persistent queue state is required to survive a restart; the queue is a derivative of the log delta.

### 2. MPC Auto-Signing (Four Categories)

The bridge is an MPC participant on the Capital Wallet with auto-signing authority for exactly four transaction categories. All other Capital Wallet transactions require human co-signature from trustee and/or team.

| Category | Auto-signing condition | Bounds |
|---|---|---|
| USDC → USYC swap | USDC ratio exceeds upper band (20%) | $5M per tx, $20M daily aggregate |
| USYC → USDC redemption | USDC ratio falls below lower band (10%) | $5M per tx, $20M daily aggregate |
| LP withdrawal payout | Destination matches pinned original deposit address; LP is whitelisted with fresh screen | $5M per tx, $10M rolling 24h across all LP payouts |
| Loan disbursement preparation | LoanMinted event observed; transaction prepared for human co-signature (bridge does not auto-sign loan disbursements — it prepares them) | N/A (human signing required) |

Swaps above the automated bounds, LP payouts above the automated bounds, and all loan disbursements are routed to the team signing queue for trustee + team co-signature.

### 3. PLUSD Minting Authority

The bridge holds the sole MINTER role on PLUSD. It distinguishes two minting categories, tracked separately in the audit log:

**Deposit mints** — triggered by a USDC Transfer event into the Capital Wallet from a whitelisted LP address. The bridge runs four checks before minting: (a) lpAddress is whitelisted, (b) Chainalysis screen is within the 90-day freshness window, (c) deposit amount is at or above the $1,000 USDC minimum, (d) the rolling 24h rate limit ($10M) and per-tx cap ($5M) are not breached. On all checks passing, the bridge calls `PLUSD.mint(lpAddress, amount)`.

**Yield mints** — triggered by trustee-signed events:
- On RepaymentSettled: `PLUSD.mint(sPLUSDvault, senior_coupon_net)` and `PLUSD.mint(TreasuryWallet, management_fee + performance_fee + oet_allocation)`.
- On TreasuryYieldDistributed: `PLUSD.mint(sPLUSDvault, vault_share)` (70% of accrued T-bill yield) and `PLUSD.mint(TreasuryWallet, treasury_share)` (30%).

Both categories are subject to the same on-chain rate limit enforced at the PLUSD contract level.

### 4. Deposit Mint Queue

When a deposit mint would breach the rolling 24h rate limit or per-tx cap, the bridge does not reject the deposit. The USDC has already arrived in the Capital Wallet and the LP is entitled to PLUSD. The bridge instead enqueues the mint:

- Queue entries carry: (lpAddress, amount, deposit_tx_hash, queued_at).
- Queued mints are processed in FIFO order as headroom opens in the rolling 24h window.
- A single deposit exceeding the $5M per-tx cap is split into multiple mint transactions across successive windows.
- The queue has no on-chain state. On bridge restart, the queue is rebuilt by computing the delta between USDC Transfer events into the Capital Wallet and PLUSD mint events for each LP address.
- LP dashboard shows queued deposits with a "PLUSD mint pending rate limit" status and the expected processing window.

Below-minimum deposits (under $1,000 USDC) are accumulated per LP address as a pending top-up counter. When subsequent deposits from the same address bring the cumulative pending amount to or above $1,000 USDC, the bridge mints PLUSD for the combined total in a single transaction and resets the counter.

### 5. USDC → USYC Sweep on Repayment

After a RepaymentSettled event settles and the corresponding USDC inflow to the Capital Wallet is verified, the bridge automatically initiates a USDC → USYC conversion of the `senior_principal_returned` portion. This sweep is executed under the bridge's USDC ↔ USYC auto-signing permission. The senior principal begins earning T-bill yield immediately rather than sitting idle as USDC.

### 6. Weekly Yield Event Pre-Building

The bridge continuously reads the current USYC NAV from the issuer's published feed and maintains a running `accrued_yield` figure between weekly distribution events. This figure is informational and does not affect sPLUSD NAV until the weekly event fires.

At the weekly reference time (Thursday end of day, working assumption: 17:00 America/New_York or issuer NAV publication time, whichever is later), the bridge:

1. Computes `total_accrued_yield = USYC NAV appreciation since previous distribution × USYC holding amount`.
2. Pre-builds a TreasuryYieldDistributed transaction carrying: total_accrued_yield, vault_share (70%), treasury_share (30%), reference USYC NAV, holding amount, week_ending date.
3. Presents the pre-built transaction to the trustee tooling for review and signature.
4. On receipt of the trustee's EIP-712 attestation, executes the two yield mints.

The USYC holding itself is not redeemed during the weekly yield event.

### 7. WhitelistRegistry Maintenance

The bridge writes and revokes entries on the WhitelistRegistry in response to KYC and screening outcomes:

- On Sumsub APPROVED + Chainalysis clean result: calls `WhitelistRegistry.setAccess(lpAddress, currentBlockTimestamp)` immediately, without human review.
- On failed passive re-screen (Chainalysis freshness window expired and re-screen returns suspicious result): calls `WhitelistRegistry.revokeAccess(lpAddress)` and routes the LP to the compliance review queue.
- On a compliance officer's manual approval decision: calls `WhitelistRegistry.setAccess(lpAddress, approvedAt)` to write the LP to the whitelist.

### 8. Price Feed and Notification System

The bridge runs a subsystem that monitors every active loan in the LoanRegistry in real time:

- Polls Platts and Argus commodity reference prices on a configurable cadence (working assumption: every 15 minutes during market hours).
- For each active loan, computes CCR = collateral_value / outstanding_senior_principal in basis points, using current price, quantity from the trustee feed, commodity-specific haircut schedule, and current outstanding senior principal.
- On threshold crossings, triggers notifications to configured recipients and batches a `loan_manager` update to the LoanRegistry's `lastReportedCCR` field.

| Event | Trigger | Recipients |
|---|---|---|
| Watchlist | CCR falls below 130% | Team, Originator, Trustee |
| Maintenance margin call | CCR falls below 120% | Team, Originator, Borrower (via Originator), Trustee |
| Margin call | CCR falls below 110% | Team, Originator, Borrower, Trustee |
| Payment delay (amber) | Scheduled repayment > 7 days late | Team, Originator, Trustee |
| Payment delay (red) | Scheduled repayment > 21 days late | Team, Originator, Trustee |
| AIS blackout | Vessel tracking loss > 12 hours | Team, Originator, Trustee |
| CMA discrepancy | Reported collateral quantity differs from CMA by > 3% | Team, Originator, Trustee |
| Status transition | Any change to LoanRegistry mutable status field | Team, Originator, Trustee |

Delivery channels: in-app dashboard alerts, email, and optional Telegram/Slack webhooks configured per recipient. All events are also logged to the protocol dashboard's Panel B event feed.

### 9. Reconciliation Invariant Publishing

After every state-changing event (deposit, yield distribution, loan disbursement, repayment, LP withdrawal), the bridge evaluates and publishes the protocol's reconciliation invariant:

`PLUSD totalSupply == USDC in Capital Wallet + USYC NAV in Capital Wallet + USDC out on loans + USDC in transit`

The result is published to the protocol dashboard with a status indicator: green (drift < 0.01%), amber (0.01%–1%), red (> 1%). Amber and red states trigger an alert to the on-call channel and to the trustee.

---

## Role Assignments on Contracts

| Contract | Role | Held by |
|---|---|---|
| PLUSD | MINTER | Bridge service |
| PLUSD | PAUSER | Foundation multisig |
| sPLUSD | PAUSER | Foundation multisig |
| WhitelistRegistry | WHITELIST_ADMIN | Bridge service |
| WhitelistRegistry | DEFAULT_ADMIN | Foundation multisig |
| WithdrawalQueue | FILLER | Bridge service |
| WithdrawalQueue | PAUSER | Foundation multisig |
| LoanRegistry | loan_manager | Bridge service |
| LoanRegistry | risk_council | Risk Council 3-of-5 multisig |

---

## Security Considerations

**Narrow MPC permissions.** The MPC policy engine, not the bridge's software, enforces the four auto-signing categories. A compromised bridge cannot sign outside the pre-authorised patterns; exceptional transactions require human signatures.

**Pinned counterparty addresses.** For each auto-signed transaction type, the valid destination is either fixed (USYC issuer for swaps, on-ramp provider for disbursements) or derived from on-chain state (LP payout destination must equal the original deposit address from the bridge's pinned mapping). A compromised bridge cannot redirect funds to an attacker-controlled destination.

**Bounded automated envelopes.** Every auto-signed transaction type is bounded by per-transaction and rolling-aggregate caps enforced at the MPC policy level. The $10M/$5M caps on LP payouts and the $20M/$5M caps on USDC ↔ USYC swaps bound worst-case exposure within any single detection window.

**Token-rail bounds.** The MINTER role is bounded by on-chain rate limits at the PLUSD contract level. The FILLER role can only burn PLUSD that is already in queue escrow. The loan_manager role on LoanRegistry mints and mutations both require prior validation of a trustee-verified off-chain signed request.

**Key storage.** Bridge hot keys for on-chain transactions are stored in an HSM-backed KMS (AWS KMS / GCP KMS) with two-person operational access required for key rotation. The MPC key share is managed through the MPC vendor's key ceremony and is not stored on the bridge's hot infrastructure.

**Audit log.** Every bridge action is recorded in an append-only audit log mirrored in near-real-time to an independent third-party log sink. The bridge service cannot delete or modify historical entries.
