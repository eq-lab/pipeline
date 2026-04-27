# Smart Contracts — Contract Interfaces (Core)

> Interface definitions for PLUSD, DepositManager, YieldMinter, sPLUSD, WhitelistRegistry, and WithdrawalQueue. See [smart-contracts.md](./smart-contracts.md) for the main spec (overview, governance, contracts table, security, actor glossary). See [smart-contracts-registry.md](./smart-contracts-registry.md) for LoanRegistry, ShutdownController, and Shutdown Mode.

---

## PLUSD

| Function | Access | Description |
|---|---|---|
| `mintForDeposit(address lp, uint256 amount)` | DEPOSITOR (DepositManager) | Mints PLUSD 1:1 to a USDC deposit. Increments `cumulativeLPDeposits`. Reverts if `_update` hook rejects recipient. |
| `mintForYield(address recipient, uint256 amount)` | YIELD_MINTER (YieldMinter) | Mints yield PLUSD into a system address (sPLUSD vault or Treasury Wallet). Increments `cumulativeYieldMinted`. No signature verification here — signature checks live in `YieldMinter`. |
| `burn(address from, uint256 amount)` | BURNER (WithdrawalQueue) | Burns escrowed PLUSD when LP calls `claim` or `redeemInShutdown`. Increments `cumulativeLPBurns`. |
| `transfer / transferFrom` | public | Standard ERC-20. `_update` hook enforces: both non-zero endpoints must be either a whitelisted LP or a system address. Transfers within the whitelist set (LP↔LP) and between system addresses are permitted; any leg touching an unscreened wallet reverts. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all mint, burn, and transfer operations. |
| `unpause()` | ADMIN | Restores operations; subject to 48h AccessManager delay, cancellable by GUARDIAN. |
| `assertLedgerInvariant()` | public view | Returns `cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns − totalSupply`. This is always 0 when the ledger is consistent; any non-zero value indicates a contract bug in one of the three mint/burn paths. Diagnostic only — not a health gradient. |

Direct `mint(address, uint256)` is removed. Fresh PLUSD enters supply only through
`mintForDeposit` (deposit leg) or `mintForYield` (yield leg), each callable by exactly one
contract address.

### Ledger invariant

PLUSD maintains three cumulative counters, updated in the same transaction that moves value:

| Counter | Incremented in | Meaning |
|---|---|---|
| `cumulativeLPDeposits` | `mintForDeposit` | Total PLUSD ever minted on the deposit leg |
| `cumulativeYieldMinted` | `mintForYield` | Total PLUSD ever minted on the yield leg |
| `cumulativeLPBurns` | `burn` | Total PLUSD ever burned (via WQ claim or `redeemInShutdown`) |

Every mint/burn path asserts, post-state-change:

```
totalSupply() == cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns
```

Since these three functions are the only entry points that change `totalSupply`, the
invariant must hold exactly. A violation signals a contract bug (e.g. a counter
increment was missed), not a recoverable drift. The check is internal-consistency only —
it catches counter desync and makes any over-mint against the contract's own ledger
revert. It is **not** a Proof of Reserve: it does not verify the custodian actually
holds the USDC. Full on-chain PoR (Chainlink) is phase 2.

---

