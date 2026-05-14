---
title: Stake PLUSD
order: 15
section: For Lenders
---

# Stake PLUSD

Stake PLUSD into sPLUSD to earn yield. sPLUSD is a standard ERC-4626 vault whose underlying asset is PLUSD. Yield arrives as fresh PLUSD minted directly into the vault — your share count stays constant, but what each share is worth grows. There is no claim step, no restake, no compounding action.

The whitelist lives on PLUSD transfers and is enforced at the underlying-asset level. The vault itself has no whitelist, so any PLUSD holder can stake — and compliance re-engages when you unstake back into PLUSD.

---

## Stake flow

{% include diagram.html src="d3-stake-unstake.png" caption="Stake is open access; unstake requires the receiver of the returned PLUSD to be whitelisted." %}

### Walkthrough

<ol class="steps">
  <li>Call <code>PLUSD.approve(sPLUSDvault, amount)</code> to authorise the vault, then call <code>sPLUSD.deposit(assets, receiver)</code>.</li>
  <li>The vault pulls <code>assets</code> PLUSD from your wallet into the vault contract via <code>transferFrom</code>.</li>
  <li>The vault mints sPLUSD shares to <code>receiver</code> at <code>shares = assets * totalSupply / totalAssets</code>, rounded down.</li>
</ol>

### How shares earn yield

Your share count stays constant after stake. The PLUSD each share redeems for grows as fresh PLUSD is minted directly into the vault address from the two yield engines. This is passive: no claim call, no restake, no compounding step. The ERC-4626 share price (`totalAssets / totalSupply`) ticks up as `totalAssets` rises while `totalSupply` is unchanged.

You can stake and unstake at any time. There is no lock-up, no queue at the vault, and no minimum hold.

### Who can stake

Any PLUSD holder. This is the design point that enables DeFi composability on sPLUSD shares while keeping the compliance boundary intact on the underlying asset.

---

## Unstake flow

Redeeming sPLUSD returns PLUSD, not USDC. Call `sPLUSD.redeem(shares, receiver, owner)` and the vault burns your shares and transfers PLUSD to the receiver. The receiver must be whitelisted on PLUSD, or the PLUSD transfer reverts and the whole redemption fails. The PLUSD amount paid out is `shares * totalAssets / totalSupply`, rounded down — so the exact quantity depends on the share price at the moment your transaction lands.

Converting PLUSD back to USDC is a separate step handled by the WithdrawalQueue. Unlike the stake/unstake vault, the redemption path can route through the 15% USDC buffer or escalate to a large-withdrawal track that liquidates T-bills on your behalf. See [withdraw](/lenders/withdraw/) for the flow, the buffer rules, and the large-withdrawal path.

---

## What affects your yield

Two yield streams feed the vault, both routed through `YieldMinter.yieldMint` under two independent signatures (Relayer + Trustee).

**Senior coupons.** Minted as extra PLUSD when borrowers repay. The offtaker pays USD into the Trustee's bank account, the Trustee on-ramps to USDC, and the senior coupon net of fees is minted into the PLUSD staking vault. Settles per repayment event.

**T-bill yield.** USYC sits in the Capital Wallet and NAV drifts up daily, but yield is realised — not accrued. Nothing mints until the Trustee instructs a USYC sale via the Hashnote redemption rail. Realised gain is split 70% as fresh PLUSD to the PLUSD staking vault, 30% to Treasury. Realisation is at the Trustee's discretion; if no sale happens for a quarter, USYC contributes nothing to share price, regardless of NAV.

A 15% USDC buffer in the Capital Wallet (band 10–20%) keeps routine redemptions from forcing a USYC sale.

---

## Common stake/unstake failure modes

- **Stake reverts on transfer.** You did not approve `sPLUSD` to spend PLUSD, or the approval is for less than the `assets` you passed.
- **Stake reverts with paused error.** The GUARDIAN Safe has paused `sPLUSD`. Check the status page before retrying.
- **Redeem reverts at the PLUSD level.** The `receiver` address you passed is not whitelisted on PLUSD.

---

## Contract addresses

`sPLUSD` and `PLUSD` addresses are published on the [Audits & addresses page](/technical/audits-and-addresses/) and are verified on Etherscan. Treat the Audits & addresses page as the source of truth. Do not trust addresses copied from third-party sites.

---

## Related pages

- [Deposit](/lenders/deposit/) — get PLUSD before you can stake.
- [Withdraw](/lenders/withdraw/) — convert sPLUSD or PLUSD back to USDC.
