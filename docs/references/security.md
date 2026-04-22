# Pipeline Mint Trust Model

**Status:** the defences proposed in this document are implemented in `smart-contracts.md` v2.3 (DepositManager, two-party yield attestation, reserve invariant, three economic caps). This document captures the threat model, peer-protocol analysis, and design rationale. It is the reference for auditors and for engineers asking "why is it built this way?".

This document:

- Analyses the attack surface of PLUSD mint paths.
- Surveys how peer protocols (Ethena, Ondo, MakerDAO, Chainlink, Lido) mitigate the same risks.
- Specifies the layered MVP defence stack.

The defence is layered: each layer independently reduces blast radius, and no single compromise — Bridge, custodian, or governance Safe — allows an unbacked mint.

PLUSD mints 1:1 against USDC on deposit — no NAV scaling, no price oracle on the deposit leg. The reserve invariant for MVP is enforced by on-chain cumulative counters in the mint contract itself. A full Chainlink Proof of Reserve integration is deferred to phase 2, to be delivered before TVL crosses a threshold the team will set.

---

## Pre-v2.3 baseline (for context)

Before v2.3, PLUSD was minted by the Bridge backend through EIP-712 signed attestations. The Bridge held four on-chain roles:

1. **MINT_ATTESTOR** — signed deposit attestations
2. **YIELD_MINTER** — minted yield into the sPLUSD vault
3. **FUNDER** — funded the Withdrawal Queue
4. **WHITELIST_ADMIN** — managed the KYC whitelist

Governance is provided by three Safes:

1. **Admin 3/5** — 48h timelock on system changes
2. **Risk Council 3/5** — 24h timelock on risk parameters
3. **Guardian 2/5** — instant pause and cancel

The threat-model analysis below was performed against this baseline and drove the v2.3 redesign.

---

## Threat model

Attack vectors by single-role / single-key compromise:

| Compromise | What the attacker does, step by step | Net effect |
|---|---|---|
| **Bridge signing key + WHITELIST_ADMIN** (both held by Bridge in the old design) | 1) Add an attacker-controlled address to the whitelist. 2) Sign a fake attestation: "address X deposited 10M USDC, tx hash 0xdead…". 3) Submit to `PLUSD.claimMint()`. Contract verifies the signature (valid — it is the real Bridge key), checks the tx hash is unused (true — it is invented), checks the address is whitelisted (true — step 1), mints 10M PLUSD to the attacker. 4) Attacker requests redemption and waits for Trustee to fund, or dumps on the secondary market. | Unbacked PLUSD minted. Capital Wallet USDC drained when the redemption is funded. Direct theft. **This is the Resolv exploit shape.** |
| **Bridge signing key ONLY** (WHITELIST_ADMIN split off) | Attacker can forge attestations but only to already-whitelisted LPs. Minted PLUSD goes to those LPs' addresses — not to the attacker. Victims receive unsolicited PLUSD. | No direct theft, but supply inflates, sPLUSD share price collapses on next valuation, LPs rush to redeem, Capital Wallet drained by legitimate redemptions of bogus PLUSD. Still catastrophic even if one step removed. |
| **YIELD_MINTER** | 1) Pre-attack: attacker quietly buys sPLUSD shares on the secondary market. 2) Attack: calls `PLUSD.yieldMint(sPLUSDVault, huge_amount)`. PLUSD lands in the vault, sPLUSD share price jumps. 3) Redeems inflated sPLUSD for PLUSD, then requests PLUSD redemption for USDC through the Withdrawal Queue. | Dilutes all other sPLUSD holders. Capital Wallet drained by the queue payout. Indirect theft via share-price manipulation. |
| **FUNDER** (Withdrawal Queue) | FUNDER on its own does NOT enable theft. To extract value, an attacker still needs a queue entry they can claim, which requires burning PLUSD they legitimately hold. FUNDER only lets them accelerate payout of their own legitimate claim. | Not an independent drain path. Dangerous only when paired with a mint compromise (the mint creates attacker-owned PLUSD; FUNDER lets them jump the queue to extract faster). |
| **WHITELIST_ADMIN alone** | Attacker can add addresses to the whitelist. On its own, adding a whitelisted address does not mint anything. | Not an independent drain path. Dangerous only when paired with MINT_ATTESTOR compromise (it is the "send the loot to me" lever). |
| **Trustee** (Capital Wallet co-signer) | Cannot mint PLUSD on-chain. Can co-sign Capital Wallet outflows — the off-chain equivalent of the same problem. | Mitigated by the custodian's own policy controls (whitelisted outbound addresses, amount thresholds, second co-signer). Out of scope for on-chain defence design, but in scope for custodian configuration. |

