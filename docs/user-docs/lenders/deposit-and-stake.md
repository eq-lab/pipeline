---
title: Deposit & stake
order: 7
section: For Lenders
---

# Deposit & stake

Deposit USDC to receive PLUSD at 1:1, then stake PLUSD into sPLUSD to earn yield. Deposit-and-mint is a single atomic transaction — your USDC never moves without the matching PLUSD mint landing in the same block.

Holding PLUSD is the compliance-bounded representation of your deposit. Staking it into sPLUSD converts that holding into yield-bearing shares. The two steps are separate on-chain calls, so you can hold PLUSD idle, stake part of it, or stake it all.

| Asset  | What it is                          | Earns yield | Whitelist at transfer |
|--------|-------------------------------------|-------------|-----------------------|
| USDC   | Your external stablecoin            | No          | No                    |
| PLUSD  | 1:1 claim on the Capital Wallet     | No          | Yes                   |
| sPLUSD | ERC-4626 share of the vault         | Yes         | No at the share level |

## Before you deposit

- Your wallet must be whitelisted and your Chainalysis screen fresh (90-day window). See [onboarding](/pipeline/lenders/onboarding/) if either is missing.
- The minimum deposit is $1,000 USDC. There is no maximum beyond the rate limits below.
- You need enough ETH in your wallet to cover two transactions: the USDC approval and the deposit call. Gas is paid by you, not the protocol.
- Pipeline never takes custody of your keys. Every step is initiated from your own wallet.

---

## Deposit — atomic USDC → PLUSD

<div class="callout safety">

**No off-chain signer gates deposits. The on-chain USDC movement is the attestation.**

There is no signature, no queue, and no back-office step between your wallet and your PLUSD. The `DepositManager` contract pulls USDC and mints PLUSD in a single transaction. If any check fails, the whole transaction reverts and your USDC stays put.

</div>

{% include diagram.html src="d2-deposit-mint.svg" caption="Deposit to mint — one atomic transaction, no Bridge signer in the critical path." %}

### Walkthrough

<ol class="steps">
  <li>Approve <code>DepositManager</code> as a USDC spender, then call <code>DepositManager.deposit(amount)</code> from your whitelisted wallet.</li>
  <li>DepositManager calls <code>WhitelistRegistry.isAllowedForMint(lp)</code> and reverts if your wallet is not whitelisted or your Chainalysis screen is older than 90 days.</li>
  <li>DepositManager checks the four caps in order: per-LP 24h limit, aggregate 24h limit, hard total supply ceiling, and the freshness window.</li>
  <li>DepositManager calls <code>USDC.transferFrom(lp, capitalWallet, amount)</code>, a single on-chain ERC-20 transfer from your wallet to the Capital Wallet.</li>
  <li>DepositManager calls <code>PLUSD.mintForDeposit(lp, amount)</code>, which runs the reserve invariant check; only DepositManager holds the DEPOSITOR role.</li>
  <li>Your PLUSD balance rises 1:1 with the USDC deposited, and the whole transaction reverts as a unit if any prior step fails.</li>
</ol>

### Rate limits

A single deposit cannot exceed $5M. Rolling 24h deposits across all your wallets cannot exceed $10M. If either cap would be breached, the transaction reverts on-chain — there is no auto-queue in MVP. Split the deposit manually and retry when headroom opens. The deposit UI reads the `GET /v1/protocol/limits` endpoint and shows live utilisation before you submit, so you can size each transaction against available headroom.

A third cap — the hard total supply ceiling on PLUSD — is a protocol-wide circuit breaker and is only tightened or loosened by ADMIN governance. Tightening is instant; loosening requires a 48h AccessManager delay. You will almost never see this cap bind; it exists to bound the blast radius of any integration error.

### What lands in your wallet

- PLUSD, minted 1:1 to USDC, with no fee deducted at mint time.
- The deposit event is indexed immediately; your PLUSD balance is spendable in the same block.
- PLUSD can only be sent to other whitelisted addresses or approved DeFi venues. Transfers to non-whitelisted addresses revert at the `_update` hook on the PLUSD contract.

### Where the USDC goes

Your USDC moves in a single ERC-20 transfer to the Capital Wallet, an MPC-custodied wallet operated by the custodian. Smart contracts never hold lender USDC, so a contract exploit cannot drain deposits. The Capital Wallet maintains the 15% USDC buffer (10–20% band) and rotates excess into USYC T-bills for yield. Movement between the Capital Wallet and the custodian is subject to multi-party approval; none of it is gated by Pipeline operators acting alone.

---

## Stake — PLUSD → sPLUSD shares

Stake by approving the vault and calling `sPLUSD.deposit(assets, receiver)`. sPLUSD is a standard ERC-4626 vault; shares are minted to the receiver at the current share price. Any PLUSD holder may stake — the vault itself has no whitelist. The whitelist lives on PLUSD transfers and is enforced at the underlying-asset level, so compliance re-engages when you unstake.

