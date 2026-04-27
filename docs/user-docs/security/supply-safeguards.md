---
title: Supply safeguards
order: 15
section: Security & Transparency
---

# Supply safeguards

PLUSD has exactly two mint paths — deposit (USDC → PLUSD 1:1) and yield (sPLUSD vault or Treasury Wallet). Each path lives behind a different contract with a different threat model and a different set of checks. They do not duplicate each other.

This page covers the structural safeguards that prevent inflation of PLUSD supply. Each section names the safeguard, describes its mechanism, and states the attack scenario it defeats.

---

## DepositManager vs YieldMinter — who checks what

DepositManager gates **lender-initiated** mints. The lender is the trust boundary; the contract assumes the caller is potentially malicious and rate-limits accordingly. YieldMinter gates **operator-initiated** mints. The operator (Relayer) is the trust boundary, but the constraint is structural — every mint requires a second, independent EIP-1271 signature from the custodian, and the destination is hard-constrained to the sPLUSD vault or the Treasury Wallet. Neither contract enforces the other's checks; the separation is what makes the threat models legible.

| Check | DepositManager | YieldMinter |
|---|---|---|
| Caller must be whitelisted (`isAllowedForMint`) | Yes — every deposit | No — caller is anyone; the signatures are the gate |
| 90-day Chainalysis freshness window | Yes | No |
| Per-LP rolling-window cap (`maxPerLPPerWindow`) | Yes — bounds single-actor mint volume | No |
| Global rolling-window cap (`maxPerWindow`, $10M / 24h) | Yes — bounds all-LP mint volume | No |
| Per-transaction $5M cap | Yes | No |
| Hard total-supply cap (`maxTotalSupply`) | Yes — checked on PLUSD via `mintForDeposit` | Yes — checked on PLUSD via `mintForYield` |
| Reserve invariant on PLUSD ledger | Yes | Yes |
| USDC `transferFrom` from caller to Capital Wallet | Yes — atomic with the mint | No — yield is post-fact accounting on USDC already in the wallet |
| Two-party EIP-712 attestation (Relayer + custodian) | No — the on-chain USDC pull IS the attestation | Yes — Relayer ECDSA + custodian EIP-1271, both verified on-chain |
| Replay guard (`usedRepaymentRefs`) | Not applicable | Yes — each attestation ref consumed exactly once |
| Destination restriction | Recipient is the depositor (whitelist-gated) | Hard-coded to sPLUSD vault or Treasury Wallet |
| Holds role on PLUSD | `DEPOSITOR` (DepositManager proxy address) | `YIELD_MINTER` (YieldMinter proxy address) |

**The shared gate is PLUSD itself.** Both `mintForDeposit` and `mintForYield` increment cumulative counters atomically on PLUSD and assert `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` in the same transaction. The `maxTotalSupply` ceiling — the hard ceiling on circulating PLUSD relative to backing — is enforced on every mint regardless of which path called it. Per-account and per-window caps are deliberately absent from YieldMinter because the recipients are protocol system addresses (not LPs) and the volume is bounded by real cash inflow — repayments wired into the Trustee bank then on-ramped to USDC, plus realised USYC redemptions — not by lender behaviour.

---

## Deposits are atomic on-chain

`DepositManager.deposit(amount)` pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction. If either leg fails, the whole transaction reverts. There is no intermediate queue, no signing step, no delay.

**No off-chain signer gates the deposit path.** Relayer is not in the deposit critical path. A complete Relayer compromise does not stop deposits or allow unbacked deposit-leg mints. The on-chain USDC movement IS the attestation. The minimum deposit is $1,000 and each transaction is capped at $5M with a $10M/24h aggregate limit.

This closes the attack class where a compromised signing key mints against a fake or spoofed USDC transfer. The Resolv exploit of March 2026 stands as the warning case: an attestor signed a mint for a deposit that never settled. Pipeline removes the attestor from the deposit path entirely.

---

## Yield mints need two independent signatures

