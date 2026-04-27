# Security — Defence Stack & Operational Tables

> MVP defence stack, timelock action table, pause cascade, and cross-rail sequence integrity. See [security.md](./security.md) for the main spec (threat model, peer comparison, known properties, trust assumptions).

---

## MVP defence stack

Five independent layers. All ship for MVP; Chainlink PoR is phase 2.

### Layer 0 — Economic bounds on mint

Three numeric caps enforced by PLUSD itself, managed by ADMIN 3/5 through the 48h
AccessManager timelock:

1. **`maxPerWindow`** — aggregate PLUSD minted per rolling 24h window, across all LPs.
2. **`maxPerLPPerWindow`** — per-LP PLUSD minted per rolling 24h window (LP path only;
   yield mints to system addresses are exempt).
3. **`maxTotalSupply`** — hard ceiling on `PLUSD.totalSupply()`.

Tightening any cap is instant (ADMIN). Loosening is 48h-delayed and GUARDIAN-cancelable.
Per-transaction caps (`maxPerTx`) were considered and dropped in v2.3: per-LP-per-window
already bounds any one actor, and a per-tx cap creates UX friction for legitimate large
deposits without a security benefit.

### Layer 1 — DepositManager (atomic 1:1 on-chain deposit, no attestor)

DepositManager closes the Resolv attack class for the deposit leg. Users call
`deposit(usdcAmount)` directly; the contract:

- Pulls USDC from the LP via `transferFrom(lp, capitalWallet, amount)` — one on-chain
  transfer, LP → Capital Wallet.
- Calls `PLUSD.mintForDeposit(lp, amount)` — restricted to the DEPOSITOR role held by
  DepositManager.
- Enforces `isAllowedForMint` (whitelist + freshness) inside PLUSD's `_update`.

The on-chain USDC move IS the attestation. There is no off-chain signer to forge, and
no way to mint without the USDC actually moving. MINT_ATTESTOR is retired.

### Layer 1b — Contract-tracked reserve invariant

PLUSD maintains three cumulative counters, updated in the same transaction that moves
value:

- `cumulativeLPDeposits` — incremented on every `mintForDeposit`.
- `cumulativeYieldMinted` — incremented on every `yieldMint`.
- `cumulativeLPBurns` — incremented on every `burn` (via WithdrawalQueue) and on
  `redeemInShutdown`.

Every mint path asserts:

```
totalSupply() + amount <= cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns
totalSupply() + amount <= maxTotalSupply
```

This is internal consistency, not true Proof of Reserve. It prevents over-minting
against the contract's own ledger but does not verify that the custodian actually holds
the underlying USDC. Full on-chain PoR (Chainlink) is phase 2.

### Layer 2 — Two-party attestation for yield mints

Yield mints are the remaining signer-dependent path because no user-side collateral
gates them — yield is an abstract off-chain P&L event (loan repayments and USYC accrual).

- **Relayer** signs first with `relayerYieldAttestor` (ECDSA).
- The **custodian-provisioned EIP-1271 signer contract** independently verifies the
  underlying USDC inflow against the custodian's own ledger and signs second. Signing
  policy is driven by the custodian's platform (Fireblocks API Co-Signer callback
  handler, BitGo Policy Engine webhook, or equivalent). The on-chain contract validates
  via `IERC1271.isValidSignature` → `0x1626ba7e`.
- `PLUSD.yieldMint(att, relayerSig, custodianSig)` verifies both signatures on-chain.

Compromising Relayer alone mints zero PLUSD. Compromising the custodian alone mints
zero PLUSD.

### Layer 3 — GUARDIAN (Ethena-style) + off-chain Watchdog

GUARDIAN Safe (2/5) holds instant, granular defensive powers:

- Pause any pausable contract.
- Cancel any pending ADMIN scheduled action.
- `AccessManager.revokeRole(role, account)` for operational roles only
  (`YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`) — one role, one holder at
  a time.

GUARDIAN cannot grant, unpause, upgrade, or move funds. Restoring service is ADMIN-only
under the 48h AccessManager delay (itself GUARDIAN-cancelable).

An off-chain Watchdog service continuously reconciles on-chain mint events against
custodian-reported inflows and can recommend a GUARDIAN trip on divergence, giving
sub-minute reaction time.

### Layer 4 — Timelock action table

