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

- **Approve** — the trustee broadcasts `LoanRegistry.mintLoan()` directly from the Trustee key (holder of the `TRUSTEE` role on LoanRegistry). The resulting LoanMinted event triggers the bridge's disbursement preparation on the Capital Wallet.
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

As the sole holder of the `TRUSTEE` role on LoanRegistry (signed directly by the Trustee
key, not relayed through Bridge), the trustee can:

- Transition loan status between Performing and Watchlist via `updateMutable`.
- Extend `currentMaturityDate`.
- Update `lastReportedCCR` following price feed threshold crossings or manual price-based review.
- Update `currentLocation` as cargo moves through the trade corridor (LocationType, locationIdentifier, optional trackingURL).
- Record a repayment split across Senior tranche (principal + interest) and Equity tranche via `recordRepayment` once the client-side waterfall is settled.
- Close a loan at scheduled maturity or early repayment via `closeLoan`.
- Escalate to the Risk Council for transitions to Default status or Closed-with-default-reason (which require the 3-of-5 `RISK_COUNCIL` role, not `TRUSTEE`).

### USYC Manual Override

The trustee has access to a manual USDC ↔ USYC swap UI as a backup path for cases outside the automated band-keeping rules. Manual swaps require Trustee + team co-signature via MPC regardless of amount and are not subject to the automated band limits.

For Team view, Originator view, and security considerations, see
[operations-console-team.md](./operations-console-team.md).
