# LP Onboarding

## Overview

Pipeline has two onboarding paths. Lenders authenticate by wallet and earn whitelist eligibility through compliance screening on transactions or addresses. Operators (Trustees, Originators, Pipeline team) authenticate by email with 2FA and require two-person consensus to activate. Both paths converge on the Operations Console backend.

Lender onboarding does not require KYC, KYB, or accreditation declarations. Compliance is enforced by KYT screening on deposit transactions (per `deposits.md`), on standalone address enrolments, and on PLUSD transfers via the `WhitelistRegistry` `_update` gate. The legal framework that governs this approach is `[Framework: TBD]`.

The Relayer never writes whitelist enrolments to `WhitelistRegistry` directly. It signs an off-chain `EnrolAttestation` after running KYT, and the address holder (or DepositManager during a claim) submits the attestation on-chain. The Relayer retains direct call rights only on `revokeAccess`, which is a defensive action that needs to land fast on a sanctions hit.

---

## Behavior

### Lender Wallet Authentication

The lender connects an Ethereum wallet via WalletConnect v2 or RainbowKit. The connected address is the lender's account identifier. There is no email or password registration. The lender signs a one-time message to bind the wallet to a Pipeline session. The wallet's own security model is the sole authentication factor. Pipeline does not require 2FA for lender accounts.

### Three Paths to the Transfer Whitelist

`WhitelistRegistry` gates PLUSD transfers via `PLUSD._update`. A lender (or any address that wants to hold PLUSD) must be on the whitelist to send or receive. There are three paths to enrolment.

**Path 1: deposit-triggered enrolment (default lender path).**

A lender deposits USDC via `DepositManager.deposit` (see `deposits.md`). The Relayer runs KYT and, on a clean result, signs a `ClaimAttestation`. The lender calls `DepositManager.claim(depositId, attestation, sig)`. Inside the claim, DepositManager calls `WhitelistRegistry.setAccess(lender, att.approvedAt)` (DepositManager holds `WHITELIST_ADMIN`). The lender is now whitelisted as a side effect of a successful claim, just before the PLUSD mint runs (so `_update` passes on the mint to the lender).

**Path 2: standalone address enrolment.**

A counterparty wants to hold PLUSD without depositing first (a CEX hot wallet receiving PLUSD from an OTC trade, an OTC desk that needs a settlement address, a treasury operator preparing to receive a transfer). The counterparty submits their address through the standalone enrolment endpoint. The Relayer runs address-only KYT against sanctions and risk lists. On a clean result, the Relayer signs an `EnrolAttestation` and serves it via API. The counterparty calls `WhitelistRegistry.enrol(addr, attestation, sig)` themselves. The contract verifies the signature against the configured `kytAttestor` address, checks the deadline and nonce, and writes `setAccess(addr, att.approvedAt)`.

No funds move on this path. It is a screening of the address only, with the on-chain write performed by the address holder (or anyone, since the attestation already binds the result to the address).

**Path 3: DeFi venue admin-add.**

DEX pools, lending markets, and other DeFi venues that need to hold PLUSD as part of protocol mechanics are added by governance. The foundation multisig calls `WhitelistRegistry.addDeFiVenue(venueAddr)`. This path bypasses KYT because the address is a contract, not a user. Each addition is a discrete governance action with audit trail.

### Enrol Attestation Format

```solidity
struct EnrolAttestation {
    bytes32 actionId;       // keccak256(abi.encode(chainId, contract, "enrol", addr))
    address holder;
    uint64  approvedAt;
    uint64  deadline;
    bytes32 nonce;
}
```

EIP-712 domain is the WhitelistRegistry contract's domain. Same shape as `ClaimAttestation` minus the amount field (no value transfer on this path).

### Re-Screening Freshness Window

A whitelist entry is valid for **90 days** from `approvedAt`. The freshness window is configured by the foundation multisig via `WhitelistRegistry.freshnessWindow`. On `PLUSD._update`, the registry returns `isAllowed = (entry exists) && (block.timestamp - approvedAt < freshnessWindow)`. An entry past the window blocks transfers to or from the address until refreshed.

**Refreshes on path 1 (deposit).** A lender depositing inside the freshness window has their `approvedAt` refreshed automatically when DepositManager calls `setAccess` during `claim`. Active depositors stay fresh without doing anything.