## DepositManager

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 usdcAmount)` | public | Atomic deposit: checks `isAllowedForMint`, per-LP cap, window cap, supply cap; pulls USDC from LP to Capital Wallet; calls `PLUSD.mintForDeposit`. |
| `setMaxPerWindow(uint256)` / `setMaxPerLPPerWindow(uint256)` / `setMaxTotalSupply(uint256)` | ADMIN | Parameter setters. Tightening instant, loosening 48h-delayed and GUARDIAN-cancelable. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all deposits. |
| `unpause()` | ADMIN | Restores deposits; subject to 48h AccessManager delay, cancellable by GUARDIAN. |

### Deposit rate-limit parameters

All deposit caps are enforced inside `DepositManager`, not inside PLUSD. PLUSD is unaware
of windows or supply ceilings.

| Cap | Enforced | Loosening |
|---|---|---|
| `maxPerWindow` | Aggregate PLUSD minted via deposit across all LPs per fixed 24h window | ADMIN, 48h delay |
| `maxPerLPPerWindow` | Per-LP PLUSD minted per fixed 24h window | ADMIN, 48h delay |
| `maxTotalSupply` | Hard ceiling on `PLUSD.totalSupply()` — circuit breaker for phased launch | ADMIN, 48h delay |

The window is a **fixed 24h window**, not a rolling one: the counters `windowMinted` and
`lpWindowMinted[lp]` reset whenever `block.timestamp` crosses a `windowStart + 24h`
boundary. Worst case is `2 × maxPerWindow` over a boundary (last second of window N plus
first second of window N+1). This is acceptable because `maxTotalSupply` and the custodian
MPC policy engine's independent cap on Bridge-originated USDC releases both bound the
worst-case blast radius, and the fixed-window algorithm is materially simpler than a
sliding-window counter. The per-tx cap (`maxPerTx`) was dropped in v2.3 — per-LP per
window already bounds any one actor, and per-tx caps create UX friction for legitimate
large deposits without a security benefit.

`maxTotalSupply` is implemented as a custom mutable cap (OZ `ERC20Capped` is immutable
and therefore unsuitable). Rationale: phased-launch bound and blast-radius circuit
breaker during the period before PoR lands. In a later version this cap may be removed
once custodian MPC policy + rolling PoR provide equivalent bounds.

---

## YieldMinter

| Function | Access | Description |
|---|---|---|
| `yieldMint(YieldAttestation att, bytes bridgeSig, bytes custodianSig)` | public (any caller — sigs are the gate) | Verifies Bridge ECDSA (ecrecover on `bridgeYieldAttestor`) + custodian EIP-1271 (on `custodianYieldAttestor`). Enforces `att.ref` unused, destination ∈ {sPLUSD vault, Treasury Wallet}, amount > 0. On success, calls `PLUSD.mintForYield(att.recipient, att.amount)`. Marks `att.ref` consumed. |
| `proposeYieldAttestors(address bridge, address custodian)` | ADMIN | Rotates signer addresses; 48h AccessManager delay, GUARDIAN-cancelable. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all yield mints. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancelable. |

Pulling signature verification out of PLUSD has two benefits. (1) Incident response: on a
suspected attestor compromise GUARDIAN pauses `YieldMinter` or revokes `YIELD_MINTER` on
the PLUSD contract from the YieldMinter proxy; no PLUSD upgrade is needed. (2) Audit
surface: the token contract contains no signature-verification code, keeping its blast
radius tight.

---

## sPLUSD (ERC-4626)

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 assets, address receiver)` | public | Standard ERC-4626 deposit. `receiver` must pass the shared whitelist check (whitelisted LP or system address); same rule applies as on a plain sPLUSD transfer. |
| `redeem(uint256 shares, address receiver, address owner)` | public | Standard ERC-4626 redeem. Plain OZ implementation; does **not** trigger any on-chain yield mint. Bridge runs the USYC NAV freshness check off-chain against pending `Deposit` / `Withdraw` events and lands the two-party `yieldMint` via `YieldMinter` before allowing the redeem to settle at a stale NAV (see `yield.md`). |
| `transfer / transferFrom` | public | Standard ERC-20. `_update` hook mirrors PLUSD: both non-zero endpoints must be a whitelisted LP or a system address. Whitelisted LPs can transfer sPLUSD freely amongst themselves. |
| `totalAssets()` | public view | Returns `PLUSD.balanceOf(address(this))`. Increases when yield mints land in the vault. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of deposits and redemptions. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancelable. |

---

## WhitelistRegistry

