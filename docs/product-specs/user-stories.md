# User Stories

Testable user stories for the Pipeline protocol, grouped by user journey.

---

## LP Onboarding

### US-LP-ONBOARD-1: Happy Path Onboarding

**As an** accredited investor, **I want to** connect my Ethereum wallet and complete KYC/KYB and Chainalysis screening in a single flow, **so that** my wallet is automatically whitelisted and I can deposit USDC without waiting for manual review.

**Acceptance criteria:**
- [ ] Connecting a wallet via WalletConnect v2 / RainbowKit creates a Pipeline account with that address as the identifier — no separate email/password registration.
- [ ] Sumsub returns APPROVED and Chainalysis returns a clean result.
- [ ] The relayer service writes the LP address to the WhitelistRegistry with `approvedAt` set to the current block timestamp within one block of both vendor results arriving.
- [ ] The LP receives an in-app notification of approval.
- [ ] The deposit UI is unblocked immediately after whitelisting.
- [ ] No human review step is required.

---

### US-LP-ONBOARD-2: Manual Review Path

**As an** investor whose screening returned a non-binary result, **I want to** have my case reviewed by a compliance officer, **so that** I am not incorrectly rejected due to an ambiguous flag.

**Acceptance criteria:**
- [ ] If Sumsub returns FLAGGED or MANUAL_REVIEW, the LP enters the compliance review queue.
- [ ] If Chainalysis returns any status other than clean or REJECTED, the LP enters the compliance review queue.
- [ ] The compliance officer sees the LP's full Sumsub output, Chainalysis report, accreditation declaration, and the specific flag that triggered manual review.
- [ ] A single compliance officer (team member with compliance sub-role) can approve or reject the LP.
- [ ] On approval, the relayer service writes the LP to the WhitelistRegistry identically to the happy path.
- [ ] On rejection, the LP is notified with the reason.
- [ ] The compliance decision is recorded in the audit log with the deciding officer and outcome.

---

### US-LP-ONBOARD-3: Re-screening Gate

**As a** whitelisted LP whose 90-day Chainalysis freshness window has expired, **I want to** be prompted to re-screen before my next deposit, **so that** I understand why my deposit UI is blocked and can unblock it myself.

**Acceptance criteria:**
- [ ] When an LP initiates a deposit and `(block.timestamp - approvedAt) >= freshnessWindow`, the deposit UI is blocked and a re-verify prompt is shown.
- [ ] Triggering re-verification via the app initiates a fresh Chainalysis screen through the relayer service.
- [ ] On a clean result, `approvedAt` is refreshed on the WhitelistRegistry and the deposit UI is unblocked.
- [ ] On a failed or suspicious result, the LP's whitelist entry is flagged for manual compliance review and the deposit UI remains blocked.
- [ ] The `freshnessWindow` parameter (default 90 days) is configurable by the foundation multisig.

---

### US-LP-ONBOARD-4: Operator Account Activation

**As a** newly invited trustee or originator, **I want to** sign up with email + password + 2FA and have my account activated by two team members, **so that** I can access the Operations Console only after proper vetting.

**Acceptance criteria:**
- [ ] A team member issues an invitation specifying the invitee's work email and role (Trustee or Originator).
- [ ] The system emails a one-time signup link that expires after 72 hours.
- [ ] The invitee completes signup by entering their work email (must match the invited address), setting a password, and binding a TOTP or WebAuthn 2FA device.
- [ ] The account enters Pending Activation state until two distinct team members approve it.
- [ ] A single team member cannot provide both approvals; the inviter cannot count as one of the two approvers.
- [ ] On second approval, the account is activated and the operator receives an email confirmation.
- [ ] Every lifecycle event (invitation, signup, approval, activation) is recorded in the audit log.

---

## Deposits

### US-DEPOSIT-1: Standard Deposit