`YieldMinter.yieldMint(attestation, relayerSig, custodianSig)` verifies both signatures on-chain before calling `PLUSD.mintForYield`. The Relayer signs with its `relayerYieldAttestor` key. The custodian's EIP-1271 signer contract independently verifies the underlying USDC inflow (a senior-coupon on-ramp from the Trustee bank, or a realised USYC sale's USDC proceeds) and signs second. Both signatures must recover to the configured addresses or the call reverts. The YieldMinter contract is the only address that holds the `YIELD_MINTER` role on PLUSD, so a direct call to `PLUSD.mintForYield` from any other address reverts unconditionally.

Compromising Relayer alone mints zero. Compromising the custodian alone mints zero. Joint compromise of both plus successful replay requires collusion PLUS bypassing the on-chain `usedRepaymentRefs` guard that rejects any attestation ID already consumed.

Destinations are constrained at the YieldMinter contract level — only the sPLUSD vault address or the Treasury Wallet. The yield mint cannot deliver to an attacker address. Recipient validation is enforced in the same function that checks the signatures.

---

## Reserve invariant on every mint

PLUSD tracks three cumulative counters — `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns`. Every mint asserts both `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` AND `totalSupply + amount ≤ maxTotalSupply`.

This is internal consistency, not Proof of Reserve. It catches counter desync and blocks over-mint against the contract's own ledger. If any mint ever exceeded what the counters say was deposited or earned, the transaction reverts before supply changes.

Full Chainlink-style PoR that verifies the custodian's actual USDC balance is phase 2. We state this limit honestly. The MVP invariant is necessary but not sufficient for end-to-end backing; it catches contract-level bugs, not custodian-side divergence.

---

## Four economic caps on the mint path

| Cap | Value | Purpose |
|---|---|---|
| `maxPerWindow` | $10M / 24h | Aggregate PLUSD minted across all lenders |
| `maxPerLPPerWindow` | bounded per lender | Prevents single-wallet concentration |
| `maxTotalSupply` | hard ceiling | Absolute supply cap on PLUSD totalSupply |
| `freshnessWindow` | 90 days | Chainalysis screen must be fresh for deposits |

Each cap is enforced on-chain inside the relevant mint path. A deposit that would breach any cap reverts without touching USDC. Per-transaction size is additionally capped at $5M.

`maxTotalSupply` is the only one of the four that applies to both DepositManager and YieldMinter (it is checked on PLUSD inside `mintForDeposit` and `mintForYield` alike). The other three are deposit-side guards on lender behaviour.

Tightening any cap is instant (ADMIN). Loosening requires a 48-hour ADMIN proposal through AccessManager, cancelable by GUARDIAN during the window. The RISK_COUNCIL path for risk-parameter changes carries a 24-hour delay. A 14-day meta-timelock on the delay setting itself blocks "collapse the delay then exploit" sequences.

---

## A compromised Trustee cannot inflate share price

The Trustee holds the `TRUSTEE` role on LoanRegistry and can write any loan NFT state — mint ghost loans, write false repayment splits, close loans at maturity. None of these move USDC or mint PLUSD. LoanRegistry is **informational only**. sPLUSD share price moves exclusively on actual `yieldMint` calls landing in the vault, not on any registry write.

The Trustee is ALSO a Capital Wallet cosigner, but a single-key Trustee compromise cannot move USDC alone — Relayer cosign is required. GUARDIAN can revoke the `TRUSTEE` role instantly via `AccessManager.revokeRole`, stopping further registry writes while the two-of-two cosign requirement continues to protect custody.

This separation is deliberate. Loan bookkeeping and share-price computation are decoupled so that no single off-chain actor can lift the NAV by editing ledger state. Price moves only when real USDC lands and a two-party yield mint executes against it.

---

## Related pages

- [Custody](/security/custody/) — Capital Wallet cosigning model and custodian setup
- [Emergency response](/security/emergency-response/) — GUARDIAN powers, pause, role revocation
- [Risks](/risks/) — full risk register including the phase 2 PoR gap
