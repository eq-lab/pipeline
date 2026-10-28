---
title: Stake PLUSD
order: 15
section: For Lenders
---

# Stake PLUSD

Stake PLUSD into sPLUSD to earn yield. sPLUSD is a share of the staking vault, whose underlying asset is PLUSD. Interest arrives as new PLUSD minted into the vault. Your share count stays the same. What each share is worth goes up. There is no claim step and no restake.

The permission check lives on PLUSD. Only authorised addresses can hold PLUSD, so only they can stake it. The vault itself does not check the address that receives the shares. The check applies again when you unstake back into PLUSD.

---

## Stake flow

{% include diagram.html src="d3-stake-unstake.png" caption="Staking takes PLUSD from an authorised holder. Unstaking requires the receiver of the returned PLUSD to be authorised." %}

### Walkthrough

<ol class="steps">
  <li>Stake an amount of PLUSD from your wallet and name the address that receives the shares.</li>
  <li>The vault takes the PLUSD from your wallet.</li>
  <li>The vault issues sPLUSD shares to the receiver in proportion to the PLUSD already in the vault, rounded down.</li>
</ol>

A bank wire deposit skips these steps. The protocol mints the PLUSD and stakes it for you in one go. See [Deposit](/lenders/deposit/).

### How shares earn yield

Your share count stays the same after you stake. The PLUSD each share redeems for grows when new PLUSD is minted into the vault. Share price is the vault's PLUSD divided by the number of shares.

You can stake and unstake at any time. There is no lock-up, no queue at the vault and no minimum hold.

### Who can stake

Any authorised PLUSD holder.

---

## Unstake flow

Unstaking returns PLUSD, not USDC. You redeem shares and name a receiver. The vault burns the shares and sends PLUSD to the receiver. The receiver must be authorised to hold PLUSD, or the redemption fails. The PLUSD paid out is your shares times the share price at that moment, rounded down.

Converting PLUSD back to USDC is a separate step through the withdrawal queue. See [Withdraw](/lenders/withdraw/).

---

## What affects your yield

Interest from loans is the source of yield. Borrowers are invoiced interest monthly. When a borrower pays, the senior interest is minted as new PLUSD into the vault in one go. The share price steps up on that day. There is no daily accrual in the share price.

Fees on a repayment go to the protocol treasury as sPLUSD shares. They do not change the share price.

Income the protocol books on its bank account is minted into the vault and raises the share price. Bank charges and ramp shortfalls are burned from the vault and lower it.

A default lowers the vault. The Risk Council, acting for the Majority Lenders, declares the default. The loan's outstanding PLUSD moves from the vault into a separate pocket for that loan. The pocket belongs to the sPLUSD holders at the moment of the default, pro rata to their shares. Recoveries on the loan go to the pocket, and those holders claim them. Holders who left the vault before the default do not share in the loss or the recoveries. See [Default management](/risks/default-management/).

---

## Common stake/unstake failure modes

- The stake is refused because your address is not authorised to hold PLUSD, or you hold less PLUSD than the amount.
- The stake or redemption is refused with a paused error. The vault is paused. Check the status page before retrying.
- The redemption fails at the PLUSD level. The receiver you named is not authorised to hold PLUSD.

---

## Contract addresses

The sPLUSD vault and PLUSD are listed on the [Audits & addresses page](/technical/audits-and-addresses/). Treat that page as the source of truth. Do not trust addresses copied from third-party sites.

---

## Related pages

- [Deposit](/lenders/deposit/). Get PLUSD before you can stake.
- [Withdraw](/lenders/withdraw/). Convert sPLUSD or PLUSD back to USDC.