**As a** whitelisted LP with a current Chainalysis screen, **I want to** call `DepositManager.deposit(amount)` and receive PLUSD 1:1 in the same transaction, **so that** my deposit is atomic and does not depend on any off-chain signer.

**Acceptance criteria:**
- [ ] The LP calls `DepositManager.deposit(usdcAmount)` after approving DepositManager as spender on USDC (standard ERC-20 permit or prior `approve`).
- [ ] DepositManager atomically: checks `WhitelistRegistry.isAllowedForMint(lp)` (whitelist + Chainalysis freshness), enforces the per-LP, rolling-window, and total-supply caps, pulls USDC via `transferFrom(lp, capitalWallet, amount)`, and calls `PLUSD.mintForDeposit(lp, amount)`.
- [ ] The LP receives PLUSD at a 1:1 ratio to USDC deposited in the same transaction.
- [ ] Relayer is not in the deposit critical path: it observes `DepositManager.Deposited` events for reconciliation and indexing only, with no gating role on the deposit leg.
- [ ] The deposit appears in the LP's transaction history.

---

### US-DEPOSIT-2: Below-Minimum Accumulation

**As an** LP who deposits below the 1,000 USDC minimum, **I want to** have my partial deposits accumulated as a pending balance, **so that** I can unlock minting with a subsequent top-up rather than receiving a refund.

**Acceptance criteria:**
- [ ] A deposit below 1,000 USDC is not rejected; the relayer records an unminted balance for the LP address.
- [ ] The LP dashboard displays the accumulated pending balance labelled "pending deposits — not yet earning yield" and shows the additional amount required to reach the threshold.
- [ ] When cumulative pending deposits from the same address reach or exceed 1,000 USDC, the relayer mints PLUSD for the combined total in a single transaction.
- [ ] The pending balance counter resets to zero after the combined mint.
- [ ] The 1,000 USDC minimum is configurable by the foundation multisig.

---

### US-DEPOSIT-3: Rate-Limit Queue

**As an** LP whose deposit would breach the rolling 24h rate limit, **I want to** be queued automatically and receive PLUSD as headroom opens, **so that** I do not lose my deposit or have to resubmit.

**Acceptance criteria:**
- [ ] A deposit that would push total mints past the $10M / 24h window or $5M / tx cap is not rejected; the relayer records it in the deposit mint queue with `(lpAddress, amount, deposit_tx_hash, queued_at)`.
- [ ] The LP dashboard shows "PLUSD mint pending rate limit" status for the queued entry.
- [ ] As the rolling 24h window advances and headroom becomes available, the relayer processes queued entries in FIFO order, calling `PLUSD.mint()` for each.
- [ ] A single deposit exceeding the $5M per-transaction cap is split into multiple mint transactions over successive windows; the LP sees incremental PLUSD arrive.
- [ ] The relayer service reconstructs the queue from USDC Transfer logs and PLUSD mint logs after a restart.

---

### US-DEPOSIT-4: Above-Cap Split

**As an** LP depositing more than $5M USDC in a single transfer, **I want to** have my full deposit eventually minted across multiple transactions, **so that** the per-transaction cap does not result in a permanently unfulfilled balance.

**Acceptance criteria:**
- [ ] A single USDC transfer above the $5M per-transaction cap is placed into the deposit mint queue.
- [ ] The relayer splits the deposit into multiple mint calls, each at or below $5M, processed across successive rolling windows.
- [ ] The LP dashboard shows incremental PLUSD arrivals with status indicators for the remaining queued amount.
- [ ] The total PLUSD minted equals the total USDC deposited after all windows are processed.
- [ ] All partial mints are recorded individually in the LP's transaction history.

---

## Staking

### US-STAKE-1: Stake PLUSD into sPLUSD

**As an** LP holding PLUSD, **I want to** deposit PLUSD into the sPLUSD vault to receive yield-bearing shares, **so that** I earn yield from loan repayments and T-bill accrual.

