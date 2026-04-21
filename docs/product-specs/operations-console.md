# Operations Console

## Overview

The Operations Console is the single web application through which the Pipeline Trust Company (Trustee), the Pipeline team, and the Loan Originator (Open Mineral) interact with the protocol. All three parties share the same backend and authentication infrastructure but see only the screens assigned to their role. The console has no Ethereum wallet connection requirement for operators — every on-chain effect is mediated by the bridge service or by MPC co-signature.

---

## Authentication

All operators authenticate via email + password + TOTP/WebAuthn 2FA. 2FA binding is mandatory; an account cannot be activated without it. Acceptable 2FA methods: TOTP via authenticator app (Google Authenticator, Authy) or hardware security key (WebAuthn / FIDO2).

Operators do not auto-onboard. Each operator account is created by an invited user and then activated by Pipeline team consensus before it can take any privileged action:

- **Invite.** A team member issues an invitation specifying the invitee's work email and role. The system generates a one-time signup link (72-hour expiry) and emails it to the invitee.
- **Signup.** The invitee sets a password and binds a 2FA method. The account enters Pending Activation state.
- **Activation.** Two distinct team members must independently approve the account. The inviter cannot count as one of the two approvers. On the second approval, the account is activated.
- **Suspension.** A single team member can suspend an account immediately (e.g., suspected compromise, staff offboarding). Suspended accounts cannot log in; their audit history is preserved indefinitely.
- **Permanent removal.** Requires two-person team consensus, mirroring the activation requirement.

These rules apply to team member accounts as well: any existing team member can invite; two-person consensus activates; one team member suspends; two-person consensus permanently removes.

Every account lifecycle event is recorded in the append-only audit log.

---

## Trustee View

The Trustee view is accessible only to accounts holding the Trustee role. It covers four functional areas.

### Origination Queue

The trustee receives origination requests submitted by the Originator. For each request the trustee sees: the full set of immutable loan parameters submitted by the Originator, the Originator's EIP-712 signature (already validated by the bridge service), and the submission timestamp.

The trustee takes one of three actions:

- **Approve** — the trustee tooling calls `LoanRegistry.mintLoan()` via the bridge service (using the loan_manager role). The resulting LoanMinted event triggers the bridge's disbursement preparation.
- **Request changes** — the trustee adds a comment; the request status becomes ChangesRequested and the Originator is notified.
- **Reject** — the trustee adds a rejection reason; the request status becomes Rejected and the Originator is notified.

### Repayment Reconciliation

The trustee manually identifies incoming USD wire transfers from borrowers against open loans. The workflow:

1. Trustee selects the loan from the LoanRegistry-backed loan picker (all active loans are listed with their on-chain identity and mutable lifecycle state).
2. Trustee enters the repayment amount received and, optionally, the repayment date if different from today.
3. The console computes the full waterfall client-side using immutable loan parameters from the LoanRegistry, current lifecycle state, the protocol-wide fee schedule, the actual tenor, and the entered amount:

| Component | Formula |
|---|---|
| senior_principal_returned | min(amount, outstanding_senior_principal) |
| senior_gross_interest | tenor × senior_rate × senior_deployed |
| management_fee | senior_deployed × mgmt_rate × (tenor / 365) |
| securitisation_agent_fee | 0 (inactive in MVP) |
| performance_fee | (senior_gross_interest − management_fee) × perf_rate |
| senior_coupon_net | senior_gross_interest − management_fee − performance_fee |
| oet_allocation | senior_deployed × oet_rate × (tenor / 365) |
| originator_residual | amount − senior_principal_returned − senior_coupon_net − fees − oet_allocation |

4. The trustee reviews the breakdown. Deviations from the computed baseline (e.g., negotiated fee waivers, partial repayments, early repayment fees) are highlighted. The trustee can adjust individual components.
5. The trustee signs the RepaymentSettled event (an EIP-712 attestation, not an on-chain transaction). This signature is the trigger for the bridge service to execute on-chain yield delivery and the senior principal USYC sweep.

### Weekly Yield Signing

Each Thursday, the bridge service pre-builds a TreasuryYieldDistributed transaction and presents it in the trustee tooling. The trustee sees: total accrued USYC yield since the previous distribution, vault share (70%), treasury share (30%), reference USYC NAV, holding amount, and expected on-chain mint amounts. The trustee signs the pre-built transaction (EIP-712 attestation). On receipt of the signature, the bridge executes the two yield mints. The trustee does not compute any values manually; the entire transaction is pre-built.

### LoanRegistry Lifecycle Updates