### Additional v2.3 threat rows

| Compromise | Mechanism | Net effect / mitigation |
|---|---|---|
| **UPGRADER / ADMIN Safe** (UUPS upgrade) | Schedule `upgradeTo(maliciousImpl)` that removes reserve invariant or mints freely. | 48h AccessManager delay + Guardian cancel + EIP-712 domain pin check in `_authorizeUpgrade` + EmergencyRevoker is non-upgradeable. 14-day meta-timelock on delay changes prevents a "collapse the delay then exploit" sequence. |
| **Bridge yield-sig + custodian co-signer joint compromise** | Produce a valid `YieldAttestation` with both sigs. PLUSD mints; `cumulativeYieldMinted` self-advances; Layer 1b internal invariant passes because counters and supply move in lockstep. | Defence is **Layer 3 watchdog** (reconcile on-chain mints vs custodian-reported inflows + Bridge's own reserve reconciliation — see §5.6 invariant) and phase-2 Chainlink PoR. Layer 1b alone does NOT catch this. |
| **Trustee + yield-attestor joint compromise** | Trustee fabricates `LoanClosed(..., EarlyRepayment)` event; yield-attestor pair signs attestation claiming the repayment; mint lands. | Same defence as above (watchdog + PoR). Independent custodian ledger check on Layer 2 co-sig catches it if the custodian verifies actual USDC inflow; if the custodian's own records are forged by the joint compromise, the attack is bounded by Layer 0 caps. |
| **First-deposit ERC-4626 inflation on sPLUSD** | Attacker is first depositor, donates USDC directly to vault, next LP's shares are rounded to zero. | OZ v5.x `ERC4626Upgradeable` with `_decimalsOffset` mitigation (dead-shares seed). Source spec §4.2 called this out; `smart-contracts.md` §6 confirms implementation. Audit test: first-deposit donation attempt at live config. |
| **Reentrancy on mint/burn paths** | Re-enter `yieldMint` or `mintForDeposit` inside a callback during `_mint`, before counters are updated. | Not possible: counter increments happen BEFORE `_mint` (spec §5), and all entry points carry `nonReentrant` (`claimMint` removed; new entries `mintForDeposit` and `yieldMint` both nonReentrant). PLUSD is non-transferable and has no external callback in its transfer path. |
| **Governance capture via overlapping signer sets** | Same people sign Admin + Risk Council + Guardian — turning the three-Safe model into a single-Safe model. | Signer-disjointness is an **operational requirement** enforced off-chain: distinct multisig member sets across Admin (3/5), Risk Council (3/5), and Guardian (2/5). Violation collapses 48h timelock to nominal. Source spec §1.5 confirms disjoint signer requirement. Recommend at least one external signer on Guardian. |
| **Watchdog compromise or offline** | Watchdog fails to detect mint-vs-inflow divergence; Layer 3 becomes inoperable. | Watchdog should run on infra disjoint from Bridge. Its signal is a Guardian-trip recommendation, not an autonomous on-chain action. Fallback: Trustee and any Guardian member can raise alerts independently. Accepted gap in MVP. |
| **LP sanctioned post-mint** | LP holds PLUSD and is subsequently added to OFAC / flagged by Chainalysis. | Bridge calls `WhitelistRegistry.revokeAccess(lp)`. Subsequent withdrawal attempts: if LP is at queue head, Bridge calls `skipSanctionedHead` (requires `!isAllowed`). ADMIN can use `adminRelease(Pending)` to remove the entry. PLUSD already held is frozen from further transfers by the non-transferability rule (every transfer requires a system-address leg). Product surface: WQ lifecycle diagram shows admin cancel/delay path. |
| **Guardian griefing (DoS, not theft)** | Guardian (2/5) repeatedly cancels scheduled Admin operations, blocking every parameter change or role grant. | Not a theft vector but a liveness issue. Admin can rotate Guardian signers (via its own 48h-timelocked grant), but that grant is itself Guardian-cancelable — the failure mode is "stuck at current config" until off-chain resolution. Accepted risk; mitigated by distinct signer sets and contractual obligations on Guardian members. |

**Two observations from the primary threat table drove the highest-leverage defensive moves:** (a) FUNDER is not an independent drain path, (b) MINT_ATTESTOR without WHITELIST_ADMIN causes chaos but not direct self-theft. Splitting MINT_ATTESTOR from WHITELIST_ADMIN was one option; *eliminating MINT_ATTESTOR entirely* was the better one — hence Layer 1 (DepositManager) below.

**Chainalysis 90-day freshness as a second-factor gate.** The WhitelistRegistry enforces `isAllowedForMint` freshness (90-day window) on every mint path via PLUSD's `_update`. Expired screening blocks mints even for whitelisted LPs. This means WHITELIST_ADMIN alone cannot enable a mint: the attacker would need the whitelist flag AND a fresh screening timestamp from Bridge. Source spec §8 requires this behaviour.

---

## What peer protocols do

| Protocol | Relevant mechanism | Takeaway for Pipeline |
|---|---|---|
| **Ethena (USDe)** | EIP-712 signed mint orders; 100k USDe per-block hard cap; separate GATEKEEPER role that can disable mint/redeem (pause-only, not unpause); 7/10 cold multisig owns contracts. | Closest analog to Pipeline's old attestation pattern. Caps blast radius to ~$300k per block even with a fully compromised minter key. Pause-only role independent of owner is exactly Pipeline's Guardian. |
| **Resolv (USR)** — exploited March 2026 | Single AWS KMS signing key. Signature validity was the ONLY check. No collateral ratio check, no supply cap, no rate limit. | Cautionary tale. Pipeline's pre-v2.3 design had the same shape. $25M extracted in 17 minutes. **Must not ship without on-chain economic bounds.** |
| **Ondo (OUSG)** — OUSGInstantManager | User calls `mint(usdcAmount)`. Contract pulls USDC atomically via `transferFrom`, reads NAV from oracle, mints OUSG, forwards USDC to Coinbase custody. All atomic, no off-chain attestor gates the deposit leg. | Proven open-source pattern that delivers instant UX with no off-chain signer trust on the deposit leg. Directly adopted by Pipeline in v2.3 (DepositManager). |
| **Chainlink Proof of Reserve** (TUSD, Cache Gold, PoundToken) | Oracle feed carries custodian-attested cumulative reserves. Token's `mint()` reverts if `totalSupply + amount > reserveFeed.latestAnswer()`. Stale feed reverts. | Structural bound that cannot be bypassed even with full mint-key compromise. Pipeline needs a custom variant (tracking LP inflows + interest receipts, not balance-in-wallet) because USDC legitimately leaves Capital Wallet to fund credit lines. Target: phase 2. |
| **MakerDAO (PSM, DC-IAM)** | Debt Ceiling Instant Access Module: per-module max line (hard ceiling), target available debt (governance-set gap), ceiling-increase cooldown. | Governance sets the envelope; anyone can move within it. Pattern Pipeline copies for its supply cap and rolling-window cap parameters. |
| **Lido (stETH)** | 1:1 trustless minting: sending ETH to the deposit contract atomically mints stETH. No off-chain signer, no attestor. L2 bridges use native lock-and-mint only. | Principle: do not add an off-chain signer when you can verify on-chain. Pipeline cannot fully replicate (custodied USDC is not equivalent to an ETH deposit contract), but the principle drives the DepositManager design. |

---

## MVP defence stack

Five layers, each independent. All layers ship for MVP. Full Chainlink Proof of Reserve is phase 2. The guiding principle: **no single compromise — Bridge, custodian, or a single governance Safe — should permit an unbacked mint.** (A *joint* compromise of Bridge's yield key AND the custodian signer still mints; that scenario is bounded by Layer 0 caps and detected by Layer 3 watchdog reconciliation — see threat rows above.)

### Layer 0 — Economic bounds on mint

Three numeric caps enforced by the PLUSD contract itself, managed by the Admin Safe 3/5 through the 48h AccessManager timelock:

1. **Rolling 24-hour window cap** (`maxPerWindow`) — aggregate across all LPs.
2. **Per-LP per-window cap** (`maxPerLPPerWindow`) — prevents single-LP concentration.
3. **Hard total supply ceiling** (`maxTotalSupply`) — MakerDAO PSM debt-ceiling analog.

Tightening any cap is instant; loosening requires the 48h timelock. Per-transaction caps (`maxPerTx`) were considered and dropped in v2.3 — per-LP-per-window already bounds any one actor, and per-tx caps create UX friction for legitimate large deposits without a security benefit.

### Layer 1 — DepositManager (atomic 1:1 on-chain deposit, no attestor)

A new DepositManager contract using Ondo's OUSGInstantManager pattern, simplified to omit NAV scaling (PLUSD is 1:1 with USDC). Replaces the EIP-712 self-claim attestation flow entirely on the deposit leg. Users call `deposit(usdcAmount)` directly; the contract:

- Atomically pulls USDC from the LP via `transferFrom(lp, capitalWallet, amount)` — one transfer, LP → Capital Wallet directly.
- Calls `PLUSD.mintForDeposit(lp, amount)` — restricted to DEPOSITOR role held by DepositManager.
- Enforces whitelist-for-mint inside PLUSD's `_update`.

The on-chain USDC move IS the attestation — there is no off-chain signer to forge, and no way to mint without the USDC actually moving. The MINT_ATTESTOR role is retired. WHITELIST_ADMIN is retained as a KYC gate but is no longer a loot-enabling lever because minting is cryptographically bound to the caller's own USDC transfer. **This single layer eliminates the Resolv attack class entirely for the deposit flow.** Instant 1:1 UX is preserved — and improved, because the mint is one transaction instead of two.

### Layer 1b — Contract-tracked reserve invariant

PLUSD maintains three cumulative counters on-chain, updated in the same transactions that move value:

- `cumulativeLPDeposits` — incremented on every `mintForDeposit`
- `cumulativeYieldMinted` — incremented on every `yieldMint` call
- `cumulativeLPBurns` — incremented when PLUSD is burned for redemption via WQ

Every mint path — `mintForDeposit` and `yieldMint` — checks the invariant before executing:

```
totalSupply(PLUSD) + amount  ≤  cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns
```

The invariant reverts any mint that would break the accounting identity. This is **not a true Proof of Reserve** — it verifies consistency inside the contract, not that USDC actually arrived at the custodian — but it structurally prevents the Resolv-shape attack on the yield-mint path (which has no user-provided collateral to gate it) by converting it into a self-check the contract performs against its own ledger. Full custodian-backed Chainlink PoR is phase 2, delivered before TVL crosses the team-defined threshold.

### Layer 2 — Two-party attestation for yield mints

Yield mints are the remaining signer-dependent path because no user-side collateral can gate them — the yield is an abstract off-chain P&L event (loan repayments and USYC accretion). The defence is a two-party EIP-712 signed attestation:

- **Bridge** signs first with its `bridgeYieldAttestor` key (ECDSA).
- The **custodian-provisioned EIP-1271 signer contract** independently verifies the underlying USDC inflow against the custodian's own ledger and signs second. The backend signing policy is driven by the custodian's platform (Fireblocks API Co-Signer callback handler, BitGo Policy Engine webhook, or equivalent), which routes every signing request through the custodian's operational controls before returning a signature. The on-chain contract does not call the custodian's REST API directly; it validates the resulting signature via `IERC1271.isValidSignature` → `0x1626ba7e`.
- `PLUSD.yieldMint(att, bridgeSig, custodianSig)` verifies both signatures on-chain.

Compromising Bridge alone mints zero PLUSD. Compromising the custodian alone mints zero PLUSD. Both platforms (Fireblocks Co-Signer Callback Handler and BitGo webhook-based policy) support this automation natively.

### Layer 3 — Guardian pause + off-chain watchdog

The Guardian Safe (2/5) can instantly pause any managed contract and cancel any scheduled operation. For the mint defence, Guardian's scope covers pausing DepositManager (stops all new deposits) and PLUSD (freezes everything). An off-chain watchdog service continuously compares on-chain mint events against custodian-reported inflows and can trip Guardian on divergence, giving sub-minute reaction time against any defence-layer failure.

### Layer 4 — Timelock action table

All role rotations, parameter loosenings, and mint-path reconfigurations are timelocked. A compromised Admin Safe can print new PLUSD only in 48 hours, and the Guardian can cancel it within that window. Tightening actions (lower a cap, revoke a role, pause a contract) are instant. This matches OpenZeppelin TimelockController best practice.

| Action | Caller | Delay | Canceler |
|---|---|---|---|
| Pause any managed contract | Guardian 2/5 | instant | — |
| Cancel any scheduled operation | Guardian 2/5 | instant | — |
| Revoke any role (EmergencyRevoker) | Guardian 2/5 | instant | — |
| Lower any cap (tighten) | Admin 3/5 | instant | — |
| Rotate YIELD_MINTER holder | Admin 3/5 | 48h | Guardian |
| Rotate FUNDER holder | Admin 3/5 | 48h | Guardian |
| Rotate WHITELIST_ADMIN holder | Admin 3/5 | 48h | Guardian |
| Rotate TRUSTEE (LoanRegistry) | Admin 3/5 | 48h | Guardian |
| Rotate yield-attestor keys (`proposeYieldAttestors`) | Admin 3/5 | 48h | Guardian |
| Grant any new role to any address | Admin 3/5 | 48h | Guardian |
| Raise hard supply cap | Admin 3/5 | 48h | Guardian |
| Raise rolling-window mint cap | Admin 3/5 | 48h | Guardian |
| Raise per-LP cap | Admin 3/5 | 48h | Guardian |
| Upgrade ReserveFeed source address (phase 2) | Admin 3/5 | 48h | Guardian |
| Change ReserveFeed staleness threshold (phase 2) | Admin 3/5 | 48h | Guardian |
| Change yield-split parameter | Admin 3/5 | 48h | Guardian |
| Replace DepositManager (deploy new version) | Admin 3/5 | 48h | Guardian |
| `adminRelease(Pending)` — unstick pending queue entry | Admin 3/5 | instant | — |
| `adminReleaseFunded` — release a Funded entry blocked by sanctions | Admin 3/5 | 24h | Guardian |
| `adjustRecoveryRateUp` (shutdown waterfall) | Risk Council 3/5 | 24h | Guardian |
| Unpause any managed contract | Admin 3/5 | 48h | Guardian |

---

## Internal rug containment

The second half of the original question — *"if we (the team) decide to scam, how is our own ability to mint PLUSD bounded?"* — is answered structurally, not by policy promises:

- **Flat-topology, no proxies:** mint logic cannot be upgraded out from under users. Any change requires deploying a new contract and migrating through a 48h-timelocked Admin Safe action.
- **Custodian as independent signer (Layer 2):** yield mints require a regulated third-party's EIP-712 signature in addition to Bridge's. The team cannot mint yield without the custodian's co-operation; the custodian has legal liability and independent compliance controls.
- **Reserve-bounded mint (Layer 1b, with phase-2 Chainlink PoR):** the invariant is computed from on-chain data the team cannot forge. If the team tries to over-mint beyond attested reserves, the mint reverts at the contract level.
- **Economic caps (Layer 0):** even within attested reserves, rolling-window and per-LP caps limit what can be minted in any 24h period.
- **Timelocked role rotation (Layer 4):** the team cannot silently swap signing keys to a controlled address — every rotation is visible on-chain for 48 hours and can be cancelled by the Guardian Safe (which can be constituted with external members).
- **Open-source backend + reproducible builds:** community can verify the Bridge binary matches the published source. Combined with on-chain invariants above, backend behaviour is bounded by what the contracts accept.
