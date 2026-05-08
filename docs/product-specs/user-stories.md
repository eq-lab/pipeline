# User Stories

Testable user stories for the Pipeline protocol, grouped by user journey.

---

## LP Onboarding

### US-LP-ONBOARD-1: Deposit-Triggered Whitelist Enrolment (Happy Path)

**As a** new lender, **I want to** connect my wallet, deposit USDC, and have my address auto-enrolled in the transfer whitelist on a clean KYT result, **so that** I can claim PLUSD without a separate identity-verification step.

**Acceptance criteria:**
- [ ] Connecting a wallet via WalletConnect v2 or RainbowKit creates a Pipeline session with that address as the identifier. No email or password registration.
- [ ] The lender approves USDC and calls `DepositManager.deposit(amount)`. USDC moves to the Intake Wallet, a `Pending` ticket is created.
- [ ] The Relayer runs KYT screening on the lender address and the inbound transaction off-chain.
- [ ] On a clean KYT result, the Relayer signs a `ClaimAttestation` (EIP-712 against DepositManager's domain) and serves it via `GET /v1/deposits/{depositId}/attestation`. The Relayer makes no on-chain write to DepositManager.
- [ ] The frontend fetches the attestation. The lender calls `DepositManager.claim(depositId, attestation, signature)`.
- [ ] DepositManager verifies the signature against `kytAttestor`, calls `WhitelistRegistry.setAccess(lender, att.approvedAt)` to enrol the lender, pulls USDC from Intake to Capital, and mints PLUSD 1:1.
- [ ] No KYC, KYB, or accreditation declaration is collected.

---

### US-LP-ONBOARD-2: Standalone Address Enrolment

**As a** counterparty (CEX hot wallet, OTC desk, treasury operator), **I want to** be added to the transfer whitelist without making my own deposit, **so that** I can receive PLUSD from another whitelisted address.

**Acceptance criteria:**
- [ ] The counterparty submits their address through the standalone enrolment endpoint, signing an enrolment message to prove control of the address.
- [ ] The Relayer runs address-only KYT screening (no transaction screening, no funds move).
- [ ] On a clean KYT result, the Relayer signs an `EnrolAttestation` (EIP-712 against WhitelistRegistry's domain) and returns it via the API.
- [ ] The address holder calls `WhitelistRegistry.enrol(addr, attestation, signature)` themselves to land the entry on-chain.
- [ ] On a non-binary result, the entry routes to the manual compliance queue.
- [ ] On a hard fail, no attestation is signed. The address is rejected and notified with a reason.
- [ ] No funds move on this path.

---

### US-LP-ONBOARD-3: Manual Compliance Review Path

**As a** lender or counterparty whose KYT returned a non-binary result, **I want to** have my case reviewed by a compliance officer, **so that** I am not incorrectly rejected due to an ambiguous flag.

**Acceptance criteria:**
- [ ] On a soft-fail KYT result for a deposit, the Relayer signs no attestation and routes the ticket to the compliance queue. The ticket stays `Pending` on-chain.
- [ ] On a soft-fail KYT result for a standalone enrolment, the entry appears in the compliance queue.
- [ ] On a soft-fail KYT result for passive re-screening, the existing whitelist entry appears in the compliance queue.
- [ ] The compliance officer sees the KYT report (address risk, transaction risk, hop analysis), the relevant deposit ticket or enrolment record, and the specific flag triggering review.
- [ ] A single compliance officer can approve, reject, or escalate to two-person review.
- [ ] On approval for a deposit, the Relayer signs and serves a `ClaimAttestation`. On approval for a standalone enrolment, the Relayer signs and serves an `EnrolAttestation`. The address holder submits the attestation on-chain themselves.
- [ ] On rejection, the Relayer triggers refund disposition for deposits, or no-enrolment for standalone, and notifies the holder.
- [ ] Every decision is logged with the officer, evidence reviewed, and outcome.

---

### US-LP-ONBOARD-4: Re-screening Freshness Gate

**As a** whitelisted holder whose 90-day freshness window has expired, **I want to** be prompted to re-screen before my next transfer or withdrawal, **so that** I understand why my action is blocked and can unblock it myself.

**Acceptance criteria:**
- [ ] When `(block.timestamp - approvedAt) >= freshnessWindow`, `WhitelistRegistry.isAllowed(addr)` returns false.
- [ ] PLUSD `_update` reverts on transfers to or from a stale address.
- [ ] `WithdrawalQueue.requestWithdrawal` reverts at the PLUSD transfer to escrow.
- [ ] The frontend prompts re-enrolment via the standalone enrolment endpoint.
- [ ] On a clean KYT result, `approvedAt` is refreshed via `setAccess` and the address is unblocked.
- [ ] On a failed result, the entry is flagged for manual compliance review.
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

### US-DEPOSIT-1: Two-Step Screened Deposit (Happy Path)

**As a** lender, **I want to** call `DepositManager.deposit(amount)` to park USDC and create a deposit ticket, then call `DepositManager.claim(depositId, attestation, signature)` with the Relayer's KYT attestation, **so that** my USDC is screened before PLUSD is minted, without me providing identity documents and without the Relayer writing on-chain to DepositManager.

**Acceptance criteria:**
- [ ] The lender calls `USDC.approve(DepositManager, amount)` then `DepositManager.deposit(usdcAmount)`.
- [ ] DepositManager enforces minimum deposit, per-lender 24h cap, global 24h cap, and `totalSupply + outstandingTickets + amount <= maxTotalSupply` at deposit time.
- [ ] DepositManager calls `USDC.transferFrom(lender, intakeWallet, amount)` to park USDC in the Intake Wallet.
- [ ] DepositManager creates a ticket `(lender, depositId, {amount, status: Pending, createdAt})` and emits `DepositRequested`.
- [ ] The Relayer runs KYT screening off-chain. On a clean result, it signs a `ClaimAttestation` and serves it via `GET /v1/deposits/{depositId}/attestation`. No on-chain write.
- [ ] The lender calls `DepositManager.claim(depositId, attestation, signature)`. The contract verifies signature against `kytAttestor`, checks attestation fields and nonce, calls `WhitelistRegistry.setAccess(lender, att.approvedAt)`, pulls USDC from Intake to Capital, calls `PLUSD.mintForDeposit(lender, amount)`.
- [ ] The lender's PLUSD balance rises 1:1 with the USDC deposited. The ticket flips to `Claimed`. The nonce is consumed.
- [ ] PLUSD is never minted without the lender's USDC having arrived in the Intake Wallet first.
- [ ] The Relayer never writes to DepositManager directly in the happy path.
- [ ] The deposit appears in the lender's transaction history (DepositRequested, Deposited events).

---

### US-DEPOSIT-2: Below-Minimum Revert

**As a** lender who calls `deposit` with less than the configured minimum, **I want to** have my deposit reverted on-chain, **so that** I am not left with USDC parked in the Intake Wallet for an amount that cannot be claimed.

**Acceptance criteria:**
- [ ] `DepositManager.deposit(amount)` reverts with a `BelowMinimum` error if `amount < minimumDeposit` (default 1,000 USDC).
- [ ] No state changes occur on revert. USDC stays in the lender's wallet.
- [ ] The `minimumDeposit` parameter is configurable by ADMIN under 48h timelock.
- [ ] The deposit UI shows the minimum and prevents submission below it.

---

### US-DEPOSIT-3: Rate-Limit Revert

**As a** lender whose deposit would breach a rate limit, **I want to** have my deposit revert on-chain, **so that** I retry when headroom reopens rather than getting stuck in an off-chain queue.

**Acceptance criteria:**
- [ ] A deposit that would push the rolling 24h window above `maxPerWindow` or `maxPerLPPerWindow` reverts.
- [ ] A deposit that would push `totalSupply + outstandingClaimable + amount` above `maxTotalSupply` reverts.
- [ ] No state changes on revert. USDC stays in the lender's wallet.
- [ ] The deposit UI reads `GET /v1/protocol/limits` and shows live utilisation against each cap before the lender submits.
- [ ] The lender retries when window headroom reopens. There is no auto-queue.

---

### US-DEPOSIT-4: Abandoned Ticket Refund

**As a** lender who deposited and received a `Claimable` ticket but did not claim within the 30-day window, **I want to** call `refund(depositId)` to retrieve my USDC, **so that** my abandoned deposit does not stay parked indefinitely in the Intake Wallet.

**Acceptance criteria:**
- [ ] A ticket reaches expiry when `block.timestamp - markedAt >= claimWindow` (default 30 days).
- [ ] The lender calls `DepositManager.refund(depositId)` from their own address.
- [ ] DepositManager pulls USDC from the Intake Wallet to the lender via standing allowance.
- [ ] The ticket flips to `Refunded` and `outstandingClaimable` decrements.
- [ ] After expiry, calls to `claim(depositId)` revert with `TicketExpired`.
- [ ] The Trustee may also bulk-refund expired tickets quarterly to clean state.

---

### US-DEPOSIT-5: KYT Soft-Fail Refund

**As a** lender whose deposit triggered a soft-fail KYT result, **I want to** receive an automatic refund within 72 hours unless compliance overrides, **so that** I am not stuck with USDC in the Intake Wallet for an indefinite manual review.

**Acceptance criteria:**
- [ ] On a soft-fail KYT result, the Relayer routes the ticket to the compliance review queue. The Relayer signs no claim attestation. The ticket stays `Pending` on-chain.
- [ ] The default disposition is auto-refund within 72h. The Trustee + Team co-sign a USDC transfer from the Intake Wallet to the lender's address (off-chain). After settlement, the Trustee calls `DepositManager.markRefunded(lender, depositId)`.
- [ ] The ticket flips to `Refunded` and `outstandingTickets` decrements.
- [ ] Compliance can override the default outcome and approve. On override, the Relayer signs and serves a `ClaimAttestation` for the lender to submit, completing the claim flow as in the happy path.

---

### US-DEPOSIT-6: KYT Hard-Fail Hold

**As a** lender whose deposit triggered a hard-fail KYT result (OFAC, sanctioned address), **I want to** have my ticket held pending Trustee disposition, **so that** sanctions-exposed funds are not automatically returned to a sanctioned address.

**Acceptance criteria:**
- [ ] On a hard-fail KYT result, the Relayer signs no attestation. The ticket stays `Pending` on-chain indefinitely.
- [ ] The lender cannot claim (no valid attestation). The lender cannot use `refund` (the 30-day timer continues running but Trustee may halt the standard refund path).
- [ ] Disposition is by Trustee under legal direction. Trustee may bring USDC out of the Intake Wallet and call `markRefunded` to flip the ticket only if legally permitted to return funds.
- [ ] The lender is notified that their deposit is held pending review.

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
- [ ] Each queue entry shows: KYT report (address risk, transaction risk, hop analysis), connected wallet address, deposit ticket reference if applicable, and the specific flag that triggered manual review.
- [ ] A single compliance officer can approve or reject. Approval triggers Relayer signing of a `ClaimAttestation` (for a deposit) or `EnrolAttestation` (for a standalone enrolment) which the address holder then submits on-chain.
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
- [ ] The dashboard displays: wallet address, whitelist status, freshness days remaining (until re-enrolment is required).
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
