---
title: Supply safeguards
order: 17
section: Security & Transparency
---

# Supply safeguards

PLUSD has exactly two mint paths: deposit (USDC to PLUSD 1:1) and yield (sPLUSD vault or Treasury Wallet). Each path lives behind a different contract with a different threat model and a different set of checks. They do not duplicate each other.

This page covers the structural safeguards that prevent inflation of PLUSD supply. Each section names the safeguard, describes its mechanism, and states the attack scenario it defeats.

---

## DepositManager vs YieldMinter

DepositManager gates **lender-initiated** mints. The lender is the trust boundary. The contract assumes the caller is potentially malicious and rate-limits accordingly. YieldMinter gates **operator-initiated** mints. The function is permissionless to call, but every mint requires both a Relayer ECDSA signature and a Trustee EIP-1271 signature verified on-chain, and the destination is hard-constrained to the sPLUSD vault or the Treasury Wallet. Neither contract enforces the other's checks. The separation is what makes the threat models legible.

| Check | DepositManager | YieldMinter |
|---|---|---|
| Caller must be whitelisted (`isAllowedForMint`) | Yes, every deposit | No. Caller is anyone. The signatures are the gate |
| 90-day Chainalysis freshness window | Yes | No |
| Per-LP rolling-window cap (`maxPerLPPerWindow`) | Yes, bounds single-actor mint volume | No |
| Global rolling-window cap (`maxPerWindow`, $10M / 24h) | Yes, bounds all-LP mint volume | No |
| Per-transaction $5M cap | Yes | No |
| Hard total-supply cap (`maxTotalSupply`) | Yes, checked on PLUSD via `mintForDeposit` | Yes, checked on PLUSD via `mintForYield` |
| Reserve invariant on PLUSD ledger | Yes | Yes |
| USDC `transferFrom` from caller to Capital Wallet | Yes, atomic with the mint | No. Yield is post-fact accounting on USDC already in the wallet |
| Two-party EIP-712 attestation (Relayer + Trustee) | No. The on-chain USDC pull IS the attestation | Yes. Relayer ECDSA + Trustee EIP-1271, both verified on-chain |
| Replay guard (`usedRepaymentRefs`) | Not applicable | Yes. Each attestation ref consumed exactly once |
| Destination restriction | Recipient is the depositor (whitelist-gated) | Hard-coded to sPLUSD vault or Treasury Wallet |
| Holds role on PLUSD | `MINTER_ROLE` (DepositManager proxy address) | `MINTER_ROLE` (YieldMinter proxy address) |

**The shared gate is PLUSD itself.** Both `mintForDeposit` and `mintForYield` increment cumulative counters atomically on PLUSD and assert `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` in the same transaction. The `maxTotalSupply` ceiling is enforced on every mint regardless of which path called it. Per-account and per-window caps are absent from YieldMinter because the recipients are protocol system addresses (not LPs) and the volume is bounded by real cash inflow (repayments wired into the Trustee bank then on-ramped to USDC, plus realised USYC redemptions), not by lender behaviour.

---

## Atomic deposits

`DepositManager.deposit(amount)` pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction. If either leg fails, the whole transaction reverts. There is no intermediate queue, no signing step, no delay.

**No off-chain signer gates the deposit path.** Relayer is not in the deposit critical path. A complete Relayer compromise does not stop deposits or allow unbacked deposit-leg mints. The on-chain USDC movement IS the attestation. The minimum deposit is $1,000 and each transaction is capped at $5M with a $10M/24h aggregate limit.

This closes the attack class where a compromised signing key mints against a fake or spoofed USDC transfer. The Resolv exploit of March 2026 stands as the warning case. An attestor signed a mint for a deposit that never settled. Pipeline removes the attestor from the deposit path entirely.

---

## User-pulled withdrawals

`WithdrawalQueue.claim(queueId)` is called by the lender (or, in the permissionless variant, by anyone). The queue contract pulls USDC via `transferFrom` from the **Withdrawal Queue Wallet**, a separate institutional MPC wallet whose USDC the Trustee and Team top up periodically from the Capital Wallet. The queue contract never has standing authority against the Capital Wallet itself.

The queue tracks three aggregates and enforces a per-claim invariant:

| Aggregate | Definition |
|---|---|
| `totalRequested` | Cumulative PLUSD escrowed across all withdrawal requests |
| `totalClaimed` | Cumulative PLUSD burned via successful claims |
| `totalClaimable` | `totalRequested - totalClaimed` (currently outstanding obligations) |

