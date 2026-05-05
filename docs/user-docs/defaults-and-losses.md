---
title: Default management
order: 12
section: Potential risks
---

# Default management

Pipeline finances real commodity deals; some of them will eventually go bad. This page explains how defaults are declared, how losses are absorbed, and what happens when a loss exceeds the protections in place — both in MVP and in the post-MVP design that succeeds it.

The audience is lenders and auditors who want to understand, before capital is at stake, exactly what the protocol does on the bad days. The MVP mechanism is the one that will actually run at launch; the post-MVP mechanism (Pipeline Recovery Tokens) is the one that replaces the MVP coefficient once the audit and hardening period concludes.

## What a default is

Every loan sits in one of four states and moves through them in a fixed order:

```
Performing → Watchlist → Default → Closed
```

The Trustee can promote a loan into Watchlist and demote it back to Performing as conditions change. The Trustee **cannot** mark a loan as `Default`. Only RISK_COUNCIL can propose that transition, and the call runs through a 3-day timelock; GUARDIAN can cancel during the window.

{% include chart.html src="c3-ccr-ladder.svg" caption="Collateral coverage thresholds — Watchlist at 130%, Maintenance margin call at 120%, Margin call at 110%. Not live protocol data." %}

A loan's collateral coverage ratio (CCR) is collateral value divided by outstanding senior principal. When CCR crosses each threshold — 130%, 120%, 110% — the Trustee and the Originator receive staged notifications and the Originator has a defined window to post additional margin. A sustained breach, or a missed repayment past the payment-delay thresholds (amber over 7 days late, red over 21 days late), is the typical route to a `Default` proposal.

Closure reasons split by authority:

| Closure reason      | Who can close      | Delay     |
|---------------------|--------------------|-----------|
| `ScheduledMaturity` | Trustee            | 0         |
| `EarlyRepayment`    | Trustee            | 0         |
| `Default`           | RISK_COUNCIL only  | 3 days    |
| `OtherWriteDown`    | RISK_COUNCIL only  | 3 days    |

A write-down closure is not reversible. Once a loan closes with `Default` or `OtherWriteDown`, the recorded loss is final and flows into the waterfall below.

The split matters. The Trustee has the operational bandwidth to close loans at maturity without a timelock. But write-downs change everyone's economics, so they are gated behind a multisig with its own delay. A single compromised Trustee key cannot manufacture a loss; it can mis-label a maturity or lie about a repayment, but those are data-integrity issues that do not move USDC. **The LoanRegistry is not a NAV source.**

---

## Loss waterfall

Losses are absorbed in a fixed order. The top two layers are identical in MVP and post-MVP; the third layer differs by phase.

1. **Originator equity tranche (first-loss).** Every loan is split into a Senior tranche, funded by lenders, and an Equity tranche, funded by the Originator and held off-chain against the deal. The Equity tranche takes the first loss. If realised losses stay within the Equity tranche, PLUSD and sPLUSD holders are whole.

2. **sPLUSD share-price writedown.** If the loss exceeds the Equity tranche, the remainder is absorbed at the vault level: sPLUSD share price writes down. sPLUSD holders take their pro-rata share of the residual loss. This is the mechanism by which stakers bear credit risk in return for the senior coupon. PLUSD holders are shielded as long as the sPLUSD cushion absorbs the entire excess.

3. **The third layer differs by phase:**
   - **MVP:** WithdrawalQueue exchange coefficient — symmetric haircut on every withdrawal.
   - **Post-MVP:** Pipeline Recovery Tokens (PRT) — per-holder claim tokens, tradable, redeemable from a recovery pool.

Both mechanisms aim for the same property: pari-passu treatment of all holders, no race, no queue jump, transparent recovery accounting. They differ in how they let holders express preference between exiting now and waiting for recovery.

---

## MVP — Exchange coefficient on the WithdrawalQueue

When the loss exceeds the Equity tranche AND the sPLUSD cushion, MVP applies a global haircut at the WithdrawalQueue level. The protocol does **not** enter a separate "shutdown mode." There is no terminal wind-down switch, no shutdown contract, no recovery-pool contract. The protocol continues operating with the haircut applied to every withdrawal.

