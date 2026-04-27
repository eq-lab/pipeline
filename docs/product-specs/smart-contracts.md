# Smart Contracts

## Overview

The Pipeline protocol deploys nine functional on-chain contracts on Ethereum mainnet, plus a
shared AccessManager hub that provides role gating and timelocked scheduling for privileged
actions. All functional contracts use OpenZeppelin v5.x audited library code as their base
with custom logic confined to small, clearly-scoped extensions. All protocol contracts use
UUPS proxies; upgrades are gated by the UPGRADER role (ADMIN 3/5 Safe) with a 48h
AccessManager delay, which GUARDIAN 2/5 Safe may cancel.

PLUSD itself is a minimal receipt token: it exposes only restricted `mintForDeposit` /
`mintForYield` / `burn` selectors and the whitelist-aware `_update` hook. All mint-path
business logic — rate limits, deposit atomicity, yield-attestation verification — lives in
dedicated contracts (`DepositManager`, `YieldMinter`) that hold the corresponding PLUSD
roles. This keeps the token free of signature-verification code and makes incident
response a matter of pausing or role-revoking a single logic contract rather than
upgrading the token.

Emergency response follows an Ethena-style split: GUARDIAN takes **instant, granular**
defensive actions — pause and targeted revocation of individual operational-role holders —
while re-enabling paused contracts and re-granting revoked roles requires the timelocked
ADMIN path. There is no scorched-earth `revokeAll`; every revocation is a named-role,
named-holder action that can be reviewed and cancelled on a per-call basis. This also
reflects an implementation reality of OpenZeppelin AccessManager: role membership is held
in a `mapping(uint64 roleId => mapping(address who => AccessParams))` that is not
enumerable on-chain, so any "revoke everyone at once" primitive would require off-chain
enumeration and per-holder transactions regardless.

---

## Governance

Three Gnosis Safes hold all privileged roles across the protocol, with distinct signer sets:

| Safe | Threshold | Role | Timelock |
|---|---|---|---|
| ADMIN | 3/5 | Role grants, unpause, upgrades, parameter changes | 48h (14d on delay changes) |
| RISK_COUNCIL | 3/5 | Proposes `setDefault` and `enterShutdown` | 24h |
| GUARDIAN | 2/5 | Instant pause; cancel pending ADMIN actions; revoke individual operational-role holders | None |

GUARDIAN is defensive-only — it cannot grant any role, unpause a contract, upgrade, or
initiate any risk-increasing action. It can only halt in-flight operations (pause) or
strip named operational-role holders (`revokeRole(role, account)` on AccessManager) on a
one-role-at-a-time basis. Restoring service — re-enabling a paused contract or re-granting
a revoked role — is an ADMIN action subject to the 48h AccessManager delay.

### Role tree (AccessManager)

Every role has a `RoleAdmin` (grants/revokes) and a `RoleGuardian` (cancels pending
timelocked actions targeting that role). Launch configuration:

| Role | Target contract | Holder | RoleAdmin | RoleGuardian |
|---|---|---|---|---|
| DEFAULT_ADMIN | AccessManager | ADMIN 3/5 Safe | — | GUARDIAN 2/5 |
| UPGRADER | every UUPS proxy | ADMIN 3/5 Safe | ADMIN 3/5 | GUARDIAN 2/5 |
| DEPOSITOR | PLUSD | DepositManager proxy | ADMIN 3/5 | GUARDIAN 2/5 |
| YIELD_MINTER | PLUSD | YieldMinter proxy | ADMIN 3/5 | GUARDIAN 2/5 |
| BURNER | PLUSD | WithdrawalQueue proxy | ADMIN 3/5 | GUARDIAN 2/5 |
| FUNDER | WithdrawalQueue | Relayer EOA | ADMIN 3/5 | GUARDIAN 2/5 |
| WHITELIST_ADMIN | WhitelistRegistry | Relayer EOA | ADMIN 3/5 | GUARDIAN 2/5 |
| TRUSTEE | LoanRegistry | Trustee key | ADMIN 3/5 | GUARDIAN 2/5 |
| RISK_COUNCIL selectors | LoanRegistry, ShutdownController | RISK_COUNCIL 3/5 Safe | ADMIN 3/5 | GUARDIAN 2/5 |
| PAUSER | every pausable contract | GUARDIAN 2/5 Safe | ADMIN 3/5 | — |

