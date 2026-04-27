# Security & Threat Model

## Overview

This document is the audit-facing companion to [smart-contracts.md](./smart-contracts.md)
and [relayer-service.md](./relayer-service.md). It captures the threat model behind the
v2.3 design, the MVP defence stack, a peer-protocol comparison, the full timelock action
table, known residual properties, and the trust assumptions an external reviewer should
assume.

Guiding principle: **no single compromise — Relayer, custodian, a single governance Safe,
or the Trustee key — allows an unbacked mint or a unilateral drain of investor capital.**
Joint compromises (e.g. Relayer yield-signer + custodian signer together) remain bounded
by Layer 0 economic caps and detected by the Layer 3 watchdog.

---

## Threat model

### Attack vectors by single-role / single-key compromise

| Compromise | What the attacker does, step by step | Net effect |
|---|---|---|
| **Relayer operational key (the modern rollup of FUNDER + WHITELIST_ADMIN + YIELD_MINTER holders)** | Cannot mint deposit PLUSD — deposits are atomic LP-driven calls to DepositManager with no Relayer dependency. Cannot mint yield alone — `PLUSD.yieldMint` still requires a valid custodian EIP-1271 signature. Can submit `fundRequest` on any queued withdrawal (but Relayer never custodies USDC; the transfer is Capital-Wallet-to-WQ via pre-approved allowance). Can modify the WhitelistRegistry, but adding an address is not a drain path — deposit minting is cryptographically bound to the caller's own USDC transfer. | Bounded. GUARDIAN can instantly pause PLUSD/DepositManager/WQ and revoke `YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN` one at a time. No unbacked mint; no direct theft. |
| **Relayer yield-signer key (`relayerYieldAttestor`) alone** | Can produce valid Relayer-side EIP-712 signatures for yield attestations. | Bounded — zero mints. The custodian's EIP-1271 signer independently verifies the underlying USDC inflow and signs second; PLUSD's `yieldMint` verifies both on-chain. Compromising Relayer's yield signer alone mints nothing. 48h-timelocked rotation via `proposeYieldAttestors`. |
| **Custodian yield-signer alone** | Can produce a valid EIP-1271 signature for yield attestations. | Bounded — zero mints. Relayer must co-sign (ECDSA) and hold `YIELD_MINTER` to submit. Custodian also carries independent legal/compliance controls. |
| **Trustee key** | Can write any LoanRegistry state: mint ghost loans, write false `recordRepayment` entries, `closeLoan(ScheduledMaturity)` without an actual repayment. Is also one cosigner on the Capital Wallet MPC. | Data-integrity damage only on the on-chain LoanRegistry — it has no capital touchpoints and is not a NAV source, so false entries do not inflate share price or drain funds. Capital Wallet releases require Relayer cosign too, so single-key Trustee compromise cannot move USDC. `Default` transition requires RISK_COUNCIL (24h timelock) — unreachable by Trustee. GUARDIAN revokes `TRUSTEE` instantly; ADMIN rotates under 48h timelock. |
| **WHITELIST_ADMIN in isolation** | Can add any address to the whitelist. | Not a drain path on its own. Whitelisting an address does not mint; mints require the address to actually transfer USDC through DepositManager, or the address to be the destination of a two-party-attested yield mint. The v2.3 elimination of MINT_ATTESTOR closed the "add + attest → mint to self" Resolv-shape class. |
| **FUNDER in isolation** | Can call `fundRequest` on any queued withdrawal. | Not a drain path. Funding a queue entry pulls USDC from the Capital Wallet to WQ, where the original requester alone can `claim` (PLUSD burn + USDC transfer atomic). FUNDER cannot redirect payouts. Only accelerates legitimate queued claims. |
| **Single Safe compromise (ADMIN, RISK_COUNCIL, or GUARDIAN)** | ADMIN: can schedule upgrades, role grants, parameter loosenings — all 48h-timelocked; GUARDIAN cancels. RISK_COUNCIL: can propose `setDefault` or `proposeShutdown` — 24h-timelocked; GUARDIAN cancels. GUARDIAN: can pause, cancel, and revoke operational-role holders — cannot grant, unpause, upgrade, move funds. | Timelock + distinct Safe signer sets + Ethena-style granular emergency response contain each single-Safe compromise scenario. |
| **Joint Relayer yield-signer + custodian signer compromise** | Produce valid two-sig attestation; PLUSD mints; `cumulativeYieldMinted` self-advances. | Bounded by Layer 0 caps (`maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply`). Detected by the Watchdog reconciling on-chain mints against custodian-reported inflows. Phase-2 Chainlink PoR removes this residual. |