### Mechanism

1. Trustee proposes the haircut coefficient `c` (e.g., `0.85`) reflecting the actual recoverable value per dollar of outstanding PLUSD-equivalent.
2. RISK_COUNCIL executes via a timelocked call on the WithdrawalQueue contract: `setExchangeCoefficient(c)`. 3-day delay, GUARDIAN-cancelable.
3. From that block onward, every claim pays out USDC = `face_value × c` instead of `face_value × 1.0`. The claim path takes one extra multiplication; everything else is unchanged.
4. Coefficient applies symmetrically:
   - PLUSD holders direct-redeeming via the queue → haircut applies.
   - sPLUSD holders unstaking-then-redeeming → haircut applies on the PLUSD leg through the queue.
   - There is no path to redeem at face value while the coefficient is below 1.
5. **Coefficient ratchets UP only.** As the Trustee recovers funds (loan workout, asset sale, insurance settlement, off-chain proceeds) and tops up the Withdrawal Queue Wallet, RISK_COUNCIL adjusts via `adjustExchangeCoefficientUp(c_new)` under the same 3-day timelock. The coefficient cannot go down.
6. Once `c = 1.0`, normal economics resume implicitly. There is no "exit shutdown" call to make.

### Properties

- **No race, no queue jump.** Two holders redeeming the same dollar of PLUSD on different days both get `face × c_at_that_day`. Holders who wait benefit from rate ratchets; holders who exit at lower coefficients do not get retroactive top-ups.
- **No new contract.** The coefficient is a single state variable on the existing WithdrawalQueue contract. Nothing else changes.
- **Symmetric across PLUSD and sPLUSD.** A holder's choice to stake or not does not affect the haircut on exit during a coefficient period.
- **Transparent.** The current coefficient is publicly readable on-chain at any time.

### Trade-off

Every holder eats the same loss at exit, regardless of whether they wanted to wait for recovery or exit immediately. The coefficient model crystallises the loss for everyone the moment they redeem — there is no way to separate "I want to exit now" from "I want to bet on recovery." Post-MVP fixes this trade-off.

---

## Post-MVP — Pipeline Recovery Tokens (PRT)

Once the protocol has audit results and a hardening period under its belt, the global queue coefficient is replaced by per-holder claim tokens — Pipeline Recovery Tokens (PRT). PRT separates the loss-realisation event from the holder's exit decision.

### Precedents studied

| Precedent | Mechanism | Outcome |
|---|---|---|
| **Bitfinex BFX (2016)** | After a $72M hack, all customer balances haircut ~36%; BFX issued 1:1 against loss; redeemable at $1 from revenue; freely tradable on-platform | Fully redeemed at $1 within 8 months |
| **Bitfinex RRT** | Long-term claim against eventual hack recovery (USG seizure proceeds); tradable | Partial recovery distributions over years |
| **Mt. Gox claims** | Bankruptcy claims tradable OTC and on specialised venues (CoinLab, GoxIOU briefly) | Prices ranged $50–$800 across years; partial recovery 10+ years on |
| **FTX claims** | Bankruptcy claims tradable OTC; specialised marketplaces (Xclaim, Cherokee, Claims Market) | Initial $0.10–0.30 → $1.00+ by mid-2024 as asset prices recovered |
| **MakerDAO debt auction (Mar 2020)** | Mint MKR, auction for DAI to cover ~$4M shortfall | Loss absorbed via MKR-holder dilution — different model (not IOU) |
| **Aave Safety Module** | Pre-funded slashable AAVE stake (up to 30%) | Ex-ante insurance, not ex-post claim — different model |
| **TradFi senior unsecured claims** | Claims tradable on distressed-debt markets; pari-passu within tier | Standard; recovery rate discovered by market |

The closest analogue to Pipeline's situation is **Bitfinex BFX** — clean unit accounting, transparent redemption commitment, secondary-market tradability — combined with the bankruptcy-claim insight that **tradable claims discover the recovery rate via market price**.

