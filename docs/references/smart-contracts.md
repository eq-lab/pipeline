# Pipeline MVP Smart Contract Design Specification

**Version:** 2.3
**Date:** 2026-04-20
**Status:** Min-trust-model integration — supersedes v2.2
**Source spec:** `docs/sources/Pipeline_MVP_Technical_Spec_v0_3_8.docx` + Mint Trust Model (`docs/specs/security.md`)
**Scope:** Smart contract layer only (8 contracts + shared AccessManager + EmergencyRevoker)

---

## Changelog

**v2.3 (2026-04-20)** — Min-trust mint model. Integrates the Mint Trust Model review (2026-04-20). Structural goal: no single compromise — Bridge, custodian, or a single governance Safe — can produce unbacked PLUSD.

- **M1 — DepositManager (atomic 1:1 deposit, no attestor).** New contract replacing the `claimMint` / EIP-712 mint-attestation flow entirely. LP calls `deposit(usdcAmount)` directly; the contract pulls USDC via `transferFrom(lp, capitalWallet, amount)` in a single on-chain transfer, then calls `PLUSD.mintForDeposit(lp, amount)`. The on-chain USDC move IS the attestation — there is no off-chain signer to forge. Adapted from Ondo's `OUSGInstantManager` pattern, simplified to omit NAV scaling (PLUSD is 1:1 against USDC).
- **M2 — MINT_ATTESTOR role retired.** All state and functions supporting it are removed from PLUSD: `mintAttestor`, `usedAttestations`, `usedDepositRefs`, `attestationWindow`, `MINT_ATTESTATION_TYPEHASH`, `claimMint`, `setMintAttestor`, `setAttestationWindow`, `invalidateAttestation`, `emergencyClearAttestor`. The Resolv attack class (single-key signature forges unbacked supply) is structurally closed for the deposit leg.
- **M3 — New `DEPOSITOR` role on PLUSD.** Held by the DepositManager proxy address. Gates the new `mintForDeposit(lp, amount)` entry point — the only path through which deposit-driven mints reach `_update`.
- **M4 — Reserve invariant on every mint path.** PLUSD maintains three cumulative counters — `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns` — updated in the same transaction that moves value. Every mint (`mintForDeposit`, `yieldMint`) and every burn (`burn` by WQ) checks: `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`. Not a true Proof of Reserve (verifies internal consistency, not custodian balance), but structurally prevents Resolv-shape over-minting against its own ledger. Full Chainlink PoR deferred to phase 2.
- **M5 — Two-party yield attestation.** `yieldMint(YieldAttestation, bridgeSig, custodianSig)` now verifies *two* EIP-712 signatures on-chain: Bridge (ecrecover on `bridgeYieldAttestor` address) and custodian (EIP-1271 `isValidSignature` on `custodianYieldAttestor` contract — Fireblocks API Co-Signer or BitGo Policy engine). Still `restricted(YIELD_MINTER)` on the caller, so three independent controls gate yield issuance. Compromising Bridge alone mints zero; compromising the custodian alone mints zero. New typehash: `YieldAttestation(bytes32 repaymentRef, address destination, uint256 amount, uint64 deadline, uint256 salt)`. New replay map: `usedRepaymentRefs`.
- **M6 — Economic caps.** Three numeric caps on the PLUSD mint path: `maxPerWindow` (rolling-window cap on total mint volume, existed in v2.2), `maxPerLPPerWindow` (caps single-LP mint activity per rolling window, new), `maxTotalSupply` (hard ceiling on `PLUSD.totalSupply()` — MakerDAO PSM debt-ceiling analog, new). **Per-tx cap (`maxPerTx`) dropped in v2.3** — redundant given per-LP per-window already bounds any one actor, and it creates UX friction for legitimate large deposits without a security benefit. Tightening any cap is instant (ADMIN); loosening is 48h via AccessManager.
- **M7 — EmergencyRevoker simplified.** No longer references PLUSD (no attestor to clear). `revokeAll()` now revokes FUNDER, WHITELIST_ADMIN, YIELD_MINTER from Bridge and TRUSTEE from Trustee. Guardian pauses DepositManager and PLUSD directly.

**v2.2 (2026-04-15)** — Merged canonical release. Incorporates the v2.2 delta review (three critic passes — security, spec-consistency, DeFi-design) and the originator's post-delta simplifications.

- **U1 — Bounded upgradeability.** UUPS proxies on every protocol contract except EmergencyRevoker. `upgradeTo` gated by `UPGRADER` role (ADMIN 3/5) with 48h AccessManager delay; GUARDIAN 2/5 can cancel any pending upgrade. Every implementation constructor calls `_disableInitializers()`. EIP-712 `name`/`version` pinned as compile-time constants to prevent silent domain-separator drift across upgrades. 14-day meta-timelock on `setTargetAdminDelay` to prevent a collapse-delay-then-exploit sequence.
- **U2 — Non-transferable PLUSD.** `_update` requires exactly one of `(from, to)` to be a system address. LP↔LP and system↔system both revert. The previous free-transfer model is closed; yield venue access is still possible because venues are in the `venueAllowlist`, but laundering between two system wallets is prevented structurally.
- **U3 — WithdrawalQueue claim model.** New lifecycle `Pending → Funded → Claimed | AdminReleased`. Bridge funds the queue head with USDC via `fundRequest`; LP later calls `claim` to atomically burn PLUSD and receive USDC. Strict FIFO on funding with automatic skip of sanctioned heads to prevent queue-DoS.
- **U4 — Shutdown mode (Option A, symmetric haircut).** `ShutdownController` contract freezes all normal flow, fixes a `recoveryRateBps`, and opens a one-way `redeemInShutdown` path on PLUSD and `claimAtShutdown` on WQ. Funded requests pay the haircut too (Maker-cage style), closing the queue-jump exploit class.
- **U5 — Three-Safe governance.** ADMIN 3/5 (role management, upgrades, parameter changes), RISK_COUNCIL 3/5 (proposes `setDefault` and `enterShutdown`), GUARDIAN 2/5 (instant pause, cancel any pending scheduled action, `EmergencyRevoker.revokeAll`). Distinct signer sets. *Revised in v2.3: `emergencyClearAttestor` retired with MINT_ATTESTOR; Guardian now pauses DepositManager directly.*
- **U6 — Mint architecture.** Direct `PLUSD.mint(address,uint256)` is removed. Fresh PLUSD enters supply only via (a) `mintForDeposit(lp, amount)` called by DepositManager during an atomic 1:1 USDC→PLUSD deposit, or (b) `yieldMint(att, bridgeSig, custodianSig)`, a destination-constrained two-party-attested path for yield accrual (restricted to sPLUSD vault or Treasury). *Revised in v2.3 from the original EIP-712 `claimMint` self-claim flow; see M1/M2/M5 above.*
- **U7 — EmergencyRevoker non-upgradeable.** One call from GUARDIAN atomically revokes FUNDER, WHITELIST_ADMIN, YIELD_MINTER from the Bridge address and TRUSTEE from the Trustee address. Bridge and Trustee target addresses are ADMIN-updatable with 48h timelock to accommodate routine key rotation. *Revised in v2.3: no longer touches PLUSD (no attestor to zero); see M7.*
- **U8 — Pull-based shutdown unwind.** sPLUSD holders exit post-shutdown through the standard ERC-4626 `redeem` (which returns depegged PLUSD) and then through `PLUSD.redeemInShutdown` for recovery-rate USDC. No special-case shutdown share-conversion function — the race-drain concern is resolved because `redeemInShutdown` pays at a frozen protocol-wide rate, not first-come.

**Post-delta simplifications (originator decision, 2026-04-15) — override the v2.2 delta where they conflict:**

- **`adjustRecoveryRateDown` is dropped.** Recovery rate ratchets **up only** via `adjustRecoveryRateUp` (24h timelock, RISK_COUNCIL). Rationale: lowering the rate after entry transfers value from patient LPs to early exiters, which is strictly anti-LP; rate should only increase as Trustee repatriates capital. All references to the 7d downward delay and the fairness-justification discussion are removed.
- **`convertSharesAtShutdown` is dropped.** sPLUSD holders exit during shutdown via normal `sPLUSD.redeem()` — which returns (depegged) PLUSD — and then redeem through `RecoveryPool` via the standard PLUSD `redeemInShutdown` path. `sPLUSD.redeem` stays open post-shutdown for exit; there is no special-case shutdown conversion function.
- **F-8 pool pre-fund invariant is dropped.** The requirement that `RecoveryPool.balance >= totalSupply × recoveryRateBps` at the moment `enterShutdown` executes was non-sensical — a real crisis implies there is no USDC to pre-fund with. `RecoveryPool` starts at whatever balance it has; the recovery rate is set accordingly at entry from the current pool balance; Trustee tops up the pool over time. Ongoing-operation solvency invariants (rate × outstanding ≤ pool + pending inflows) remain.
- **`setDefault` timelock = 24h** (not 6h). Consistent with the 24h delay already used for shutdown entry.

**v2.1 (2026-04-14)** — Post-alignment reversals after the second Telegram round with the originator. Product-level, not correctness-level.

- **R1 — LoanRegistry reinstated.** Soulbound ERC-721 with immutable + amendable parameter groups. Not in audit scope; no capital touchpoints.
- **R2 — Custodian-side withdrawal enforcement made explicit.** LP-withdrawal destination matching and cumulative cap enforced by custodian MPC policy engine (Fireblocks/BitGo), not by smart contracts. Documented at §7, §10, §11, §15.
- **R3 — EmergencyRevoker extended to four revocations.** (Subsequently extended further in v2.2; see U7.)

**v2.0 (2026-04-14)** — Simplification pass after originator alignment.

- **S1 — OZ AccessManager replaces per-contract AccessControl.**
- **S2 — WithdrawalQueue drops partial fills; strict FIFO.** (Further revised to Pending/Funded/Claimed/AdminReleased model in v2.2; see U3.)
- **S3 — LoanRegistry removed.** (Later reinstated by R1.)

**v1.1 (2026-04-14)** — Correctness pass after adversarial review.

- **A1–A4** WithdrawalQueue `_advanceHead` fix, cross-rail double-spend guard, `whenNotPaused` on confirm, PLUSD `_update` ordering.
- **C1–C5** Spec corrections aligning to intended and implemented behaviour.

**v1.0 (2026-04-11)** — Initial design.

---

## 1. Design Principles

1. **Minimise custom code.** Use OpenZeppelin v5.x audited contracts as the base for every contract. Custom logic is isolated to small, clearly-scoped extensions.
2. **Flat topology.** Each contract is independent; roles are delegated to a single shared `AccessManager` hub (OZ v5.x). No inheritance between protocol contracts (except the shared `TimelockPending` base and the common `AccessManaged` parent). No diamonds.
3. **Bounded upgradeability.** Protocol contracts use OZ v5.x UUPS proxies. `upgradeTo` is gated by the `UPGRADER` role held by ADMIN (3/5 Safe) and subject to a 48h AccessManager-scheduled delay. GUARDIAN (2/5) may cancel any pending upgrade during the window. EmergencyRevoker is non-upgradeable and immutable. Every implementation constructor calls `_disableInitializers()`; every implementation pins EIP-712 `name`/`version` as compile-time constants to prevent silent domain-separator drift across upgrades. A 14-day meta-timelock on `setTargetAdminDelay` prevents a "collapse the delay then exploit" sequence. Reason for reversal vs. v2.1: originator prefers in-place parameter and bug-fix paths over re-deployment ceremonies once LP capital is in the vault; 48h + GUARDIAN veto bounds concentration of trust.
4. **On-chain safety invariants.** Rate limits, whitelist checks, non-transferability, and burn restrictions are enforced at the contract level. A compromised Bridge cannot bypass them.
5. **Two-phase settlement with atomic claim.** Withdrawal escrows both legs (PLUSD and USDC) in WQ before burn; the LP's `claim` burns and pays atomically. Cross-rail atomicity is handled by holding state, not by assuming it.

---

## 2. Stack

| Component | Value |
|---|---|
| Solidity | ^0.8.20 |
| OpenZeppelin | v5.x (pin exact version) — AccessManager / AccessManaged, ERC1967 UUPS, EIP712Upgradeable |
| Chain | Ethereum mainnet |
| Governance | **3 Gnosis Safes**: ADMIN (3/5), RISK_COUNCIL (3/5), GUARDIAN (2/5) |
| Role management | Single OZ `AccessManager` hub |
| Upgrade | UUPS on all protocol contracts except EmergencyRevoker; 48h ADMIN delay; GUARDIAN cancel; 14d meta-timelock on delay changes |

The three-Safe split:

- **ADMIN 3/5** — role management, upgrades, parameter changes. Slowest, highest threshold.
- **RISK_COUNCIL 3/5** — proposes `setDefault` (24h timelock) and `enterShutdown` (24h timelock). Distinct signer set from ADMIN so a compromised ADMIN Safe cannot declare default or enter shutdown.
- **GUARDIAN 2/5** — instant `pause` on every pausable target (PLUSD, DepositManager, sPLUSD, WQ, WhitelistRegistry, LoanRegistry); `AccessManager.cancel(actionId)` on any pending scheduled action; `revokeAll` on EmergencyRevoker. Defensive-only per Morpho sentinel pattern — cannot initiate risk-increasing actions.

---

## 3. Contract Map

| Contract | Base | Custom LOC | Roles (managed by AccessManager) |
|---|---|---|---|
| AccessManager (OZ) | — | 0 | ADMIN (3/5) at hub level; per-function target roles below |
| TimelockPending (abstract) | — | ~25 | — |
| PLUSD | ERC20Upgradeable + ERC20PausableUpgradeable + ERC20PermitUpgradeable + AccessManagedUpgradeable + UUPSUpgradeable + TimelockPending | ~110 | BURNER (WQ), DEPOSITOR (DepositManager), YIELD_MINTER (Bridge), PAUSER (GUARDIAN), UPGRADER (ADMIN) — **no generic MINTER role; `mint(address,uint256)` is removed; MINT_ATTESTOR retired in v2.3.** |
| DepositManager (new in v2.3) | AccessManagedUpgradeable + PausableUpgradeable + ReentrancyGuardUpgradeable + UUPSUpgradeable | ~60 | PAUSER (GUARDIAN), UPGRADER (ADMIN). Holds DEPOSITOR on PLUSD. |
| sPLUSD | ERC4626Upgradeable + ERC20PausableUpgradeable + AccessManagedUpgradeable + UUPSUpgradeable | ~35 | PAUSER (GUARDIAN), UPGRADER (ADMIN) |
| WithdrawalQueue | AccessManagedUpgradeable + PausableUpgradeable + ReentrancyGuardUpgradeable + UUPSUpgradeable | ~140 | FUNDER (Bridge), PAUSER (GUARDIAN), ADMIN ops (3/5), UPGRADER (ADMIN) |
| WhitelistRegistry | AccessManagedUpgradeable + TimelockPending + UUPSUpgradeable | ~95 | WHITELIST_ADMIN (Bridge), ADMIN (3/5), PAUSER (GUARDIAN), UPGRADER (ADMIN) |
| LoanRegistry | ERC721Upgradeable (soulbound) + AccessManagedUpgradeable + PausableUpgradeable + UUPSUpgradeable | ~190 | TRUSTEE (Trustee key), RISK_COUNCIL (setDefault only, 24h delay), PAUSER (GUARDIAN), ADMIN (3/5), UPGRADER (ADMIN) |
| ShutdownController (new) | AccessManagedUpgradeable + UUPSUpgradeable | ~75 | RISK_COUNCIL (proposeShutdown, adjustRecoveryRateUp), ADMIN (execute via AccessManager), GUARDIAN (cancel via AccessManager) |
| RecoveryPool (new) | AccessManagedUpgradeable + PausableUpgradeable + ReentrancyGuardUpgradeable + UUPSUpgradeable | ~70 | ADMIN (deposit); `release` / `recordReturned` callable only by PLUSD and WQ (fixed addresses) |
| EmergencyRevoker | standalone, **non-upgradeable** | ~50 | Holds AccessManager ADMIN; targets `bridge` and `trustee` are ADMIN-updatable with 48h timelock (U7). Parameterless `revokeAll()` callable only by GUARDIAN. |

