---
title: Deposit
order: 14
section: For Lenders
redirect_from:
  - /lenders/deposit-and-stake/
---

# Deposit

Request a deposit, wait for KYT screening, claim PLUSD. Two actions on your side, with a screening window in between. Your USDC goes to the protocol's deposit custody account when you request. PLUSD is minted to you when you claim. You can hold PLUSD, send it to other authorised addresses, or stake it into sPLUSD to earn yield.

| Asset  | What it is                                      | Earns yield | Holder must be authorised |
|--------|-------------------------------------------------|-------------|---------------------------|
| USDC   | External stablecoin                             | No          | No                        |
| PLUSD  | Permissioned dollar token, 1 PLUSD = 1 USD of claim on the pool | No | Yes                 |
| sPLUSD | Share of the staking vault                      | Yes         | No at the share level     |

## Before you deposit

- The minimum deposit is 1,000 USDC. There is no maximum beyond the rate limits below.
- You pay the network fees for the request and the claim. The protocol does not.
- Pipeline never takes custody of your keys. Every step starts from your own wallet.
- You pass KYB before your first deposit. A clean KYT screen of your first deposit authorises your address. See [Onboarding](/lenders/onboarding/).

---

## Deposit flow

{% include diagram.html src="d2-deposit-mint.png" caption="Two-step deposit. USDC goes to the deposit custody account at request. Pipeline screens the request and issues a voucher. PLUSD is minted to the lender at claim." %}

### Walkthrough

<ol class="steps">
  <li>Request a deposit of an amount from your wallet.</li>
  <li>The deposit contract checks the minimum deposit, the per-transaction limit and the 24-hour window limit. A request over any limit is refused.</li>
  <li>Your USDC moves from your wallet to the deposit custody account in the same transaction. The contract records the request: your address, the amount, the time. You get a request number.</li>
  <li>Pipeline screens your address and the deposit transaction off-chain. Typically seconds, sometimes minutes.</li>
  <li>On a clean result, Pipeline authorises your address to hold PLUSD and signs a voucher for your request number, address and amount. The voucher is valid for 24 hours. Your app fetches it when ready.</li>
  <li>You submit the claim with the voucher. The contract checks the voucher and its deadline, marks the request claimed, and mints PLUSD 1:1 to the address on the request.</li>
</ol>

Pipeline does not write to the deposit contract. It screens, authorises your address and signs vouchers. A voucher only releases PLUSD against a request whose USDC has already reached custody.

### Rate limits

A single deposit cannot exceed 5,000,000 USDC. Deposits across all lenders cannot exceed 10,000,000 USDC in a 24-hour window. A request over either limit is refused on-chain. There is no automatic queue. Split the deposit or wait for the window to reopen.

The protocol administrator can raise or lower these limits.

### What lands in your wallet

- PLUSD, minted 1:1 to the USDC deposited, with no fee at mint.
- PLUSD can only be sent to other authorised addresses.

### Where your USDC goes

Your USDC moves to the deposit custody account when you request the deposit. Smart contracts never hold lender USDC.

If screening does not return clean, your USDC stays in the deposit custody account and no PLUSD is minted.

### Bank wire deposits

You can also wire USD to the protocol's bank account. When the wire arrives, the cash reporter, a 2-of-2 multisig, records it on-chain with the bank reference. Each bank reference can be recorded once. The protocol mints PLUSD 1:1 and stakes it straight into sPLUSD for your address. You receive sPLUSD, not PLUSD. A wire that cannot be matched to a lender is held in escrow until the Trustee assigns it to a lender or returns it.

Bank wire deposits count against a separate protocol mint limit: 1,000,000 per transaction and 10,000,000 per 24-hour window.

---

## When KYT does not return clean

Your request stays unclaimed on-chain in every case. The off-chain handling differs.

- Clean. Pipeline issues the voucher. You claim. PLUSD is minted.
- Not clean. Pipeline issues no voucher. The Trustee decides what happens to the USDC off-chain.

---

## Abandoned tickets

An unclaimed request has no expiry. There is no on-chain refund. If your voucher expires before you claim, your app fetches a new one.

---

## Common deposit failure modes

- The request is refused with a minimum-deposit error. The amount is below 1,000 USDC.
- The request is refused with a rate-limit error. The amount exceeds the per-transaction limit, or the 24-hour window is full. Split the deposit or wait.
- The claim is refused with an expired or invalid signature. The voucher is past its 24-hour deadline or does not match the request. Your app fetches a fresh voucher.
- The claim is refused as already claimed. The request was claimed before.
- No voucher is available. Screening is still running, or your request did not screen clean.
- The request or the claim is refused with a paused error. The deposit contract is paused. Check the status page before retrying.

---

## Contract addresses

The deposit contract, PLUSD and the deposit custody account are listed on the [Audits & addresses page](/technical/audits-and-addresses/). Treat that page as the source of truth. Do not trust addresses copied from third-party sites.

---

## Next

- [Stake PLUSD](/lenders/stake/). Convert PLUSD into yield-bearing sPLUSD.
- [Withdraw](/lenders/withdraw/). Convert sPLUSD or PLUSD back to USDC.
- [Supply safeguards](/security/capital-safeguards/). Rate limits and mint controls.