Contract-held roles (`DEPOSITOR`, `BURNER`, `YIELD_MINTER`) are bound to proxy addresses;
GUARDIAN revocation is technically possible but not part of the ordinary incident playbook
(revoking them would freeze deposits/withdrawals/yield wholesale rather than targeting the
compromised actor). Operational roles held by EOAs (`FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`,
and the Relayer-side attestor key referenced by `YieldMinter`) are the ones GUARDIAN revokes
in a compromise.

---

## Contracts

| Contract | Base standard | Purpose | Custom LOC |
|---|---|---|---|
| AccessManager (OZ) | — | Single role-management hub; timelocked scheduled actions | 0 |
| PLUSD | OZ ERC20Pausable + ERC20Permit + AccessManaged + UUPS | Receipt token; mint exposed only as restricted `mintForDeposit` / `mintForYield`; `_update` hook enforces whitelist. All signature verification and rate-limit enforcement happens in caller contracts, not in the token. | ~80 |
| DepositManager | AccessManaged + Pausable + ReentrancyGuard + UUPS | Atomic 1:1 USDC→PLUSD deposit. Enforces per-LP / per-window / supply caps. Holds `DEPOSITOR` role on PLUSD. | ~120 |
| YieldMinter | AccessManaged + Pausable + UUPS | Verifies the two-party yield attestation (Relayer ECDSA + custodian EIP-1271), enforces replay protection, calls `PLUSD.mintForYield`. Holds `YIELD_MINTER` role on PLUSD. | ~110 |
| sPLUSD | OZ ERC-4626 + ERC20Pausable + AccessManaged + UUPS | Yield-bearing vault on PLUSD; open to any whitelisted PLUSD holder. Plain ERC-4626 semantics — share price moves only when Relayer lands a `yieldMint` in the vault. `_update` hook mirrors PLUSD: both non-zero endpoints must be a whitelisted LP or a system address. | ~55 |
| WhitelistRegistry | AccessManaged + TimelockPending + UUPS | On-chain allowlist: KYCed LP wallets and approved DeFi venues. Tracks Chainalysis `approvedAt` timestamp. Exposes `isAllowed` (no freshness check) and `isAllowedForMint` (requires fresh screen). | ~95 |
| WithdrawalQueue | AccessManaged + Pausable + ReentrancyGuard + UUPS | FIFO withdrawal queue; Pending→Funded→Claimed/AdminReleased lifecycle. `fundRequest(uint256 usdcAmount)` consumes as many queue heads as the amount covers in full. | ~140 |
| LoanRegistry | OZ ERC-721 (soulbound) + AccessManaged + Pausable + UUPS | On-chain registry of loan facilities. Origination data stored off-chain in IPFS JSON, referenced via standard ERC-721 `tokenURI`; mutable lifecycle state (status, CCR, location, cumulative repayments) lives on-chain. | ~140 |
| ShutdownController | AccessManaged + UUPS | Freezes normal flow on distress; fixes `recoveryRateBps`; opens `redeemInShutdown` / `claimAtShutdown` paths. | ~75 |
| RecoveryPool | AccessManaged + Pausable + ReentrancyGuard + UUPS | Holds USDC for LP recovery payments on shutdown. | ~70 |

## Contract Interfaces

For the full interface definitions of all nine contracts, see:

- [smart-contracts-interfaces.md](./smart-contracts-interfaces.md) — PLUSD, DepositManager, YieldMinter, sPLUSD, WhitelistRegistry, WithdrawalQueue
- [smart-contracts-registry.md](./smart-contracts-registry.md) — LoanRegistry, ShutdownController, Shutdown Mode
- [smart-contracts-operations.md](./smart-contracts-operations.md) — Role Assignments, Upgradeability, Emergency Response, Deferred Features
---

## Security Considerations

- **No single point of mint compromise.** Deposit-leg mints require an atomic contract call
  through DepositManager (no off-chain signer). Yield-leg mints require Relayer ECDSA signature
  + custodian EIP-1271 signature verified inside YieldMinter, plus YieldMinter holding
  `YIELD_MINTER` on PLUSD — three independent controls. Compromising any one party alone
  mints zero PLUSD.
- **Ledger invariant on every mint path.** On-chain cumulative counters make any counter
  desync revert against the contract's own ledger. Full Proof of Reserve (Chainlink PoR)
  is deferred to phase 2.
- **Bounded upgradeability.** 48h ADMIN delay on upgrades with GUARDIAN veto. A 14-day
  meta-timelock on delay changes closes the "collapse-delay-then-exploit" second-order attack.
- **Three-Safe governance separation.** ADMIN cannot enter shutdown or declare default;
  RISK_COUNCIL cannot perform upgrades or manage roles; GUARDIAN cannot grant roles,
  unpause, upgrade, or initiate any risk-increasing action.