On every claim: `require(claimAmount ≤ totalClaimable)`. Even if the Withdrawal Queue Wallet has granted the queue contract `MAX_UINT` allowance, the queue physically refuses to pull more than its outstanding obligations. **Allowance from the Wallet is the permission ceiling. The aggregate ledger is the spending discipline.**

**Blast-radius bound.** A WithdrawalQueue contract bug or exploit can only drain the Withdrawal Queue Wallet, never the Capital Wallet. The settlement-isolation property is the safety guarantee here, not the allowance number.

---

## Two-party yield mints

`YieldMinter.yieldMint(attestation, relayerSig, trusteeSig)` verifies both signatures on-chain before calling `PLUSD.mintForYield`. The Relayer signs with its `relayerYieldAttestor` key. The Trustee's EIP-1271 signer contract (`trusteeYieldAttestor`) independently verifies the underlying USDC inflow (a senior-coupon on-ramp from the Trustee bank, or a realised USYC sale's USDC proceeds) and signs second. Both signatures must recover to the configured addresses or the call reverts. The YieldMinter contract is the only address that holds `MINTER_ROLE` on PLUSD for yield-leg mints, so a direct call to `PLUSD.mintForYield` from any other address reverts unconditionally.

Compromising the Relayer alone mints zero. Compromising the Trustee's yield-attestor alone mints zero. Joint compromise of both plus successful replay requires collusion PLUS bypassing the on-chain `usedRepaymentRefs` guard that rejects any attestation ID already consumed.

Destinations are constrained at the YieldMinter contract level to the sPLUSD vault address or the Treasury Wallet only. The yield mint cannot deliver to an attacker address. Recipient validation is enforced in the same function that checks the signatures.

---

## Reserve invariant

PLUSD tracks three cumulative counters: `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns`. Every mint asserts both `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` AND `totalSupply + amount ≤ maxTotalSupply`.

This is internal consistency, not Proof of Reserve. It catches counter desync and blocks over-mint against the contract's own ledger. If any mint ever exceeded what the counters say was deposited or earned, the transaction reverts before supply changes.

Full Chainlink-style PoR that verifies the wallet's actual USDC balance against PLUSD totalSupply is phase 2. The MVP invariant is necessary but not sufficient for end-to-end backing. It catches contract-level bugs, not USYC mark-to-market drift or off-chain accounting errors.

---

## Mint caps

| Cap | Value | Purpose |
|---|---|---|
| `maxPerWindow` | $10M / 24h | Aggregate PLUSD minted across all lenders |
| `maxPerLPPerWindow` | bounded per lender | Prevents single-wallet concentration |
| `maxTotalSupply` | hard ceiling | Absolute supply cap on PLUSD totalSupply |
| `freshnessWindow` | 90 days | Chainalysis screen must be fresh for deposits |

Each cap is enforced on-chain inside the relevant mint path. A deposit that would breach any cap reverts without touching USDC. Per-transaction size is additionally capped at $5M.

`maxTotalSupply` is the only one of the four that applies to both DepositManager and YieldMinter (it is checked on PLUSD inside `mintForDeposit` and `mintForYield` alike). The other three are deposit-side guards on lender behaviour.

Tightening any cap is instant (GUARDIAN). Loosening requires a 3-day ADMIN proposal through AccessManager, cancelable by GUARDIAN during the window. A 14-day meta-timelock on the delay setting itself blocks "collapse the delay then exploit" sequences.

---

## Trustee cannot inflate share price

The Trustee holds the LoanRegistry write role and can write any loan NFT state: mint ghost loans, write false repayment splits, close loans at maturity. None of these move USDC or mint PLUSD. **LoanRegistry is informational only.** sPLUSD share price moves exclusively on actual `yieldMint` calls landing in the vault, not on any registry write.

The Trustee is ALSO one of five Capital Wallet cosigners. A single-key Trustee compromise cannot move USDC alone. The cosigner policy requires Team + Trustee + one more on every transfer (3-of-5 with mandatory Team and Trustee). GUARDIAN can revoke the LoanRegistry write role instantly via `AccessManager.revokeRole`, stopping further registry writes while the cosigner policy continues to protect custody.

Loan bookkeeping and share-price computation are decoupled so that no single off-chain actor can lift the NAV by editing ledger state. Price moves only when real USDC lands and a two-party yield mint executes against it.

---

## Related

- [Custody](/security/custody/). Institutional MPC wallet model and cosigner policy.
- [Emergency response](/security/emergency-response/). GUARDIAN powers, pause, role revocation.
- [Potential risks](/risks/). Full risk register including the phase 2 PoR gap.
