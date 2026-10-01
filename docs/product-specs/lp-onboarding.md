# LP Onboarding

## Overview

Pipeline has two onboarding paths. Lenders authenticate by wallet **or** by self-serve email and password, and earn whitelist eligibility through compliance screening on transactions or addresses. Operators (Trustees, Originators, Pipeline team) authenticate by **wallet signature only**, against a hand-maintained allow-list. Email and password are a lender credential and carry no roles, so an operator never reaches the Operations Console that way. Both paths converge on the Operations Console backend.

Lender onboarding does not require KYC, KYB, or accreditation declarations. Compliance is enforced by KYT screening on deposit transactions (per `deposits.md`), on standalone address enrolments, and on PLUSD transfers via the `WhitelistRegistry` `_update` gate. The legal framework that governs this approach is `[Framework: TBD]`.

The Relayer never writes whitelist enrolments to `WhitelistRegistry` directly. It signs an off-chain `EnrolAttestation` after running KYT, and the address holder (or DepositManager during a claim) submits the attestation on-chain. The Relayer retains direct call rights only on `revokeAccess`, which is a defensive action that needs to land fast on a sanctions hit.

---

## Behavior

### Lender Wallet Authentication

An LP reaches a Pipeline account by either of two credentials, and both resolve to the same principal — an `accounts` row (see `api-authorization.md`).

**Wallet.** The lender connects an Ethereum or Stellar wallet via WalletConnect v2 / RainbowKit / Freighter. The lender signs a one-time server-issued message to bind the wallet to a Pipeline session. The wallet's own security model is the sole authentication factor; Pipeline does not require 2FA for wallet-authenticated lenders.

**Email and password (self-serve).** The LP registers a corporate email and a password, verifies the address with a six-digit passcode, and is then signed in. Registration is open — there is no invitation and no allow-list, which is the deliberate difference from operator accounts below. Verification is mandatory: an account whose address is unverified cannot log in. Passwords are stored as Argon2id hashes; the policy is at least 8 characters including a digit and a special character.

These are credentials of one account, not two accounts. An LP that signed up by email and later links a wallet is one identity throughout, and the LP record it owns follows the account rather than either credential. KYB, not the credential type, is what gates an LP's ability to transact — a freshly verified email account holds no roles.

Lender authentication remains outside the operator model: no 2FA, no two-person activation. Those apply only to Trustees, Originators, and the Pipeline team (see below).

### LP Entity Registration and KYB Documents

A verified account registers the legal entity it acts for, attaches supporting documents, and has them reviewed by a Trustee. That whole flow — the record, the document set, the review lifecycle, notifications, and the settlement address — is specified in [`kyb-lp-verification.md`](./kyb-lp-verification.md). It is independent of the whitelist paths below, and the division is worth stating plainly because it is easy to get backwards: the whitelist screens *addresses* and is what actually gates PLUSD transfers, while KYB verifies the *entity* and today gates nothing but the LP's own record and its settlement address.

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

Operators authenticate by **wallet signature**, the opposite way round from a lender. A Trustee, Originator, or team member signs a server-issued challenge with a key recorded in the `auth_users` allow-list, and that row's `roles` are what the issued token carries. The email-and-password credential belongs to lenders: a token minted from it is role-less by construction, so it can never reach an operator endpoint whatever the person behind it does.

An operator therefore comes into existence by a row being added to that allow-list. It is populated by hand — the table documents itself as a "manually-populated allow-list" with no admin endpoint — so adding or removing an operator is a deliberate act performed directly against the database.

**Open design question.** The controls below were specified against an email signup flow operators do not use, and nothing implements them today. They are recorded rather than deleted because the second is a real control and its absence is a gap, not a decision:

1. **Invitation.** A one-time signup link, valid for 72 hours, issued by a team member against the invitee's work email and role.
2. **Two-person consensus activation.** Two distinct team members approving before the account becomes Active, with the inviting member not counting as one of the two.
3. **Suspension and removal.** Suspension by any single team member; permanent removal by two-person consensus, with audit history preserved indefinitely. Suspension itself is now enforced (`accounts.status`, Issue #1380); the two-person and audit parts are not.

A wallet credential makes the first redundant — the key is the factor, as it already is for a lender — but gives the second and third no mechanism at all.

Team members are operators too and reach the console the same way, by wallet signature against the same allow-list. The invitation and consensus rules above would apply to them identically — once there is a mechanism for them.

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

- **A compromised lender wallet** grants the attacker the ability to deposit and (after a Relayer-signed claim attestation) claim PLUSD to that address, and to initiate withdrawals from it. The withdrawal claim still re-checks `isAllowed`, so a wallet compromise during a sanctions event does not unlock funds.

- **Self-serve email registration is open by design, so the account is not a trust signal.** Anyone can create and verify one; it grants no roles and confers nothing beyond the ability to start KYB. Every privileged action stays gated on roles assigned manually in `auth_users` or on KYB status. Abuse of the endpoint itself (signup floods burning email quota, address enumeration) is handled at the API — see `api-authorization.md`.

- **Email sessions cannot currently be revoked.** Tokens are stateless and live 24 hours, so a password reset does not end an attacker's existing session. Tracked as TD-80. Suspension is different: `accounts.status` is read on every authenticated request, so suspending an account — whether via a terminal KYB refusal or an operator action — now takes effect on the account's very next request, for both wallet and email credentials.

- **Operator accounts require 2FA.** Two-person consensus activation prevents a single compromised team account from introducing a rogue operator.

- **Passive re-screening covers the gap between deposits.** A whitelisted address that becomes sanctioned mid-cycle is revoked without depending on the lender initiating another deposit.

- **Standalone enrolment is address-only.** No transaction screening because no transaction has occurred. The Relayer relies on address-screening only. This is appropriate for the use case (a counterparty needing to receive PLUSD) but is weaker than the deposit-triggered path. Watchdog monitors the rate of standalone enrolments and flags anomalies.

- **DeFi venue admin-add bypasses KYT.** Each venue addition is a discrete governance action by the foundation multisig with full audit trail. The risk is governance compromise. Mitigation: 3/5 threshold on the foundation multisig, plus the GUARDIAN's pause cascade on the registry.

- **Replay protection via nonces and deadlines.** Same shape as the claim attestations. Each enrol attestation is single-use with a deadline.