| Function | Access | Description |
|---|---|---|
| `setAccess(address lp, uint256 approvedAt)` | WHITELIST_ADMIN (Bridge) | Adds or updates a whitelisted LP with the Chainalysis screening timestamp. |
| `refreshScreening(address lp, uint256 newApprovedAt)` | WHITELIST_ADMIN (Bridge) | Updates `approvedAt` for an existing whitelisted LP after re-screening. |
| `revokeAccess(address lp)` | WHITELIST_ADMIN (Bridge) or ADMIN | Removes LP from the whitelist immediately. |
| `isAllowed(address lp)` | public view | Returns true if LP is whitelisted. Does not check freshness. Used by WithdrawalQueue and PLUSD `_update`. |
| `isAllowedForMint(address lp)` | public view | Returns true if LP is whitelisted AND `(block.timestamp − approvedAt) < freshnessWindow`. Used by DepositManager at deposit time. |
| `setFreshnessWindow(uint256 seconds)` | ADMIN, bounded `[7d, 365d]` | Adjusts the Chainalysis re-screening cutoff. 48h-delayed, GUARDIAN-cancelable. |
| `addDeFiVenue(address venue)` | ADMIN | Adds an approved DeFi pool/vault to the system-address allowlist. |

### `freshnessWindow`

`freshnessWindow` is the maximum age of the Chainalysis screening result the protocol is
willing to mint against. Default is 90 days. It is **not** an oracle-freshness concept
and has no relationship to rate limits; it only gates `isAllowedForMint`. At the deposit
path, if an LP's last screening is older than `freshnessWindow`, `DepositManager.deposit`
reverts and the Bridge re-screens via Chainalysis before calling `refreshScreening` to
update `approvedAt`. At the withdrawal path, staleness is handled by Bridge before
calling `fundRequest` (see withdrawals spec).

---

## WithdrawalQueue

Lifecycle: `Pending → Funded → Claimed | AdminReleased`

| Function | Access | Description |
|---|---|---|
| `requestWithdrawal(uint256 amount)` | public | Pulls PLUSD from caller into escrow; assigns `queue_id`; emits `WithdrawalRequested`. Reverts if caller not whitelisted with a fresh screen. |
| `fundRequest(uint256 usdcAmount)` | FUNDER (Bridge) | Pulls `usdcAmount` USDC from Capital Wallet via pre-approved allowance, funds as many consecutive queue heads in full as the amount covers, emits `WithdrawalFunded(queueId)` per filled entry. Reverts if `usdcAmount` is not exactly the sum of one or more contiguous head entries (no change / partial fills). |
| `skipSanctionedHead()` | FUNDER (Bridge) | Moves a currently-not-`isAllowed` queue head to `AdminReleased`, unblocking the queue. Escrowed PLUSD remains in the contract pending ADMIN disposition. See Sanctioned Head Handling below. |
| `claim(uint256 queueId)` | public (original requester only) | Atomically burns escrowed PLUSD and pays out USDC to LP. Only callable after `Funded`. Emits `WithdrawalClaimed`. |
| `adminRelease(uint256 queueId)` | ADMIN | Manual release of a stuck entry to `AdminReleased`; disposition of escrowed PLUSD handled by a separate ADMIN action. |
| `getQueueDepth()` | public view | Returns `(totalEscrowed, pendingCount, fundedCount)`. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of `fundRequest` and `claim`. |
| `unpause()` | ADMIN | 48h-delayed, GUARDIAN-cancelable. |

Partial fills, `cancelWithdrawal`, and LP-initiated cancellation are not in the MVP.

### Sanctioned head handling

If at the moment Bridge evaluates the head `isAllowed(requester) == false` — i.e. the LP
has been removed from the whitelist since `requestWithdrawal` (Chainalysis flag, OFAC
listing, or manual revoke) — Bridge calls `skipSanctionedHead()`. The entry moves to
`AdminReleased`, unblocking the queue for subsequent LPs. **No USDC is transferred for
this entry**; the Capital Wallet is untouched. The escrowed PLUSD stays inside WQ
pending ADMIN disposition (e.g. legal/regulatory direction on a confirmed OFAC match).
This is a legal requirement, not a policy choice — disbursing USDC to a sanctioned
address would expose the protocol to sanctions liability, and USDC itself enforces the
equivalent at the stablecoin level.

This path is reserved for actual sanctions / whitelist revocation. Merely-stale
Chainalysis screens do not go through `skipSanctionedHead`; Bridge re-screens and calls
`WhitelistRegistry.refreshScreening` to restore freshness before funding.
