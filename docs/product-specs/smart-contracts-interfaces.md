# Smart Contracts: Contract Interfaces (Core)

> Interface definitions for PLUSD, DepositManager, YieldMinter, sPLUSD, WhitelistRegistry, and WithdrawalQueue. See [smart-contracts.md](./smart-contracts.md) for the main spec (overview, governance, contracts table, security, actor glossary). See [smart-contracts-registry.md](./smart-contracts-registry.md) for LoanRegistry, ShutdownController, and Shutdown Mode.

---

## PLUSD

| Function | Access | Description |
|---|---|---|
| `mintForDeposit(address lp, uint256 amount)` | DEPOSITOR (DepositManager) | Mints PLUSD 1:1 against a `Claimable` deposit ticket consumed by `DepositManager.claim`. Increments `cumulativeLPDeposits`. Reverts if `_update` rejects the recipient. |
| `mintForYield(address recipient, uint256 amount)` | YIELD_MINTER (YieldMinter) | Mints yield PLUSD into a system address (sPLUSD vault or Treasury Wallet). Increments `cumulativeYieldMinted`. No signature verification here. Signature checks live in `YieldMinter`. |
| `burn(address from, uint256 amount)` | BURNER (WithdrawalQueue) | Burns escrowed PLUSD when LP calls `claim` or `redeemInShutdown`. Increments `cumulativeLPBurns`. |
| `transfer / transferFrom` | public | Standard ERC-20. `_update` enforces both non-zero endpoints must be either a whitelisted address or a system address. Transfers within the whitelist set are permitted. Any leg touching an unscreened wallet reverts. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all mint, burn, and transfer operations. |
| `unpause()` | ADMIN | Restores operations, subject to 48h AccessManager delay, cancellable by GUARDIAN. |
| `assertLedgerInvariant()` | public view | Returns `cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns - totalSupply`. Always 0 when the ledger is consistent. Any non-zero value indicates a contract bug in one of the three mint/burn paths. Diagnostic only, not a health gradient. |

Direct `mint(address, uint256)` is removed. Fresh PLUSD enters supply only through `mintForDeposit` (deposit leg) or `mintForYield` (yield leg), each callable by exactly one contract address.

### Ledger invariant

PLUSD maintains three cumulative counters, updated in the same transaction that moves value:

| Counter | Incremented in | Meaning |
|---|---|---|
| `cumulativeLPDeposits` | `mintForDeposit` | Total PLUSD ever minted on the deposit leg |
| `cumulativeYieldMinted` | `mintForYield` | Total PLUSD ever minted on the yield leg |
| `cumulativeLPBurns` | `burn` | Total PLUSD ever burned (via WQ claim or `redeemInShutdown`) |

Every mint/burn path asserts, post-state-change:

```
totalSupply() == cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns
```

Since these three functions are the only entry points that change `totalSupply`, the invariant must hold exactly. A violation signals a contract bug (e.g. a counter increment was missed), not a recoverable drift. The check is internal-consistency only. It catches counter desync and makes any over-mint against the contract's own ledger revert. It is **not** a Proof of Reserve. It does not verify the custodian actually holds the USDC. Full on-chain PoR (Chainlink) is phase 2.

---

## DepositManager

`DepositManager` runs the two-step deposit flow. `deposit` parks USDC in the Intake Wallet and writes a ticket. The Relayer runs KYT off-chain and signs a `ClaimAttestation`. The lender submits the attestation to `claim`, which verifies the signature, enrols the lender in `WhitelistRegistry`, and mints PLUSD. The Relayer never writes to DepositManager directly. See `deposits.md` for the full behavior spec.