### Additional v2.3 threat rows

| Compromise | Mechanism | Net effect / mitigation |
|---|---|---|
| **UPGRADER / ADMIN Safe (UUPS upgrade)** | Schedule `upgradeTo(maliciousImpl)` that removes the reserve invariant or adds unrestricted mint. | 48h AccessManager delay + GUARDIAN cancel + EIP-712 domain-pin check in `_authorizeUpgrade` (new implementation must return matching `name`/`version` from `eip712Domain()`). 14-day meta-timelock on delay changes prevents a "collapse-the-delay-then-exploit" sequence. |
| **Trustee + Relayer yield-signer joint compromise** | Trustee fabricates a `RepaymentRecorded` event; the joint party produces a valid Relayer-side yield attestation; custodian is asked to co-sign. | Custodian's EIP-1271 signer must independently verify the underlying USDC inflow against the custodian's own ledger; if no USDC actually arrived, the co-sign is refused. Additional defence: Watchdog cross-checks `RepaymentRecorded` against Capital Wallet inflows. |
| **First-deposit ERC-4626 inflation on sPLUSD** | Attacker is first depositor, donates USDC directly to vault, next LP's shares round to zero. | OZ v5.x `ERC4626Upgradeable` with `_decimalsOffset` mitigation (dead-shares seed). Audit test: first-deposit donation attempt at live config. |
| **Reentrancy on mint/burn paths** | Re-enter `yieldMint` or `mintForDeposit` inside a callback during `_mint`, before counters are updated. | Counter increments happen before `_mint`; all entry points carry `nonReentrant`. PLUSD is non-transferable and has no external callback in its transfer path. |
| **Governance capture via overlapping Safe signer sets** | Same people sign ADMIN + RISK_COUNCIL + GUARDIAN — the three-Safe model collapses to a one-Safe model and the 48h / 24h / instant separation is nominal. | Signer-disjointness is an **operational requirement** enforced off-chain. Distinct member sets across ADMIN (3/5), RISK_COUNCIL (3/5), GUARDIAN (2/5). Recommend at least one external signer on GUARDIAN. |
| **Watchdog compromise or offline** | Watchdog fails to detect mint-vs-inflow divergence; Layer 3 becomes inoperable. | Watchdog runs on infrastructure disjoint from Relayer. Its output is a GUARDIAN-trip recommendation, not an autonomous on-chain action. Fallback: Trustee and any GUARDIAN member can raise alerts independently. Accepted gap in MVP. |
| **LP sanctioned post-mint** | LP holds PLUSD and is subsequently added to OFAC / flagged by Chainalysis. | Relayer calls `WhitelistRegistry.revokeAccess(lp)`. Subsequent withdrawal: if LP is at queue head, Relayer calls `skipSanctionedHead` (requires `!isAllowed`). ADMIN can `adminRelease` to remove the entry. PLUSD already held is frozen from further transfers by the non-transferability rule (every transfer requires a system-address leg). |
| **GUARDIAN griefing (DoS, not theft)** | A compromised GUARDIAN (2/5) repeatedly cancels scheduled ADMIN actions, blocking every parameter change or role re-grant. | Not a theft vector; a liveness issue. ADMIN can rotate GUARDIAN signers (via its own 48h-timelocked grant), but that grant is itself GUARDIAN-cancelable — the failure mode is "stuck at current config" until off-chain resolution. Accepted risk; mitigated by distinct signer sets. |

