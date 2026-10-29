---
title: Smart contracts overview
order: 21
section: Technical overview
---

# Smart contracts overview

Every Protocol Layer contract: purpose, key rules, role gates.

## Contract reference

| Contract | Purpose | Key rules |
|---|---|---|
| **PLUSD** | Dollar token. 1 PLUSD = 1 USD of claim on the pool | Only addresses approved by the issuer can hold it. Minted only by the deposit manager and the minter. |
| **sPLUSD** | Staking vault share over PLUSD | Share price rises when loan interest is minted into the vault. It falls when a defaulted loan's outstanding is moved to its pocket, or when a loss is absorbed. Keeps per-holder balance history for default snapshots. |
| **Loan registry** | One non-transferable record per loan, held by the capital account | Origination terms fixed at creation: facility size, senior and equity tranche, offtaker price, rate, dates. Records status, disbursements, repayments, write-downs, interest periods and the repayment split. Simple interest on outstanding principal. Fees capped at 50 % of interest plus fees. |
| **Security registry** | Collateral for each loan | One record per security instrument, written and attested by the Security Agent. Records hold no value. Inspections are entered by one operator and approved by another; the contract computes variances. Computes LTV and opens margin calls. No haircut. |
| **Debt token factory** | One debt token per loan | 1 debt token = 1 USD of principal outstanding. Held by the capital account. Kept in line with the loan registry. Never money. |
| **Deposit manager** | USDC deposit | USDC goes straight to the deposit custody account. PLUSD is minted 1:1 to the lender after the backend signs a single-use voucher. Minimum 1,000 USDC; 5,000,000 per deposit; 10,000,000 per 24 hours. |
| **Withdrawal queue** | First-in, first-out exit | The lender escrows PLUSD. A claim needs a backend voucher and enough USDC in the withdrawal custody account to cover the queue up to that request. Pays USDC from that account through its allowance and burns the PLUSD. Can carry one recovery rate below 1, set once. |
| **Minter** | Cash book and PLUSD mints for bank wires, interest, fees and bank income | Books bank wires in (mints PLUSD 1:1 and stakes it for the lender), loan disbursements, repayments (interest to the vault, fees to the capital wallet as sPLUSD shares), wire-outs, USDC-to-bank ramps, bank income and charges, and their reversals. Each bank reference is single-use. Limits on PLUSD minted for wires in, interest, fees and bank income: 1,000,000 per transaction and 10,000,000 per 24 hours. |
| **Pocket** | Defaulted loans | Holds a defaulted loan's PLUSD for the sPLUSD holders at the moment of default. Releases recoveries for them to claim. Burns write-downs. |
| **Access manager** | Role hub | Maps every privileged action to one role. Grants roles with an execution delay. Schedules and executes delayed calls. A role's guardian can cancel its scheduled calls. |

## Privileged role catalogue

| Role | Holder | Capability |
|---|---|---|
| **Minter role** | Deposit manager and minter contracts | Mint PLUSD. Contract-held; no human key. |
| **Whitelist Admin** | Backend key and Admin | Approve addresses to hold PLUSD. |
| **Trustee** | Pipeline's Trustee | Record and service loans: drawdown, status between Performing and WatchList, rollover, closing. Register debt tokens. Book disbursements, wire-outs, ramps and expenses. |
| **Cash Reporter** | 2-of-2 multisig | Book bank wires in, loan repayments and bank income. Runs with no delay. |
| **Risk Council** | Multisig of several people | Declare default, write down, cure, close defaulted loans, amend rate and maturity, adjust interest, reverse disbursements and repayments, correct the cash book. Resolve inspection flags and set a manual price. Default and the reversal of a repayment run at once. Other actions run after a 24-hour delay. Acts for the Majority Lenders while Pipeline is the only lender. |
| **Pauser** | Multisig | Pause each pausable contract. |
| **Upgrader** | Multisig | Upgrade contracts. |
| **Guardian** | Multisig | Cancel scheduled calls of the roles above. |
| **Admin** | Multisig | Every action not mapped to another role: grant and revoke roles, unpause, set custody accounts, voucher key, limits, the fee recipient (the capital wallet) and recovery rate. No delay. |
| **Security Agent** | The Security Agent | Write and attest security records, handovers and releases. |
| **Inspection Operator** | The lending vehicle, two-person entry | Enter and approve inspection results. |