**Acceptance criteria:**
- [ ] The LP approves the sPLUSD vault to spend PLUSD and calls `sPLUSD.deposit(assets, receiver)`.
- [ ] The vault computes shares using `assets * totalSupply / totalAssets` (or 1:1 on first deposit).
- [ ] sPLUSD shares are minted to the receiver address.
- [ ] `totalAssets()` returns `PLUSD.balanceOf(address(vault))` and increases when yield mints are made into the vault.
- [ ] The stake appears in the LP's transaction history.
- [ ] No whitelist check is applied at the sPLUSD vault level — any PLUSD holder may stake.

---

### US-STAKE-2: Unstake sPLUSD

**As an** LP holding sPLUSD, **I want to** redeem my shares for PLUSD at the current exchange rate, **so that** I receive the accumulated yield value of my position.

**Acceptance criteria:**
- [ ] The LP calls `sPLUSD.redeem(shares, receiver, owner)`; the vault burns the shares and transfers PLUSD to the receiver at the current exchange rate.
- [ ] The PLUSD transfer reverts if the receiver is not on the WhitelistRegistry (enforced at the PLUSD contract level, not the vault level).
- [ ] The LP receives more PLUSD than originally staked if yield has accrued since staking.
- [ ] Unstaking is available at any time; no lock-up or cooldown is enforced.
- [ ] The unstake appears in the LP's transaction history.

---

### US-STAKE-3: DeFi Composability (Non-LP Stakes)

**As a** third party who holds PLUSD acquired via an approved DeFi venue, **I want to** stake into the sPLUSD vault without going through Pipeline's KYC onboarding, **so that** I can earn yield on PLUSD I hold legitimately.

**Acceptance criteria:**
- [ ] Any address holding PLUSD (regardless of how it was acquired) can call `sPLUSD.deposit()` — the vault applies no whitelist check.
- [ ] The staker earns yield pro-rata alongside KYCed LPs.
- [ ] On redemption, the PLUSD transfer succeeds only if the receiver address is on the WhitelistRegistry (KYCed LP or approved DeFi venue); an unstake to a non-whitelisted address reverts.
- [ ] sPLUSD transfers are unrestricted — the vault token can move freely between any addresses.

---

## Loan Management

### US-LOAN-1: Origination Request Submission

**As an** originator, **I want to** submit a signed loan origination request through the Originator UI, **so that** the trustee can review and mint the loan on-chain without me holding any Ethereum signing keys.

**Acceptance criteria:**
- [ ] The originator enters immutable loan parameters (borrower identifier, commodity, corridor, facility size, senior/equity tranche split, tenor, governing law, optional metadata URI, initial location data) via the New origination form.
- [ ] On submit, the Originator UI builds an EIP-712 payload and signs it using the originator's authenticated session with 2FA confirmation — no wallet popup or on-chain transaction is required.
- [ ] The signed request is POSTed to the relayer service, validated, and given status `SubmittedAwaitingTrustee`.
- [ ] The request appears in the trustee's origination queue.
- [ ] If the signature is invalid, the request is rejected immediately and not surfaced to the trustee.
- [ ] The originator sees the request in "My Requests" with the current status.

---

### US-LOAN-2: Trustee Approval and Disbursement

**As a** trustee, **I want to** verify and approve an origination request and co-sign the resulting disbursement transaction, **so that** the borrower receives USDC only after proper dual-authority review.

**Acceptance criteria:**
- [ ] The trustee reviews the origination parameters in the trustee tooling (signature already validated by the relayer service).
- [ ] On approval, the trustee tooling broadcasts `LoanRegistry.mintLoan()` with the verified parameters; a LoanMinted event is emitted.
- [ ] The relayer service prepares the Capital Wallet outflow transaction in response to LoanMinted and surfaces it in the team signing queue.
- [ ] A team member provides their MPC signature; the trustee provides their MPC co-signature.
- [ ] On both signatures, USDC is wired to the borrower via the on-ramp provider.
- [ ] The originator's request status updates to `Approved` then `Disbursed`.
- [ ] On rejection, the originator sees the trustee's comment and may resubmit as a new request.