- **Granular defensive response.** GUARDIAN's emergency toolkit is instant but narrow:
  pause a named pausable contract, cancel a pending ADMIN action, or revoke a named holder
  of a named operational role (`FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`). There is no
  `revokeAll` switch that strips everything at once — every action names what it is doing
  to what, leaving a reviewable record and bounded blast radius. Re-enabling a paused
  contract or re-granting a revoked role is an ADMIN action with the 48h AccessManager
  delay, which GUARDIAN may cancel if the restoration is premature.
- **Smart contracts hold no USDC.** Capital Wallet and Treasury Wallet are MPC-controlled.
  A contract exploit cannot drain investor capital unilaterally.
- **Whitelist-gated PLUSD and sPLUSD.** Both tokens share the same `_update` rule: every
  non-zero endpoint of every transfer must be a whitelisted LP or a system address. This
  keeps the permissioned trading universe closed — unscreened wallets cannot be a source
  or destination on either rail — while allowing whitelisted LPs to move PLUSD and sPLUSD
  freely among themselves.
- **On-chain repayment accounting is informational.** `LoanRegistry.recordRepayment`
  increments counters and emits an event but moves no USDC and mints no PLUSD. sPLUSD share
  price moves only on actual yield mints via the two-party `yieldMint` path. A compromised
  Trustee key cannot inflate share price by writing false repayment entries.

---

## Appendix A — Actor glossary

| Actor | Type | On-chain roles | Notes |
|---|---|---|---|
| ADMIN Safe | 3/5 Gnosis Safe | `DEFAULT_ADMIN` on AccessManager, `UPGRADER` on every proxy | All actions 48h-timelocked. Grants and re-grants operational roles (re-grant under 48h after a GUARDIAN revocation). |
| RISK_COUNCIL Safe | 3/5 Gnosis Safe | Caller of `setDefault` on LoanRegistry, `proposeShutdown` and `adjustRecoveryRateUp` on ShutdownController | 24h AccessManager delay on these selectors. Distinct signer set from ADMIN. |
| GUARDIAN Safe | 2/5 Gnosis Safe | `PAUSER` on every pausable contract; `GUARDIAN_ROLE` on AccessManager | Instant pause, cancellation, and operational-role revocation. No ability to grant, unpause, upgrade, or initiate risk-increasing actions. |
| Relayer | Protocol backend | `FUNDER` (WithdrawalQueue), `WHITELIST_ADMIN` (WhitelistRegistry) | On-chain EOA or contract wallet. Never custodies USDC. Co-signs yield-mint attestations alongside custodian (as `relayerYieldAttestor` referenced by YieldMinter — a signing-key relationship, not a role). Not in the critical path for deposits (those are atomic LP-driven via DepositManager). Has no role on LoanRegistry. |
| Trustee | Pipeline Trust Company key | `TRUSTEE` on LoanRegistry | All LoanRegistry writes: `mintLoan`, `updateMutable`, `recordRepayment`, Trustee-branch `closeLoan`. Also one cosigner on the Capital Wallet MPC. Distinct key set from Relayer and Team. |
| Pipeline Team | Team key | — (none on-chain) | One cosigner on Capital Wallet and Treasury Wallet MPC. Co-signs loan disbursement and treasury operations per custodian policy. |
| Capital Wallet | MPC-controlled on-chain address | — | Holds USDC reserves. Cosigners: Trustee + Team + Relayer. All Capital Wallet transfers are on-chain ERC-20, never off-chain wires. |
| Treasury Wallet | MPC-controlled on-chain address | — | Protocol fees and yield share. |
| Custodian yield-attestor | EIP-1271 contract | — (smart-contract signer) | Independent second signer on every yield mint (verified inside YieldMinter). Compromising Relayer alone mints zero; compromising the custodian alone mints zero. |
| Relayer yield-attestor | EOA | — (ECDSA signer) | First signer on every yield mint. Rotatable via `YieldMinter.proposeYieldAttestors` under 48h ADMIN timelock. |
| DepositManager | Contract | Holds `DEPOSITOR` on PLUSD | Only account authorised to call `PLUSD.mintForDeposit`. |
| YieldMinter | Contract | Holds `YIELD_MINTER` on PLUSD | Only account authorised to call `PLUSD.mintForYield`. Contains all attestation-verification logic. |
| WithdrawalQueue | Contract | Holds `BURNER` on PLUSD | Only account authorised to call `PLUSD.burn` on the claim path. |
