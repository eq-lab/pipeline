---
title: Capital safeguards
order: 31
section: Security & Transparency
---

# Capital safeguards

PLUSD has two mint paths. The deposit manager mints PLUSD 1:1 for USDC deposits. The minter mints PLUSD for bank wires, loan interest, fees and bank income. Each path has its own checks and its own limits.

This page lists the safeguards on PLUSD supply and on investor cash.

---

## Deposit manager and minter

The deposit manager serves investors who deposit USDC. The minter serves the cash book: bank wires, repayments and bank income. Both hold the mint role on PLUSD. No person holds it.

| Check | Deposit manager | Minter |
|---|---|---|
| Who starts the mint | The investor, by sending USDC | The Cash reporter role, by booking a wire, a repayment or bank income |
| Cash behind the mint | USDC already in the deposit custody account | Bank dollars booked by the Cash reporter |
| Signed voucher | Yes. The platform backend signs it after screening. One use, with a deadline. | No |
| Recipient must be approved to hold PLUSD | Yes | Not checked: the PLUSD goes to the vault, not to the investor. Wires are staked in the vault for the investor; interest goes to the vault; fees go to the treasury as vault shares. |
| Per-transaction limit | 5,000,000 USDC | 1,000,000 PLUSD |
| 24-hour limit | 10,000,000 USDC | 10,000,000 PLUSD |
| Minimum | 1,000 USDC | None |
| Replay guard | Each request is claimed once | Each bank reference is used once; an empty reference is refused |

The Trustee cannot mint PLUSD. Its disbursements move booked bank cash into loan principal outstanding. Its expense entries burn PLUSD from the vault.

---

## Two-step deposits with screening

PLUSD mints only to an address approved to hold it. The investor sends USDC to the deposit manager, which passes it straight to the deposit custody account and opens a request. The platform backend screens the address and the transfer (KYT). Every investor passes KYB before its address can be approved. On a clean result it approves the address to hold PLUSD and signs a voucher for the request. Anyone can submit the voucher. The deposit manager checks it and mints PLUSD 1:1 to the investor.

PLUSD mints only against a request, and a request exists only after the investor's USDC has reached custody. A stolen voucher key can release a pending request without screening. It cannot create a request or mint PLUSD without USDC.

The minimum deposit is 1,000 USDC. The limits are 5,000,000 USDC per deposit and 10,000,000 USDC per 24 hours.

---

## User-pulled withdrawals

An investor redeems sPLUSD for PLUSD at the current share price and places the PLUSD in the withdrawal queue. The queue is first in, first out. Each request records the total queued up to and including it.

A claim needs two things: a voucher signed by the platform backend, and enough USDC in the withdrawal custody account to cover every earlier request plus this one. On claim, the queue pays USDC from the withdrawal custody account through its allowance and burns the PLUSD.

The queue never holds USDC. It cannot draw more than the allowance the withdrawal custody account has granted. It has no access to the deposit custody account.

---

## Bank wires and interest

The Cash reporter books each incoming wire with a bank reference. The minter mints PLUSD 1:1 and stakes it in the vault for the investor. A wire with no known investor waits in the minter until the Trustee assigns it or returns it.

Interest reaches the vault when a repayment is booked. The minter mints the interest into the vault and the share price rises. Fees go to the treasury as vault shares. Disbursements do not mint.

---

## Pool accounting

The minter keeps the cash book on-chain. It reports pool assets as custody USDC plus booked bank cash plus cash in transit plus loan principal outstanding. Bank cash is booked by the Cash reporter and the Trustee. The contracts do not see the bank balance.

---

## Mint caps

| Cap | Value | Applies to |
|---|---|---|
| Minimum deposit | 1,000 USDC | Deposit manager |
| Per deposit | 5,000,000 USDC | Deposit manager |
| Deposits per 24 hours | 10,000,000 USDC | Deposit manager, all investors together |
| Per mint | 1,000,000 PLUSD | Minter: wires, interest, fees, income |
| Minter mints per 24 hours | 10,000,000 PLUSD | Minter |

Each cap is checked on-chain. A deposit or mint above a cap fails.

The Admin changes the caps. Changes take effect at once.

---

## Trustee cannot inflate share price

The Trustee opens loans, records disbursements and closes loans. A disbursement moves booked bank cash into loan principal outstanding. Pool assets do not change. The share price rises only when the minter mints interest or income into the vault, and those mints belong to the Cash reporter role. A wrong repayment is reversed by the Risk Council.

The Admin can revoke the Trustee role at once.

---

## Related

- [Custody](/security/custody/). Custody accounts and the withdrawal allowance.
- [Emergency response](/security/emergency-response/). Pause, cancellation, role revocation.
- [Potential risks](/risks/). Full risk register.