| Action | Caller | Delay | Canceller |
|---|---|---|---|
| Pause any managed contract | GUARDIAN 2/5 | instant | — |
| Cancel any scheduled operation | GUARDIAN 2/5 | instant | — |
| Revoke operational-role holder (`YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`) | GUARDIAN 2/5 | instant | — |
| Lower any cap (tighten) | ADMIN 3/5 | instant | — |
| Unpause any managed contract | ADMIN 3/5 | 48h | GUARDIAN |
| Re-grant any operational role after revocation | ADMIN 3/5 | 48h | GUARDIAN |
| Rotate `YIELD_MINTER` / `FUNDER` / `WHITELIST_ADMIN` holder | ADMIN 3/5 | 48h | GUARDIAN |
| Rotate `TRUSTEE` holder | ADMIN 3/5 | 48h | GUARDIAN |
| Rotate yield-attestor keys (`proposeYieldAttestors`) | ADMIN 3/5 | 48h | GUARDIAN |
| Grant any new role to any address | ADMIN 3/5 | 48h | GUARDIAN |
| Raise `maxTotalSupply` | ADMIN 3/5 | 48h | GUARDIAN |
| Raise `maxPerWindow` / `maxPerLPPerWindow` | ADMIN 3/5 | 48h | GUARDIAN |
| Change `freshnessWindow` | ADMIN 3/5 | 48h | GUARDIAN |
| Upgrade any contract (`upgradeTo`) | ADMIN 3/5 | 48h | GUARDIAN |
| Change AccessManager admin delay (`setTargetAdminDelay`) | ADMIN 3/5 | 14 days | GUARDIAN |
| `adminRelease(Pending)` — unstick pending queue entry | ADMIN 3/5 | instant | — |
| `adminReleaseFunded` — release a Funded entry blocked by sanctions | ADMIN 3/5 | 24h | GUARDIAN |
| `setDefault` (LoanRegistry) | RISK_COUNCIL 3/5 | 24h | GUARDIAN |
| `proposeShutdown` | RISK_COUNCIL 3/5 | 24h | GUARDIAN |
| `adjustRecoveryRateUp` (shutdown) | RISK_COUNCIL 3/5 | 24h | GUARDIAN |

---

## Pause cascade

Pausing one contract does not pause the whole system — each contract is independent.
Cascade effects:

| Paused | Effect | Unaffected |
|---|---|---|
| PLUSD | All mints, transfers, burns revert (except `redeemInShutdown` via transient flag). DepositManager, sPLUSD, WithdrawalQueue all stop operating because they depend on PLUSD being mintable/burnable/transferable. | View functions. |
| DepositManager | `deposit` reverts. PLUSD remains operational if not separately paused (yield mints and withdrawals continue). | Yield mints, withdrawals, sPLUSD stake/unstake. |
| sPLUSD | `deposit`, `redeem`, and vault-side transfers revert. Yield mints to Treasury still land if PLUSD is unpaused. | Other capital paths. |
| WithdrawalQueue | `requestWithdrawal`, `fundRequest`, `skipSanctionedHead`, `claim`, `claimAtShutdown` revert. | Deposits, stake/unstake. |
| WhitelistRegistry | `setAccess`, `refreshScreening`, `revokeAccess` revert. View functions continue. | Read-path gates in other contracts. |
| LoanRegistry | All mutations revert. Capital flows are unaffected — registry is informational. | All capital operations. |
| RecoveryPool | `deposit`, `release` revert. During shutdown, this blocks redemptions. | — |

PLUSD pause is the nuclear option; it cascades implicitly. Prefer the narrowest
possible pause scope for a given incident class.

---

## Cross-rail sequence integrity

| Sequence | Risk | Mitigation |
|---|---|---|
| LP calls `DepositManager.deposit(amount)` → USDC moves LP → Capital Wallet → PLUSD minted 1:1 to LP | `transferFrom` succeeds but `mintForDeposit` reverts | Atomic: any revert propagates and the whole transaction reverts. Cannot produce a dangling USDC transfer without matching PLUSD. |
| Relayer + custodian co-sign `YieldAttestation`; Relayer submits `yieldMint(att, relayerSig, custodianSig)`; repeated for each destination (vault, treasury) | First succeeds, second fails: vault yield accreted but treasury share missing | Two separate calls, each idempotent on `repaymentRef` (destination-scoped). Relayer retries the failed leg with a fresh `salt` after re-cosign. |
| LP submits `requestWithdrawal` → Relayer calls `fundRequest` → LP calls `claim` | Relayer never custodies USDC; `claim` is atomic (burn + transfer). | Capital Wallet → WQ allowance is cosigned (Trustee + Relayer) at deploy. If Relayer is compromised, Trustee revokes allowance out-of-band. |
| LP withdrawal USDC leg (Capital Wallet → WQ → LP) | LP attempts to route payout to a new address | `claim` pays only the original requester on-chain; custodian MPC policy engine also enforces per-LP destination-set matching on the Capital Wallet → WQ release (R2). |
| Trustee verifies USDC repayment on Capital Wallet → Relayer calls `yieldMint` and Trustee calls `recordRepayment` + `closeLoan(EarlyRepayment)` | Yield mints but registry updates fail (or vice versa) | Two independent transactions; yield is the capital-critical leg and is retried. Registry updates are idempotent (mutating on Closed reverts cleanly). Registry lag does not affect share price — LoanRegistry is informational only. |
