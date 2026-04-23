---
title: Supply safeguards
order: 15
section: Security & Transparency
---

# Supply safeguards

PLUSD has exactly two mint paths — deposit (USDC → PLUSD 1:1) and yield (vault or Treasury). Each is gated independently so no single compromise can create unbacked PLUSD.

This page covers the four structural safeguards that prevent inflation of PLUSD supply. Each section names the safeguard, describes its mechanism, and states the attack scenario it defeats.

---

## Deposits are atomic on-chain

`DepositManager.deposit(amount)` pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction. If either leg fails, the whole transaction reverts. There is no intermediate queue, no signing step, no delay.

**No off-chain signer gates the deposit path.** Bridge is not in the deposit critical path. A complete Bridge compromise does not stop deposits or allow unbacked deposit-leg mints. The on-chain USDC movement IS the attestation. The minimum deposit is $1,000 and each transaction is capped at $5M with a $10M/24h aggregate limit.

This closes the attack class where a compromised signing key mints against a fake or spoofed USDC transfer. The Resolv exploit of March 2026 stands as the warning case: an attestor signed a mint for a deposit that never settled. Pipeline removes the attestor from the path entirely.

---

## Yield mints need two independent signatures

`PLUSD.yieldMint(attestation, bridgeSig, custodianSig)` verifies both signatures on-chain. The Bridge signs with its yield-attestor key. The custodian's EIP-1271 signer contract independently verifies the underlying USDC inflow and signs second. Both signatures must recover to the configured addresses or the call reverts.

Compromising Bridge alone mints zero. Compromising the custodian alone mints zero. Joint compromise of both plus successful replay requires collusion PLUS bypassing the on-chain `usedRepaymentRefs` guard that rejects any attestation ID already consumed.

Destinations are constrained at the contract level — only the sPLUSD vault address or the Treasury Wallet. The yield mint cannot deliver to an attacker address. Recipient validation is enforced in the same function that checks the signatures.

---

## Reserve invariant on every mint

PLUSD tracks three cumulative counters — `cumulativeLPDeposits`, `cumulativeYieldMinted`, `cumulativeLPBurns`. Every mint asserts both `totalSupply + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` AND `totalSupply + amount ≤ maxTotalSupply`.

This is internal consistency, not Proof of Reserve. It catches counter desync and blocks over-mint against the contract's own ledger. If any mint ever exceeded what the counters say was deposited or earned, the transaction reverts before supply changes.

Full Chainlink-style PoR that verifies the custodian's actual USDC balance is phase 2. We state this limit honestly. The MVP invariant is necessary but not sufficient for end-to-end backing; it catches contract-level bugs, not custodian-side divergence.

---

## Four economic caps on the mint path

<div class="callout info">

| Cap | Value | Purpose |
|---|---|---|
| `maxPerWindow` | $10M / 24h | Aggregate PLUSD minted across all lenders |
| `maxPerLPPerWindow` | bounded per lender | Prevents single-wallet concentration |
| `maxTotalSupply` | hard ceiling | Absolute supply cap |
| `freshnessWindow` | 90 days | Chainalysis screen must be fresh for deposits |

</div>

Each cap is enforced on-chain inside the mint function. A deposit that would breach any cap reverts without touching USDC. Per-transaction size is additionally capped at $5M.

Tightening any cap is instant (ADMIN). Loosening requires a 48-hour ADMIN proposal through AccessManager, cancelable by GUARDIAN during the window. The RISK_COUNCIL path for risk-parameter changes carries a 24-hour delay. A 14-day meta-timelock on the delay setting itself blocks "collapse the delay then exploit" sequences.

---

## A compromised Trustee cannot inflate share price

The Trustee holds the `TRUSTEE` role on LoanRegistry and can write any loan NFT state — mint ghost loans, write false repayment splits, close loans at maturity. None of these move USDC or mint PLUSD. LoanRegistry is **informational only**. sPLUSD share price moves exclusively on actual `yieldMint` calls, not on any registry write.

The Trustee is ALSO a Capital Wallet cosigner, but a single-key Trustee compromise cannot move USDC alone — Bridge cosign is required. GUARDIAN can revoke the `TRUSTEE` role instantly via `AccessManager.revokeRole`, stopping further registry writes while the two-of-two cosign requirement continues to protect custody.

This separation is deliberate. Loan bookkeeping and share-price computation are decoupled so that no single off-chain actor can lift the NAV by editing ledger state. Price moves only when real USDC lands and a two-party yield mint executes against it.

---

## Related pages

- [Custody](/pipeline/security/custody/) — Capital Wallet cosigning model and custodian setup
- [Emergency response](/pipeline/security/emergency-response/) — GUARDIAN powers, pause, role revocation
- [Risks](/pipeline/risks/) — full risk register including the phase 2 PoR gap
