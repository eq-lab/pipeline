# Operations Console

## Overview

The Operations Console is the single web application through which the Pipeline Trust Company (Trustee), the Pipeline team, and the Loan Originator (Open Mineral) interact with the protocol. All three parties share the same backend and authentication infrastructure but see only the screens assigned to their role. The console has no Ethereum wallet connection requirement for operators — every on-chain effect is mediated by the relayer service or by MPC co-signature.

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

## Role views

The Trustee action surface and its signing paths are in
[trustee-dashboard.md](./trustee-dashboard.md). The Team view, Originator view, and security
considerations are in [operations-console-team.md](./operations-console-team.md).