---

### US-LOAN-3: Lifecycle Update

**As a** trustee, **I want to** update mutable loan fields (status, maturity date, CCR, goods location) in response to operational events, **so that** the on-chain LoanRegistry reflects current loan state accurately.

**Acceptance criteria:**
- [ ] The trustee can call `updateMutable` directly from the Trustee key (holder of the `TRUSTEE` role on LoanRegistry; Relayer has no write access to LoanRegistry) to update: `status` (Performing ↔ Watchlist), `currentMaturityDate`, `lastReportedCCR` with timestamp, and `currentLocation` (LocationType, locationIdentifier, trackingURL).
- [ ] `updateMutable` reverts if `newStatus == Default`; default transitions require the Risk Council 3-of-5 multisig calling `setDefault`.
- [ ] CCR updates triggered by the price feed subsystem are also written via this path, batched on threshold crossings only.
- [ ] The updated fields are visible on Protocol Dashboard Panel B and the Originator's loan detail view immediately.
- [ ] Every `updateMutable` call is recorded in the audit log.

---

### US-LOAN-4: Loan Closure

**As a** trustee or Risk Council member, **I want to** close a loan with the appropriate closure reason, **so that** the LoanRegistry accurately reflects the final state of the facility.

**Acceptance criteria:**
- [ ] The Trustee (holder of `TRUSTEE` on LoanRegistry) can close a loan with `ClosureReason.ScheduledMaturity` or `ClosureReason.EarlyRepayment`.
- [ ] The Risk Council (`RISK_COUNCIL`, 3-of-5 multisig) can close a loan with `ClosureReason.Default` or `ClosureReason.OtherWriteDown`.
- [ ] A closed loan appears in Protocol Dashboard Panel B under historical loans with actual maturity date, closure reason, realised senior coupon, realised originator residual, and realised loss.
- [ ] No further `updateMutable` calls are permitted once a loan is in Closed status.

---

## Yield Distribution

### US-YIELD-1: Repayment Waterfall

**As a** trustee, **I want to** enter a borrower repayment and have the client-side application compute the full waterfall automatically, **so that** I can verify and sign the RepaymentSettled event with confidence.

**Acceptance criteria:**
- [ ] The trustee selects the loan from the LoanRegistry-backed loan picker and enters the repayment amount.
- [ ] The application computes all waterfall components: senior principal returned, senior gross interest, management fee, securitisation agent fee (zero in MVP), performance fee, senior coupon net, OET allocation, and originator residual.
- [ ] The trustee can adjust individual components if the actual transaction deviates (negotiated fee waiver, partial repayment, early repayment fee); deviations from the baseline are highlighted.
- [ ] On confirmation, the trustee signs the RepaymentSettled event (an EIP-712 attestation, not an on-chain transaction).
- [ ] The relayer service mints `PLUSD(sPLUSD vault, senior_coupon_net)` and `PLUSD(TreasuryWallet, management_fee + performance_fee + oet_allocation)`.

---

### US-YIELD-2: USYC Weekly Distribution

**As a** trustee, **I want to** review and sign the pre-built weekly TreasuryYieldDistributed transaction, **so that** T-bill yield is distributed to stakers and the Treasury Wallet each Thursday without manual computation.

**Acceptance criteria:**
- [ ] At the weekly reference time (Thursday end of day NY), the relayer pre-builds the TreasuryYieldDistributed transaction with: total accrued yield, vault share (70%), treasury share (30%), reference USYC NAV, USYC holding amount, and week-ending date.
- [ ] The pre-built transaction appears in the trustee tooling for review before any minting occurs.
- [ ] The trustee signs the transaction (a signed attestation); the relayer mints `PLUSD(sPLUSD vault, vault_share)` and `PLUSD(TreasuryWallet, treasury_share)`.
- [ ] The weekly distribution event appears in Protocol Dashboard Panel D as a discrete point in the T-bill yield time series.
- [ ] The real-time accrued T-bill yield counter resets to zero after the mint.

