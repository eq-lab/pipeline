# User Stories — Issue #676: Deposit activity row labels received amount as PLUSD

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#676](https://github.com/eq-lab/pipeline/issues/676)

A deposit burns USDC to mint PLUSD (1:1), so the amount the user *receives* is PLUSD. The Activity row previously labeled the received amount `+ xxx USDC`; it must read `+ xxx PLUSD`. Withdraw (which returns USDC) is unchanged.

---

## Story 1 — Completed deposit shows `+ xxx PLUSD` on the Activity page

**As a** user who has completed a deposit,
**I want** the Activity row to label the received amount as PLUSD,
**so that** the row reflects the token I actually received (PLUSD), not the USDC I paid in.

### Acceptance criteria

- On `/transactions`, a Completed Deposit row shows the received amount pill as `+ <amount> PLUSD`.
- The magnitude is unchanged from before (mint is 1:1), only the token label flips from USDC to PLUSD.

### How to test

1. Open the app in a browser and connect a wallet.
2. Seed/complete a Deposit request (e.g. via the Mocks tab or by completing a deposit flow).
3. Navigate to `/transactions`.
4. Verify the Deposit row's received pill reads `+ <amount> PLUSD` (not `USDC`).

---

## Story 2 — Pending deposit shows `+ xxx PLUSD`

**As a** user with a deposit still processing,
**I want** the pending Deposit row to also label the received amount as PLUSD,
**so that** the label is consistent across pending, verification-failed, and completed states.

### Acceptance criteria

- A Pending (or VerificationFailed) Deposit row shows the primary received amount as `+ <amount> PLUSD`.

### How to test

1. Seed a Deposit request that is in the Pending state.
2. Navigate to `/transactions`.
3. Verify the row's primary amount reads `+ <amount> PLUSD`.

---

## Story 3 — Home Recent Activity matches the Activity page

**As a** user on the home dashboard,
**I want** the Recent Activity card's Deposit row to show `+ xxx PLUSD`,
**so that** the home card and the full Activity page agree.

### Acceptance criteria

- The `RecentActivityCard` on the home dashboard shows the Deposit received amount as `+ <amount> PLUSD`.

### How to test

1. With a completed Deposit present, open the home dashboard.
2. Verify the Recent Activity Deposit row reads `+ <amount> PLUSD`.

---

## Story 4 — Withdraw still shows `+ xxx USDC` (regression guard)

**As a** user who has withdrawn,
**I want** the Withdraw row to keep showing the received amount as USDC,
**so that** the PLUSD label fix does not accidentally flip the withdraw leg (a withdraw burns PLUSD and returns USDC).

### Acceptance criteria

- A Withdraw row on `/transactions` and in the home Recent Activity card still shows `+ <amount> USDC`.

### How to test

1. Seed/complete a Withdraw request.
2. Navigate to `/transactions` and the home dashboard.
3. Verify the Withdraw row's received pill reads `+ <amount> USDC` (unchanged).
