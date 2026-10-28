---
title: Protocol layer
order: 11
section: How Pipeline works
---

# Protocol layer

The Protocol Layer is a set of on-chain smart contracts. PLUSD is the dollar token. sPLUSD is the share of the PLUSD staking vault. The loan registry is the public record of every loan facility. The other contracts run deposits, mints, withdrawals, defaults and access.

## Token architecture

### PLUSD

Permissioned dollar token. 1 PLUSD is a claim on 1 USD of the pool. Only addresses approved by the protocol can hold it. PLUSD moves only between approved holders.

PLUSD is minted 1:1 in two cases: a lender deposits USDC, or a lender's bank wire arrives. The minter also mints PLUSD for loan interest and protocol fees at repayment. Each minting path has a per-transaction and a 24-hour limit.

### sPLUSD

Share of the PLUSD staking vault. Any PLUSD holder can stake. Bank-wire deposits are staked for the lender on arrival. Redemption back to PLUSD is instant at the current share price.

The share price rises when loan interest or bank interest is minted into the vault. Interest is minted in one amount when a borrower repays, so the share price moves in steps.

### Debt token

Each loan has its own debt token. One token equals 1 USD of principal outstanding. The capital wallet holds the tokens frozen, and their supply follows the loan registry. Debt tokens are never money and are never counted in PLUSD.

## LoanRegistry

Every loan is one non-transferable record held by the capital wallet. It carries data fixed at origination: a hash of the borrower reference, facility size, senior and equity tranches, offtaker price, interest rate, origination and maturity dates. It also carries lifecycle state: status, amounts disbursed, repaid and written down, interest periods and each repayment's split.

Statuses: Approved, Performing, WatchList, Default, Closed. A cured default returns to WatchList.

Interest is simple interest on principal outstanding at the current rate, on a 365.25-day year. A new interest period starts on every change of principal or rate.

The loan registry is part of the pool's value. Principal outstanding counts in the pool's assets.

## Core operational contracts

| Contract | Purpose |
|---|---|
| **Deposit manager** | Lender sends USDC. The USDC goes straight to the deposit account. After screening, the relayer signs a voucher. The voucher is submitted, and PLUSD is minted 1:1 to the lender. Minimum 1,000 USDC, at most 5,000,000 per deposit and 10,000,000 per 24 hours across all lenders. |
| **Minter** | Keeps the cash book of the bank account. Mints PLUSD for bank wires in, books loan disbursements and repayments, mints interest into the vault and fees to the treasury, books wires out, USDC-to-bank conversions, bank income and charges, and reversals. |
| **Withdrawal queue** | First-in, first-out exit. Lenders escrow PLUSD and get a queue position. A claim needs a voucher signed by the relayer and enough USDC in the withdrawal account to cover the queue up to that position. The queue pays USDC from the withdrawal account through its allowance and burns the PLUSD. |
| **Security registry** | One record per security instrument behind a loan, written and confirmed by the Security Agent. Holds inspections, prices and each loan's security terms. Computes LTV and opens margin calls. |
| **Debt token factory** | Registers each loan's debt token and keeps its supply equal to principal outstanding. |
| **Pocket** | Holds a defaulted loan's share of the vault for the holders at the time of default. Pays recoveries to them and burns write-downs. |
| **Access manager** | Role hub. Every privileged call goes through it. It maps each action to a role, applies the role's delay, and lets a guardian cancel a scheduled call. |

## Recovery

When the Risk Council declares a loan in default, the loan's principal outstanding moves from the vault into the pocket for that loan. The pocket belongs to the vault holders at that moment, pro rata to their balance. Repayments and recoveries on the loan go to the pocket, and those holders claim them. A write-down burns PLUSD from the pocket. If the vault could not cover the full amount at default, the uncovered part of a write-down is recorded as an unabsorbed loss. See [Default management](/risks/default-management/).

The withdrawal queue has one more lever. The Admin can set a recovery rate below 1.0 once. From then on, every claim pays the face value times that rate. The rate cannot be changed after it is set.

## Roles

| Role | Powers | Delay |
|---|---|---|
| Admin | Grants and revokes roles, sets limits and accounts, unpauses, sets the recovery rate | None |
| Trustee | Records loans, disbursements, wires out and USDC-to-bank conversions, bank charges | None |
| Cash reporter | Records bank wires in, repayments and bank income | None |
| Risk Council | Declares default, reverses repayment entries | None |
| Risk Council | Writes down, cures, amends loan terms, reverses other entries | 24 hours |
| Security Agent | Writes and confirms security records | None |
| Inspection operator | Enters and approves inspection results | None |
| Guardian | Cancels a scheduled call of a guarded role | None |
| Pauser | Pauses a contract | None |
| Upgrader | Upgrades a contract | None |