---

### US-YIELD-3: Reconciliation Invariant

**As a** protocol operator, **I want** the backing invariant to be evaluated automatically after every state-changing event and published to the protocol dashboard, **so that** any PLUSD under-backing is detected immediately.

**Acceptance criteria:**
- [ ] The relayer evaluates `PLUSD totalSupply == USDC in Capital Wallet + USYC NAV + USDC out on loans + USDC in transit` after each: yield distribution, deposit, loan disbursement, loan repayment, and LP withdrawal.
- [ ] The result is published to Protocol Dashboard Panel A with a green / amber / red indicator (green < 0.01%, amber 0.01%–1%, red > 1%).
- [ ] An amber or red state triggers an alert to the on-call channel and to the trustee.
- [ ] The invariant status and before/after values are recorded in the audit log for each evaluation.

---

### US-YIELD-4: USYC Rebalancing

**As a** protocol, **I want** idle capital to be automatically swept into USYC and redeemed back to USDC when the buffer falls below the lower band, **so that** the Capital Wallet earns T-bill yield on idle reserves without manual intervention.

**Acceptance criteria:**
- [ ] When USDC ratio exceeds 20%, the relayer automatically initiates a USDC → USYC swap to bring the ratio back to 15%.
- [ ] When USDC ratio falls below 10%, the relayer automatically initiates a USYC → USDC redemption to restore the ratio.
- [ ] Each automated swap is capped at $5M per transaction and $20M per day; amounts above either bound route to the team + trustee signing queue.
- [ ] Senior principal returned on loan repayment is automatically swept into USYC immediately after the RepaymentSettled mint.
- [ ] The trustee retains a manual override UI requiring trustee + team co-signature for swaps outside the automated rules.

---

## Withdrawals

### US-WITHDRAW-1: Standard Withdrawal

**As a** whitelisted LP, **I want to** unstake sPLUSD, escrow the resulting PLUSD into the withdrawal queue, and receive USDC automatically at my original deposit address, **so that** I can exit my position without human intervention.

**Acceptance criteria:**
- [ ] The LP calls `WithdrawalQueue.requestWithdrawal(amount)`; the contract checks the caller is on the WhitelistRegistry with a fresh screen, pulls PLUSD into escrow, assigns a `queue_id`, and emits `WithdrawalRequested`.
- [ ] The relayer evaluates fillability against the Capital Wallet's current USDC balance.
- [ ] If sufficient USDC is available, the relayer auto-signs the payout to the LP's original deposit address and calls `WithdrawalQueue.fillRequest(queue_id)`.
- [ ] `WithdrawalSettled` is emitted; PLUSD escrow is burned.
- [ ] The payout destination must exactly equal the address from which the LP originally deposited USDC; the MPC policy engine enforces this check.
- [ ] The fill is subject to the $5M per-transaction cap and $10M rolling-24h aggregate cap.

---

### US-WITHDRAW-2: Partial Fill

**As an** LP with a large withdrawal request, **I want to** receive USDC incrementally as liquidity arrives, **so that** I am not blocked waiting for a single large payout.

**Acceptance criteria:**
- [ ] If available USDC is insufficient for the full request, the relayer fills as much as the current USDC balance allows and reduces `amount_remaining` in the queue entry.
- [ ] A `WithdrawalPartiallyFilled(queue_id, amount_filled, amount_remaining)` event is emitted.
- [ ] The LP dashboard shows progressive fill status: `amount_filled`, `amount_remaining`, and status.
- [ ] The entry remains at the head of the queue; subsequent USDC inflows (from deposits, repayments, or USYC redemptions) continue to fill it.
- [ ] `WithdrawalSettled` is emitted only when `amount_remaining` reaches zero.

---

### US-WITHDRAW-3: Cancellation