**Role renames and additions vs. v2.1/v2.2 (swept across all sections):**

- `FILLER` → **FUNDER** (on-chain USDC pusher, held by Bridge).
- `LOAN_MANAGER` → **TRUSTEE** (grantee: distinct Trustee key, not Bridge).
- `MINTER` role (on PLUSD) — **removed**; see U6.
- `MINT_ATTESTOR` (on PLUSD, v2.2) — **retired in v2.3** (M2). Replaced by DepositManager + DEPOSITOR role + two-party yield attestation.
- **`DEPOSITOR`** (new in v2.3) — on PLUSD, held by DepositManager; gates `mintForDeposit`.
- `PAUSER` grantee across all contracts: GUARDIAN 2/5 Safe.
- `RISK_COUNCIL` grantee: 3/5 RISK_COUNCIL Safe (was "3/5 admin Safe" in v2.1). Threshold matches the originator source spec §1.5.
- `UPGRADER` (new) → ADMIN 3/5 Safe; gates `_authorizeUpgrade` on every upgradeable contract.

**Actor glossary.**

- **Bridge** — the off-chain protocol backend. Single on-chain actor holding FUNDER, WHITELIST_ADMIN, YIELD_MINTER. Co-signs yield-mint EIP-712 attestations (alongside the custodian). **Never custodies USDC.** Does not gate deposits — those are atomic user-driven calls to DepositManager. Every USDC movement on-chain originates from the Capital Wallet (MPC) or from the LP's own wallet (deposits). Bridge's internal key material (HSM, MPC shards, custodian-managed signing keys) is an implementation detail, not an architectural actor.
- **DepositManager** — on-chain contract through which LPs deposit USDC and receive PLUSD atomically. Holds `DEPOSITOR` on PLUSD. No off-chain signer gates the deposit leg — the USDC transfer to Capital Wallet IS the on-chain evidence of the deposit. Pull pattern: LP approves DepositManager on USDC, DepositManager calls `USDC.transferFrom(lp, capitalWallet, amount)` and `PLUSD.mintForDeposit(lp, amount)` in a single transaction.
- **Trustee** (Pipeline Trust Company) — holds one MPC key share on the Capital Wallet and Treasury Wallet. Holder of the on-chain `TRUSTEE` role on LoanRegistry. Distinct key set from Bridge and Team.
- **Pipeline Team** — holds one MPC key share on the Capital Wallet and Treasury Wallet. Co-signs loan disbursement and Treasury Wallet operations per source spec §1.5. Does not hold any on-chain protocol roles.
- **Capital Wallet** — MPC-controlled on-chain address holding USDC reserves. **Cosigners: Trustee + Team + Bridge (three parties).** Different transaction categories require different cosigner combinations per custodian policy: routine LP withdrawals are auto-signed by Bridge within narrow policy bounds; loan disbursements require Trustee + Team cosign; USYC/USDC swaps within automated bands are Bridge-only. Transfers to/from Capital Wallet are on-chain ERC-20 transfers, not off-chain wires.
- **Treasury Wallet** — MPC-controlled on-chain address for protocol fees / yield share.

---

## 4. Shared Base: TimelockPending

Minimal timelock pattern extracted to avoid code duplication across PLUSD, WhitelistRegistry, and EmergencyRevoker.

```
abstract contract TimelockPending
```

### Constants

- `TIMELOCK_DELAY`: 48 hours (default; per-use overrides where noted).

### State

- `mapping(bytes32 => uint256) public pendingChanges` — maps a change ID to its activation timestamp.

### Internal functions

- `_propose(bytes32 id, uint256 delay)` — records `block.timestamp + delay` for the change ID. Emits `ChangeProposed(id, activationTime)`.
- `_execute(bytes32 id)` — requires `block.timestamp >= pendingChanges[id]` and `pendingChanges[id] != 0`. Deletes the pending entry. Emits `ChangeExecuted(id)`.
- `_cancel(bytes32 id)` — deletes the pending entry. Emits `ChangeCancelled(id)`.

### Design notes

- Change IDs are `keccak256` of the operation and parameters (e.g., `keccak256(abi.encode("setWhitelistRegistry", newAddress))`).
- Used for ad-hoc 48h delays on contract-local operations (system-address changes on WhitelistRegistry, EmergencyRevoker target rotation, `setYieldAttestors` on PLUSD). Role-level scheduling uses AccessManager's built-in `setTargetAdminDelay` / `schedule`.
- OZ `TimelockController` was considered and rejected — it is a full governance primitive adding ~500 lines of inherited logic. The inline pattern is ~25 lines.

---

## 5. PLUSD

```
contract PLUSD is ERC20Upgradeable, ERC20PausableUpgradeable, ERC20PermitUpgradeable, AccessManagedUpgradeable, UUPSUpgradeable, TimelockPending
```

### Purpose

Receipt token. Minted 1:1 against USDC deposits (via `DepositManager.deposit` → `mintForDeposit`) and against Trustee-confirmed yield events (via two-party-attested `yieldMint`). Non-transferable between LPs — every transfer has exactly one system-address leg. Backed by USD-equivalent reserves held at the custodian's Capital Wallet, verified against on-chain cumulative counters on every mint path.

### Roles (via AccessManager)

| Role | Holder | Can do |
|---|---|---|
| BURNER | WithdrawalQueue | `burn()` (WQ invokes on claim / claimAtShutdown) |
| DEPOSITOR | DepositManager | `mintForDeposit(lp, amount)` — atomic 1:1 deposit mint |
| YIELD_MINTER | Bridge | `yieldMint(att, bridgeSig, custodianSig)` — destination ∈ {sPLUSD vault, Treasury}; also requires both EIP-712 sigs |
| PAUSER | GUARDIAN 2/5 | `pause()`, `unpause()` |
| UPGRADER | ADMIN 3/5 | `upgradeTo` (48h AccessManager delay) |
| ADMIN (hub) | ADMIN 3/5 | Parameter changes, timelocked state changes via TimelockPending |

**No generic MINTER role.** `mint(address,uint256)` is removed from the ABI (U6). Fresh PLUSD enters supply only via:

1. **`mintForDeposit(lp, amount)`** — restricted to DEPOSITOR (DepositManager). Used by the atomic 1:1 deposit flow (see §5b). There is no off-chain attestor on this path: the USDC transfer to Capital Wallet and the PLUSD mint happen in the same DepositManager transaction.
2. **`yieldMint(att, bridgeSig, custodianSig)`** — restricted to YIELD_MINTER (Bridge) *and* requires two EIP-712 signatures (Bridge + custodian) verified on-chain. Destination constrained to `sPLUSD vault` or `Treasury` inside the function body. Compromising any single key on this path mints zero PLUSD.

Why two-party on yield: yield mints are the only remaining signer-dependent path — no user-provided collateral can gate them, because the yield is an abstract off-chain P&L event (loan repayments, USYC accretion). The custodian independently verifies the underlying USDC inflow against its own ledger before signing. Compromising Bridge alone → zero mint. Compromising custodian alone → zero mint.

### Custom state

```solidity
IWhitelistRegistry public whitelistRegistry;
IShutdownController public shutdownController;

// Rate limiting (rolling window)
uint256 public maxPerWindow;          // default 10_000_000e6 ($10M)
uint256 public maxPerLPPerWindow;     // default 5_000_000e6 ($5M)  — new in v2.3
uint256 public maxTotalSupply;        // hard ceiling on totalSupply() — new in v2.3
uint256 public windowDuration;        // default 24 hours
uint256 public windowStart;
uint256 public windowMinted;
mapping(address => uint256) public lpWindowMinted;  // per-LP, cleared on window roll

// Operational gate
bool public operational;              // admin toggle, blocks non-admin ops when false

// Reserve invariant (new in v2.3 — M4)
uint256 public cumulativeLPDeposits;  // incremented in mintForDeposit
uint256 public cumulativeYieldMinted; // incremented in yieldMint
uint256 public cumulativeLPBurns;     // incremented in burn (from WQ)

// Two-party yield attestation (new in v2.3 — M5)
address public bridgeYieldAttestor;   // EOA — Bridge's yield-signing key
address public custodianYieldAttestor; // EIP-1271 smart-contract signer (custodian's co-signer)
mapping(bytes32 => bool) public usedRepaymentRefs;

bytes32 public constant YIELD_ATTESTATION_TYPEHASH = keccak256(
    "YieldAttestation(bytes32 repaymentRef,address destination,uint256 amount,uint64 deadline,uint256 salt)"
);
```

The `repaymentRef` is deterministic and **scoped per destination**: `keccak256(abi.encode(chainId, repaymentTxHash, destinationTag))` where `destinationTag` is the string `"vault"` or `"treasury"`. One on-chain repayment produces two independent attestations (one for sPLUSD vault coupon_net, one for Treasury fees), each with its own `repaymentRef`. This lets both legs be submitted independently — each consumes its own replay slot. `salt` allows reissuance if a signature is lost in transit. `deadline` bounds attestation validity.

**Removed from v2.2:** `mintAttestor`, `usedAttestations`, `usedDepositRefs`, `attestationWindow`, `attestorRotatedAt`, `MINT_ATTESTATION_TYPEHASH` (M2). The entire single-party deposit-attestation surface is gone.

### Constants

```solidity
uint256 public constant MIN_WINDOW_DURATION    = 1 hours;
uint256 public constant MAX_PER_WINDOW_CEILING = 100_000_000e6;
uint256 public constant MAX_TOTAL_SUPPLY_FLOOR = 10_000_000e6;   // hard cap can't be set below this
```

### Functions

**`decimals()`** — Returns 6. Matches USDC.

**`mintForDeposit(address lp, uint256 amount)`** — `restricted` (DEPOSITOR). Called by DepositManager inside an atomic 1:1 deposit.

```solidity
function mintForDeposit(address lp, uint256 amount) external restricted nonReentrant {
    require(!shutdownController.isActive(), "PLUSD: shutdown");
    _requireReserveInvariant(amount);
    cumulativeLPDeposits += amount;
    _mint(lp, amount);  // runs _update mint-path gates: operational, isAllowedForMint, rate limits
}
```

**`yieldMint(YieldAttestation att, bytes bridgeSig, bytes custodianSig)`** — `restricted` (YIELD_MINTER) + dual EIP-712 signature verification.

```solidity
function yieldMint(
    YieldAttestation calldata att,
    bytes calldata bridgeSig,
    bytes calldata custodianSig
) external restricted nonReentrant {
    require(!shutdownController.isActive(), "PLUSD: shutdown");
    require(block.timestamp <= att.deadline, "PLUSD: expired");
    require(att.destination == address(vault) || att.destination == address(treasury), "PLUSD: bad dest");
    require(!usedRepaymentRefs[att.repaymentRef], "PLUSD: replay");

    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
        YIELD_ATTESTATION_TYPEHASH,
        att.repaymentRef, att.destination, att.amount, att.deadline, att.salt
    )));

    // Bridge sig (ECDSA)
    require(ECDSA.recover(digest, bridgeSig) == bridgeYieldAttestor, "PLUSD: bad bridge sig");

    // Custodian sig (EIP-1271 smart-contract verification)
    require(
        IERC1271(custodianYieldAttestor).isValidSignature(digest, custodianSig) == 0x1626ba7e,
        "PLUSD: bad custodian sig"
    );

    usedRepaymentRefs[att.repaymentRef] = true;
    _requireReserveInvariant(att.amount);
    cumulativeYieldMinted += att.amount;
    _mint(att.destination, att.amount);
}
```

Three independent controls gate every yield mint: (1) YIELD_MINTER role on the caller, (2) Bridge signature on the attestation, (3) custodian EIP-1271 signature on the same attestation. Plus: destination constraint, replay guard on `repaymentRef`, deadline bound, reserve invariant, hard supply cap via `_update`, and shutdown guard.

**`burn(uint256 amount)`** — `restricted` (BURNER role). Calls `_burn(msg.sender, amount)` and increments `cumulativeLPBurns`. Caller can only burn its own balance. Only WithdrawalQueue holds BURNER.

```solidity
function burn(uint256 amount) external restricted {
    cumulativeLPBurns += amount;
    _burn(msg.sender, amount);
}
```

**Internal: `_requireReserveInvariant(uint256 amount)`**

```solidity
function _requireReserveInvariant(uint256 amount) internal view {
    require(totalSupply() + amount <= maxTotalSupply, "PLUSD: supply cap");
    // Invariant holds after the add:
    // totalSupply + amount <= cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns
    uint256 backing = cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns;
    // The mint being processed adds to one counter and to totalSupply in lockstep.
    // The check that matters is the conservative view *before* adding: existing totalSupply
    // must already be <= backing (no silent accounting drift), and the new amount must
    // not exceed the headroom projection. In practice the post-add equality is maintained
    // by the call path; this require catches any drift from storage corruption or a
    // malformed external interaction.
    require(totalSupply() <= backing, "PLUSD: reserve drift");
}
```

The counters move in lockstep with `totalSupply` under normal operation. The `require` catches two failure modes: (a) a bug that lets totalSupply and counters drift, (b) a contract upgrade that changes accounting semantics and leaves inconsistent state.

**`_update(address from, address to, uint256 amount)`** — Override of `ERC20PausableUpgradeable._update` with non-transferability enforcement (U2) and rate-limit charging.

```solidity
function _update(address from, address to, uint256 amount)
    internal override(ERC20Upgradeable, ERC20PausableUpgradeable)
{
    // Shutdown blocks everything except burn-from-shutdown-redeem path.
    require(!shutdownController.isActive() || _isShutdownRedeemPath(), "PLUSD: shutdown");

    if (from == address(0)) {
        // Mint path: operational gate, whitelist-for-mint, rate limits.
        // Note: mint path is entered only via mintForDeposit (DEPOSITOR) or
        // yieldMint (YIELD_MINTER + two-party sigs). Reserve invariant and
        // hard supply cap are checked in those entry points before _update.
        _requireOperational();
        require(whitelistRegistry.isAllowedForMint(to), "PLUSD: not allowed for mint");
        _chargeRateLimit(to, amount);
    } else if (to == address(0)) {
        // Burn path: no checks. Pause still applies.
    } else {
        // Transfer path: exactly one side must be system.
        _requireOperational();
        bool fromSys = whitelistRegistry.isSystemAddress(from);
        bool toSys   = whitelistRegistry.isSystemAddress(to);
        require(fromSys != toSys, "PLUSD: LP-to-LP or sys-to-sys blocked");
        require(whitelistRegistry.isAllowed(to), "PLUSD: recipient not allowed");
    }

    super._update(from, to, amount);
}

function _chargeRateLimit(address to, uint256 amount) internal {
    // Roll aggregate window if elapsed
    if (block.timestamp >= windowStart + windowDuration) {
        windowStart = block.timestamp;
        windowMinted = 0;
    }
    require(windowMinted + amount <= maxPerWindow, "PLUSD: window cap");
    windowMinted += amount;

    // Per-LP cap: applies only to LP deposit mints, NOT to yield mints into
    // system addresses (sPLUSD vault, Treasury). Yield mints are already
    // bounded by maxPerWindow + maxTotalSupply; adding a per-recipient cap
    // would bottleneck all yield into a single system address.
    if (whitelistRegistry.isSystemAddress(to)) {
        return;
    }
    uint256 lpUsed = _lpWindowUsed(to);
    require(lpUsed + amount <= maxPerLPPerWindow, "PLUSD: per-LP cap");
    _recordLPMint(to, amount);
}
```