**Refreshes on path 2 (standalone).** The address holder re-submits through the standalone enrolment endpoint. Address-only KYT runs again. On a clean result, the Relayer signs a fresh `EnrolAttestation`, and the holder calls `enrol` again with it. The new entry overwrites `approvedAt`.

**Refreshes on path 3 (DeFi venues).** Venues do not expire. Governance adds and removes them explicitly.

The frontend displays freshness status to the connected lender and prompts re-enrolment before the window closes.

### Passive Re-Screening and Revocation

The Relayer runs scheduled batch re-screening against all whitelisted addresses. If a passive screen returns a sanctions hit or a hard-fail KYT result, the Relayer calls `WhitelistRegistry.revokeAccess(addr)` directly. This is the narrow on-chain action retained by the Relayer (a defensive action that needs to land fast). PLUSD already held by the address is not seized, but further transfers to or from the address revert at `PLUSD._update`.

Any in-flight `Pending` deposit ticket associated with the revoked address becomes effectively unclaimable (the Relayer stops issuing claim attestations) and is escalated to manual compliance review for refund or freeze disposition.

Any in-flight `Pending` queue entry on `WithdrawalQueue` for the revoked address fails at the `isAllowed` re-check inside `claim`. ADMIN takes disposition via `adminRelease`.

### Manual Compliance Review

The compliance review queue is reached when KYT returns a non-binary result (soft-fail on a deposit, soft-fail on a standalone enrolment, or a soft-fail on passive re-screening of an existing entry).

A compliance officer (a team member with the compliance sub-role) reviews the KYT report, the connected wallet address, the specific flag that triggered review, and any associated deposit ticket. The officer approves or rejects. Approval results in the Relayer signing the appropriate attestation (claim attestation for a stuck deposit, enrol attestation for a standalone enrolment) and serving it via API. The address holder then submits the attestation on-chain themselves. Rejection results in no signature and triggers refund (for soft-fail deposits, via Trustee + Team off-chain transfer plus `markRefunded`) or no-enrolment (for standalone).

Complex cases (PEPs, large entities with complex UBO chains, high-confidence indirect-exposure flags) escalate to two-person review. Every decision is written to the audit log with the deciding officer, evidence reviewed, KYT reason codes, and outcome.

### What we cannot serve

- Addresses on OFAC or equivalent sanctions lists.
- Jurisdictions Pipeline cannot legally serve under `[Framework: TBD]`. The list is maintained on `legal.md`.

### Operator Account Onboarding (Trustees, Originators, Team)

Operators authenticate via email, password, and 2FA. They do not use wallet connection.

1. **Invitation.** A team member issues an invitation specifying the invitee's work email and role. The system generates a one-time signup link, valid for 72 hours, and emails it to the invitee.
2. **Signup.** The invitee opens the link, confirms their email, sets a password, and binds a 2FA authenticator (TOTP via Google Authenticator or Authy, or hardware key via WebAuthn or FIDO2). 2FA binding is mandatory. After signup, the account enters **Pending Activation**.
3. **Two-person consensus activation.** The new account appears in the Pipeline team's operator approvals queue. At least two distinct team members must independently approve. The inviting team member cannot count as one of the two. Only after both approvals does the account transition to **Active**.
4. **Suspension and removal.** Any single team member can suspend an operator account immediately. Permanent removal requires two-person consensus. Audit history for suspended or removed accounts is preserved indefinitely.

Team members themselves follow the same rules. Any existing team member can invite a new team member, two-person consensus activates, one member suspends, two-person consensus permanently removes.

---

## API Contract

### WhitelistRegistry

