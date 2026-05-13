---
title: Smart contracts overview
order: 21
section: Technical overview
---

# Smart contracts overview

Every Protocol Layer contract: purpose, key invariants, role gates.

## Contract reference

| Contract | Purpose | Key invariant |
|---|---|---|
| **PLUSD** | ERC-20 dollar receipt | `totalSupply ≤ cumulative LP deposits + cumulative yield minted − cumulative LP burns`. Reserve invariant checked on every mint. Transfers require both endpoints whitelisted or one to be a system address. |
| **sPLUSD** | ERC-4626 yield-bearing share | Share price moves only on YieldMinter mints landing in the vault. No emissions, no rebases. |
| **LoanRegistry** | ERC-721 NFT loan book | Origination data immutable. Lifecycle state mutable. Trustee writes lifecycle. `setDefault` and write-down closures gated by RISK_COUNCIL via AccessManager. Informational only — not a NAV source. |
| **DepositManager** | Two-step screened deposit | `deposit` parks USDC in the Intake Wallet and creates a ticket; `claim` verifies a Relayer EIP-712 ClaimAttestation, enrols the lender on the whitelist, moves USDC from Intake to Capital, and calls `mintForDeposit` 1:1. Holds the only DEPOSITOR role on PLUSD and WHITELIST_ADMIN on WhitelistRegistry (used inside `claim`). |
| **YieldMinter** | Two-party yield mint gate | Mint requires verified signatures from both the Trustee attestor (EIP-1271) and the Relayer attestor. Mint destinations hard-constrained to sPLUSD vault or Treasury Wallet. |
| **WithdrawalQueue** | User-pulled FIFO exit | `claimAmount ≤ totalClaimable` enforced on every claim. The queue contract pulls from the Withdrawal Queue Wallet via the wallet's standing allowance when a lender calls `claim`. Allowance is the permission ceiling; aggregate ledger is the spending discipline. Can carry an exchange coefficient `< 1.0` during recovery. |
| **WhitelistRegistry** | Compliance-screened allowlist | Both endpoints of every PLUSD transfer must be whitelisted or a system address. 90-day KYT freshness window enforced via `approvedAt` per entry. |
| **AccessManager** | OpenZeppelin v5 role hub | Every privileged call routed through. Per-role timelocks: ADMIN 3-day standard / 7-day for upgrades, RISK_COUNCIL 3-day, GUARDIAN 0. 14-day meta-timelock on the delay parameter itself. |
| **ShutdownController** | Dormant in MVP. Reserved primitive for post-MVP terminal-mode scenarios. MVP loss handling uses the WithdrawalQueue exchange coefficient. |
| **RecoveryPool** | Dormant in MVP. Reserved primitive for post-MVP recovery flows alongside Pipeline Recovery Tokens (PRT). |

## Privileged role catalogue

| Role | Holder | Capability |
|---|---|---|
| **DEPOSITOR** | DepositManager proxy address | Calls `PLUSD.mintForDeposit`. Contract-held; no human key. |
| **YIELD_MINTER** | YieldMinter proxy address | Calls `PLUSD.mintForYield`. Contract-held; gated by the two-party signature check inside YieldMinter. |
| **BURNER** | WithdrawalQueue proxy address | Calls `PLUSD.burn` inside `WithdrawalQueue.claim`. Contract-held. |
| **WHITELIST_ADMIN** | DepositManager proxy address | Calls `WhitelistRegistry.setAccess` inside `DepositManager.claim` (auto-enrolment on a clean KYT). |
| **WHITELIST_REVOKER** | Relayer EOA | Calls `WhitelistRegistry.revokeAccess` for fast sanctions response. Narrow defensive on-chain role. GUARDIAN can revoke instantly. |
| **TRUSTEE** | Trustee key (or EIP-1271 signer) | Authorises LoanRegistry lifecycle writes (`recordRepayment`, `closeLoan` for non-default reasons, etc). GUARDIAN can revoke instantly. |
| **PAUSER** | GUARDIAN MPC | Pauses any pausable contract. |
| **UPGRADER** | ADMIN MPC | Schedules UUPS upgrades through AccessManager under the 7-day delay. |

`setDefault`, write-down closures, and exchange-coefficient changes on the WithdrawalQueue are RISK_COUNCIL-gated function selectors via AccessManager — not separate role grants. `kytAttestor` and `relayerYieldAttestor` are signing-key addresses configured on the relevant contracts via setters under the 3-day ADMIN timelock (48-hour timelock for attestor rotation under `proposeYieldAttestors`); they are not role grants.