---

## Peer-protocol comparison

| Protocol | Relevant mechanism | Takeaway for Pipeline |
|---|---|---|
| **Ethena (USDe)** | EIP-712 signed mint orders; 100k USDe per-block hard cap; separate GATEKEEPER role that can disable mint/redeem (pause-only, not unpause); 7/10 cold multisig owns contracts. | Closest analog for Pipeline's emergency-response model. Caps blast radius; pause-only role independent of owner maps directly onto Pipeline's GUARDIAN (2/5). **The Ethena GATEKEEPER split is the design Pipeline v2.3 adopts.** |
| **Resolv (USR) — exploited March 2026** | Single AWS KMS signing key. Signature validity was the only check. No collateral ratio check, no supply cap, no rate limit. | Cautionary tale: $25M extracted in 17 minutes. Pipeline's pre-v2.3 design had the same shape; v2.3 closes it by retiring MINT_ATTESTOR and adopting DepositManager + on-chain economic caps. |
| **Ondo (OUSG) — OUSGInstantManager** | User calls `mint(usdcAmount)`. Contract pulls USDC atomically via `transferFrom`, reads NAV from oracle, mints OUSG, forwards USDC to Coinbase custody. All atomic, no off-chain attestor. | Proven open-source pattern that delivers instant UX with no off-chain signer trust on the deposit leg. Directly adopted by Pipeline as DepositManager (simplified: PLUSD is 1:1, no NAV scaling). |
| **Chainlink Proof of Reserve (TUSD, Cache Gold, PoundToken)** | Oracle feed carries custodian-attested cumulative reserves; mint reverts if `totalSupply + amount > reserveFeed.latestAnswer()`; stale feed reverts. | Structural bound that cannot be bypassed even with full mint-key compromise. Target for phase 2. |
| **MakerDAO (PSM, DC-IAM)** | Debt Ceiling Instant Access Module: per-module max line, target available debt, ceiling-increase cooldown. | Governance sets the envelope; anyone can move within it. Pattern adopted for `maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply`. |
| **Lido (stETH)** | 1:1 trustless minting: ETH → deposit contract atomically mints stETH. No off-chain signer. | Principle: do not add an off-chain signer when you can verify on-chain. Pipeline cannot fully replicate (custodied USDC ≠ ETH deposit contract), but the principle drives DepositManager. |

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
totalSupply() + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns
totalSupply() + amount ≤ maxTotalSupply
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

---

## Known properties (not bugs)

- **Rolling-window boundary.** Rate limit uses a fixed-window algorithm; worst case is
  `2 × maxPerWindow` over a window boundary. Bounded by `maxTotalSupply` and the
  custodian MPC policy engine's independent cap on Relayer-originated USDC releases.
- **`windowMinted` does not decrease on burn.** Net supply may be lower than window
  usage suggests. Mints and burns have different purposes.
- **LoanRegistry mutable state is Trustee-attested, not on-chain verified.**
  `updateMutable`, `recordRepayment`, and `closeLoan(ScheduledMaturity | EarlyRepayment)`
  are written on Trustee attestation only. The `Default` transition is the sole
  RISK_COUNCIL-gated exception. Because LoanRegistry has no capital touchpoints and
  is not a NAV source, this is data-integrity risk only, not fund risk.
- **Chainalysis 90-day freshness is a second factor.** `WhitelistRegistry.isAllowedForMint`
  fails if `(block.timestamp − approvedAt) ≥ freshnessWindow`, even for whitelisted LPs.
  A compromised `WHITELIST_ADMIN` alone cannot enable a mint because it would also need
  to forge a fresh Chainalysis timestamp.
- **Recovery rate only ratchets up.** Post-entry discoveries of further losses do not
  reduce the rate; LPs who have not yet redeemed wait on Trustee inflows rather than
  taking a rate cut. Explicit design decision to prevent patient-LP value transfer to
  early exiters.