**As an** LP with a pending withdrawal request, **I want to** cancel my request before it is filled, **so that** I recover my escrowed PLUSD and re-enter my position.

**Acceptance criteria:**
- [ ] The LP calls `cancelWithdrawal(queue_id)`; only the original requester may call this function.
- [ ] The remaining escrowed PLUSD (`amount_remaining`) is returned to the LP.
- [ ] Any amount already paid out via partial fills is final and is not reversed.
- [ ] The cancelled entry is removed from the queue.
- [ ] The cancellation appears in the LP's transaction history.

---

### US-WITHDRAW-4: Above-Envelope Manual Path

**As an** LP wishing to withdraw to a different address than the original deposit address, **I want** a manual review path to be available, **so that** my request is not permanently blocked even though it cannot be processed by the automated payout policy.

**Acceptance criteria:**
- [ ] An LP payout that fails the destination-match check (destination != original deposit address) is rejected at the MPC policy engine level; the automated path does not execute.
- [ ] The rejected transaction routes to the trustee + team signing queue for manual co-signature.
- [ ] The team member verifies the destination address is the LP's legitimate alternative address (identity verification process is out of scope for the contract but is enforced operationally).
- [ ] On trustee + team co-signature, the payout is executed to the verified alternative address.
- [ ] An alert is pushed to the 24/7 on-call channel for every automated payout above $1M.

---

## Operations

### US-OPS-1: Trustee Repayment Reconciliation

**As a** trustee, **I want to** identify an incoming USD wire, match it to a loan, compute the waterfall, and sign the RepaymentSettled event, **so that** yield is delivered on-chain and the senior principal is swept into USYC.

**Acceptance criteria:**
- [ ] The trustee identifies the `loan_id` using wire details, borrower communication, and the open loan ledger; the tooling displays all active loans from on-chain state.
- [ ] The trustee selects the loan, enters the repayment amount, and reviews the client-side-computed waterfall breakdown.
- [ ] The trustee adjusts any component and signs the RepaymentSettled event (EIP-712 attestation).
- [ ] The trustee instructs the on-ramp provider to convert the senior portion to USDC into the Capital Wallet.
- [ ] After the USDC inflow is confirmed, the relayer mints yield PLUSD and sweeps the senior principal return into USYC automatically.
- [ ] The full waterfall and the signed event are recorded in the audit log.

---

### US-OPS-2: Team Signing Queue

**As a** Pipeline team member, **I want to** review and co-sign pending cash-rail transactions (loan disbursements, Treasury redemptions, above-envelope payouts, above-envelope swaps) in a unified signing queue, **so that** no privileged transaction executes without my awareness and approval.

**Acceptance criteria:**
- [ ] The signing queue groups pending transactions by category (loan disbursement, Treasury redemption Stage A, Treasury redemption Stage B, above-envelope LP payout, above-envelope USDC ↔ USYC swap).
- [ ] For loan disbursements, the team member sees: loan ID, amount, destination (must be the on-ramp provider address).
- [ ] For Treasury redemptions, the team enforces that Operator A and Operator B are distinct authenticated sessions; the trustee provides a third co-signature.
- [ ] For Stage B Treasury redemptions, the destination bank account must be selected from the foundation-multisig-maintained pre-approved list; free-text entry is not permitted.
- [ ] Every signing action is recorded in the audit log with the signing team member's session identifier.

---

### US-OPS-3: Compliance Review

**As a** compliance officer (team member with compliance sub-role), **I want to** review flagged LP onboarding cases and make an approve/reject decision, **so that** ambiguous screening results are resolved by a human with full context rather than rejected automatically.

**Acceptance criteria:**
- [ ] Each queue entry shows: Sumsub output, Chainalysis report, accreditation declaration, wallet address, and the specific flag that triggered manual review.
- [ ] A single compliance officer can approve or reject; approval writes the LP to the WhitelistRegistry identically to the happy path.
- [ ] Genuinely complex cases can be escalated to a two-person review; the second reviewer must be a different team member.
- [ ] Rejected LPs receive a notification with the rejection reason.
- [ ] Every compliance decision (officer, evidence reviewed, outcome) is recorded in the audit log.