```solidity
interface IWhitelistRegistry {
    /// @notice Standalone enrolment via an off-chain attestation.
    /// @dev Verifies sig against kytAttestor. Anyone can submit if they have a valid attestation.
    function enrol(address addr, EnrolAttestation calldata att, bytes calldata sig) external;

    /// @notice Used by DepositManager during claim to enrol the depositor.
    /// @dev Restricted to WHITELIST_ADMIN role (held by DepositManager proxy).
    function setAccess(address addr, uint256 approvedAt) external;

    /// @notice Direct revoke for sanctions response.
    /// @dev Restricted to WHITELIST_REVOKER role (held by Relayer EOA) or DEFAULT_ADMIN.
    function revokeAccess(address addr) external;

    function addDeFiVenue(address venue) external;       // DEFAULT_ADMIN
    function removeDeFiVenue(address venue) external;    // DEFAULT_ADMIN

    function isAllowed(address addr) external view returns (bool);
    // Returns true if entry exists AND (block.timestamp - approvedAt < freshnessWindow).
    // DeFi venues bypass the freshness check.

    function freshnessWindow() external view returns (uint256);
    function setFreshnessWindow(uint256 newWindow) external;  // DEFAULT_ADMIN
    function setKytAttestor(address newAttestor) external;    // DEFAULT_ADMIN, 48h-delayed
    function isNonceUsed(bytes32 nonce) external view returns (bool);
}
```

`isAllowed` is the only function `PLUSD._update` calls.

The role split is deliberate. `setAccess` is contract-only (DepositManager during claim) for the deposit-enrolment side effect. `enrol` is anyone-with-attestation for standalone enrolment. `revokeAccess` is Relayer-direct for sanctions response.

### Standalone Enrolment Endpoint (off-chain)

```
POST /v1/whitelist/standalone-enrol
Body: { address: 0x..., signature: <wallet sig over enrolment message> }
Returns: { status: "screening" | "approved" | "manual_review" | "rejected", attestation?: EnrolAttestation, signature?: bytes, reason?: string }
```

The wallet signature in the request proves the requester controls the address. The Relayer runs address-only KYT and either returns an `EnrolAttestation` + signature (clean) or routes to manual review (flag).

---

## Data Model

| Field | Type | Description |
|---|---|---|
| `addr` | `address` | Whitelisted lender, counterparty, or approved DeFi venue |
| `approvedAt` | `uint256` | Block timestamp of the last clean KYT screen (zero for DeFi venues) |
| `isDeFiVenue` | `bool` | True for governance-added venues, exempt from freshness window |
| `freshnessWindow` | `uint256` | Storage variable, default 90 days, configurable by foundation multisig |
| `kytAttestor` | `address` | Signing key for `EnrolAttestation`, rotatable under 48h timelock |
| `usedNonces` | `mapping(bytes32 => bool)` | Replay guard for enrol attestations |

The compliance review queue, KYT reason codes, and audit log live in the Operations Console backend, not on-chain.

---

## Security Considerations

- **Relayer never writes enrolments on-chain.** Enrolment lands either via DepositManager.claim (which holds `WHITELIST_ADMIN`) or via the address holder calling `enrol` with a Relayer-signed attestation. The signing key is the security boundary. Compromise response is rotation under ADMIN timelock.

- **Relayer retains direct `revokeAccess`.** This is a defensive action with a fast-response requirement. Holding a `WHITELIST_REVOKER` role rather than relying on the attestation flow ensures sanctions hits land in seconds, not in the time it takes the address holder to submit an off-chain attestation themselves. The role is GUARDIAN-revocable in case of Relayer compromise.

- **Lender authentication is wallet-only.** A compromised lender wallet grants the attacker the ability to deposit and (after a Relayer-signed claim attestation) claim PLUSD to that address, and to initiate withdrawals from it. The withdrawal claim still re-checks `isAllowed`, so a wallet compromise during a sanctions event does not unlock funds.

- **Operator accounts require 2FA.** Two-person consensus activation prevents a single compromised team account from introducing a rogue operator.

- **Passive re-screening covers the gap between deposits.** A whitelisted address that becomes sanctioned mid-cycle is revoked without depending on the lender initiating another deposit.

- **Standalone enrolment is address-only.** No transaction screening because no transaction has occurred. The Relayer relies on address-screening only. This is appropriate for the use case (a counterparty needing to receive PLUSD) but is weaker than the deposit-triggered path. Watchdog monitors the rate of standalone enrolments and flags anomalies.

- **DeFi venue admin-add bypasses KYT.** Each venue addition is a discrete governance action by the foundation multisig with full audit trail. The risk is governance compromise. Mitigation: 3/5 threshold on the foundation multisig, plus the GUARDIAN's pause cascade on the registry.

- **Replay protection via nonces and deadlines.** Same shape as the claim attestations. Each enrol attestation is single-use with a deadline.