Using the loan_manager role (exercised via the bridge service), the trustee can:

- Transition loan status between Performing and Watchlist via `updateMutable`.
- Extend `currentMaturityDate`.
- Update `lastReportedCCR` following price feed threshold crossings or manual price-based review.
- Update `currentLocation` as cargo moves through the trade corridor (LocationType, locationIdentifier, optional trackingURL).
- Close a loan at scheduled maturity or early repayment via `closeLoan`.
- Escalate to the Risk Council for transitions to Default status or Closed-with-default-reason (which require the 3-of-5 risk_council role, not the loan_manager role).

### USYC Manual Override

The trustee has access to a manual USDC ↔ USYC swap UI as a backup path for cases outside the automated band-keeping rules. Manual swaps require Trustee + team co-signature via MPC regardless of amount and are not subject to the automated band limits.

---

## Team View

The Team view is accessible only to accounts holding the Team role. It covers five functional areas.

### Signing Queue

A unified queue of pending cash-rail transactions requiring team co-signature. Filterable by category:

- **Loan disbursements.** The bridge prepares the Capital Wallet outflow in response to a LoanMinted event. The team member reviews loan ID, amount, and destination (on-ramp provider address) before providing their MPC signature. Trustee MPC signature is required in parallel.
- **Treasury redemption Stage A (PLUSD → USDC).** Team operator A initiates; team operator B independently verifies and confirms; trustee co-signs via MPC. The console enforces that A and B are different authenticated sessions.
- **Treasury redemption Stage B (USDC → bank).** Mirrors Stage A authorisation chain. Destination is selected from the foundation-multisig-maintained pre-approved bank account list; free-text entry is not permitted.
- **Above-envelope LP payouts.** LP payouts exceeding $5M per-tx or $10M rolling 24h route here for trustee + team co-signature. The team member verifies destination (must be the LP's original deposit address), amount, and originating queue_id.
- **Above-envelope USDC ↔ USYC swaps.** Swaps exceeding $5M per-tx or $20M daily aggregate route here for trustee + team co-signature.

The two-operator disjoint rule for Treasury redemptions is enforced by the console backend: each step is bound to a distinct authenticated session, preventing a single operator from fulfilling both roles.

### Compliance Review Queue

Reached when LP onboarding returned an ambiguous screening result (Sumsub or Chainalysis returned FLAGGED, MANUAL_REVIEW, or another non-binary status). For each queue entry the reviewer sees: Sumsub output, Chainalysis report, accreditation declaration, connected wallet address, and the specific flag triggering manual review.

- **Single-reviewer decision.** A compliance officer (team member with the compliance sub-role) can approve or reject. Approval causes the bridge to write the LP address to the WhitelistRegistry; rejection notifies the LP with a reason.
- **Escalation.** Reviewers can escalate complex cases to a two-person review. The second reviewer must be a different team member.

Every compliance decision is recorded in the audit log with the deciding officer, evidence reviewed, and outcome.

### Bridge Alerts Feed

A real-time chronological feed of bridge service events: rate-limit hits, mint or payout alerts (threshold: any single mint or payout >= $1M), reconciliation invariant drift (amber/red), failed screening checks during deposits, and unusual activity patterns. Each alert carries severity (info / amber / red), timestamp, category, and originating event or transaction.

Team members can acknowledge alerts (stopping repeat notifications) and add resolution notes. Acknowledgement does not change on-chain state.

For incidents warranting a foundation multisig pause over PLUSD, sPLUSD, or the WithdrawalQueue, the console provides a coordination button that notifies all Risk Council members with context. Risk Council members sign the Safe pause transaction independently; the team interface does not execute the pause.

### Operational Monitoring

Read-only dashboards for day-to-day operational awareness:

- **Protocol health.** Reconciliation invariant status, Capital Wallet USDC ratio vs target band, withdrawal queue depth, oldest pending withdrawal age, active loan count.
- **Signing queue depth.** Count of pending MPC transactions per category, with SLA indicators for transactions open longer than the operational threshold.
- **Operator activity.** Recent logins, recent privileged actions by trustees and originators, recent account lifecycle changes.

### Operator Account Management

Team members manage all operator accounts (team, trustee, originator) from this view.

- **Invite new operator.** Fields: invitee email, role, optional sub-role, optional note. Generates a one-time signup link (72-hour expiry).
- **Pending activations queue.** Lists accounts in Pending Activation state. Shows invitee email, role, invitation date, signup date (if completed), and approvers so far. After two distinct team members approve, the account activates automatically. The inviter cannot be one of the two approvers.
- **Active operators view.** Lists all active accounts with role, last login, and status. Single-click Suspend for immediate suspension.
- **Removal requests.** Permanent removal requires two-person team consensus. Initiator creates the request; a second team member approves.

---

## Originator View

The Originator view is accessible only to accounts holding the Originator role. Originators have no Ethereum signing keys and no MPC key shares; all on-chain effects are mediated by the trustee tooling.

### New Origination Request

The Originator submits new loan origination requests through a structured form:

1. Originator enters immutable loan parameters: borrower identifier, commodity, corridor, original facility size, senior/equity tranche split, tenor, governing law, optional metadata URI, and initial location data (LocationType, identifier, optional tracking URL).
2. On submit, the console builds the canonical EIP-712 payload covering all immutable parameters and requests an off-chain signature bound to the Originator's authenticated session. This is not an on-chain transaction and produces no wallet popup; the signature is confirmed via 2FA.
3. The signed request is submitted to the bridge service, which validates the signature deterministically. A valid request is recorded as SubmittedAwaitingTrustee and surfaced in the trustee's origination queue. An invalid signature is rejected immediately and not forwarded to the trustee.
4. If the trustee requests changes, the Originator sees the comment and may resubmit a revised request as a new submission.

### My Requests View

Lists every origination request the Originator has submitted, with the following statuses:

- **SubmittedAwaitingTrustee** — signed and submitted, awaiting trustee review.
- **ChangesRequested** — trustee has flagged required changes; comment shown, Originator can revise and resubmit.
- **Rejected** — trustee declined; comment shown, no further action possible on this request.
- **Approved** — trustee has approved and broadcast the LoanRegistry mint; corresponding loanId shown with link to loan detail.
- **Disbursed** — disbursement co-signature has settled and USDC has been wired to the borrower.

Each entry shows submission timestamp, current status, last-updated timestamp, submitted parameters, and loanId once minted.

### My Loans Portfolio

Lists every loan facility minted with this Originator's address. Reads loan identity and lifecycle state from the LoanRegistry on-chain. Reads outstanding principal, accrued interest, and days remaining from the trustee feed. Filterable by status (Performing / Watchlist / Default / Closed) and by commodity, corridor, or borrower.

Each loan detail view displays the full immutable and mutable LoanRegistry state, the price feed event log for that loan (watchlist triggers, margin call notifications, payment delays, AIS blackouts, status transitions), and the repayment history reconstructed from RepaymentSettled events filtered by loanId.

### Statistics Panel

A single-page summary of portfolio performance scoped to loans where originator equals this account's address:

| Metric | Source |
|---|---|
| Active loans count | LoanRegistry (status != Closed) |
| Aggregate outstanding senior principal | Trustee feed |
| Lifetime loans originated | LoanRegistry |
| Lifetime volume originated | LoanRegistry (originalFacilitySize sum) |
| Weighted average tenor | LoanRegistry (closed loans) |
| Weighted average gross rate | RepaymentSettled events |
| Default count and realised loss | LoanRegistry + RepaymentSettled |
| Concentration view | LoanRegistry (by commodity, corridor, borrower) |
| Equity tranche outstanding | LoanRegistry + trustee feed |
| Lifetime residual yield earned | RepaymentSettled events (originator_residual) |

### Notifications

Originators receive notifications for events on their own loans only, delivered via in-app banner plus optional email and Slack webhook. The notification feed is a chronological log filterable by event type (watchlist, maintenance margin call, margin call, payment delay amber/red, AIS blackout, CMA discrepancy, status transition) with acknowledge / mark-read controls. Acknowledgement does not change on-chain state.

---

## Security Considerations

- All operators authenticate via email + password + TOTP/WebAuthn 2FA. No operator holds an Ethereum signing key outside their MPC participation.
- Two-person team consensus is required to activate any new operator account (team, trustee, or originator). A single team member can suspend; two-person consensus is required for permanent removal.
- The Originator's EIP-712 signature on an origination request covers only the immutable parameters. It does not authorise any cash-rail action; the LoanRegistry mint is a trustee transaction.
- Treasury redemption stages A and B each enforce a two-operator disjoint rule at the session level. The team console backend prevents a single operator from fulfilling both roles.
- Stage B destination selection is restricted to a foundation-multisig-maintained pre-approved bank account list; operators cannot enter free-text destinations.
- Every privileged action in the console (login, signing-queue action, invitation, activation approval, suspension, compliance decision, alert acknowledgement, origination submission) is recorded in the append-only audit log.
- The Originator API enforces read scoping: an Originator account can query only loans where originator equals its own address.
