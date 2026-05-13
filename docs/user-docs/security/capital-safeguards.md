---
title: Capital safeguards
order: 31
section: Security & Transparency
---

# Capital safeguards

PLUSD has exactly two mint paths: deposit (USDC to PLUSD 1:1) and yield (sPLUSD vault or Treasury Wallet). Each path lives behind a different contract with a different threat model and a different set of checks. They do not duplicate each other.

This page covers the structural safeguards that prevent inflation of PLUSD supply. Each section names the safeguard, describes its mechanism, and states the attack scenario it defeats.

---

## DepositManager vs YieldMinter

DepositManager gates **lender-initiated** mints. The lender is the trust boundary. The contract assumes the caller is potentially malicious and rate-limits accordingly. YieldMinter gates **operator-initiated** mints. The function is permissionless to call, but every mint requires both a Relayer ECDSA signature and a Trustee EIP-1271 signature verified on-chain, and the destination is hard-constrained to the sPLUSD vault or the Treasury Wallet. Neither contract enforces the other's checks. The separation is what makes the threat models legible.

| Check | DepositManager | YieldMinter |
|---|---|---|
| Deposit ticket must be `Claimable` (KYT clean) | Yes, enforced inside `claim` | Not applicable |
| PLUSD `_update` whitelist gate at mint recipient | Yes, recipient must be whitelisted | Yes, recipient is the sPLUSD vault or Treasury Wallet (system addresses) |
| Per-lender rolling-window cap (`maxPerLPPerWindow`) | Yes, bounds single-actor deposit volume | No |
| Global rolling-window cap (`maxPerWindow`, $10M / 24h) | Yes, bounds all-lender deposit volume | No |
| Hard total-supply cap with reservation against `outstandingClaimable` | Yes, checked at deposit and re-checked at claim | Yes, checked on `mintForYield` |
| Reserve invariant on PLUSD ledger | Yes, increments `cumulativeLPDeposits` at claim | Yes, increments `cumulativeYieldMinted` |
| USDC custody during screening | Intake Wallet (separate MPC) holds USDC between `deposit` and `claim` | Not applicable. Yield is post-fact accounting on USDC already in the Capital Wallet |
| USDC `transferFrom` paths | Caller to Intake Wallet at `deposit`, Intake to Capital at `claim`, Intake to caller at `refund` | None |
| EIP-712 attestation verified on-chain | Yes. Relayer ECDSA `ClaimAttestation` verified at `claim` against `kytAttestor` | Yes. Relayer ECDSA + Trustee EIP-1271, both verified at `yieldMint` |
| Replay guard (`usedRepaymentRefs`) | Not applicable, ticket state machine prevents double-claim | Yes. Each attestation ref consumed exactly once |
| Destination restriction | Recipient is the depositor, who must be whitelisted at mint time | Hard-coded to sPLUSD vault or Treasury Wallet |
| Holds role on PLUSD | `DEPOSITOR` role (DepositManager proxy address) | `YIELD_MINTER` role (YieldMinter proxy address) |

**The shared gate is PLUSD itself.** Both `mintForDeposit` and `mintForYield` increment cumulative counters atomically on PLUSD and assert `totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns` in the same transaction. The `maxTotalSupply` ceiling is enforced on every mint regardless of which path called it. Per-account and per-window caps are absent from YieldMinter because the recipients are protocol system addresses (not LPs) and the volume is bounded by real cash inflow (repayments wired into the Trustee bank then on-ramped to USDC, plus realised USYC redemptions), not by lender behaviour.

---

## Two-step deposits with screening

`DepositManager.deposit(amount)` pulls USDC from the lender into the **Intake Wallet** (a separate MPC custody address) and creates a deposit ticket. The Relayer runs KYT off-chain. On a clean result, the Relayer signs an EIP-712 `ClaimAttestation` and serves it via API. The lender calls `claim(depositId, attestation, signature)`, which verifies the signature on-chain, writes the lender's whitelist entry, moves USDC from the Intake Wallet to the Capital Wallet via standing allowance, and mints PLUSD 1:1.

The previous "deposit is one atomic transaction" property is gone. The Relayer sits between `deposit` and `claim` as an off-chain attestor. The trade-off bought compliance screening without requiring KYC of the lender, and the Relayer never writes to DepositManager directly.

**PLUSD remains 1:1 backed in every state.** Mint only happens at `claim`, and only against USDC the lender already deposited into the Intake Wallet. A Relayer compromise can flip a `Pending` ticket to `Claimable` without a real KYT pass, but it cannot mint PLUSD on its own. The lender still has to deposit their own USDC for any PLUSD to exist. The risk of Relayer compromise is AML (illicit USDC entering the Capital Wallet) rather than direct theft.

The Resolv exploit of March 2026 stands as the warning case. An attestor signed a mint for a deposit that never settled. Pipeline's design closes that class because the on-chain `claim` requires the deposit ticket to exist (which requires real USDC in the Intake Wallet) before the mint can happen.

The minimum deposit is $1,000. The aggregate limit is $10M/24h.

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
| `maxPerWindow` | $10M / 24h | Aggregate USDC accepted across all lenders |
| `maxPerLPPerWindow` | bounded per lender | Prevents single-wallet concentration |
| `maxTotalSupply` | hard ceiling | Absolute supply cap on `PLUSD.totalSupply() + outstandingClaimable`, reserves cap headroom for tickets already screened-clean but not yet claimed |
| `freshnessWindow` | 90 days | Compliance screen must be fresh for the transfer whitelist (`PLUSD._update` and `WithdrawalQueue.claim`) |

Each cap is enforced on-chain inside the relevant mint path. A deposit that would breach any cap reverts without touching USDC.

`maxTotalSupply` applies to both DepositManager and YieldMinter. The other three are deposit-side guards on lender behaviour. `freshnessWindow` is a transfer-whitelist parameter, not a deposit-rate parameter.

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