- `fromSys != toSys` enforces "exactly one side is system" — closes the system↔system laundering bypass.
- `_isShutdownRedeemPath()` returns true only when called inside `redeemInShutdown` (re-entrancy-style flag set/unset within that function) — lets shutdown redemptions burn while blocking all other transfers.
- Per-LP window tracking: `lpWindowMinted[lp]` paired with `lpWindowStart[lp]` lazily reset on next mint for the same LP. Gas cost is a single SSTORE per deposit under normal operation. Skipped entirely when `to` is a system address (yield-mint destinations).

**`redeemInShutdown(uint256 plusdAmount)`** — Shutdown-only one-way redemption.

```solidity
function redeemInShutdown(uint256 plusdAmount) external nonReentrant {
    require(shutdownController.isActive(), "PLUSD: no shutdown");
    require(whitelistRegistry.isAllowed(msg.sender), "PLUSD: not whitelisted");

    uint16 bps = shutdownController.recoveryRateBps();
    uint256 usdcOut = plusdAmount * bps / 10_000;

    _setShutdownRedeemPath(true);
    cumulativeLPBurns += plusdAmount;   // keep reserve invariant in lockstep
    _burn(msg.sender, plusdAmount);
    _setShutdownRedeemPath(false);

    recoveryPool.release(msg.sender, usdcOut);
    emit ShutdownRedemption(msg.sender, plusdAmount, usdcOut);
}
```

Pause is overridden only for this function (via the transient flag pattern). Non-redemption transfers remain blocked. `cumulativeLPBurns` is updated here (not via the external `burn` BURNER path) because shutdown redemptions bypass WithdrawalQueue; the counter must still advance to keep the reserve invariant consistent.

**`setRateLimits(uint256 newMaxPerWindow, uint256 newMaxPerLP, uint256 newWindowDuration)`** — `restricted` (ADMIN). Validates against floor/ceiling constants. **Tightening** (any new value ≤ current) is immediate. **Loosening** (any new value > current) is timelocked 48h via AccessManager. Emits `RateLimitsChanged(old, new)`.

**`setMaxTotalSupply(uint256 newMax)`** — `restricted` (ADMIN). Same tighten-instant / loosen-48h pattern. Floor: `MAX_TOTAL_SUPPLY_FLOOR`. Emits `MaxTotalSupplyChanged(old, new)`.

**`proposeWhitelistRegistry(address newRegistry)`** / **`executeWhitelistRegistryChange(address newRegistry)`** / **`cancelWhitelistRegistryChange()`** — ADMIN, 48h timelock via `TimelockPending`.

**`setOperational(bool status)`** — `restricted` (ADMIN). Toggles the operational gate. Emits `OperationalStatusChanged(status)`.

**`pause()` / `unpause()`** — `restricted` (PAUSER, GUARDIAN).

**`proposeYieldAttestors(address newBridge, address newCustodian)`** / **`executeYieldAttestorsChange(...)`** / **`cancelYieldAttestorsChange()`** — ADMIN, 48h timelock via `TimelockPending`. Emits `YieldAttestorsChanged(oldBridge, newBridge, oldCustodian, newCustodian)`. Rotation is emergency-only (key compromise) — the custodian normally manages these keys as part of its HSM/MPC lifecycle.

**`isFullyOperational() → bool`** — View. Returns `operational && !paused() && !shutdownController.isActive()`. Convenience for monitoring.

**`reserveHealth() → (uint256 backing, uint256 supply, uint256 headroom)`** — View. Returns the three numbers driving the invariant so monitors can alert on tight headroom before a mint reverts.

### Burn exemption

Burns are exempt from both the `operational` gate and the whitelist check. This is intentional. The WithdrawalQueue must be able to complete in-flight `claim` burns during a maintenance window where `operational = false`, and cannot be blocked by a whitelist check against `address(0)`. Pause (`whenNotPaused` via `ERC20PausableUpgradeable`) still applies to burns — that is the emergency brake that overrides both operational and the settlement pipeline.

### EIP-712 domain pinning

```solidity
// in implementation initializer:
__EIP712_init("Pipeline PLUSD", "1");   // name, version pinned at impl-deploy time

function _authorizeUpgrade(address newImpl) internal override restricted {
    // UPGRADER role + 48h AccessManager delay handle authorization.
    // Verify the new impl preserves domain fields:
    (,,string memory newName, string memory newVersion,,,) = IERC5267(newImpl).eip712Domain();
    require(
        keccak256(bytes(newName))    == keccak256(bytes("Pipeline PLUSD")) &&
        keccak256(bytes(newVersion)) == keccak256(bytes("1")),
        "PLUSD: EIP-712 domain drift"
    );
}
```

Defends against a bad UUPS upgrade silently changing the domain separator and orphaning pre-signed yield attestations.

### Known properties (document in audit brief)

- **Rolling-window boundary.** Worst-case 2 × `maxPerWindow` ($20M) over the window boundary. Acceptable — bounded by `maxTotalSupply` and per-LP cap; custodian MPC policy engine provides independent cap on Bridge-originated USDC releases.
- **`windowMinted` does not decrease on burn.** Net supply may be lower than window usage suggests. Acceptable — mints and burns have different purposes.
- **Reserve invariant measures internal consistency, not external backing.** The three counters track what the contract has observed on-chain. A custodian holding less USDC than claimed will not be detected by this invariant — full Chainlink PoR (phase 2) closes that gap. MVP relies on counters + Watchdog service + custodian legal/compliance independence.
- **ERC20Permit linearization.** The `permit()` → `transferFrom()` path must hit `_update` and enforce non-transferability. Confirmed via linearization with the inheritance chain `ERC20 → ERC20Pausable → ERC20Permit → PLUSD`. Dedicated test: `permit` + `transferFrom` to non-whitelisted or LP-to-LP address must revert.

---

## 5b. DepositManager (new in v2.3)

```
contract DepositManager is AccessManagedUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable
```

### Purpose

Atomic 1:1 USDC→PLUSD deposit path. Replaces the v2.2 EIP-712 self-claim mint flow entirely (M1). The on-chain USDC transfer to Capital Wallet IS the deposit attestation — there is no off-chain signer on this path. Pattern reference: Ondo `OUSGInstantManager`, simplified to omit NAV scaling (PLUSD is 1:1 with USDC).

### Roles (via AccessManager)

| Role | Holder | Can do |
|---|---|---|
| PAUSER | GUARDIAN 2/5 | `pause()`, `unpause()` |
| UPGRADER | ADMIN 3/5 | `upgradeTo` (48h delay) |

DepositManager **holds** DEPOSITOR on PLUSD — it is the only account authorised to call `PLUSD.mintForDeposit`.

### State

```solidity
IERC20           public immutable usdc;
IPLUSD           public immutable plusd;
IWhitelistRegistry public whitelistRegistry;   // same registry as PLUSD
address          public capitalWallet;         // MPC-controlled destination; ADMIN-updatable 48h

uint256 public minDeposit;                     // default 1_000e6 ($1K); anti-dust
```

### Functions

**`deposit(uint256 amount)`** — public, pausable, reentrancy-guarded. The entire deposit flow in one transaction.

```solidity
function deposit(uint256 amount) external whenNotPaused nonReentrant {
    require(amount >= minDeposit, "DM: below min");
    require(whitelistRegistry.isAllowedForMint(msg.sender), "DM: not allowed for mint");

    // Pull USDC directly from LP to Capital Wallet (LP must have pre-approved DM on USDC)
    usdc.safeTransferFrom(msg.sender, capitalWallet, amount);

    // Mint PLUSD 1:1 to LP — PLUSD.mintForDeposit checks reserve invariant,
    // hard supply cap, rate limits, and whitelist-for-mint inside _update.
    plusd.mintForDeposit(msg.sender, amount);

    emit Deposited(msg.sender, amount);
}
```

**Why pull, not push.** A single `USDC.transferFrom(lp, capitalWallet, amount)` moves USDC from the LP directly to the Capital Wallet. DepositManager never holds USDC, eliminating one escrow vector. LP's USDC allowance is granted to DepositManager; USDC's `transferFrom` supports an arbitrary `to` so the one approval covers the full flow.

**`proposeCapitalWallet(address)`** / **`executeCapitalWalletChange(address)`** / **`cancelCapitalWalletChange()`** — ADMIN, 48h timelock via PLUSD-style TimelockPending (or equivalent). Changing the capital wallet is a high-sensitivity operation (effectively changes where deposit USDC lands).

**`setMinDeposit(uint256 newMin)`** — `restricted` (ADMIN). Operational parameter.

**`pause()` / `unpause()`** — `restricted` (PAUSER, GUARDIAN). Under pause, all new deposits revert. PLUSD itself is unaffected unless separately paused.

### Shutdown behaviour

`deposit` reverts when `PLUSD.shutdownController.isActive()` because `PLUSD.mintForDeposit` reverts in that state. No explicit shutdown check needed in DepositManager — PLUSD is the authority.

### Design notes

- **No attestor, no replay map, no signature verification.** The LP's own `transferFrom` is the authenticator — nobody else can cause an LP's USDC to move. Replay-protection is unnecessary because each `transferFrom` moves a distinct chunk of balance.
- **MinDeposit.** Dust-limit floor keeps the contract from becoming a spam vector and preserves a floor on per-deposit gas economics.
- **No fee.** MVP charges no deposit fee. Adding one would be a separate timelocked parameter change.
- **Capital Wallet as `to` in `transferFrom`.** USDC semantics allow this. The LP's one approval is consumed by DepositManager's single `safeTransferFrom` call; USDC itself moves from LP to Capital Wallet atomically.
- **No off-chain reliance for deposit.** The Bridge backend is not in the critical path for deposits. Bridge only observes the resulting `Transfer(lp, capitalWallet, amount)` and `Mint(0x0, lp, amount)` events for reconciliation, accounting, and dashboard data.

### Known properties (document in audit brief)

- **Capital Wallet compromise does not enable deposit fraud.** An attacker controlling the Capital Wallet cannot cause fake LP deposits — `transferFrom` must be authorised by the LP on USDC's ledger.
- **Front-running resistance.** Deposits are self-serve and not MEV-profitable (1:1 exchange, no price impact).
- **Reserve invariant per-call.** Each `deposit` atomically adds to `cumulativeLPDeposits`, `totalSupply`, and (off-chain) USDC in Capital Wallet. Any failure aborts all three.

---

## 6. sPLUSD

```
contract SPLUSD is ERC4626Upgradeable, ERC20PausableUpgradeable, AccessManagedUpgradeable, UUPSUpgradeable
```

### Purpose

Yield-bearing vault on PLUSD. Open to any PLUSD holder (no whitelist check at the vault layer). Yield accretion is a natural property of ERC-4626: the Bridge mints PLUSD to the vault address via `PLUSD.yieldMint`, increasing `totalAssets` and the share price.

### Roles (via AccessManager)

| Role | Holder | Can do |
|---|---|---|
| PAUSER | GUARDIAN 2/5 | `pause()`, `unpause()` |
| UPGRADER | ADMIN 3/5 | `upgradeTo` (48h delay) |
| ADMIN (hub) | ADMIN 3/5 | — (no local admin ops; role management at hub) |

### State (shutdown additions)

```solidity
IShutdownController public shutdownController;
```

(Snapshot state for the dropped `convertSharesAtShutdown` is removed; sPLUSD holders exit post-shutdown via the standard `redeem` path — see below.)

### Custom logic

**`_decimalsOffset()`** — Returns 6. First-deposit inflation attack protection for 6-decimal underlying. With 6-decimal offset, manipulating share price by $1 requires donating ~$1M PLUSD.

**`_update(address from, address to, uint256 amount)`** — `override(ERC20Upgradeable, ERC20PausableUpgradeable)`. Calls `super._update()` to enforce pause. No whitelist check — sPLUSD is intentionally open.

**`maxDeposit` / `maxMint` / `maxWithdraw` / `maxRedeem`** — Override to return 0 when paused. Integrators calling these view functions before transacting get accurate information.

**`pause()` / `unpause()`** — `restricted` (PAUSER).

### Shutdown behaviour

- `deposit` / `mint` revert while shutdown is active. (Enforced by the underlying `PLUSD._update` shutdown check; no local check needed.)
- `redeem` / `withdraw` remain open post-shutdown for exit. They return depegged PLUSD (no share-price recovery is attempted here); the holder then calls `PLUSD.redeemInShutdown` for recovery-rate USDC. This is the pull-based unwind (U8, simplified).
- Race-drain concern is resolved structurally: `PLUSD.redeemInShutdown` pays at a frozen protocol-wide `recoveryRateBps`, not first-come, so the order in which sPLUSD holders unwrap does not affect per-unit payout.

### Post-shutdown yield

Any post-shutdown recoveries flow via `RecoveryPool.deposit` by ADMIN, which enables `RISK_COUNCIL.adjustRecoveryRateUp`. `yieldMint` is blocked during shutdown by the PLUSD `_update` guard.

### Design notes

- No MINTER role. Yield accretion happens externally via `PLUSD.yieldMint(address(this), amount)`.
- KYC chain re-enters on redeem: `sPLUSD.redeem()` → `PLUSD.transfer(vault → receiver)` → `PLUSD._update` → `whitelistRegistry.isAllowed(receiver)` and non-transferability check (vault is system; receiver must be non-system and whitelisted). If receiver is not whitelisted, redeem reverts at the PLUSD level.
- Pause freezes deposits, redeems, AND transfers. Conservative choice for an emergency mechanism.
- OZ version pinned. `ERC4626Upgradeable` does not override `_update` in OZ v5.x. Pin and verify on upgrade.
- sPLUSD remains transferable. The PLUSD redeem-whitelist gate neuters secondary-market value for non-KYC buyers; no attack paths identified by reviewers.

### Audit brief items

- Donation attack math: confirm $1M donation threshold holds at $50M TVL.
- Vault concentration risk (single LP holding dominant share position) is a monitoring/dashboard concern.
- LP agreement must include: "Emergency pause may freeze all positions; shutdown pays a protocol-set recovery rate."

---

## 7. WithdrawalQueue

```
contract WithdrawalQueue is AccessManagedUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable
```

### Purpose

Holds both PLUSD (LP-deposited on request) and USDC (Bridge-funded on head) during a withdrawal. On `claim`, burns PLUSD and transfers USDC atomically. No cancellation — queue is one-way. Strict FIFO on funding, with auto-skip of sanctioned heads to prevent queue-DoS.