### PRT design

1. **Snapshot trigger.** RISK_COUNCIL declares the bad-debt amount `D` via timelocked call. A snapshot of every PLUSD holder's balance plus every sPLUSD holder's PLUSD-equivalent (`shares × pricePerShare`) is taken at the execution block.
2. **Haircut + mint.** Each holder's PLUSD (or sPLUSD-equivalent PLUSD) is reduced pro-rata by their share of `D`. Each receives **1 PRT per $1 of haircut**.
3. **PRT mechanics.**
   - Standard ERC-20.
   - **No whitelist** — PRT is a claim token, not a deposit. Freely transferable.
   - **No yield accretion** — PRT is a claim, not equity. PRT holders do not earn senior coupons or T-bill yield.
   - 1 PRT = $1 face value claim against the Recovery Pool.
4. **Recovery accounting.** Recoveries from the defaulted loans (workout, asset sale, insurance proceeds) are deposited by the Trustee into a Recovery Pool contract as USDC. The current **recovery rate** is `RecoveryPool.balance() / totalSupply(PRT)`, capped at 1.0.
5. **Redemption.** A PRT holder calls `RecoveryPool.redeem(amount)` and receives `amount × currentRate` USDC; their PRT burns. Rate ratchets UP only — a holder who redeems at rate 0.5 cannot retroactively claim if the rate later climbs.
6. **PLUSD and sPLUSD continue normally** post-snapshot. Their balances are reduced (the haircut already happened); from then on they accrue yield, withdraw, and trade exactly as before.

### Why PRT, not just a coefficient

The MVP coefficient applies the same loss to every holder at exit time. The PRT model separates two decisions:

- **Loss realisation** — happens at snapshot, for every holder, pari-passu.
- **Recovery participation** — each holder chooses whether to sell PRT now (crystallise loss at the current market price) or hold for the recovery pool.

This separation matters because holders have different time preferences. A retail holder who needs cash now can sell PRT to a distressed-debt fund willing to wait years for recovery. The fund is paid for waiting; the retail holder gets liquidity. The MVP coefficient denies this trade entirely — every holder eats the same expected recovery regardless of their willingness to wait.

### Why one tradable token, not tranched claims

Tranched claims (junior PRT, senior PRT, etc.) would mirror traditional bankruptcy hierarchies but add complexity Pipeline does not need:

- All Pipeline lenders sit at the same seniority — no contractual basis for tranching among them.
- Tranching adds accounting, signalling, and audit surface for marginal benefit.
- Bitfinex BFX's eight-month-to-full-redemption story used a single token. Mt. Gox's tradable bankruptcy claims used a single instrument per creditor. Both showed the market discovers price effectively without tranches.

PRT follows BFX's structural simplicity: one token, 1:1 face, redemption from recovery, freely tradable.

### What PRT is NOT

- **Not a security** under our intended structuring (a pro-rata claim token mirroring bankruptcy distribution rights), but legal review applies before launch and may add restrictions.
- **Not perpetual** — extinguishes as the Recovery Pool drains via redemptions, or via DAO decision after a long horizon if recoveries plateau.
- **Not a yield-bearing instrument** — PRT only entitles to recovered USDC at the current rate. PLUSD and sPLUSD continue to accrue yield on their post-haircut balances.

---

## Historical events

No defaults have occurred in the protocol's history. At MVP launch this is trivially true because the protocol is not yet operational. Future events will appear here with dates, affected loans, loss amounts, and realised outcomes.

The commitment is specific: every `Default` or `OtherWriteDown` closure, every coefficient adjustment (in MVP) or PRT mint event (post-MVP), and every Recovery Pool deposit, will be listed with the on-chain transaction, the originator involved, the principal and recovery amounts, and the dollar impact on holders. Losses are a fact of credit; opacity about them is a choice, and this page is where that choice goes the other way.

## Related reading

- [Potential risks](/risks/)
- [Emergency response](/security/emergency-response/)
- [Supply safeguards](/security/supply-safeguards/)
