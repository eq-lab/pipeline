---
title: Onboarding
order: 13
section: For Lenders
---

# Onboarding

Connect a wallet and deposit. Pipeline runs KYT on every deposit. Only screened addresses can hold PLUSD. Lenders who deposit or withdraw by bank wire pass KYC or KYB first.

## Who can lend

Entities and individuals from non-sanctioned jurisdictions, outside the US.

## What you need

- A self-custodied wallet you control. Pipeline never holds your keys.
- USDC in that wallet for your deposit (minimum 1,000 USDC), or a bank account for a USD wire.
- A small balance for network fees. Two actions on your side: the deposit request and the claim.

## The flow

You sign in with a wallet or with an email and password. Both lead to one account.

1. Connect your wallet. The connected address is the address that holds your PLUSD and sPLUSD.
2. Request a deposit. Your USDC goes straight to the protocol's deposit custody account. The request is recorded on-chain with your address and amount.
3. Pipeline screens your address and the deposit transaction (KYT). This usually takes seconds, sometimes minutes.
4. On a clean result, Pipeline authorises your address to hold PLUSD and issues a signed voucher for your request.
5. Claim the deposit with the voucher. The protocol mints PLUSD 1:1 to your address. From there you can stake into sPLUSD or send PLUSD to other authorised addresses.

### Verification for bank wires

To deposit or withdraw by bank wire, you pass KYC as an individual, or KYB for the legal entity you act for, and upload the documents. Pipeline reviews them and passes the account, asks for changes, or refuses it. A refusal is final and suspends the account. You also name a settlement address. You can change it at any time by signing with the new wallet, unless the account is refused. Wire deposits are minted to the address linked when they are processed.

## Re-screening

PLUSD is a permissioned token. Only addresses the protocol has authorised can hold, send or receive it. The protocol can withdraw an address's authorisation. A de-authorised address cannot move PLUSD, request a withdrawal or request a bank wire-out until the matter is resolved.

## What we cannot serve

- Wallets on OFAC or equivalent sanctions lists
- Lenders from the US or from sanctioned jurisdictions

## Next steps

- [Deposit](/lenders/deposit/). Request a deposit, claim PLUSD.
- [Risks](/risks/). Read before committing capital.
- [Legal](/references/legal/). Jurisdictional rules.
