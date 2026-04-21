# Smart Contracts

## Overview

The Pipeline protocol deploys six on-chain contracts on Ethereum mainnet. Five are functional token-rail components; one is the governance multisig that holds admin roles across all others. All five functional contracts use OpenZeppelin audited library code as their base, with custom logic confined to small, clearly-scoped extensions totalling approximately 470 lines of custom Solidity across the entire suite.

## Contracts

| Contract | Base standard | Purpose | Privileged roles |
|---|---|---|---|
| PLUSD | OZ ERC-20Pausable + minimal `_update` override | Receipt token; minted 1:1 to USDC deposits and against trustee-signed yield events | MINTER (bridge), PAUSER (foundation multisig) |
| sPLUSD | OZ ERC-4626 (standard, unmodified) | Yield-bearing vault on PLUSD with NAV accretion. Open to any PLUSD holder. | PAUSER (foundation multisig) |
| WhitelistRegistry | Custom (~80 lines) | On-chain allowlist: KYCed LPs + approved DeFi venues. Tracks Chainalysis `approvedAt` timestamp. | WHITELIST_ADMIN (bridge), DEFAULT_ADMIN (foundation multisig) |
| WithdrawalQueue | Custom (~180 lines) | FIFO queue with partial fill support | FILLER (bridge), PAUSER (foundation multisig) |
| LoanRegistry | OZ ERC-721 + custom extension (~200 lines) | On-chain registry of loan facilities | loan_manager (bridge), risk_council (Risk Council 3-of-5) |
| FoundationMultisig | Safe | Holds admin roles on all contracts | Risk Council members (3-of-5 standard, 2-of-5 fast pause) |

---

## Contract Interfaces

### PLUSD

| Function | Access | Description |
|---|---|---|
| `mint(address to, uint256 amount)` | MINTER | Mints PLUSD. Enforces rolling 24h rate limit ($10M) and per-tx cap ($5M), both configurable by foundation multisig. Reverts if recipient not on WhitelistRegistry. |
| `burn(address from, uint256 amount)` | MINTER | Burns PLUSD from a specified address. Used by WithdrawalQueue.fillRequest. |
| `transfer(address to, uint256 amount)` | public | Standard ERC-20 transfer. Custom `_update` hook reverts if recipient not on WhitelistRegistry. |
| `transferFrom(address from, address to, uint256 amount)` | public | Standard ERC-20. Same whitelist check via `_update`. |
| `pause() / unpause()` | PAUSER | Freezes all mint, burn, and transfer operations. 2-of-5 Risk Council via foundation multisig. |

The custom surface on PLUSD is approximately 5 lines: a single override of the OpenZeppelin `_update` hook that calls `WhitelistRegistry.isAllowed(to)` before completing any transfer, mint, or burn. All other token logic is inherited unmodified.

Two minting categories use the same `mint()` function but are tracked separately in the bridge service audit log: deposit mints (triggered by USDC inflow from a whitelisted LP) and yield mints (triggered by trustee-signed RepaymentSettled or TreasuryYieldDistributed events).