Lifecycle: `Pending -> Claimed | Refunded`.

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 usdcAmount)` | public | Pulls USDC from caller to the Intake Wallet via `transferFrom`. Creates a ticket in `Pending` state. Enforces minimum deposit, per-lender 24h cap, global 24h cap, and `totalSupply + outstandingTickets + amount <= maxTotalSupply`. Emits `DepositRequested`. |
| `claim(uint256 depositId, ClaimAttestation att, bytes sig)` | public (original depositor only) | Verifies the EIP-712 signature against `kytAttestor`, checks attestation fields and nonce, calls `WhitelistRegistry.setAccess(holder, att.approvedAt)`, pulls USDC from Intake Wallet to Capital Wallet via standing allowance, calls `PLUSD.mintForDeposit`. Flips ticket to `Claimed`. Emits `Deposited`. |
| `refund(uint256 depositId)` | public (original depositor only) | Refunds a `Pending` ticket past the claim window (default 30 days). No attestation required. Pulls USDC from Intake Wallet to depositor via standing allowance. Flips ticket to `Refunded`. |
| `markRefunded(address lender, uint256 depositId)` | TRUSTEE_REFUNDER (Trustee) | Flips a `Pending` ticket to `Refunded` after a Trustee + Team co-signed off-chain USDC transfer from Intake Wallet to lender (KYT soft-fail path). The standing allowance is not used. |
| `getTicket(address lender, uint256 depositId)` | public view | Returns the ticket struct. |
| `outstandingTickets()` | public view | Sum of `Pending` ticket amounts. Reserved against the supply cap. |
| `isNonceUsed(bytes32 nonce)` | public view | Returns true if the attestation nonce has already been consumed. |
| `setKytAttestor(address)` | ADMIN | Rotate the off-chain attestation signing key, 48h-delayed and GUARDIAN-cancellable. |
| `setMaxPerWindow(uint256)` / `setMaxPerLenderPerWindow(uint256)` / `setMaxTotalSupply(uint256)` / `setClaimWindow(uint256)` / `setMinimumDeposit(uint256)` | ADMIN | Parameter setters. Tightening instant, loosening 48h-delayed and GUARDIAN-cancellable. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of `deposit`, `claim`, `refund`, and `markRefunded`. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancellable. |

### Claim attestation

`ClaimAttestation` is an EIP-712 typed message signed off-chain by the Relayer's `kytAttestor` key. The contract verifies it inside `claim`. Same shape as `WithdrawalQueue.claim`.

```solidity
struct ClaimAttestation {
    bytes32 actionId;       // keccak256(abi.encode(chainId, contract, "deposit", depositId))
    address holder;         // expected msg.sender at claim time
    uint256 amount;         // ticket amount, must match
    uint64  approvedAt;     // KYT-pass timestamp written to WhitelistRegistry
    uint64  deadline;       // claim must land before this
    bytes32 nonce;          // anti-replay, single-use
}
```

A compromised `kytAttestor` can sign valid attestations for any depositId, but `claim` requires a real `Pending` ticket (which requires the lender to have already deposited USDC into the Intake Wallet). The blast radius of a key compromise is AML bypass on real deposits, not unbacked minting.

### Deposit rate-limit parameters

All deposit caps are enforced inside `DepositManager`, not inside PLUSD. PLUSD is unaware of windows or supply ceilings.

| Cap | Enforced | Loosening |
|---|---|---|
| `maxPerWindow` | Aggregate USDC accepted across all lenders per fixed 24h window | ADMIN, 48h delay |
| `maxPerLPPerWindow` | Per-lender USDC accepted per fixed 24h window | ADMIN, 48h delay |
| `maxTotalSupply` | Hard ceiling on `PLUSD.totalSupply() + outstandingClaimable`, circuit breaker for phased launch | ADMIN, 48h delay |
| `claimWindow` | Time after `deposit` before a `Pending` ticket becomes refundable by the lender (default 30 days) | ADMIN, 48h delay |

The window is a **fixed 24h window**, not a rolling one. The counters `windowDeposited` and `lenderWindowDeposited[lp]` reset whenever `block.timestamp` crosses a `windowStart + 24h` boundary. Worst case is `2 * maxPerWindow` over a boundary (last second of window N plus first second of window N+1). This is acceptable because `maxTotalSupply` and the custody MPC policy engine's independent cap on transfers from the Intake Wallet both bound the worst-case blast radius. The fixed-window algorithm is materially simpler than a sliding-window counter.

`maxTotalSupply` reserves headroom against `outstandingClaimable` so a lender holding a `Claimable` ticket cannot be blocked at claim time by other claimants exhausting the cap.

`maxTotalSupply` is implemented as a custom mutable cap (OZ `ERC20Capped` is immutable and therefore unsuitable). Rationale: phased-launch bound and blast-radius circuit breaker during the period before PoR lands. In a later version this cap may be removed once custody MPC policy plus rolling PoR provide equivalent bounds.

### Intake Wallet allowances

The Intake Wallet grants two standing USDC allowances to `DepositManager`:

- One for `claim` payouts to the Capital Wallet.
- One for `refund` payouts to the original lender.

Both allowances can be revoked by the custody-side hardware circuit breaker independently of any on-chain governance action. The `mark*` functions do not require these allowances.

---

## YieldMinter

| Function | Access | Description |
|---|---|---|
| `yieldMint(YieldAttestation att, bytes relayerSig, bytes custodianSig)` | public (any caller, sigs are the gate) | Verifies Relayer ECDSA (ecrecover on `relayerYieldAttestor`) plus custodian EIP-1271 (on `custodianYieldAttestor`). Enforces `att.ref` unused, destination is in {sPLUSD vault, Treasury Wallet}, amount > 0. On success, calls `PLUSD.mintForYield(att.recipient, att.amount)`. Marks `att.ref` consumed. |
| `proposeYieldAttestors(address relayer, address custodian)` | ADMIN | Rotates signer addresses, 48h AccessManager delay, GUARDIAN-cancellable. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all yield mints. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancellable. |

Pulling signature verification out of PLUSD has two benefits. (1) Incident response: on a suspected attestor compromise GUARDIAN pauses `YieldMinter` or revokes `YIELD_MINTER` on the PLUSD contract from the YieldMinter proxy. No PLUSD upgrade is needed. (2) Audit surface: the token contract contains no signature-verification code, keeping its blast radius tight.

---

## sPLUSD (ERC-4626)

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 assets, address receiver)` | public | Standard ERC-4626 deposit. `receiver` must pass the shared whitelist check (whitelisted address or system address). Same rule applies as on a plain sPLUSD transfer. |
| `redeem(uint256 shares, address receiver, address owner)` | public | Standard ERC-4626 redeem. Plain OZ implementation, does **not** trigger any on-chain yield mint. Relayer runs the USYC NAV freshness check off-chain against pending `Deposit` and `Withdraw` events and lands the two-party `yieldMint` via `YieldMinter` before allowing the redeem to settle at a stale NAV (see `yield.md`). |
| `transfer / transferFrom` | public | Standard ERC-20. `_update` mirrors PLUSD. Both non-zero endpoints must be a whitelisted address or a system address. |
| `totalAssets()` | public view | Returns `PLUSD.balanceOf(address(this))`. Increases when yield mints land in the vault. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of deposits and redemptions. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancellable. |

