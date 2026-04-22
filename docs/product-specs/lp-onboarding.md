# LP Onboarding

## Overview

Pipeline has two distinct onboarding paths: wallet-based onboarding for LPs, and email-based onboarding for operators (Trustees, Originators, and Pipeline team members). Both paths converge on the same Operations Console backend, but they differ in authentication method, identity verification, and activation requirements.

LP onboarding is entirely off-chain except for a single on-chain write to the WhitelistRegistry upon approval.

---

## Behavior

### LP Wallet Onboarding

1. The LP connects an Ethereum wallet via WalletConnect v2 / RainbowKit. The connected wallet address is the LP's account identifier. There is no separate email or password registration. The LP signs a one-time message to bind the wallet to a Pipeline session; the wallet's own security model is the sole authentication factor. Pipeline does not require 2FA for LP accounts.

2. The LP completes Sumsub KYC/KYB: identity verification for individuals, or corporate document upload and UBO disclosure for entities.

3. The LP completes accreditation self-certification with documentary evidence: Reg D 506(c) for US persons, or Reg S attestation for non-US persons. Both exemptions permit PLUSD minting.

4. Chainalysis Address Screening checks the LP's connected wallet address against sanctions lists, mixers, and prohibited categories.

5. The bridge service evaluates the results automatically:
   - Sumsub APPROVED + Chainalysis clean result: the bridge immediately writes the LP address to the WhitelistRegistry with `approvedAt` set to the current block timestamp. No human review is required.
   - Either vendor returns REJECTED: the LP is notified with the rejection reason and cannot proceed.
   - Either vendor returns FLAGGED, MANUAL_REVIEW, or any other non-binary status: the LP enters the compliance review queue for manual resolution by a compliance officer (see Manual Compliance Review Queue below).

6. On approval, the LP receives an in-app notification and, if they provided one, an email. The `approvedAt` timestamp on the WhitelistRegistry is the authoritative reference for the re-screening freshness window.

### Chainalysis Re-Screening Freshness Window

- A wallet's Chainalysis screening result is valid for **90 days** from the last clean screen. This parameter is configurable by the foundation multisig via `WhitelistRegistry.freshnessWindow`.
- When an LP initiates a deposit, the frontend checks the on-chain `approvedAt` timestamp. If the 90-day window has expired, the deposit UI is blocked and the LP is prompted to re-verify.
- Re-verification triggers a fresh Chainalysis screen via the bridge service. On a clean result, `approvedAt` is refreshed. On a failed or suspicious result, the LP's whitelist entry is flagged for manual compliance review.
- The frontend freshness gate is a UX convenience; the authoritative check is enforced on-chain by the DepositManager contract (`isAllowedForMint`) at deposit time (see deposits spec).

### Passive Re-Screening and Revocation

The bridge service may initiate a Chainalysis screen against a whitelisted address outside of the deposit flow, for example as part of a scheduled batch re-screen of all active LPs. If a passive re-screen returns a failed or sanctioned result, the bridge service calls `WhitelistRegistry.revokeAccess(lpAddress)` immediately, removing the LP from the whitelist without waiting for their next deposit attempt. The LP's existing PLUSD holdings are unaffected by revocation, but further PLUSD mints and transfers to their address will revert.

### Manual Compliance Review Queue

The compliance review queue is reached only when automated screening returns a non-binary result.

- A single compliance officer (a team member with the compliance sub-role) reviews the LP's Sumsub output, Chainalysis report, accreditation declaration, connected wallet address, and the specific flag that triggered manual review.
- The compliance officer approves or rejects. Approval causes the bridge service to write the LP to the WhitelistRegistry as in the automated path. Rejection notifies the LP with the reason.
- For complex cases (PEPs, large entities with complex UBO chains), the reviewer may escalate to a two-person review requiring a second compliance officer.
- Every compliance decision is written to the audit log with the deciding officer, evidence reviewed, and outcome.

### Operator Account Onboarding (Trustees, Originators, Team)

Operators — Trustees, Originators, and Pipeline team members — authenticate via email, password, and 2FA. They do not use wallet connection.

1. **Invitation.** A team member issues an invitation specifying the invitee's work email and role (Trustee or Originator). The system generates a one-time signup link, valid for 72 hours, and emails it to the invitee.

2. **Signup.** The invitee opens the link, confirms their email, sets a password, and binds a 2FA authenticator (TOTP via Google Authenticator / Authy, or hardware key via WebAuthn/FIDO2). 2FA binding is mandatory. After signup, the account enters **Pending Activation** state.

3. **Two-person consensus activation.** The new account appears in the Pipeline team's operator approvals queue. At least two distinct team members must independently approve the account. The inviting team member cannot count as one of the two approvers. Only after both approvals does the account transition to **Active** and gain access to role-appropriate screens.

4. **Suspension and removal.** Any single team member can suspend an operator account immediately. Permanent removal requires two-person consensus, the same threshold as activation. Audit history for suspended or removed accounts is preserved indefinitely.

Team members themselves follow the same rules: any existing team member can invite a new team member; two-person consensus activates; one team member suspends; two-person consensus permanently removes.

---

## API Contract

### WhitelistRegistry

```solidity
function setAccess(address lp, uint256 approvedAt) external; // WHITELIST_ADMIN (bridge)
function revokeAccess(address lp) external;                  // WHITELIST_ADMIN or DEFAULT_ADMIN
function isAllowed(address lp) external view returns (bool); // returns true if whitelisted AND (block.timestamp - approvedAt) < freshnessWindow
function freshnessWindow() external view returns (uint256);  // default 90 days; set by DEFAULT_ADMIN
function addDeFiVenue(address venue) external;               // DEFAULT_ADMIN (foundation multisig)
```

`isAllowed` returns `true` only if the address is present in the registry **and** the freshness window has not elapsed. The freshness window is a storage variable configurable by the foundation multisig without a contract upgrade.

---

## Data Model

| Field | Type | Description |
|---|---|---|
| `lp` | `address` | Whitelisted LP or approved DeFi venue address |
| `approvedAt` | `uint256` | Block timestamp of the last clean Chainalysis screen |
| `freshnessWindow` | `uint256` | Maximum age of a clean screen before re-screening is required (default: 90 days in seconds) |

---

## Security Considerations

- The bridge service holds the `WHITELIST_ADMIN` role and is the only party that can write to the WhitelistRegistry in the normal path. The foundation multisig holds `DEFAULT_ADMIN` as the fallback admin.
- LP authentication relies entirely on wallet ownership. A compromised LP wallet grants an attacker the ability to initiate deposits and withdrawals to/from that address but not to any other address (the withdrawal destination-match check in the bridge enforces this).
- Operator accounts require 2FA, protecting against password-only credential compromise.
- The two-person consensus activation requirement means a single compromised team account cannot unilaterally introduce a rogue operator.
- Passive re-screening ensures that an LP whose wallet is subsequently sanctioned is removed from the whitelist without depending on the LP initiating another deposit.