{% include diagram.html src="d3-stake-unstake.svg" caption="Stake is open access; unstake requires the receiver of the returned PLUSD to be whitelisted." %}

### Walkthrough

<ol class="steps">
  <li>Call <code>PLUSD.approve(sPLUSDvault, amount)</code> to authorise the vault, then call <code>sPLUSD.deposit(assets, receiver)</code>.</li>
  <li>The vault pulls <code>assets</code> PLUSD from your wallet into the vault contract via <code>transferFrom</code>.</li>
  <li>The vault mints sPLUSD shares to <code>receiver</code> at <code>shares = assets * totalSupply / totalAssets</code>, rounded down.</li>
</ol>

### How shares earn yield

Your share count stays constant after stake. The PLUSD each share redeems for grows as fresh PLUSD is minted directly into the vault address from two yield engines. This is passive: no claim call, no restake, no compounding step. The ERC-4626 share price (`totalAssets / totalSupply`) ticks up as `totalAssets` rises while `totalSupply` is unchanged.

You can stake and unstake at any time. There is no lock-up, no queue at the vault, and no minimum hold. Redemptions that cross the whitelist boundary are subject to the PLUSD transfer hook on the receiver address.

### Who can stake

Any PLUSD holder — including approved DeFi venues that acquired PLUSD through whitelisted pools. The vault performs no KYC check of its own; the check was performed upstream when the PLUSD first entered the holder's address. This is the design point that enables DeFi composability on sPLUSD shares while keeping the compliance boundary intact on the underlying asset.

---

## Unstake preview

Redeeming sPLUSD returns PLUSD, not USDC. Call `sPLUSD.redeem(shares, receiver, owner)` and the vault burns your shares and transfers PLUSD to the receiver. The receiver must be whitelisted on PLUSD, or the PLUSD transfer reverts and the whole redemption fails. The PLUSD amount paid out is `shares * totalAssets / totalSupply`, rounded down — so the exact quantity depends on the share price at the moment your transaction lands.

Converting PLUSD back to USDC is a separate step handled by the WithdrawalQueue. Unlike the stake/unstake vault, the redemption path can route through the 15% USDC buffer or escalate to a large-withdrawal track that liquidates T-bills on your behalf. See [withdraw](/pipeline/lenders/withdraw/) for the flow, the buffer rules, and the large-withdrawal path.

---

## What affects your yield

Two engines feed the vault. Senior loan coupons are minted into the vault as trade-finance borrowers repay their drawings. T-bill NAV yield is minted at 70% of accrued USYC appreciation; the remaining 30% accrues to the Treasury tranche. A 15% USDC buffer (target band 10–20%) sits inside the Capital Wallet so that routine redemptions can be serviced without forcing a T-bill sale. Both yield mints require two independent signatures verified on-chain — neither Bridge alone nor the custodian alone can mint yield PLUSD.

Loan-coupon mints settle per repayment event. T-bill NAV mints settle lazily, on each stake or unstake that touches the vault, so the share price refreshes at your interaction rather than on a fixed cadence. If there are no stake or unstake events for a period, unrealised NAV still accrues inside the Capital Wallet and materialises at the next vault interaction.

See [yield engines](/pipeline/how-it-works/yield-engines/) for the full split mechanics, the signing parties, and how the buffer is rebalanced.

---

## Common failure modes

- **Deposit reverts with whitelist error.** Your Chainalysis screen is older than 90 days. Re-screen via the app.
- **Deposit reverts with rate-limit error.** You or the protocol have hit the 24h cap. Check live utilisation and split the deposit or wait.
- **Deposit reverts on `transferFrom`.** You did not approve `DepositManager` to spend USDC, or the approval is for less than the `amount` you passed.
- **Stake reverts on transfer.** You did not approve `sPLUSD` to spend PLUSD, or the approval is for less than the `assets` you passed.
- **Redeem reverts at the PLUSD level.** The `receiver` address you passed is not whitelisted on PLUSD.
- **Deposit or stake reverts with paused error.** The GUARDIAN Safe has paused `DepositManager` or `sPLUSD`. Check the status page before retrying.

---

## Contract addresses

All four contract addresses — `DepositManager`, `PLUSD`, `sPLUSD`, and `WhitelistRegistry` — are published on the [Audits &amp; addresses page](/pipeline/security/audits-and-addresses/) and are verified on Etherscan. Treat the Audits &amp; addresses page as the source of truth. Do not trust addresses copied from third-party sites.

---

## Related pages

- [Withdraw](/pipeline/lenders/withdraw/) — convert sPLUSD or PLUSD back to USDC.
- [Yield engines](/pipeline/how-it-works/yield-engines/) — how senior coupons and T-bill NAV flow into the vault.
- [Supply safeguards](/pipeline/security/supply-safeguards/) — the reserve invariant, rate limits, and the hard supply cap.