---

## WhitelistRegistry

`WhitelistRegistry` gates PLUSD and sPLUSD transfers via `_update`. It does not gate deposits (the `DepositManager` ticket book handles mint eligibility) or withdrawals (`WithdrawalQueue` claim takes its own attestation, plus an `isAllowed` re-check as backstop). Three enrolment paths are documented in `lp-onboarding.md`: deposit-triggered (DepositManager calls `setAccess` during `claim`), standalone address enrolment (holder calls `enrol` with a Relayer-signed attestation), DeFi venue admin-add (governance).

| Function | Access | Description |
|---|---|---|
| `enrol(address addr, EnrolAttestation att, bytes sig)` | public | Standalone enrolment via off-chain attestation. Verifies signature against `kytAttestor`, checks fields and nonce, writes the entry. Anyone can submit a valid attestation, the attestation itself binds the result to `addr`. |
| `setAccess(address addr, uint256 approvedAt)` | WHITELIST_ADMIN (DepositManager proxy) | Writes a whitelist entry. Called by DepositManager during `claim` to enrol the depositor as a side effect of a successful claim. |
| `revokeAccess(address addr)` | WHITELIST_REVOKER (Relayer) or DEFAULT_ADMIN | Removes the address from the whitelist immediately. Direct call retained for fast sanctions response. |
| `isAllowed(address addr)` | public view | Returns true if the address is whitelisted **and** `(block.timestamp - approvedAt) < freshnessWindow`. Single source of truth for `PLUSD._update`, `sPLUSD._update`, and the claim-time backstop in `WithdrawalQueue.claim`. |
| `setFreshnessWindow(uint256 seconds)` | ADMIN, bounded `[7d, 365d]` | Adjusts the re-screening cutoff. 48h-delayed, GUARDIAN-cancellable. |
| `setKytAttestor(address newAttestor)` | ADMIN | Rotates the signing key for `EnrolAttestation`. 48h-delayed, GUARDIAN-cancellable. |
| `addDeFiVenue(address venue)` | ADMIN | Adds an approved DeFi pool or vault to the system-address allowlist. Bypasses freshness. |
| `removeDeFiVenue(address venue)` | ADMIN | Removes a DeFi venue. |
| `isNonceUsed(bytes32 nonce)` | public view | Replay guard for enrol attestations. |

