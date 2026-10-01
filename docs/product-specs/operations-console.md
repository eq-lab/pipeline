# Operations Console

## Overview

The Operations Console is the single web application through which the Pipeline Trust Company (Trustee), the Pipeline team, and the Loan Originator (Open Mineral) interact with the protocol. All three parties share the same backend and authentication infrastructure but see only the screens assigned to their role. The console has no Ethereum wallet connection requirement for operators — every on-chain effect is mediated by the relayer service or by MPC co-signature.

---

## Authentication

All operators authenticate by wallet signature, against the hand-maintained `auth_users` allow-list whose row carries their role. The key is the sole authentication factor; there is no separate 2FA binding, and the email-and-password credential is a lender's and carries no roles. See `lp-onboarding.md` § Operator Account Onboarding, including the open question about activation controls.

Operators do not auto-onboard. An operator exists because its key was added to the allow-list, which happens directly against the database — there is no admin endpoint and no self-serve path.

The lifecycle below was specified around an email signup that operators do not use. It is kept as the intended target, not as a description of today: only suspension is implemented, and a wallet credential leaves the rest without a mechanism. Treat it as an open design question.

- **Invite.** *(unimplemented; assumed an email signup.)* A team member issues an invitation specifying the invitee's work email and role, with a one-time signup link expiring after 72 hours.
- **Signup.** *(unimplemented; assumed an email signup.)* The invitee sets a password and binds a 2FA method, entering Pending Activation. Under a wallet credential there is nothing to bind — the key is the factor.
- **Activation.** *(unimplemented.)* Two distinct team members approving independently, the inviter not counting as one. This is the control worth preserving in whatever replaces the flow: today a single person with database access can mint an operator.
- **Suspension.** *Implemented* (Issue #1380). `accounts.status = 'Suspended'` is read on every authenticated request and refuses token issue, so a suspended operator stops on its next call. Which team member may set it is not modelled.
- **Permanent removal.** *(unimplemented.)* Would require two-person consensus, mirroring activation.

These rules apply to team member accounts as well: any existing team member can invite; two-person consensus activates; one team member suspends; two-person consensus permanently removes.

Every account lifecycle event is recorded in the append-only audit log.

---

## Role views

The Trustee action surface and its signing paths are in
[trustee-dashboard.md](./trustee-dashboard.md). The Team view, Originator view, and security
considerations are in [operations-console-team.md](./operations-console-team.md).
