---
title: Relayer security model
order: 22
section: Technical overview
---

# Relayer security model

The Relayer is Pipeline's off-chain backend. It indexes on-chain events, screens lenders, approves screened addresses to hold PLUSD, signs deposit and withdrawal vouchers, and matches bank wires to their on-chain bookings. It holds no custody key. It cannot mint PLUSD alone. It cannot move USDC out of any custody account.

## What the Relayer can do

- Index on-chain events and serve protocol data to the app and the console
- Screen lender addresses and deposits against sanctions and AML lists
- Approve a screened address to hold PLUSD, under the Whitelist Admin role
- Sign a single-use, expiring voucher for a screened deposit; anyone can then submit the claim, and PLUSD is minted 1:1 to the depositor
- Sign a voucher for a withdrawal claim; the claim pays only if the withdrawal custody account holds enough USDC for the queue up to that request
- Match bank wires to the wire-in bookings in the cash book

## What the Relayer cannot do

- Mint PLUSD alone. A deposit mint needs a real USDC deposit already sent to custody. Every other mint needs the Cash Reporter.
- Move USDC out of any custody account. The withdrawal queue pays only the lender who queued the request.
- Grant or revoke roles. Admin only.
- Pause contracts. Pauser only.
- Declare default. Risk Council only.

## Compromised Relayer scenario

If the Relayer is compromised, the attacker cannot drain capital. PLUSD for a deposit is minted only against USDC the depositor already sent to custody. A compromised voucher key can approve deposits that should have failed screening. The risk is AML: illicit USDC can enter custody. It can also approve withdrawal claims; they still pay only the lender who queued them, in queue order. Under the Whitelist Admin role it can approve any address to hold PLUSD, or remove an approval. Worst case beyond that: deposits and withdrawals stall, and new addresses are not approved.

The Admin revokes the Relayer's Whitelist Admin role, sets a new voucher key on the deposit manager and the withdrawal queue, and grants the role to a new key. The Pauser can pause the deposit manager and the withdrawal queue meanwhile. These actions run with no delay.

## Operational hardening

- One voucher key signs both deposit and withdrawal vouchers.
- Each voucher names the request, the user, the amount and a deadline, and can be used once.
- Mint limits on deposits: 5,000,000 PLUSD per deposit and 10,000,000 per 24 hours.