- **Reserve invariant is internal-consistency only.** It verifies the contract's own
  counters against its own `totalSupply`; it does not verify that the custodian holds
  the underlying USDC.
- **ADMIN can re-grant GUARDIAN-revoked operational roles.** GUARDIAN revocation is
  therefore temporary unless followed by an ADMIN-level response. Accepted consequence
  of Ethena-style split governance.
- **DeFi venue removal creates a PLUSD black hole.** If a DeFi venue is removed from
  WhitelistRegistry while holding PLUSD, that PLUSD cannot be transferred out.
  Recovery path: re-add the venue temporarily, venue's LPs unwind, remove again.
- **Addresses can exist in multiple allowlist categories simultaneously** (system /
  DeFi venue / KYCed LP). By design — some addresses legitimately satisfy more than
  one category.

---

## Accepted trust assumptions

- **Trustee attestations over LoanRegistry mutable state.** `updateMutable`,
  `recordRepayment`, and `closeLoan(ScheduledMaturity | EarlyRepayment)` are signed
  off-chain by the Trustee and written on-chain via the `TRUSTEE` role. The contract
  does not verify these attestations against capital movement. Mitigation: LoanRegistry
  has no capital touchpoints — data-integrity risk only, not fund risk. Watchdog
  reconciles against Capital Wallet inflows off-chain.
- **Custodian custody of USDC reserves.** The reserve invariant verifies the contract's
  own `totalSupply` against its own cumulative counters; it does not prove on-chain that
  the custodian holds the underlying USDC. Out-of-band checks are the custodian's
  independent legal/compliance controls and the Watchdog reconciliation. Chainlink PoR
  is phase 2.
- **Custodian operation of the EIP-1271 yield-attestor.** The custodian provides and
  operates the EIP-1271 contract that signs half of every yield attestation. A
  compromised custodian signer alone mints zero (Relayer co-signature and `YIELD_MINTER`
  caller role are independent controls). A colluding custodian + Relayer + compromised
  governance could mint; bounded by the 48h attestor-rotation timelock, the three-Safe
  separation, and the custodian's legal accountability.
- **Capital Wallet cosigner integrity.** Trustee + Team + Relayer each hold one MPC share
  of the Capital Wallet. Different transaction categories require different cosigner
  combinations; routine LP withdrawals are auto-signed by Relayer within narrow custodian
  policy bounds. A 2-of-3 cosigner compromise is out of scope for smart-contract
  mitigations (custodian boundary).
- **GUARDIAN compromise is griefing-bounded.** A compromised GUARDIAN can pause
  contracts and revoke operational-role holders, but cannot escalate roles, unpause,
  upgrade, or move funds. ADMIN rotates GUARDIAN signers if compromise is suspected.

---

## Internal rug containment

The "what if the team itself decides to scam?" question is answered structurally, not
by policy promises:

- **Flat topology with ERC-7201 storage discipline.** Mint logic cannot be upgraded
  out from under users silently — every upgrade is a 48h-timelocked ADMIN action,
  GUARDIAN-cancelable, with a domain-pin check that forces the new implementation's
  EIP-712 `name`/`version` to match. Storage slots are append-only.
- **Custodian as independent signer (Layer 2).** Yield mints require a regulated third
  party's EIP-1271 signature in addition to Relayer's. The team cannot mint yield without
  the custodian's co-operation.
- **Reserve-bounded mint (Layer 1b, phase-2 PoR).** The invariant is computed from
  on-chain data the team cannot forge. Over-minting beyond the counter envelope reverts
  at the contract level.
- **Economic caps (Layer 0).** Even within the attested reserve envelope, rolling-window
  and per-LP caps bound any 24h period.
- **Timelocked role rotation (Layer 4).** Operational-role rotations and governance
  actions are all 48h-visible on-chain before they land. A compromised ADMIN cannot
  silently swap Relayer for an attacker-controlled address.
- **Open-source backend + reproducible builds.** Community can verify the Relayer binary
  matches published source. Combined with on-chain invariants, backend behaviour is
  bounded by what the contracts accept.