**USDC custody model (Model B Bridge).** Bridge never holds USDC. The `fundRequest(queueId)` call is made by Bridge but the USDC itself moves via `usdc.transferFrom(capitalWallet, address(this), amount)` — a pre-existing allowance from Capital Wallet (granted during deployment and cosigned Trustee + Bridge) lets the WQ pull USDC directly from Capital Wallet when Bridge calls `fundRequest`. The funds path is `Capital Wallet → WithdrawalQueue`; Bridge is an on-chain validator / attestation signer / FUNDER role-holder.

### Roles (via AccessManager)

| Role | Holder | Can do |
|---|---|---|
| FUNDER | Bridge | `fundRequest`, `skipSanctionedHead` |
| PAUSER | GUARDIAN 2/5 | `pause`, `unpause` |
| ADMIN ops | ADMIN 3/5 | `adminRelease(Pending)` (immediate), `adminReleaseFunded` (24h AccessManager delay, GUARDIAN-cancelable), `adminSweep`, `sweepStale(queueId)`, `upgradeTo` |

### Data structures

```solidity
enum RequestStatus { Pending, Funded, Claimed, AdminReleased }

struct WithdrawalRequest {
    address requester;
    uint256 amount;     // PLUSD, 1:1 with USDC
    uint64  createdAt;
    uint64  fundedAt;   // 0 if never funded
    RequestStatus status;
}

IERC20 public plusd;
IERC20 public usdc;
address public capitalWallet;                 // source of USDC on fundRequest (allowance model)
IWhitelistRegistry public whitelistRegistry;
IShutdownController public shutdownController;
IRecoveryPool public recoveryPool;

uint256 public nextRequestId;
uint256 public headId;          // lowest queueId with status ∈ {Pending, Funded}
uint256 public nextToFund;      // lowest queueId with status == Pending
mapping(uint256 => WithdrawalRequest) public requests;

uint256 public totalPlusdEscrowed;   // sum over Pending ∪ Funded ∪ AdminReleased-with-unswept-PLUSD
uint256 public totalUsdcEscrowed;    // sum over Funded ∪ AdminReleased-with-unswept-USDC

uint256 public constant MIN_WITHDRAWAL   = 1_000e6;
uint256 public constant STALE_CLAIM_WINDOW = 180 days;
```

### Lifecycle

```
                               fundRequest
                                    │
requestWithdrawal                   ▼            claim
  ─────────────►   Pending  ──────────────►  Funded  ─────────────►  Claimed
                     │                          │
                     │  adminRelease(Pending)   │  adminReleaseFunded
                     │  (ADMIN, immediate)      │  (ADMIN, 24h timelock, GUARDIAN-cancelable)
                     │                          │
                     │  skipSanctionedHead      │
                     │  (FUNDER auto-skip       │  sweepStale (ADMIN, after 180d Funded)
                     │   if de-whitelisted)     │
                     ▼                          ▼
                              AdminReleased  ────────► adminSweep ────► funds out
```

### Functions

**`requestWithdrawal(uint256 amount) → uint256 queueId`** — `nonReentrant`, `whenNotPaused`, `whenNotShutdown`

- Require `amount >= MIN_WITHDRAWAL`.
- Require `whitelistRegistry.isAllowed(msg.sender)` — sole sender-side compliance gate. `PLUSD._update` checks `isAllowed(to)` on transfers, not `isAllowed(from)`; on `plusd.transferFrom(LP, queue, amount)` the receiver-side check passes trivially because the queue is a system address. Without this explicit check, a de-whitelisted LP could enter the queue.
- Pull PLUSD: `plusd.transferFrom(msg.sender, address(this), amount)`.
- Create request with `status = Pending`, `createdAt = block.timestamp`, `fundedAt = 0`.
- Increment `totalPlusdEscrowed`.
- Emit `WithdrawalRequested(indexed queueId, indexed requester, amount)`.

**`fundRequest(uint256 queueId)`** — `restricted` (FUNDER), `whenNotPaused`, `whenNotShutdown`, `nonReentrant`

- Require `queueId == nextToFund`.
- Require `requests[queueId].status == Pending`.
- Require `whitelistRegistry.isAllowed(requests[queueId].requester)` — sanctioned LP path goes through `skipSanctionedHead` instead.
- Pull USDC from Capital Wallet: `usdc.transferFrom(capitalWallet, address(this), amount)`. The Capital Wallet has a pre-approved allowance to the WQ; this call succeeds only if Capital Wallet's allowance and balance are sufficient (Capital Wallet releases are cosigned Trustee + Bridge off-chain via the MPC policy).
- Set `status = Funded`, `fundedAt = block.timestamp`.
- Increment `totalUsdcEscrowed`.
- Advance `nextToFund` while `requests[nextToFund].status != Pending`.
- Emit `WithdrawalFunded(indexed queueId, indexed requester, amount)`.

**`skipSanctionedHead()`** — `restricted` (FUNDER), `whenNotPaused`, `whenNotShutdown`

- Let `qId = nextToFund`. Require `requests[qId].status == Pending`.
- Require `!whitelistRegistry.isAllowed(requests[qId].requester)`.
- Set `status = AdminReleased`. PLUSD stays in contract. (ADMIN sweeps to whitelisted destination later.)
- Advance `nextToFund` while `requests[nextToFund].status != Pending`.
- Advance `headId` while `requests[headId].status ∈ {Claimed, AdminReleased}`.
- Emit `WithdrawalSanctionedSkip(indexed queueId, indexed requester, amount)`.

Rationale: strict-FIFO is a DoS primitive if a sanctioned head blocks all subsequent funding. The Bridge (already holds WHITELIST_ADMIN) does not need to wait for ADMIN Safe mobilization to unstick the queue; Bridge itself verifies `isAllowed` and marks the head `AdminReleased`. The sanctioned LP's PLUSD remains escrowed until ADMIN decides disposition — no funds moved, only a status flip.

**`claim(uint256 queueId)`** — `nonReentrant`, `whenNotPaused`, `whenNotShutdown`

- `msg.sender == requests[queueId].requester`.
- `requests[queueId].status == Funded`.
- `whitelistRegistry.isAllowed(msg.sender)` — LP must still be compliant at claim time.
- **Order:** `status = Claimed`; `plusd.burn(amount)`; `usdc.transfer(msg.sender, amount)`; then decrement totals. This satisfies the invariant `totalPlusdEscrowed == plusd.balanceOf(this)` across the call because the state flip precedes the burn.
- Advance `headId` while `requests[headId].status ∈ {Claimed, AdminReleased}`.
- Emit `WithdrawalClaimed(indexed queueId, indexed requester, amount)`.

**`adminRelease(uint256 queueId)`** — `restricted` (ADMIN)

- If `requests[queueId].status == Pending`: **immediate** (no timelock).
- If `requests[queueId].status == Funded`: call the separate `adminReleaseFunded(queueId)` selector, which carries a 24h AccessManager delay and is GUARDIAN-cancelable. Shared internal `_adminRelease(queueId)` body.
- On release: `status = AdminReleased`. No token movement.
- Advance `nextToFund` via `while` loop.
- Advance `headId` via `while` loop.
- Emit `WithdrawalAdminReleased(indexed queueId, indexed requester, amount, priorStatus)`.

**`adminSweep(uint256 queueId, address plusdTo, address usdcTo)`** — `restricted` (ADMIN)

- Require `status == AdminReleased`.
- Transfers any still-escrowed PLUSD and USDC. `plusdTo` subject to `PLUSD._update` check (from=WQ=system, so toSys must be false: any whitelisted LP or venue).
- Zero `amount` on the request to mark swept.
- Decrement totals by swept quantities.

**`sweepStale(uint256 queueId, address recipient)`** — `restricted` (ADMIN)

- Require `status == Funded`.
- Require `block.timestamp >= requests[queueId].fundedAt + STALE_CLAIM_WINDOW` (180d).
- Require `recipient == requester` (stale claim is still the LP's money — send it to the LP's whitelisted address, or to a treasury sub-account if LP is de-whitelisted; audit logs document rationale).
- Burn PLUSD and transfer USDC as in `claim`.

Rationale: institutional LPs have turnover (key rotation, custodian migration, entity reorgs). Without a stale path, USDC sits in contract forever and pollutes reconciliation. 180d is long enough that normal claim lapses are rare; ADMIN threshold prevents abuse.

**`claimAtShutdown(uint256 queueId)`** — one-way claim during shutdown; see §7b.

### Invariants

- `totalPlusdEscrowed == plusd.balanceOf(this)` at rest.
- `totalUsdcEscrowed <= usdc.balanceOf(this)` (surplus = direct sends; detectable via `invariantCheck()`).
- `∀ id < nextToFund: requests[id].status != Pending`.
- `∀ id < headId: requests[id].status ∈ {Claimed, AdminReleased}`.
- `nextToFund >= headId`.

### View functions

- `getRequest(uint256 queueId) → WithdrawalRequest`.
- `getQueueDepth() → (totalPlusdEscrowed, totalUsdcEscrowed, pendingCount, fundedCount)`.
- `invariantCheck() → (int256 plusdDrift, int256 usdcDrift)`.

### Custodian-side enforcement (R2)

Two properties of LP withdrawals are enforced by the custodian's MPC policy engine (Fireblocks / BitGo), **not** by WithdrawalQueue:

1. **Destination match.** The USDC destination on a settled withdrawal must be an address in the LP's historic deposit-address set for this protocol. LPs cannot exfiltrate USDC to a new wallet they did not deposit from.
2. **Cumulative cap.** For every LP, `cumulativeWithdrawn ≤ cumulativeDeposited` measured on the Capital Wallet. The custodian's rule engine maintains the per-LP ledger and rejects any transfer that would violate this.