### sPLUSD (ERC-4626)

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 assets, address receiver)` | public | Standard ERC-4626 deposit. Open to any PLUSD holder. |
| `redeem(uint256 shares, address receiver, address owner)` | public | Standard ERC-4626 redeem. Reverts at the PLUSD level if receiver is not whitelisted. |
| `totalAssets()` | public view | Returns `PLUSD.balanceOf(address(this))`. Yield accretion happens via fresh PLUSD mints into this address. |
| `pause() / unpause()` | PAUSER | Freezes deposits and redemptions. 2-of-5 Risk Council via foundation multisig. |

sPLUSD is the OpenZeppelin ERC-4626 implementation deployed without modification. Yield accretion is a natural property of ERC-4626: when the bridge service mints fresh PLUSD directly into the vault address, `totalAssets` increases while `totalSupply` stays constant, raising the share price for all stakers. No custom code is required.

Initial exchange rate is 1 PLUSD = 1 sPLUSD at first deposit. A dead-shares seed at vault deployment mitigates first-deposit inflation attacks. Standard ERC-4626 rounding direction applies.

### WhitelistRegistry

| Function | Access | Description |
|---|---|---|
| `setAccess(address lp, uint256 approvedAt)` | WHITELIST_ADMIN | Bridge sets a wallet as approved with the current Chainalysis screening timestamp. |
| `revokeAccess(address lp)` | WHITELIST_ADMIN or DEFAULT_ADMIN | Immediate removal from whitelist, e.g., on failed passive re-screen. |
| `isAllowed(address lp)` | public view | Returns true if lp is currently whitelisted AND `(block.timestamp - approvedAt) < freshnessWindow`. |
| `freshnessWindow` | public storage | Configurable parameter (default 90 days) set by DEFAULT_ADMIN. |
| `addDeFiVenue(address venue)` | DEFAULT_ADMIN | Foundation multisig adds approved DeFi pool/vault addresses that can hold PLUSD. |

### WithdrawalQueue

| Function | Access | Description |
|---|---|---|
| `requestWithdrawal(uint256 amount)` | public | Pulls PLUSD from caller into escrow, creates a queue entry, returns queue_id. Emits WithdrawalRequested. Reverts if caller not on WhitelistRegistry with a fresh screen. |
| `cancelWithdrawal(uint256 queueId)` | public | Only callable by original requester. Returns remaining escrowed PLUSD. Cannot reverse already-filled portions. |
| `fillRequest(uint256 queueId, uint256 amount)` | FILLER | Bridge calls this to fill the first request in the queue, either fully or partially. Burns the filled PLUSD amount. Emits WithdrawalPartiallyFilled or WithdrawalSettled. |
| `getQueueDepth()` | public view | Returns (totalEscrowed, count, outstandingAtHead). |
| `pause() / unpause()` | PAUSER | Freezes all fills. 2-of-5 Risk Council via foundation multisig. |

### LoanRegistry

| Function | Access | Description |
|---|---|---|
| `mintLoan(address originator, ImmutableLoanData data)` | loan_manager | Mints a new loan NFT. Emits LoanMinted, which triggers the bridge service's disbursement preparation. |
| `updateMutable(uint256 tokenId, LoanStatus status, uint256 newMaturityDate, uint256 newCCR, LocationUpdate newLocation)` | loan_manager | Updates lifecycle fields. Reverts if newStatus == Default. |
| `setDefault(uint256 tokenId)` | risk_council | Risk Council 3-of-5 multisig transitions a loan to Default status. |
| `closeLoan(uint256 tokenId, ClosureReason reason)` | loan_manager or risk_council | loan_manager for {ScheduledMaturity, EarlyRepayment}; risk_council for {Default, OtherWriteDown}. |
| `getImmutable(uint256 tokenId)` | public view | Returns immutable origination data. |
| `getMutable(uint256 tokenId)` | public view | Returns current mutable lifecycle data. |

---

## Data Models

### ImmutableLoanData (set at mint, never changes)

| Field | Type | Notes |
|---|---|---|
| originator | address | Originator's on-chain identifier |
| borrowerId | bytes32 | Hashed borrower identifier |
| commodity | string | e.g. Jet fuel JET A-1 |
| corridor | string | e.g. South Korea → Mongolia |
| originalFacilitySize | uint256 | 6-decimal USDC units |
| originalSeniorTranche | uint256 | Senior portion at origination |
| originalEquityTranche | uint256 | Equity portion at origination |
| originationDate | uint256 | Block timestamp at mint |
| originalMaturityDate | uint256 | Originally agreed maturity |
| governingLaw | string | e.g. English law, LCIA London |
| metadataURI | string | Optional IPFS pointer to descriptive context |

### MutableLoanData (updated by loan_manager / risk_council)

| Field | Type | Notes |
|---|---|---|
| status | LoanStatus | Performing \| Watchlist \| Default \| Closed |
| currentMaturityDate | uint256 | May be extended from original |
| lastReportedCCR | uint256 | Basis points (e.g. 14000 = 140%) |
| lastReportedCCRTimestamp | uint256 | When CCR was last updated |
| currentLocation | LocationUpdate | Embedded struct |
| closureReason | ClosureReason | Set when status = Closed |

### LocationUpdate (embedded in MutableLoanData)

| Field | Type | Notes |
|---|---|---|
| locationType | LocationType | Vessel \| Warehouse \| TankFarm \| Other |
| locationIdentifier | string | Vessel IMO, warehouse name, tank farm ID |
| trackingURL | string | Optional external tracking link (MarineTraffic etc.) |
| updatedAt | uint256 | Timestamp of last location update |

Enums: `LoanStatus { Performing, Watchlist, Default, Closed }` · `ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }` · `LocationType { Vessel, Warehouse, TankFarm, Other }`.

---

## Restricted Interaction Model

PLUSD transfers are gated by the WhitelistRegistry on every movement. The WhitelistRegistry contains two categories of approved address:

- **KYCed LP wallets** approved via the onboarding process, with Chainalysis freshness enforced via the `approvedAt` timestamp and the `freshnessWindow` parameter (default 90 days).
- **Approved DeFi venues** — specific Curve pools, Uniswap v4 pools, Aave market contracts — explicitly added by the foundation multisig after legal and technical review.

Any PLUSD transfer to an address not in either category reverts. PLUSD cannot be redirected to an attacker-controlled address unless that address has either passed KYC or been added to the DeFi venue allowlist by the foundation multisig.

sPLUSD is not subject to the whitelist check. The vault is open to any PLUSD holder, enabling DeFi composability for the yield-bearing token. The KYC chain re-enters on sPLUSD redemption: the resulting PLUSD transfer to the receiver triggers the PLUSD `_update` hook, which checks the WhitelistRegistry on delivery.

The MVP ships in strict whitelist mode (only approved addresses permitted). The foundation multisig can later shift the WhitelistRegistry to a permissive mode (only sanctioned addresses blocked) via a configuration change, without a contract upgrade.

---

## Security Considerations

- Total custom audit surface is approximately 470 lines across all contracts — a small target for a Tier 1 auditor.
- Smart contracts hold no USDC or USYC. A contract exploit cannot drain investor capital unilaterally; cash-rail outflows require bridge or human MPC signatures.
- The FoundationMultisig holds a 2-of-5 Risk Council fast-pause capability over PLUSD, sPLUSD, and the WithdrawalQueue, enabling immediate freeze without the full 3-of-5 quorum.
- PLUSD on-chain rate limits ($10M rolling 24h / $5M per tx, both configurable by foundation multisig) bound the blast radius of a compromised MINTER key.
- The FILLER role on WithdrawalQueue can only burn PLUSD that is already in queue escrow; it cannot fabricate fills against non-existent entries.