---

### US-OPS-4: Relayer Alert Response

**As an** on-call team member, **I want to** see real-time relayer alerts with severity, acknowledge them, and coordinate a foundation multisig pause if needed, **so that** incidents are tracked and responded to within the on-call SLA.

**Acceptance criteria:**
- [ ] The live alert stream displays events with severity (info / amber / red), timestamp, category, and originating event or transaction; the stream is filterable by severity and category.
- [ ] Amber and red reconciliation invariant drift trigger an alert to the on-call channel and to the trustee automatically.
- [ ] Every automated payout above $1M triggers an alert to the 24/7 on-call channel.
- [ ] A team member can acknowledge an alert, stopping repeat notifications; acknowledgement is recorded in the audit log but does not change any on-chain state.
- [ ] The team interface provides a button to notify all Risk Council members with context for emergency pause coordination; the team interface does not execute the pause itself.

---

## Dashboards

### US-DASHBOARD-1: LP Dashboard View

**As an** LP, **I want to** see my full position, yield earned, withdrawal request status, and transaction history in one place, **so that** I can monitor my investment without querying the blockchain directly.

**Acceptance criteria:**
- [ ] The dashboard displays: wallet address, KYC status, Chainalysis freshness days remaining.
- [ ] Current PLUSD and sPLUSD balances are shown with the live exchange rate and equivalent PLUSD value of the sPLUSD holding.
- [ ] Total deposited, total withdrawn, and net position are displayed.
- [ ] Yield earned is shown both as a nominal PLUSD figure and as a time-weighted annualised rate, computed from the cost basis of each stake lot.
- [ ] Active withdrawal requests show `queue_id`, original amount, `amount_filled`, `amount_remaining`, and current status.
- [ ] Transaction history includes all deposits, mints (with queue status where applicable), stakes, unstakes, withdrawal requests, partial fills, and settlements.

---

### US-DASHBOARD-2: Protocol Balance Sheet

**As a** protocol operator or LP, **I want to** see the full balance sheet of the Capital Wallet with the reconciliation indicator, **so that** I can verify that PLUSD is fully backed at all times.

**Acceptance criteria:**
- [ ] Panel A displays total PLUSD outstanding, total sPLUSD outstanding, and the current sPLUSD → PLUSD exchange rate.
- [ ] Capital Wallet contents are shown as separate lines: USDC balance, USYC units and current USD value (at issuer's NAV), USDC out on active loans, and USDC in transit.
- [ ] The current USDC ratio is displayed against the 15% target with upper (20%) and lower (10%) band indicators.
- [ ] The reconciliation indicator shows green / amber / red status based on invariant drift thresholds.
- [ ] All values update continuously without requiring a page refresh.

---

### US-DASHBOARD-3: Deployment Monitor

**As a** protocol operator or LP, **I want to** see per-loan details, aggregate portfolio metrics, and the real-time event log for each active loan, **so that** I have a complete picture of deployed capital and collateral health.

**Acceptance criteria:**
- [ ] Panel B displays each active loan with chain-sourced fields (loanId, originator, commodity, corridor, facility size, tranche split, status, CCR, location) and trustee-feed fields (outstanding principal, accrued interest, days remaining, equity tranche) clearly labelled by source.
- [ ] For vessel-located cargo, a link to an external maritime tracking platform is displayed.
- [ ] Closed loans appear in a historical section with actual maturity date, closure reason, realised coupon, realised residual, and realised loss.
- [ ] Aggregate metrics are displayed: total deployed, weighted average tenor, weighted average gross rate, commodity mix, corridor mix, originator concentration.
- [ ] The real-time event log per loan shows all price feed notifications and status transitions in chronological order.