The contract layer enforces atomic-claim settlement (PLUSD burn and USDC transfer in the same call, from WQ's own escrow) and strict FIFO on funding. Destination and cap constraints live in the custodian's policy rules and are out of audit scope for this spec.

### Failure mode table

| Scenario | PLUSD | USDC | Recovery |
|---|---|---|---|
| `fundRequest` then `claim` | Escrowed → burned | Pulled from Capital Wallet → delivered on claim | Happy path |
| `fundRequest` reverts (allowance, gas, pause) | Escrowed | Not moved | Bridge retries; no partial state |
| `claim` reverts after fundRequest (receiver de-whitelisted mid-flow) | Escrowed | In WQ | `adminReleaseFunded` (24h) → `adminSweep`, or wait for recovery and LP re-claims |
| Capital Wallet allowance revoked | N/A | fundRequest reverts | Governance re-approves; LPs keep waiting as Pending |
| Bridge compromised before any fundRequest | Escrowed | Not moved | GUARDIAN triggers `EmergencyRevoker.revokeAll()`. ADMIN grants FUNDER to new Bridge. Pending requests resume. |
| Bridge compromised after fundRequest but before LP claim | Escrowed | In WQ (attacker cannot access — only `claim` by requester, or ADMIN `adminReleaseFunded` / `adminSweep`) | No loss; LP still claims or ADMIN releases. |
| LP de-whitelisted with Pending head | Escrowed | Not moved | `skipSanctionedHead` by Bridge; `adminSweep` by ADMIN later |

---

## 7b. Shutdown Mode (Option A, symmetric haircut)

**Controller contract.** The flag and rate live in a standalone `ShutdownController`, not inside PLUSD. All contracts read via `shutdownController.isActive()` / `recoveryRateBps()`. Single source of truth.

### State (ShutdownController)

```solidity
bool    public isActive;
uint16  public recoveryRateBps;            // 1..10_000
bytes32 public reasonHash;
uint64  public activatedAt;
uint256 public totalSupplyAtEntry;         // plusd.totalSupply() frozen at entry
```

### Trigger

- `RISK_COUNCIL` schedules `enterShutdown(bps, reasonHash)` via `AccessManager.schedule` with 24h delay on the selector.
- During the 24h window, `GUARDIAN` may `AccessManager.cancel(actionId)`.
- After 24h, any caller can `AccessManager.execute` — this invokes `ShutdownController.enterShutdown`.

### `enterShutdown(uint16 bps, bytes32 hash)` body

```solidity
function enterShutdown(uint16 bps, bytes32 hash) external restricted {
    require(!isActive, "already active");
    require(bps > 0 && bps <= 10_000, "bad bps");

    // No pre-fund invariant: RISK_COUNCIL sets bps from the pool balance
    // actually available at execution time. Trustee tops up the pool over
    // the subsequent weeks/months as capital is repatriated; rate can be
    // ratcheted up later via adjustRecoveryRateUp.

    isActive = true;
    recoveryRateBps = bps;
    reasonHash = hash;
    activatedAt = uint64(block.timestamp);
    totalSupplyAtEntry = plusd.totalSupply();

    emit ShutdownEntered(bps, hash, block.timestamp);
}
```

**No pre-fund requirement at entry.** A real protocol crisis implies there is no USDC to pre-fund with. RecoveryPool starts at whatever balance it has at entry; `recoveryRateBps` is chosen by RISK_COUNCIL consistent with that balance. Trustee tops up the pool over time as capital is recovered; `adjustRecoveryRateUp` widens the rate as solvency improves.

### Rate adjustment — **up only**

```solidity
function adjustRecoveryRateUp(uint16 newBps) external restricted;    // RISK_COUNCIL, 24h delay
```

- Only upward adjustments exist. For post-shutdown recoveries improving the solvency position.
- Rationale: lowering the rate after entry transfers value from patient LPs to early exiters, which is strictly anti-LP. Rate should only increase as Trustee repatriates capital.
- Solvency check at adjustment: `pool.balance >= remainingUnredeemedSupply * newBps / 10_000` must hold at the time the adjustment is scheduled; GUARDIAN may cancel during the 24h window if the check would be stale at execution.

### `redeemInShutdown(uint256 plusdAmount)` on PLUSD

See §5. Burns PLUSD from the caller, releases `plusdAmount * bps / 10_000` USDC from RecoveryPool to the caller. LP must be whitelisted at redemption time.

### Funded-request haircut — SYMMETRIC

Per originator decision: Funded requests are **haircut-eligible** in shutdown. Rationale: removes queue-jump exploit class; matches MakerDAO `cage` semantics; simpler LP model ("at shutdown, everyone gets the rate, period").

On `WQ.claimAtShutdown(queueId)`:

```solidity
function claimAtShutdown(uint256 queueId) external nonReentrant {
    require(shutdownController.isActive(), "WQ: no shutdown");
    require(msg.sender == requests[queueId].requester, "WQ: not requester");
    require(
        requests[queueId].status == RequestStatus.Pending ||
        requests[queueId].status == RequestStatus.Funded,
        "WQ: bad status"
    );
    require(whitelistRegistry.isAllowed(msg.sender), "WQ: not whitelisted");

    uint256 plusdAmount = requests[queueId].amount;
    uint16  bps = shutdownController.recoveryRateBps();
    uint256 usdcOut = plusdAmount * bps / 10_000;

    RequestStatus priorStatus = requests[queueId].status;
    requests[queueId].status = RequestStatus.Claimed;
    requests[queueId].amount = 0;

    plusd.burn(plusdAmount);              // PLUSD still in escrow, burn from WQ balance
    totalPlusdEscrowed -= plusdAmount;

    if (priorStatus == RequestStatus.Funded) {
        // WQ holds USDC 1:1 for this request; return the haircut to RecoveryPool,
        // pay the LP the rate.
        uint256 returnToPool = plusdAmount - usdcOut;
        totalUsdcEscrowed -= plusdAmount;
        usdc.transfer(address(recoveryPool), returnToPool);
        recoveryPool.recordReturned(returnToPool);
        usdc.transfer(msg.sender, usdcOut);
    } else {
        // Pending: WQ holds no USDC. Pull from RecoveryPool.
        recoveryPool.release(msg.sender, usdcOut);
    }

    emit WithdrawalClaimedAtShutdown(queueId, msg.sender, plusdAmount, usdcOut, priorStatus);
}
```

Funded-branch returns the haircut (difference) to RecoveryPool so subsequent redemptions remain solvent against the updated supply.

### RecoveryPool

```solidity
contract RecoveryPool is AccessManagedUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    IERC20 public usdc;
    address public plusdContract;
    address public wqContract;
    uint256 public totalDeposited;
    uint256 public totalReleased;
    uint256 public totalReturned;

    function deposit(uint256 amount) external restricted;         // ADMIN
    function release(address to, uint256 amount) external nonReentrant {
        require(msg.sender == plusdContract || msg.sender == wqContract, "RP: unauthorized");
        totalReleased += amount;
        usdc.transfer(to, amount);
    }
    function recordReturned(uint256 amount) external nonReentrant {
        require(msg.sender == wqContract, "RP: unauthorized");
        totalReturned += amount;
    }
    function balance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
```

- ~70 LOC.
- `release` is guarded against reentrancy and restricted to two known callers.
- On UUPS upgrade of PLUSD or WQ: proxies keep the same addresses, so `plusdContract`/`wqContract` pointers remain valid across upgrades.

### Ongoing-operation solvency

At any point in shutdown, the protocol aims for:

```
recoveryRateBps × outstandingPlusd / 10_000  ≤  RecoveryPool.balance() + pendingTrusteeInflows
```

This is a monitoring invariant, not an entry gate. If the left side exceeds the right, RISK_COUNCIL does *not* lower the rate (dropped); instead, redemptions queue until Trustee inflows catch up, or — if the gap persists — the protocol is documented as under-solvent at the rate and LPs understand further top-ups are required to clear the backlog. Rate only ratchets up.

### sPLUSD unwind during shutdown

sPLUSD holders exit as follows:

1. Call `sPLUSD.redeem(shares)` — standard ERC-4626 redeem, returns PLUSD at the vault's current (depegged) share price. The sPLUSD vault remains unpaused post-shutdown specifically to keep this exit path open.
2. Call `PLUSD.redeemInShutdown(plusdAmount)` — burns PLUSD, receives `plusdAmount × recoveryRateBps / 10_000` USDC from RecoveryPool.

No special-case shutdown conversion function. Race-drain concern is resolved because `redeemInShutdown` pays at a frozen protocol-wide rate, not first-come; the order in which holders unwind does not affect per-unit payout.

### Post-shutdown yield blocked

All PLUSD mint paths (`mintForDeposit`, `yieldMint`) revert when `shutdownController.isActive()`. DepositManager.deposit reverts as a consequence. Any post-shutdown recoveries enter via ADMIN calling `RecoveryPool.deposit(amount)`, which enables RISK_COUNCIL to `adjustRecoveryRateUp`.

---

## 8. WhitelistRegistry

```
contract WhitelistRegistry is AccessManagedUpgradeable, TimelockPending, UUPSUpgradeable
```

### Purpose

On-chain allowlist controlling who can hold PLUSD and where PLUSD can move. Three categories of approved addresses.

### Roles (via AccessManager)

| Role | Holder | Can do |
|---|---|---|
| WHITELIST_ADMIN | Bridge | LP management (`setAccess`, `refreshScreening`, `revokeAccess`) |
| PAUSER | GUARDIAN 2/5 | `pause()`, `unpause()` |
| UPGRADER | ADMIN 3/5 | `upgradeTo` (48h delay) |
| ADMIN (hub) | ADMIN 3/5 | DeFi venue management, system address management (timelocked), freshness window |

### Three allowlist categories

```solidity
// 1. KYCed LP wallets — have screening timestamps
struct LPEntry {
    bool approved;
    uint256 approvedAt;  // Chainalysis screening timestamp
}
mapping(address => LPEntry) private _lpAllowlist;

// 2. Approved DeFi venues — Curve pools, Uniswap pools, Aave markets
mapping(address => bool) private _venueAllowlist;

// 3. Protocol/system addresses — sPLUSD vault, WithdrawalQueue, RecoveryPool, Treasury, Capital Wallet
mapping(address => bool) private _systemAllowlist;

uint256 public freshnessWindow; // default 90 days
```

### Check functions (called by PLUSD)

**`isAllowed(address account) → bool`**
- Called by PLUSD `_update` on every non-burn transfer.
- `require(account != address(0))`
- Returns `_lpAllowlist[account].approved || _venueAllowlist[account] || _systemAllowlist[account]`
- **No freshness check.** Allowlist membership is sufficient for transfers.

**`isAllowedForMint(address account) → bool`**
- Called by PLUSD `_update` on mints only (`from == address(0)`).
- `require(account != address(0))`
- If `_systemAllowlist[account]`: return true. System addresses bypass freshness (yield mints to vault/treasury).
- If `entry.approvedAt == 0`: return false. Guards against underflow with cleared timestamps.
- Returns `entry.approved && (block.timestamp - entry.approvedAt) < freshnessWindow`.

**`isSystemAddress(address account) → bool`**
- Reads `_systemAllowlist`. Used by `PLUSD._update` for the non-transferability rule.

**Intentional asymmetry (document for auditors):** DeFi venues pass `isAllowed` but not `isAllowedForMint`. System addresses pass both. An address can exist in multiple categories simultaneously.

### LP management (WHITELIST_ADMIN)

**`setAccess(address lp, uint256 approvedAt)`** — New LP onboarding. Validates `lp != address(0)`, `approvedAt <= block.timestamp`. Sets `LPEntry(true, approvedAt)`. Emits `LPApproved(indexed lp, approvedAt)`.

**`refreshScreening(address lp, uint256 newApprovedAt)`** — Periodic re-screening. Requires `_lpAllowlist[lp].approved`. Validates `newApprovedAt <= block.timestamp`. Updates `approvedAt`. Emits `ScreeningRefreshed(indexed lp, newApprovedAt)`.

**`revokeAccess(address lp)`** — Sanctions/compliance removal. Requires `_lpAllowlist[lp].approved`. Clears to `LPEntry(false, 0)`. Emits `LPRevoked(indexed lp)`.

### DeFi venue management (ADMIN)

**`addDeFiVenue(address venue)`** / **`removeDeFiVenue(address venue)`** — No timelock. Emits `VenueAdded` / `VenueRemoved`.

Note: removing a venue that holds PLUSD creates a black hole — that PLUSD cannot be transferred out. Recovery path: admin re-adds the venue temporarily, venue's LPs withdraw, admin removes again.

### System address management (ADMIN, timelocked)

- `proposeSystemAddress(addr)` / `executeAddSystemAddress(addr)` / `cancelSystemAddressChange()` — 48h timelock.
- `proposeRemoveSystemAddress(addr)` / `executeRemoveSystemAddress(addr)` / `cancelRemoveSystemAddress()` — 48h timelock.

Timelock rationale for both add and remove: system addresses bypass freshness checks on mints (add = privilege escalation). Removing a system address (e.g., sPLUSD vault, WithdrawalQueue) breaks protocol operations. This is an operational disruption equivalent to a targeted pause. Emergency response uses PLUSD pause (GUARDIAN, instant) rather than system address removal.

### Freshness window management (ADMIN)

```solidity
uint256 public constant MIN_FRESHNESS = 7 days;
uint256 public constant MAX_FRESHNESS = 365 days;
```

**`setFreshnessWindow(uint256 newWindow)`** — Bounded by constants. No timelock — tightening is always safe, loosening is bounded by `MAX_FRESHNESS`.

### Trust assumptions

- Bridge holds WHITELIST_ADMIN and can revoke all LP whitelist entries, freezing all PLUSD transfers. No rate limit on revocations. GUARDIAN's fast pause on PLUSD is the emergency brake for a rogue Bridge doing mass revocations.
- ADMIN Safe can grant itself WHITELIST_ADMIN and override any whitelist decision.

---

## 9. LoanRegistry

**Context.** Reinstated per originator: "on-chain proofs of deals." One soulbound ERC-721 per originated loan. Holds no capital. Not an input to sPLUSD share price. Yield still flows exclusively through `PLUSD.yieldMint(vault, amount)` when USDC repayment lands in the Capital Wallet. The registry is the audit trail — no more, no less.

### Purpose

- Immutable public record of every loan financed through the protocol (principal, doc hash, originator, borrower, commodity, origination time).
- Operational state tracking for live loans (status, collateral coverage ratio, commodity location, maturity) — sourced off-chain by the Trustee, written on-chain by the Trustee key.
- Fully soulbound: tokens are non-transferable after mint. Ownership is symbolic; economic rights do not flow through the NFT.

### Roles (via AccessManager)

| Role | Grantee | Can call |
|---|---|---|
| TRUSTEE | Trustee key | `mintLoan`, `updateStatus(loanId, {Performing, Watchlist})`, `updateCCR`, `updateLocation`, `updateMaturity`, `closeLoan` |
| RISK_COUNCIL | RISK_COUNCIL 3/5 Safe | `setDefault(loanId)` (24h delay, GUARDIAN-cancelable) |
| PAUSER | GUARDIAN 2/5 | `pause` / `unpause` |
| UPGRADER | ADMIN 3/5 | `upgradeTo` (48h delay) |
| ADMIN | ADMIN 3/5 | Contract-level admin ops |

**Separation of duty:** the Trustee can flag a loan as `Watchlist` but cannot flag `Default`. The `Default` transition — which has reputational and reporting consequences — requires RISK_COUNCIL with a 24h timelock (GUARDIAN-cancelable) to protect against front-running on sPLUSD secondary transfers. Trustee can still execute `closeLoan(loanId, Default)` after RISK_COUNCIL has set `Default`, since closure is a routine Trustee operation.

### Data structures

```solidity
enum LoanStatus   { Performing, Watchlist, Default, Closed }
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default }

struct ImmutableLoanData {
    bytes32 docHash;       // IPFS/S3 hash of signed facility docs
    uint256 principal;     // original facility size, USDC decimals
    address originator;    // counterparty that took on the loan
    address borrower;      // end beneficiary (may equal originator)
    bytes32 commodity;     // short code (e.g. "COCOA-2026-07")
    uint64  originatedAt;  // block.timestamp at mint
}

struct MutableLoanData {
    LoanStatus    status;
    uint32        ccrBps;        // collateral coverage ratio, basis points
    bytes32       location;      // warehouse/port short code or coordinates digest
    uint64        maturity;      // unix timestamp; may be extended
    ClosureReason closureReason; // set only on transition → Closed
}

mapping(uint256 loanId => ImmutableLoanData) public immutableData;
mapping(uint256 loanId => MutableLoanData)   public mutableData;

uint256 public nextLoanId;
```

### Functions

**`mintLoan(address to, ImmutableLoanData data, uint64 initialMaturity)`** — Restricted to `TRUSTEE`. Mints a new soulbound token to `to`, writes `immutableData`, initializes `mutableData.status = Performing` and `mutableData.maturity = initialMaturity`. Emits `LoanMinted(loanId, originator, principal, docHash)`.

**`updateStatus(uint256 loanId, LoanStatus newStatus)`** — Restricted to `TRUSTEE`. Rejects transitions into `Default` (use `setDefault`) and into `Closed` (use `closeLoan`). Legal transitions: `Performing ↔ Watchlist`. Emits `LoanStatusChanged`.

**`updateCCR(uint256 loanId, uint32 newCcrBps)`** — Restricted to `TRUSTEE`. Reverts if loan is `Closed`. Emits `LoanCCRUpdated`.

**`updateLocation(uint256 loanId, bytes32 newLocation)`** — Restricted to `TRUSTEE`. Reverts if loan is `Closed`. Emits `LoanLocationUpdated`.

**`updateMaturity(uint256 loanId, uint64 newMaturity)`** — Restricted to `TRUSTEE`. Reverts if loan is `Closed`. No constraint that `newMaturity > oldMaturity` — extensions and forward roll-ups allowed; auditors verify via event history. Emits `LoanMaturityUpdated`.

**`setDefault(uint256 loanId)`** — Restricted to `RISK_COUNCIL`, 24h AccessManager delay, GUARDIAN-cancelable. Transitions `status = Default`. Rejects if current status is `Closed`. Emits `LoanDefaulted(loanId)`.

**`closeLoan(uint256 loanId, ClosureReason reason)`** — Restricted to `TRUSTEE`. Sets `status = Closed`, writes `closureReason = reason`. Valid inputs: `ScheduledMaturity`, `EarlyRepayment`, `Default`. The `Default` reason is admissible only if `status` was already `Default` (enforced by internal check). No further mutation allowed after closure.

**`_update(from, to, tokenId, auth)`** (OZ v5.x ERC-721 hook) — Overridden to revert on any transfer where `from != address(0)` (non-mint) and `to != address(0)` (non-burn). Soulbound property.

### Capital separation

- LoanRegistry never moves USDC, PLUSD, or sPLUSD. It has no `IERC20` touchpoints.
- `closeLoan` does not mint or burn anything. Yield flow (USDC repayment on Capital Wallet → Trustee + Bridge cosigned release cycle → `PLUSD.yieldMint(vault, …)`) is a fully separate sequence.
- A compromised `TRUSTEE` key can falsify `LoanRepaid`-equivalent state (via `closeLoan(id, EarlyRepayment)`) but cannot produce or move any capital. This is data-integrity damage, not funds damage — see §13.

### Design notes

- **Why soulbound ERC-721 instead of plain struct mapping?** The ERC-721 surface gives auditors, indexers, and downstream integrations (Dune, block explorers) a standard shape for iteration, ownership queries, and event semantics. ~60 lines over a bare mapping; the clarity payoff outweighs it.
- **Why no on-chain verification of `EarlyRepayment`?** Repayment arrival is a cross-rail event (USDC on Ethereum's Capital Wallet). The contract cannot observe the Capital Wallet's balance change atomically with `closeLoan`. Trustee attests; monitoring reconciles against Capital Wallet USDC inflow.
- **Why no partial repayments?** Trade finance loans in MVP scope are single-shot (principal + interest paid at maturity or early in one transfer). If multi-tranche repayment becomes operationally needed, `MutableLoanData` gains a `repaidAmount` field and `LoanPartialRepaid` event — additive, non-breaking.
- **Pausing effect.** When paused, all mutation functions revert. View functions still work. Pausing the registry is *not* in the default incident playbook but exists for completeness.

---

## 10. Deployment

### Prerequisites

1. Three Gnosis Safes deployed: ADMIN 3/5, RISK_COUNCIL 3/5, GUARDIAN 2/5.
2. Bridge on-chain address (key ceremony complete — internal HSM/MPC setup is an implementation detail of Bridge).
3. Trustee on-chain address (key ceremony complete; distinct key set from Bridge).
4. Bridge yield-attestor signing address (EOA for EIP-712 signing).
5. Custodian yield-attestor contract address (EIP-1271 compliant — provided by the custodian as part of API-Co-Signer or Policy-Engine setup).
6. Capital Wallet MPC address; Treasury Wallet MPC address.

### Order

```
Step 0:  Verify every implementation contract constructor calls _disableInitializers().
         (Audit item; verified before Step 1.)
Step 1:  Deploy AccessManager(admin = ADMIN Safe).
Step 2:  Deploy implementation contracts (PLUSD_Impl, DepositManager_Impl, sPLUSD_Impl, WQ_Impl,
         WhitelistRegistry_Impl, LoanRegistry_Impl, ShutdownController_Impl, RecoveryPool_Impl).
Step 3:  Deploy ERC1967 proxies for each, initializing with (manager = AccessManager, peers...).
         Order: WhitelistRegistry, PLUSD, DepositManager, sPLUSD, WQ, LoanRegistry, RecoveryPool, ShutdownController.
         (Each initialize(...) wires references; ShutdownController last so it can take all peers.)
Step 4:  Deploy EmergencyRevoker(
           manager, bridge, trustee, guardianSafe,
           funderRole, whitelistAdminRole, trusteeRole, yieldMinterRole
         ).
         Non-upgradeable. `bridge` and `trustee` are ADMIN-updatable via 48h timelock.
         v2.3: no longer references PLUSD (no attestor to clear).

Step 5:  AccessManager role → function mappings (setTargetFunctionRole):

         PLUSD:
           - PLUSD.mintForDeposit          → DEPOSITOR    → DepositManager
           - PLUSD.yieldMint               → YIELD_MINTER → Bridge  (caller gate; also requires 2-of-2 EIP-712 sigs)
           - PLUSD.redeemInShutdown        → public (shutdown-gated)
           - PLUSD.burn                    → BURNER       → WithdrawalQueue
           - PLUSD.pause / unpause         → PAUSER       → GUARDIAN
           - PLUSD.setRateLimits           → ADMIN (3/5), tighten-instant / loosen-48h
           - PLUSD.setMaxTotalSupply       → ADMIN (3/5), tighten-instant / loosen-48h
           - PLUSD.proposeYieldAttestors / executeYieldAttestorsChange / cancelYieldAttestorsChange → ADMIN (3/5), 48h via TimelockPending
           - PLUSD.upgradeTo               → UPGRADER     → ADMIN, 48h delay

         DepositManager:
           - DepositManager.deposit                           → public
           - DepositManager.pause / unpause                   → PAUSER       → GUARDIAN
           - DepositManager.proposeCapitalWallet / execute / cancel → ADMIN (3/5), 48h timelock
           - DepositManager.setMinDeposit                     → ADMIN (3/5)
           - DepositManager.upgradeTo                         → UPGRADER     → ADMIN, 48h delay

         sPLUSD:
           - sPLUSD.pause / unpause        → PAUSER       → GUARDIAN
           - sPLUSD.upgradeTo              → UPGRADER     → ADMIN, 48h delay

         WQ:
           - WQ.fundRequest                → FUNDER       → Bridge
           - WQ.skipSanctionedHead         → FUNDER       → Bridge
           - WQ.claim                      → public (requester-gated)
           - WQ.claimAtShutdown            → public (shutdown-gated)
           - WQ.adminRelease(Pending)      → ADMIN ops    → ADMIN Safe, immediate
           - WQ.adminReleaseFunded         → ADMIN ops    → ADMIN Safe, 24h delay, GUARDIAN-cancelable
           - WQ.adminSweep                 → ADMIN ops    → ADMIN Safe
           - WQ.sweepStale                 → ADMIN ops    → ADMIN Safe
           - WQ.pause / unpause            → PAUSER       → GUARDIAN
           - WQ.upgradeTo                  → UPGRADER     → ADMIN, 48h delay

         WhitelistRegistry:
           - WL.setAccess / refreshScreening / revokeAccess → WHITELIST_ADMIN → Bridge
           - WL admin ops                  → ADMIN (3/5) — local timelocks per §8
           - WL.pause / unpause            → PAUSER       → GUARDIAN
           - WL.upgradeTo                  → UPGRADER     → ADMIN, 48h delay

         LoanRegistry:
           - LR.mintLoan / updateStatus / updateCCR / updateLocation / updateMaturity / closeLoan
                                           → TRUSTEE     → Trustee key
           - LR.setDefault                 → RISK_COUNCIL → RISK_COUNCIL Safe, 24h delay, GUARDIAN-cancelable
           - LR.pause / unpause            → PAUSER       → GUARDIAN
           - LR.upgradeTo                  → UPGRADER     → ADMIN, 48h delay

         ShutdownController:
           - SC.enterShutdown              → RISK_COUNCIL, 24h delay, GUARDIAN-cancelable
           - SC.adjustRecoveryRateUp       → RISK_COUNCIL, 24h delay
           - SC.upgradeTo                  → UPGRADER     → ADMIN, 48h delay

         RecoveryPool:
           - RP.deposit                    → ADMIN (3/5)
           - RP.release                    → (internal — only PLUSD/WQ can call; no role)
           - RP.recordReturned             → (internal — only WQ; no role)
           - RP.upgradeTo                  → UPGRADER     → ADMIN, 48h delay

         EmergencyRevoker:
           - ER.revokeAll                  → GUARDIAN (authorized caller check in contract)
           - ER.setBridge / setTrustee     → ADMIN, 48h delay via TimelockPending

         AccessManager:
           - Grant ADMIN_ROLE (id 0) on AccessManager to EmergencyRevoker
             so it can call revokeRole(*, bridge) and revokeRole(TRUSTEE, trustee).

Step 5a: Role-grant verification checkpoint. Read hasRole for every (role, account) pair
         before the timelock starts. Special attention to: FUNDER on Bridge, WHITELIST_ADMIN
         on Bridge, YIELD_MINTER on Bridge, TRUSTEE on Trustee key, RISK_COUNCIL on council
         Safe, UPGRADER on ADMIN Safe.

Step 6:  Per-target admin delays (setTargetAdminDelay): all role changes gated 48h.
         Meta-timelock: setTargetAdminDelay itself gated 14d (prevents delay collapse).

Step 7:  Whitelist system addresses (WL timelock, 48h):
         - propose: DepositManager, sPLUSD vault, WQ, RecoveryPool, ShutdownController, Treasury Wallet, Capital Wallet
         - wait 48h
         - execute in batched Safe tx

Step 8:  Capital Wallet → WQ USDC allowance.
         Capital Wallet MPC (Trustee + Bridge cosigners) approves the WQ to spend
         USDC up to a ceiling (e.g. $50M, renewable). WQ.fundRequest uses this
         allowance via usdc.transferFrom(capitalWallet, wq, amount). Bridge itself
         never custodies USDC.
         Note: deposits use a different mechanism — LPs approve DepositManager
         directly on their own wallets, and DepositManager uses the LP's USDC
         allowance to push USDC to Capital Wallet in one transferFrom.

Step 9:  Custodian MPC policy-engine acceptance (R2). Confirm custodian rules:
         (a) every LP withdrawal destination must match an address in that LP's
             historic deposit-address set, and
         (b) cumulative USDC withdrawn by any LP cannot exceed cumulative USDC
             that LP has deposited to the Capital Wallet.
         Plus: custodian provides and operates the EIP-1271 yield-attestation
         signer (API Co-Signer or Policy Engine webhook integration).
         Sign-off from custodian operations team is a launch prerequisite.

Step 10: Seed RecoveryPool with 0 USDC. Remains empty until a shutdown is funded.

Step 11: PLUSD.setOperational(true). Final enablement.
```

### Initial cap parameters (v2.3)

Four numeric caps must be set at deployment (tightening-instant, loosening-48h post-launch). Initial sizing is a business decision that should reflect expected launch TVL and LP onboarding profile:

```
PLUSD.maxPerWindow        — default $10M / 24h rolling    (aggregate across all LPs)
PLUSD.maxPerLPPerWindow   — default $5M  / 24h rolling    (per-LP concentration)
PLUSD.maxTotalSupply      — launch value to be set by Product / Risk
```

### Pre-launch checklist

- [ ] All 3 Safes deployed with correct thresholds and signers
- [ ] All impl constructors verified to call `_disableInitializers()`
- [ ] All proxies deployed and verified on Etherscan
- [ ] `eip712Domain()` returns matching tuples across all future impls (regression test)
- [ ] All (target, selector, role, grantee) tuples verified via `hasRole`
- [ ] 48h admin delay on role changes; 14d meta-timelock on delay changes; 24h on shutdown entry; 24h on setDefault; 24h on adjustRecoveryRateUp
- [ ] DepositManager, sPLUSD, WQ, RecoveryPool, ShutdownController, Treasury, Capital Wallet in system allowlist
- [ ] Bridge holds FUNDER, WHITELIST_ADMIN, YIELD_MINTER
- [ ] DepositManager holds DEPOSITOR on PLUSD
- [ ] Trustee key holds TRUSTEE
- [ ] GUARDIAN holds PAUSER on every pausable target (including DepositManager)
- [ ] GUARDIAN is `authorizedCaller` on EmergencyRevoker
- [ ] Bridge yield-attestor EOA provisioned
- [ ] Custodian EIP-1271 yield-attestor contract address provisioned and verified (`isValidSignature` test with a sample digest)
- [ ] Initial `maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply` set and verified
- [ ] Capital Wallet → WQ USDC allowance set and verified
- [ ] Reserve invariant smoke test: DepositManager deposit → counters update → yieldMint → counters update → burn via WQ → counters update; invariant holds at every step
- [ ] Two-party yieldMint test: valid Bridge sig + invalid custodian sig → reverts; vice versa → reverts; both valid → succeeds
- [ ] Hard supply cap test: mint that would exceed `maxTotalSupply` → reverts
- [ ] Per-LP cap test: second deposit in same window that breaches `maxPerLPPerWindow` → reverts
- [ ] Window cap test: N deposits summing > `maxPerWindow` within 24h → next reverts
- [ ] EIP-712 domain pinning test: upgrade to a modified impl with drift → reverts
- [ ] Test `DepositManager.deposit` during `shutdownActive` → reverts (because `mintForDeposit` reverts)
- [ ] Test shutdown unwind: `sPLUSD.redeem` → `PLUSD.redeemInShutdown` full flow
- [ ] Test `claimAtShutdown` Funded-branch returns haircut to RecoveryPool
- [ ] Test `skipSanctionedHead` with de-whitelisted head
- [ ] Test `adminReleaseFunded` 24h delay enforced; GUARDIAN cancel works
- [ ] Test `sweepStale` at 179d reverts, at 181d works
- [ ] Rate-limit, freshness window confirmed
- [ ] Custodian MPC policy engine signed off (R2)
- [ ] Monitoring dashboards wired to all contract events (incl. LoanRegistry)
- [ ] Incident response runbook reviewed; `EmergencyRevoker.revokeAll()` tested on testnet

---

## 11. Cross-Contract Interaction Map

### Capital-path calls

| Caller | Target | Function | Trust assumption |
|---|---|---|---|
| LP | DepositManager.deposit | Atomic 1:1 USDC→PLUSD | LP pre-approves DepositManager on USDC; whitelist-for-mint check; reserve invariant; hard supply cap; rate limits; no off-chain signer |
| Bridge | PLUSD.yieldMint | Yield accrual | Triple gate: YIELD_MINTER role; Bridge EIP-712 sig (ecrecover); Custodian EIP-1271 sig; destination constrained to vault/treasury; replay guard on `repaymentRef` |
| LP | WQ.requestWithdrawal | Enter queue | Whitelist check at entry; pulls PLUSD into WQ |
| Bridge | WQ.fundRequest | Pull USDC from Capital Wallet into WQ for head | FUNDER role; strict FIFO (`nextToFund`); USDC moves via Capital Wallet allowance — Bridge never custodies |
| Bridge | WQ.skipSanctionedHead | Unblock DoS from sanctioned head | FUNDER role; Bridge verifies `!isAllowed(head.requester)` |
| LP | WQ.claim | Burn PLUSD + receive USDC | `msg.sender == requester`; current whitelist required |
| sPLUSD.deposit / redeem | PLUSD.transferFrom / transfer | Stake / unstake | Vault is system; receiver must be non-system and whitelisted (non-transferability enforces exactly-one-side-system) |
| ADMIN Safe | WQ.adminRelease(Pending) | Immediate unstick of Pending-status request | ADMIN |
| ADMIN Safe | WQ.adminReleaseFunded | 24h-timelocked release of Funded | ADMIN; GUARDIAN-cancelable |
| ADMIN Safe | WQ.sweepStale | 180d stale claim sweep | ADMIN; recipient = original requester |

### Loan-path calls

| Caller | Target | Function |
|---|---|---|
| Trustee key | LoanRegistry.{mintLoan, updateStatus, updateCCR, updateLocation, updateMaturity, closeLoan} | TRUSTEE role |
| RISK_COUNCIL Safe | LoanRegistry.setDefault | 24h delay, GUARDIAN-cancelable |

### Shutdown-path calls

| Caller | Target | Function |
|---|---|---|
| RISK_COUNCIL Safe | ShutdownController.enterShutdown | 24h delay, GUARDIAN-cancelable |
| Any caller after 24h | ShutdownController (via AccessManager.execute) | executes scheduled enterShutdown |
| RISK_COUNCIL Safe | ShutdownController.adjustRecoveryRateUp | 24h delay |
| LP (sPLUSD holder) | sPLUSD.redeem | Standard ERC-4626 exit returning (depegged) PLUSD |
| LP (PLUSD holder) | PLUSD.redeemInShutdown | Burn PLUSD, receive recoveryRate × USDC from RecoveryPool |
| LP (with pre-shutdown WQ request) | WQ.claimAtShutdown | Burn WQ-held PLUSD, receive recoveryRate × USDC (Funded branch returns haircut to pool) |
| ADMIN Safe | RecoveryPool.deposit | Top up pool with late recoveries |

### Incident-path calls

| Caller | Target | Function |
|---|---|---|
| GUARDIAN Safe | \*.pause() | Instant pause — no timelock (PLUSD, DepositManager, sPLUSD, WQ, WhitelistRegistry, LoanRegistry) |
| GUARDIAN Safe | AccessManager.cancel(actionId) | Cancel any pending scheduled action |
| GUARDIAN Safe | EmergencyRevoker.revokeAll | Revoke FUNDER + WHITELIST_ADMIN + YIELD_MINTER from Bridge, TRUSTEE from Trustee |
| ADMIN Safe | EmergencyRevoker.setBridge / setTrustee | 48h timelock — accommodates operational key rotation |
| ADMIN Safe | PLUSD.proposeYieldAttestors / execute | 48h timelock — rotate Bridge/custodian yield-sig keys under key-compromise scenario |

### Bridge-to-contract sequences (cross-rail)

| Sequence | Risk | Mitigation |
|---|---|---|
| LP calls `DepositManager.deposit(amount)` → USDC moves LP → Capital Wallet → PLUSD minted 1:1 to LP | `transferFrom` succeeds but `mintForDeposit` reverts | Atomic: any revert in `mintForDeposit` propagates and the whole transaction reverts, restoring USDC to LP. |
| Bridge + custodian co-sign a `YieldAttestation` → Bridge submits `yieldMint(att, bridgeSig, custodianSig)` (vault destination); repeats for treasury destination | First succeeds, second fails: vault yield accreted but treasury share missing | Two separate calls, each idempotent on `repaymentRef`. Bridge retries the failed leg after Trustee/custodian re-co-sign a new attestation with a fresh `salt`. Monitoring treats partial-yield-mint as known intermediate state. |
| LP submits `requestWithdrawal` → Bridge calls `WQ.fundRequest(queueId)` → LP calls `WQ.claim(queueId)` | Atomic claim. Bridge never custodies USDC. Capital Wallet allowance funds the WQ on `fundRequest` via `usdc.transferFrom(capitalWallet, wq, amount)`. | Capital Wallet allowance is cosigned (Trustee + Bridge). If Bridge is compromised, Trustee can revoke allowance out-of-band. |
| LP withdrawal USDC leg (Capital Wallet → WQ → LP) | LP attempts to route withdrawal to a new address, or to exfiltrate more than they deposited | Two-leg defence. On-chain: `WQ.claim` pays only the requester. Off-chain (R2): custodian MPC policy engine caps cumulative per-LP outflow and enforces destination-set matching on the Capital Wallet → WQ release. |
| Trustee originates loan off-chain → Trustee calls `LoanRegistry.mintLoan` | Trustee misses own registry write (tx revert) | Mint is atomic with the on-chain touchpoint; on revert, nothing is recorded and origination is replayed on retry. No coupling to capital flow. |
| Trustee verifies USDC repayment on Capital Wallet → Bridge calls `PLUSD.yieldMint(vault, yieldAmount)` + Trustee calls `LoanRegistry.closeLoan(id, EarlyRepayment\|ScheduledMaturity)` | Yield mints but registry close fails (or vice versa) | Two independent txs. Yield is the capital-critical leg and is retried until successful; registry close is idempotent (calling on already-Closed reverts). Registry lag does not affect share price. |

### Pause cascade

| Paused | Effect | Unaffected |
|---|---|---|
| PLUSD | Full freeze. All mints, transfers, burns revert (except `redeemInShutdown`, via `_setShutdownRedeemPath`). DepositManager, sPLUSD, and WQ all stop (they all depend on PLUSD being mint/burn/transfer-able). | View functions only. |
| DepositManager | `deposit` reverts. PLUSD itself still operational if not separately paused. | Yield mints, withdrawals, stake/unstake. |
| sPLUSD | Deposit/redeem/transfers revert. `yieldMint` to vault also reverts because it goes through `PLUSD._update` → pause-check on PLUSD. | Other capital paths if PLUSD unpaused. |
| WithdrawalQueue | `requestWithdrawal`, `fundRequest`, `skipSanctionedHead`, `claim`, `adminRelease*`, `adminSweep`, `sweepStale`, `claimAtShutdown` all revert. | Deposits (DepositManager), stake/unstake. |
| LoanRegistry | All mutations revert. Capital flows are unaffected — registry is not in their path. Not in the default incident playbook; reserved for data-integrity incidents. | All capital operations. |
| ShutdownController | — (never paused by itself; shutdown and pause are orthogonal mechanisms). | |
| RecoveryPool | `deposit` and `release` revert. | — |

### Shutdown vs pause

- **Pause** (GUARDIAN, instant): defensive brake, fully reversible.
- **Shutdown** (RISK_COUNCIL 24h + ADMIN execute, GUARDIAN-vetoable): terminal declaration of recovery rate. No programmatic exit (v2.2).
- During shutdown, PLUSD is paused for normal flow but `redeemInShutdown` is enabled via the transient flag pattern. sPLUSD stays unpaused so holders can `redeem` to PLUSD and then `redeemInShutdown`.

Ops runbook must make cascade explicit. PLUSD pause is the nuclear option.

---

## 12. EmergencyRevoker

Pre-signed revocation transactions have a fatal flaw: Gnosis Safe nonces are sequential. Any Safe transaction (routine admin work, parameter change, role grant) increments the nonce and invalidates all pre-signed revocation txs. The revocations become stale the moment the Safe does anything.

**Solution:** An immutable, parameterless contract deployed at launch:

```solidity
contract EmergencyRevoker {
    IAccessManager public immutable manager;
    address        public immutable guardian;          // authorized caller (GUARDIAN 2/5)

    // Target addresses: ADMIN-updatable via 48h timelock (U7)
    address public bridge;
    address public trustee;

    uint64 public immutable funderRole;
    uint64 public immutable whitelistAdminRole;
    uint64 public immutable yieldMinterRole;
    uint64 public immutable trusteeRole;

    // Inlined TimelockPending-style pattern for target rotation
    mapping(bytes32 => uint256) public pendingTargetChanges;

    function revokeAll() external {
        require(msg.sender == guardian, "unauthorized");
        manager.revokeRole(funderRole,         bridge);
        manager.revokeRole(whitelistAdminRole, bridge);
        manager.revokeRole(yieldMinterRole,    bridge);
        manager.revokeRole(trusteeRole,        trustee);
    }

    function proposeSetBridge(address newBridge) external restricted;    // ADMIN
    function executeSetBridge(address newBridge) external restricted;    // ADMIN, 48h timelock
    function cancelSetBridge(address newBridge) external restricted;     // ADMIN
    // Symmetric functions for trustee.
}
```

~50 LOC. `revokeAll` is parameterless, non-reentrant-by-construction, and only callable by GUARDIAN. `bridge` and `trustee` addresses are ADMIN-updatable with 48h timelock — accommodates routine key rotation without redeploy ceremonies. Non-upgradeable. Holds AccessManager ADMIN.

**v2.3 change:** EmergencyRevoker no longer touches PLUSD. With MINT_ATTESTOR retired (M2), there is no attestor to zero. The deposit path is structurally safe because `PLUSD.mintForDeposit` is role-gated to DepositManager, and DepositManager itself is pausable by GUARDIAN (faster mitigation than role revocation). YIELD_MINTER remains a revokable role; compromising it alone still cannot mint (requires custodian co-signature).

**Safety-by-construction (for audit):** despite holding AccessManager ADMIN, EmergencyRevoker exposes only `revokeAll` (and target-rotation functions gated by ADMIN + 48h). There is no fallback, no delegatecall, no arbitrary-call forwarding. An attacker cannot use EmergencyRevoker as a proxy to grant roles or move funds.

**Under attack:** The GUARDIAN 2/5 Safe submits one tx: `EmergencyRevoker.revokeAll()`. One tx, one nonce, four revocations on the hub. The nonce is always fresh because the call is constructed at incident time, not pre-signed. Only 2 of 5 signers needed — same threshold as pause, matching the urgency profile.

**Risk of EmergencyRevoker compromise:** Minimal. The contract is immutable — `revokeAll()` can only disconnect Bridge/Trustee, and only when called by the GUARDIAN Safe. It cannot grant roles, mint tokens, or move funds. The ADMIN Safe can re-grant Bridge/Trustee roles on the AccessManager after investigation.

### Incident response — Bridge compromise

1. **Detection.** Monitoring alerts on anomalous mint/settle/whitelist activity, on divergence between `DepositManager.Deposited` events and `PLUSD.cumulativeLPDeposits`, on `LoanClosed(…, EarlyRepayment)` events without matching USDC inflow, or on reserve-invariant headroom shrinking unexpectedly.
2. **Immediate (GUARDIAN, < 1 minute):** Pause PLUSD (freezes everything — mints, transfers, burns except shutdown-redeem path); pause DepositManager (stops new deposits explicitly); pause WithdrawalQueue (defense-in-depth).
3. **Containment (GUARDIAN, < 10 minutes):** Submit one Safe tx calling `EmergencyRevoker.revokeAll()` — atomically revokes FUNDER, WHITELIST_ADMIN, YIELD_MINTER from Bridge and TRUSTEE from Trustee. Even a fully compromised Bridge cannot mint yield alone (custodian signature still required); cannot fund withdrawals (FUNDER revoked); cannot modify whitelist (WHITELIST_ADMIN revoked). Deposits are blocked separately via DepositManager pause.
4. **Investigation.** Audit logs, determine blast radius. If Trustee was not compromised, Trustee can cosign on Capital Wallet to revoke the Capital Wallet → WQ USDC allowance as an additional barrier. If the compromise was via the Bridge yield-signing key (not the operational EOA), initiate `PLUSD.proposeYieldAttestors(newBridge, sameCustodian)` with 48h timelock — meanwhile yield mints remain blocked (pause + role revocation).
5. **Recovery.** Deploy/provision new Bridge key. Call `EmergencyRevoker.setBridge(newBridge)` (48h timelock), then ADMIN grants FUNDER/WHITELIST_ADMIN/YIELD_MINTER to the new Bridge on AccessManager. If the yield-signing key was also compromised, execute the pending `executeYieldAttestorsChange`. Unpause PLUSD, DepositManager, and WQ.

---

## 13. Audit Brief Outline

### Scope

- 7 Solidity files in primary audit scope: TimelockPending.sol, PLUSD.sol, SPLUSD.sol, WithdrawalQueue.sol, WhitelistRegistry.sol, ShutdownController.sol, RecoveryPool.sol, EmergencyRevoker.sol. AccessManager is deployed from OZ v5.x (no custom code).
- LoanRegistry.sol is **excluded from primary audit scope** — it holds no capital and has no effect on sPLUSD share price, PLUSD supply, or withdrawal settlement. Internal review only.
- Target: Tier 1 audit (Trail of Bits, ChainSecurity, OpenZeppelin, or equivalent).
- Estimated engagement: 2.5–3 weeks (up from v2.1 due to UUPS, ShutdownController, claim-model WQ).

### Threat model

| Threat | Likelihood | Impact | On-chain mitigation |
|---|---|---|---|
| Compromised Bridge (backend) | Medium | **Bounded** — cannot mint deposit PLUSD (deposits are atomic LP-driven); cannot mint yield alone (requires custodian co-sig); can call FUNDER / WHITELIST_ADMIN / (solo-submit) YIELD_MINTER | Deposit leg has no Bridge dependency — DepositManager is role-gated to itself, LP controls `transferFrom`. Yield leg requires custodian EIP-1271 co-signature; compromised Bridge alone → zero yield mint. Rate limits + per-LP cap + hard supply cap cap any accidental or malicious flow. WHITELIST_ADMIN compromise without mint-capability is not a drain path (cannot redirect funds to attacker). GUARDIAN pauses PLUSD, DepositManager, WQ instantly. `EmergencyRevoker.revokeAll()` atomically disconnects. Bridge never custodies USDC. |
| Compromised Bridge yield-attestor key (EOA) | Low–Med | **Bounded** — cannot mint alone (custodian must co-sign each mint) | Two-party attestation: custodian EIP-1271 independently verifies repayment. 48h rotation via `proposeYieldAttestors`. `usedRepaymentRefs` replay guard. |
| Compromised custodian yield-attestor | Low | **Bounded** — cannot mint alone (Bridge must co-sign; Bridge must hold YIELD_MINTER) | Two-party attestation. Custodian cannot forge yield solo. 48h rotation via `proposeYieldAttestors`. Custodian has independent legal/compliance controls. |
| Compromised Trustee key | Medium | Medium — data-integrity loss on LoanRegistry, plus ability to cosign malicious Capital Wallet releases (requires Bridge cosign too) | TRUSTEE role can `mintLoan` ghost loans, `closeLoan(..., EarlyRepayment)` without actual repayment, or set arbitrary CCR/location/maturity. No capital touchpoints in LoanRegistry. Capital Wallet releases require Bridge cosign — a single-key Trustee compromise cannot move USDC alone. `EmergencyRevoker.revokeAll` revokes TRUSTEE. Monitoring reconciles `LoanClosed(…, EarlyRepayment)` against Capital Wallet inflows. `Default` transition requires RISK_COUNCIL — not reachable by Trustee. |
| Reserve-invariant drift (counter desync) | Very Low | High — could mask over-minting | Counters updated in lockstep with `_mint` / `_burn` inside single function bodies. `_requireReserveInvariant` checks `totalSupply <= backing` before every mint. Full test coverage of the counter-updating paths, plus fuzz tests on the mint/burn sequences. |
| `maxTotalSupply` breach | Very Low | High | Hard cap enforced in `_requireReserveInvariant` before every mint. Loosening requires 48h timelock. |
| Malicious shutdown (RISK_COUNCIL + ADMIN collusion) | Very Low | Protocol-ending | 24h delay + GUARDIAN veto; distinct Safe signer sets. No pre-fund invariant (crisis-realistic), but also no degenerate "higher than cash" state because rate is chosen against actual pool balance and can only go up. |
| Upgrade malice (ADMIN compromised) | Low | Protocol-ending | 48h delay; GUARDIAN veto; 14d meta-timelock; EIP-712 domain pin check in `_authorizeUpgrade`; EmergencyRevoker non-upgradeable. |
| Queue-jump in distress | N/A | N/A | Resolved by symmetric haircut — Funded requests also pay the rate. |
| DoS via sanctioned head | N/A | N/A | `skipSanctionedHead` by FUNDER auto-skips. |
| `adminReleaseFunded` front-run of LP `claim` | Very Low | High | 24h timelock + GUARDIAN cancel. |
| sPLUSD shutdown race drain | N/A | N/A | Rate is frozen protocol-wide via `recoveryRateBps`; order of unwind does not affect per-unit payout. |
| Double-mint on yield path | Very Low | High | `usedRepaymentRefs` replay key; deterministic `keccak256(chainId, repaymentTxHash)` format; two-party sig requirement means collusion needed in addition to replay. |
| `setDefault` front-run on sPLUSD secondary | Low | Medium | 24h timelock; GUARDIAN-cancelable. |
| GUARDIAN compromise (2/5) | Low | Medium — can grief via cancel; can force revokeAll; **cannot escalate roles or move funds.** | Accepted per Morpho sentinel pattern. ADMIN rotates GUARDIAN signers. |
| Stale Funded claim (dead LP) | Low | Low | `sweepStale` at 180d, ADMIN-executed, recipient = original requester. |
| EmergencyRevoker targets stale after key rotation | N/A | N/A | `setBridge`/`setTrustee` with 48h timelock. |
| Malicious LP (sanctions evasion) | Medium | Medium — regulatory exposure | Chainalysis freshness window on mints; whitelist revocation; custodian-level destination/cap rules (R2). |
| MEV / front-running | Low | Low | No AMM; no sandwich-profitable paths. Rate-limit fixed-window 2× worst case bounded by custodial caps. |
| Smart contract vulnerability | Low (post-audit) | Variable | OZ v5.x base incl. audited AccessManager, UUPS; custom surface ~450 LOC; flat topology. |

### Focus areas

1. PLUSD `_update` correctness — non-transferability rule (`fromSys != toSys`), shutdown guard with `_isShutdownRedeemPath` flag, rate limits (per-window / per-LP, with system-address exemption), whitelist-for-mint, ERC20Permit linearization.
2. **Reserve invariant correctness** — counters updated in lockstep with mint/burn; `_requireReserveInvariant` called on every mint path; `maxTotalSupply` enforced before mint; fuzz tests on counter arithmetic.
3. **DepositManager atomicity** — `deposit` pulls USDC from LP to Capital Wallet and mints PLUSD in the same tx; any revert inside `mintForDeposit` rolls back the USDC transfer; no USDC can arrive without PLUSD being minted (and vice versa).
4. **Two-party yieldMint signature verification** — Bridge ECDSA + custodian EIP-1271 both verified on each call; `usedRepaymentRefs` replay guard; EIP-712 domain pinning on upgrade; deadline enforcement.
5. WithdrawalQueue lifecycle — FIFO on funding, atomic claim, `skipSanctionedHead` correctness, `adminReleaseFunded` 24h timelock path, `sweepStale` boundary.
6. Capital Wallet → WQ allowance pattern — `usdc.transferFrom(capitalWallet, ...)` on `fundRequest`; invariant that Bridge itself never holds USDC.
7. ShutdownController & RecoveryPool — entry path with no pre-fund requirement, up-only rate adjustment, symmetric Funded-branch haircut with pool return.
8. AccessManager role topology — per-target admin delays, UPGRADER gating on every `_authorizeUpgrade`, EmergencyRevoker's `ADMIN_ROLE` safety-by-construction, DEPOSITOR role scoped to DepositManager only.

### Known properties (not bugs)

- Rate limit fixed-window boundary: worst-case 2× `maxPerWindow`.
- `windowMinted` does not decrease on burn.
- LoanRegistry mutable state (status, CCR, location, maturity, `closeLoan(..., EarlyRepayment)`) is Trustee-attested, not on-chain-verified; only `setDefault` is gated on RISK_COUNCIL.
- DeFi venue removal creates PLUSD black hole (documented recovery path).
- Addresses can exist in multiple allowlist categories simultaneously.
- ADMIN Safe can re-grant revoked Bridge/Trustee roles (EmergencyRevoker disarmable by admin).
- Recovery rate only ratchets up. Post-entry discoveries of further losses do not reduce the rate; LPs who have not yet redeemed wait on Trustee inflows, not a rate cut.

### Accepted trust-footprint items

- **B1 — Trustee signatures over location/valuation/CCR updates are off-chain attestations.** Verified off-chain by Bridge before calling `updateLocation` / `updateCCR`. Trustee is the only caller of `TRUSTEE_ROLE` functions.
- **B2 — `EmergencyRevoker` is disarmable by the ADMIN Safe.** ADMIN 3/5 can `revokeRole(ADMIN_ROLE, emergencyRevoker)` on AccessManager, disarming GUARDIAN's ability to cut off the Bridge/Trustee. Accepted consequence; mitigation is off-chain (deployment runbook + monitoring alerts on relevant `RoleRevoked` events).
- **B3 — No on-chain backing oracle.** Protocol does not verify on-chain that `PLUSD.totalSupply()` is backed 1:1 by USD-equivalent assets. Backing computed off-chain by Bridge/treasury service from reconciled on-chain state combined with custody attestations (USDC in Capital Wallet, USYC holdings).

### Pre-audit deliverables

- [ ] Gas benchmarks: PLUSD transfer cost (with external WhitelistRegistry call), `claim` cost, worst-case `_advanceHead`-style loops.
- [ ] Full test suite with coverage report.
- [ ] Deployment script exercised on testnet.
- [ ] ERC20Permit linearization test (permit + transferFrom to LP-to-LP / non-whitelisted).
- [ ] Donation attack math at $50M TVL documented.
- [ ] UUPS upgrade drill on testnet including EIP-712 domain pin assertion.

---

## 14. Testing Strategy

### Phase 1: Full-scenario local test suite (pre-audit)

Complete Foundry test environment with mock actors, tokens, and time manipulation. Every branch of every contract exercised.

**Mock actors:**

- Multiple LP wallets (whitelisted, expired screening, revoked, sanctioned mid-flow).
- Bridge service (FUNDER / YIELD_MINTER / WHITELIST_ADMIN / yield-attestor signer — mock or harness).
- Custodian EIP-1271 signer (mock contract implementing `isValidSignature`).
- Trustee key (TRUSTEE role caller on LoanRegistry).
- ADMIN Safe, RISK_COUNCIL Safe, GUARDIAN Safe (mock multisig callers configured as AccessManager role grantees).
- Capital Wallet mock (MPC address with USDC balance and a pre-approved allowance to WQ).
- Malicious actors (non-whitelisted, re-entrant contracts, griefing bots).
- Real OZ v5.x AccessManager deployment; tests configure target-role mappings in `setUp`.

**Mock infrastructure:**

- Mock USDC (mintable ERC-20 for test purposes).
- Mock WhitelistRegistry oracle (controllable freshness timestamps).
- `vm.warp`, `vm.prank`, `deal`, `vm.sign` for EIP-712 signing.

**Scenario matrix:**

| Category | Scenarios |
|---|---|
| **Deposit (DepositManager)** | Happy-path `deposit`; LP without USDC allowance reverts; LP with zero balance reverts; sub-minimum deposit reverts; non-whitelisted LP reverts; expired-screening LP reverts; revoked LP reverts; rate-limit per-window caps deposit; per-LP per-window caps deposit (LP paths only, system addresses exempt); hard supply cap caps deposit; `DepositManager` paused reverts; PLUSD paused reverts (propagates); shutdown-active reverts; reserve invariant holds after every deposit. |
| **Reserve invariant (PLUSD)** | Counters advance in lockstep with `totalSupply`; burn decrements and invariant holds; double-entry arithmetic preserved across deposit + yield + burn mix; fuzz sequences of `(deposit, yieldMint, burn)` randomly ordered — invariant holds at every state; `maxTotalSupply` breach reverts. |
| **Yield mint (two-party)** | Happy path to vault with valid both sigs; happy path to treasury; valid Bridge sig + invalid custodian sig reverts; vice versa reverts; replay same `repaymentRef` reverts even with fresh `salt`; caller without YIELD_MINTER reverts; destination ≠ vault/treasury reverts; deadline exceeded reverts; shutdown-active reverts; EIP-1271 stub returning non-magic value reverts. |
| **Non-transferability** | LP→LP reverts; LP→WQ succeeds; WQ→LP succeeds; sys→sys (e.g., Treasury→Vault) reverts; permit+transferFrom to non-whitelisted reverts; permit+transferFrom LP→LP reverts. |
| **Staking** | Deposit, redeem, share price after yield mint, first-deposit inflation attack attempt, redeem to non-whitelisted receiver, redeem to LP (non-system) works, pause during active positions. |
| **Withdrawal** | Full lifecycle (request → fund → claim), fund on non-head reverts (strict FIFO on funding), `claim` on non-Funded reverts, MIN_WITHDRAWAL enforcement, head advancement with AdminReleased/Claimed gaps, `claim` by non-requester reverts, `claim` after LP de-whitelisted reverts. |
| **Cross-rail funding** | `fundRequest` pulls USDC from Capital Wallet via `transferFrom`; Bridge never custodies (verify Bridge balance unchanged); Capital Wallet allowance revoked → `fundRequest` reverts; Capital Wallet insufficient balance → `fundRequest` reverts; no intermediate state where PLUSD is burned without USDC in WQ. |
| **Sanctioned-head DoS** | `skipSanctionedHead` with de-whitelisted head; `skipSanctionedHead` with whitelisted head reverts; `skipSanctionedHead` advances `nextToFund` past the skipped request. |
| **Admin operations** | `adminRelease(Pending)` immediate unstick advances head; `adminReleaseFunded` respects 24h timelock (enforced by AccessManager); GUARDIAN can `cancel` pending `adminReleaseFunded` schedule; `adminSweep` after `adminReleaseFunded` moves both PLUSD and USDC; `sweepStale` at 179d reverts, 181d works; `sweepStale` to non-requester reverts. |
| **Whitelist** | LP onboard/refresh/revoke, venue add/remove/black-hole, system address add/remove (both timelocked), freshness boundary, multi-category membership, fuzz `isAllowedForMint` across full `uint256` range of `approvedAt` (must never return true for stale or future-dated). |
| **Loan lifecycle** | `mintLoan` happy path (immutable fields locked), `updateStatus` legal (Performing ↔ Watchlist) and illegal (Default/Closed via update reverts), `setDefault` restricted to RISK_COUNCIL, `setDefault` respects 24h timelock and GUARDIAN cancel, `closeLoan` reason enum validation, soulbound transfer revert, all mutations revert after close, all mutations revert when paused. |
| **Access control** | Unauthorized caller → `AccessManagedUnauthorized`; role grant takes effect only after per-target delay; revoked role loses access immediately; `EmergencyRevoker.revokeAll()` by non-GUARDIAN reverts; ADMIN can re-grant revoked Bridge/Trustee roles. |
| **Upgrade** | Unauthorized `upgradeTo` reverts; scheduled upgrade respects 48h delay; GUARDIAN cancels pending upgrade; impl with modified EIP-712 domain reverts (domain pin check); impl without `_disableInitializers` fails pre-launch verification; `setTargetAdminDelay` respects 14d meta-timelock. |
| **Shutdown** | `enterShutdown` only by RISK_COUNCIL after 24h; GUARDIAN cancel during window; `redeemInShutdown` only callable while `isActive`; `mintForDeposit` / `yieldMint` revert while `isActive`; `DepositManager.deposit` reverts while `isActive` (via mintForDeposit revert); sPLUSD holders exit via standard `redeem` → `redeemInShutdown` and receive correct pro-rata recovery-rate USDC; `claimAtShutdown` Pending-branch pulls from pool; `claimAtShutdown` Funded-branch returns haircut to pool and pays recoveryRate; `adjustRecoveryRateUp` respects 24h delay; no `adjustRecoveryRateDown` selector exists. |
| **Incident response** | GUARDIAN pause cascade (PLUSD pause freezes everything, DepositManager pause blocks new deposits specifically); `EmergencyRevoker.revokeAll` by GUARDIAN lands four role revocations in one tx (FUNDER/WHITELIST_ADMIN/YIELD_MINTER from Bridge + TRUSTEE from Trustee); two-party yield mint continues to require custodian sig even mid-incident; recovery path: revoke → `setBridge` with 48h → ADMIN re-grants roles to new Bridge → unpause; if yield-attestor keys compromised, `proposeYieldAttestors` with 48h timelock; invariants hold at every intermediate state. |
| **Invariants** | `totalPlusdEscrowed == plusd.balanceOf(this)` at rest after every sequence; `totalUsdcEscrowed <= usdc.balanceOf(this)`; `∀ id < nextToFund: status != Pending`; `∀ id < headId: status ∈ {Claimed, AdminReleased}`; `windowMinted` tracks correctly across window resets. |
| **Bank run** | All LPs call `DepositManager.deposit` followed by `requestWithdrawal` simultaneously; queue depth stress; rate limits (per-window / per-LP) block rapid minting during panic re-deposit; `maxTotalSupply` caps aggregate exposure; strict-FIFO ordering under pressure. |

**Permit path coverage.** Dedicated test: ERC20Permit `permit(owner, spender, amount, ...)` followed by `transferFrom(owner, nonWhitelisted, amount)` must revert in `PLUSD._update` at the non-transferability or whitelist check. Plus LP-to-LP permit+transferFrom reverts even if both LPs are whitelisted.

**Test harness hygiene.** Any shared `BaseTest` helper must be exercised by at least one test or removed before merge.

**Actor-critic review process.** Test scenarios designed in iterations. After each iteration, an adversarial reviewer (critic agent) examines the test suite for missing branches, weak assertions, and scenarios that pass trivially. Multiple rounds until critic finds no new gaps.

### Phase 2: Adversarial agentic loop (post-implementation)

Automated red team / blue team cycle on a local Anvil fork.

**Attacker agent:** unlimited test capital (flash loans from Aave V3 fork, or `vm.deal` + `deal`). Goals: break invariants, drain funds, grief operations. Attack vectors: reentrancy, flash loan manipulation, rate limit gaming, whitelist state manipulation, front-running `claim` / `fundRequest` / `setDefault`, donation attacks on sPLUSD, AccessManager role escalation via admin-delay manipulation, shutdown-boundary exploits (e.g., mint-then-shutdown), attestation replay via alt-chain or different domain.

**Defender agent:** security specialist reviewing attacker findings. Root-cause analysis, patch proposal, regression test.

**Loop structure.**

```
┌─────────────────────────────────────────────────┐
│  Round N                                         │
│                                                  │
│  Attacker: runs attack suite against contracts   │
│         ↓                                        │
│  Results: list of (vector, outcome, evidence)    │
│         ↓                                        │
│  Defender: analyzes results, patches contracts   │
│         ↓                                        │
│  Regression: full test suite + new attack tests  │
│         ↓                                        │
│  If all pass → Round N+1 (attacker gets smarter) │
│  If fail → Defender fixes, re-run regression     │
└─────────────────────────────────────────────────┘
```

Terminates when attacker finds no new vectors across N consecutive rounds (suggest N = 3).

**Separate hardening loop.**

```
┌───────────────────────────────────────────────┐
│  Full test suite runner                        │
│                                                │
│  Run all tests (unit + scenario + adversarial) │
│         ↓                                      │
│  Failures? → Fix agent patches, re-runs        │
│         ↓                                      │
│  All pass? → White-hat findings incorporated   │
│         ↓                                      │
│  Final coverage report + gas benchmarks        │
└───────────────────────────────────────────────┘
```

---

## 15. Out of Scope

- Bridge service architecture (separate spec). Bridge's internal key material (HSM, Fireblocks-backed signers, MPC shards) is an implementation detail of Bridge, not an architectural actor.
- Trustee tooling and signer operations (separate spec).
- LP and protocol dashboards (separate spec).
- **MPC wallet configuration and policy engine rules (R2)** — including LP withdrawal destination matching and cumulative withdrawal cap. Enforced by the custodian (Fireblocks / BitGo) on the USDC leg of every Capital Wallet release and *not* duplicated on-chain.
- USYC auto-allocation of idle LP capital by the custodian's policy engine.
- Off-chain price feed and notification system.
- Gnosis Safe deployment and signer management.
- IOU token mechanics (deferred past MVP).
- On-chain backing oracle (B3; deferred past MVP).
- sPLUSD transferable-gating beyond the PLUSD redeem whitelist.
- Public bug bounty programme (Phase 2).

---

## Appendix A — Resolved open questions (originator confirmed)

| ID | Decision |
|---|---|
| C1 | `mintForDeposit` and `yieldMint` gated by `!shutdownActive`. Explicit revert. `DepositManager.deposit` reverts transitively. |
| C2 | sPLUSD shutdown exit via standard `redeem` + `PLUSD.redeemInShutdown`. No special conversion function. Race-drain solved by protocol-wide frozen rate. |
| C3 | `adminRelease(Funded)` is 24h-timelocked and GUARDIAN-cancelable; `adminRelease(Pending)` immediate. |
| H1 | Symmetric haircut: Funded requests also pay recoveryRate; haircut difference returned to RecoveryPool. |
| H3 | **Downward recovery-rate adjustments disallowed.** Rate only ratchets up via `adjustRecoveryRateUp`. Lowering would be anti-LP. |
| M1 | EmergencyRevoker's `bridge` and `trustee` targets are ADMIN-updatable with 48h timelock. |
| M2 | WQ stale `Funded` requests: `sweepStale` eligible at 180 days, recipient == original requester. |
| U6 (mint, v2.3) | Direct `PLUSD.mint(address,uint256)` removed. Fresh PLUSD enters supply only via `mintForDeposit` (DEPOSITOR, called by DepositManager atomically with USDC transfer to Capital Wallet) or `yieldMint` (YIELD_MINTER + two EIP-712 sigs from Bridge and custodian, destination-constrained to vault/treasury). MINT_ATTESTOR retired. |
| F-8 | **Pre-fund pool-solvency invariant at shutdown entry dropped.** Crisis-realistic: rate is set against actual pool balance; Trustee tops up; rate can ratchet up. |
| setDefault timelock | **24 hours** (aligned with shutdown entry delay). |

## Appendix B — Carry-overs (not re-decided)

- **FIFO funding.** Strict FIFO on `fundRequest` ordering; parallel `claim` on Funded requests.
- **sPLUSD transferability.** Transferable; PLUSD redeem gate neutralizes non-KYC secondary-market value.
- **GUARDIAN concentration.** Accepted as defensive concentration; GUARDIAN cannot escalate roles or move funds (Morpho sentinel pattern).