`isAllowedForMint` is removed. Mint eligibility is no longer a registry concern. `DepositManager` checks ticket status and verifies the claim attestation. `enrol` takes a separate `EnrolAttestation` shape distinct from the deposit/withdrawal claim attestations.

### Enrol attestation

```solidity
struct EnrolAttestation {
    bytes32 actionId;       // keccak256(abi.encode(chainId, contract, "enrol", addr))
    address holder;
    uint64  approvedAt;
    uint64  deadline;
    bytes32 nonce;
}
```

EIP-712 domain is the WhitelistRegistry contract's domain, distinct from DepositManager and WithdrawalQueue domains. Same `kytAttestor` signs all three across rotations.

### `freshnessWindow`

`freshnessWindow` is the maximum age of the KYT screening result the protocol is willing to accept on a transfer. Default is 90 days. It is **not** an oracle-freshness concept and has no relationship to deposit rate limits. It only gates `isAllowed`. An expired entry blocks PLUSD and sPLUSD transfers to or from the address until refreshed via `refreshScreening`.

---

## WithdrawalQueue

Lifecycle: `Pending -> Claimed | AdminReleased`.

| Function | Access | Description |
|---|---|---|
| `requestWithdrawal(uint256 amount)` | public | Pulls PLUSD from caller into queue escrow. Assigns `queueId`. Increments `totalRequested`. Emits `WithdrawalRequested`. The PLUSD transfer triggers `PLUSD._update`, which enforces `isAllowed` (whitelist plus freshness). A stale or revoked caller reverts here. |
| `claim(uint256 queueId, ClaimAttestation att, bytes sig)` | public (original requester only) | Verifies the EIP-712 signature against `kytAttestor`, checks attestation fields and nonce, re-checks `WhitelistRegistry.isAllowed` as a backstop, enforces `claimAmount <= totalClaimable`, pulls USDC from Withdrawal Queue Wallet via standing allowance, burns escrowed PLUSD, increments `totalClaimed`. Emits `WithdrawalClaimed`. All atomically. |
| `adminRelease(uint256 queueId)` | ADMIN (3/5) | Manually flips a `Pending` entry to `AdminReleased`. PLUSD does not move on this call. Used for sanctioned or disputed entries. Escrowed PLUSD disposition is a separate ADMIN action. |
| `getEntry(uint256 queueId)` | public view | Returns the entry struct. |
| `getAggregates()` | public view | Returns `(totalRequested, totalClaimed, totalClaimable)`. |
| `isNonceUsed(bytes32 nonce)` | public view | Replay guard for claim attestations. |
| `setKytAttestor(address)` | ADMIN | Rotate the off-chain attestation signing key, 48h-delayed and GUARDIAN-cancellable. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of `requestWithdrawal` and `claim`. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancellable. |

### Claim attestation

Same shape as `DepositManager.claim`. Distinct EIP-712 domain (WithdrawalQueue's). Verifies that the off-chain Relayer KYT pass is fresh at claim time and bound to this specific queue entry.

Partial fills, `cancelWithdrawal`, and lender-initiated cancellation are not in MVP.

### Self-limit invariant

`claim` enforces `claimAmount <= totalClaimable`, where `totalClaimable = totalRequested - totalClaimed`. This is independent of the allowance the Withdrawal Queue Wallet has granted to the contract. Even if the allowance is `MAX_UINT`, the contract physically refuses to pull more USDC than the queue's outstanding obligations. Allowance is the permission ceiling. The aggregate ledger is the spending discipline.

### Sanctions and Withdrawal Queue Wallet

Sanctions handling between request and claim, the Withdrawal Queue Wallet's role as settlement custody, top-up cadence, and the hardware circuit breaker are documented in [withdrawals.md](./withdrawals.md).
