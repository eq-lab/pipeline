---
title: Glossary
order: 36
section: Reference
---

# Glossary

One alphabetical list of trade-finance and protocol terms.

---

## A

**Access manager** — The smart contract that holds the protocol's roles. It maps each privileged action to a role and grants roles to holders. A role holder can carry an execution delay: the action is scheduled first and runs after the delay. A role's Guardian can cancel a scheduled action before it runs.

**Accession** — How a new lender joins a facility. The new lender signs an accession deed, and the facility agent holds it. The Loan Originator and other lenders join this way.

**Admin** — The top role. Admin grants and revokes roles, sets limits and custodian accounts, unpauses contracts and sets the withdrawal recovery rate. Admin actions run with no delay. A multisig holds the role.

**Advance ratio** — The highest LTV allowed at drawdown, set per loan. A margin call must bring LTV back to this level. Default value 80 %.

**Agency deed** — The facility document that appoints the facility agent and the Security Agent and sets their duties. Each agent is liable only for gross negligence, wilful misconduct or fraud. The Majority Lenders may replace either agent.

**AIS (Automatic Identification System)** — The maritime transponder standard that broadcasts a vessel's identity, position, course and speed in real time.

---

## B

**Bill of lading (B/L)** — The carrier's document for goods shipped by sea. It is a receipt for the cargo and a document of title. In the security registry an endorsed B/L is one type of security record.

---

## C

**Capital wallet** — The protocol account that holds every loan record and every debt token. It also receives protocol fees: management and performance fees are minted as PLUSD at repayment and staked into the vault for it.

**Carve-out** — The first time a loan goes into default, the protocol moves PLUSD equal to the loan's outstanding balance from the vault into that loan's pocket. The sPLUSD holders at that moment own the pocket pro rata to their balances. What the vault cannot cover stays recorded as unabsorbed.

**Cash Reporter** — The role that books bank events on-chain: incoming bank wires, loan repayments and bank income. Its actions run with no delay.

**CMA (Collateral Management Agreement)** — A contract under which an independent inspection and custody agent (SGS, Cotecna, Intertek) takes control of physical collateral (warehoused commodity, tank-farm stock) and releases it only against documented instructions. It gives a trade-finance lender third-party confirmation that the cargo backing a loan exists and is controlled.

**Collection account** — The borrower's account that receives the buyer's payment. The Security Agent co-signs it. It carries no credit facility at the borrower's bank, so there is no set-off. A change to its signing mandate without notice to the Security Agent is an event of default.

**Commodity** — The physical good financed by a given Pipeline loan, for example jet fuel JET A-1, refined metals or agricultural products.

**Corridor** — The route the cargo travels, stated as "origin country → destination country" (e.g. "South Korea → Mongolia"). Sanctioned corridors are not financed.

**CTRM** — Commodity Trade and Risk Management system. Software a commodity trader uses to book physical trades, positions and risk.

**Cure** — A Risk Council action that moves a defaulted loan back to Watchlist. The loan's pocket stays in place.

**Cure period** — The time a borrower has after a margin call to bring LTV back to the advance ratio, with cash or goods. Set per loan.

**Custodian accounts** — The accounts that hold USDC. Smart contracts hold no USDC. A deposit goes straight to the deposit custodian. Withdrawals are paid from the withdrawal custodian through an allowance it grants to the withdrawal queue. Each custodian account is a multisig account.

---

## D

**Debt token** — One token per loan. One token equals one dollar of principal outstanding on that loan. The capital wallet holds it frozen, and it follows the loan registry. It is a record of the loan. It is not money and does not trade.

**Default** — A loan status set by the Risk Council. The action runs at once. The first default of a loan triggers the carve-out.

**Deposit manager** — The smart contract for USDC deposits. A lender sends USDC; it goes straight to the deposit custodian and a deposit request is recorded. The backend screens the deposit and signs a voucher. With the voucher, PLUSD is minted 1:1 to the lender. Limits: minimum 1,000 USDC, 5,000,000 per deposit, 10,000,000 per 24 hours across all lenders.

**Deposit request** — The record of one USDC deposit: lender, amount, time and whether it has been claimed. A request is claimed once, with a valid voucher. There is no refund path in the contract.

---

## E

**Equity tranche** — Junior slice of a commodity loan, funded by the Originator. The loan registry records its size. The protocol does not enforce the loss order between tranches.

---

## F

**Facility** — A single trade-finance loan, typically tied to one offtake contract for one cargo. Every facility has one record in the loan registry.

**Facility agent** — The agent appointed under the agency deed. It reviews drawdown requests, keeps the loan register, applies the priority of payments and records payments, accessions and transfer certificates. It executes grace, extensions, margin calls and the call of the loan on lender instruction.

**Facility size** — The total committed loan amount at origination. The loan registry records it with its split into the senior tranche (lender capital) and the equity tranche (originator capital).

**First-loss** — The tranche that absorbs realised losses before any other capital is hit. On Pipeline, the originator's equity tranche is first-loss on every loan.

---

## G

**Guardian** — The role that can cancel scheduled actions of the operational roles before they run. It cannot pause, unpause, grant or revoke roles.

---

## H

**Handover** — In the security registry, one step that makes a new security record active and releases the old one. Example: the cargo leaves the ship for a warehouse, and the warehouse pledge replaces the bill of lading.

---

## I

**Inspection** — An independent weight or quality check by an inspection company appointed by the lending vehicle. One Inspection Operator enters it and a second one approves it. The protocol computes the variance against the paper quantity and against the previous inspection. A variance above tolerance flags the record, and the Risk Council resolves the flag.

**Inspection Operator** — The role that enters and approves inspections in the security registry. It is held by the lending vehicle. It never writes security records.

**Interest** — Simple interest on outstanding principal at the loan's rate, on a 365.25-day year. A new interest period starts each time the outstanding amount or the rate changes. When a repayment is booked, the interest is minted as PLUSD into the vault and the sPLUSD price steps up. There is no daily minting. The platform bills accrued interest each month, and the borrower pays it as a repayment with zero principal.

---

## K

**KYB (Know Your Business)** — Verification of a legal entity: ownership, control and sanctions. Every counterparty passes KYB: lenders, Originators, borrowers and every other party to a facility.

**KYT (Know Your Transaction)** — Compliance screening of an address against sanctions and risk lists, and of a payment for source-of-funds risk. Every counterparty passes KYT. The backend screens an address before whitelisting it and screens each deposit before signing its voucher.

---

## L

**Lending vehicle** — The bankruptcy-remote company that is the initial lender under the MFA. It holds the senior share of each facility and appoints the inspection companies. Pipeline's Trustee runs it and its operations.

**Letter of credit** — A bank instrument under which an issuing bank undertakes to pay the seller once stated shipping and document conditions are met. A classical trade-finance payment mechanism. Pipeline finances the seller's working capital against the underlying trade. It does not finance the letter of credit itself.

**Loan registry** — The smart contract that records each loan as one non-transferable record held by the capital wallet. Fixed at origination: borrower reference, facility size, senior and equity tranches, offtaker price, interest rate, origination and maturity dates. Updated over the loan's life: status, amounts disbursed, repaid and written down, interest periods and repayments. Outstanding principal in the registry counts toward the pool's assets.

**Loan Originator** — Independent commodity trading house, merchant or specialist trade-finance shop that sources deals, underwrites them and contributes the equity tranche on every loan it brings to Pipeline. It joins a facility as a lender by accession.

**Loan status** — Approved, Performing, Watchlist, Default, Closed. A loan becomes Performing at its first disbursement. A cured default returns to Watchlist.

**LTV (Loan-to-Value)** — Outstanding principal plus accrued interest, divided by the value of the loan's active security. Goods count at counted quantity times market price. Cash, receivables, letter-of-credit proceeds and prepayments count at face. Insurance never counts. The platform feeds market prices on-chain.

---

## M

**Majority Lenders** — Lenders holding the MFA threshold of commitments. They decide grace, extensions, default, the call of the loan, enforcement, write-downs, inspection flags, price overrides and the replacement of either agent. Changes to economics and release of security outside its release condition need all lenders. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders.

**Margin call** — Opened when LTV rises above the margin-call ratio (default 85 %). Cured when LTV is back at or below the advance ratio (default 80 %) within the cure period. A stale price blocks a margin call. There is no automatic default at the end of the cure period.

**MFA (master facility agreement)** — The agreement between the borrower and the lenders for a facility. It sets the lenders' decisions, the priority of payments and the conditions for each drawdown.

**Mint limits** — Caps on new PLUSD per entry and per 24 hours. Deposit manager: 5,000,000 per deposit, 10,000,000 per 24 hours. Minter: 1,000,000 per entry, 10,000,000 per 24 hours, counting bank wires in, interest and fees.

**Minter** — The smart contract that keeps the protocol's cash book. It makes every PLUSD mint other than USDC deposits: bank wires in, interest and fees on repayment, bank income. It also books loan disbursements, bank wires out, USDC-bank ramps, expenses and reversals.

**MOPS** — Mean of Platts Singapore. Benchmark price assessment used for refined-products pricing.

---

## O

**Offtake contract** — A commercial agreement under which the Offtaker commits to buy a specified cargo at a stated price and schedule. Pipeline typically originates one facility per offtake contract and records the offtaker price in the loan registry.

**Offtaker** — The end buyer of the physical commodity in a trade-finance deal. The offtaker pays in USD to the bank account. The Cash Reporter books the payment on-chain as a repayment. The offtaker never touches USDC or the chain.

**Originator** — Short for Loan Originator.

---

## P

**Pauser** — The role that stops a contract at once in an emergency. Seven contracts can be paused; the access manager and the debt token factory cannot. Only Admin unpauses.

**Platts / Argus** — Independent commodity price-assessment providers: Platts (S&P Global) and Argus.

**PLUSD** — Pipeline's dollar token. 1 PLUSD = 1 USD of claim on the pool. Minted 1:1 for USDC deposits and for bank wires in, and for interest and fees when a repayment is booked. Only whitelisted addresses can hold it. Burned when a withdrawal is paid.

**Pocket** — A holding account opened for each defaulted loan. It holds the PLUSD carved out of the vault for the sPLUSD holders at the moment of default. Recoveries on the loan go into the pocket, and those holders claim them pro rata. A write-down burns PLUSD from the pocket.

**Priority of payments** — The order in which a facility's payments and enforcement proceeds are applied: agent costs, then lenders by class, then any surplus to the borrower.

---

## R

**Ramp** — A conversion between USDC and USD at the bank, booked on-chain by the Trustee. A shortfall on a ramp is booked as an expense and taken from the vault.

**Recovery rate** — A rate below 1 that Admin may set once on the withdrawal queue. Queued withdrawals are then paid in USDC at that rate. It cannot be changed after it is set.

**Relayer** — Pipeline's off-chain backend service. It screens addresses and deposits, whitelists approved addresses, signs deposit and withdrawal vouchers and matches bank wires to on-chain records. It cannot mint PLUSD on its own.

**Repayment waterfall** — The split of an offtaker payment, recorded per repayment: senior principal, senior interest, equity distributed, management fee, performance fee. Fees are capped at 50 % of interest plus fees. Interest goes to the vault. Fees go to the capital wallet as sPLUSD.

**Risk Council** — The role for loan risk actions: default, write-down, cure, interest adjustment, changes to loan terms including extensions, closing a defaulted loan, and reversals and corrections of cash records. Default and the reversal of a repayment run at once. Its other actions run 24 hours after they are scheduled. In the security registry it resolves inspection flags and may set a manual price. A multisig of several people holds the role. While Pipeline is the only lender, it acts for the Majority Lenders. Loan approval runs off-chain.

---

## S

**Security Agent** — The independent security trustee appointed under the agency deed. It holds the security on trust for all lenders by the priority of payments. Bills of lading are endorsed to it by way of pledge. It is loss payee on cargo and trade credit insurance and co-signs the collection account. In the security registry it writes the security records and attests them.

**Security registry** — The smart contract that records the security behind each loan, one record per security instrument: bill of lading, warehouse pledge, CMA, receivable, letter-of-credit proceeds, cash cover, prepayment, insurance. Only active records count toward LTV. There is no haircut. A facility is funded only where the lenders' security ranks first, confirmed by a local legal opinion.

**Senior tranche** — The senior slice of a commodity loan, funded by Pipeline lenders through the sPLUSD vault. Earns the senior interest rate. Paid before the equity tranche.

**Signed voucher** — The backend's signature that releases a deposit or a withdrawal. It names the request, the lender, the amount and a deadline. A voucher works once.

**Split-rail** — Pipeline keeps cash and tokens apart. USDC sits in custodian accounts and USD in the bank. Smart contracts hold no USDC. They record loans and cash, and mint and burn PLUSD.

**sPLUSD** — Staked Pipeline USD, the share of the staking vault over PLUSD. A lender stakes PLUSD and receives sPLUSD. Unstaking returns PLUSD at the current share price at once. The share price rises when interest or bank income is minted into the vault. It falls when the vault absorbs a loss, an expense or a carve-out. The vault keeps each holder's balance history to fix who owns a pocket at default. sPLUSD transfers are not limited to whitelisted addresses.

**Stale price** — A market price older than the allowed age. A stale price blocks a margin call.

---

## T

**Tranche** — A slice of a loan with a defined priority in the repayment waterfall. Pipeline's facilities have a senior tranche (lender capital, paid first) and an equity tranche (originator first-loss, paid last).

**Transfer certificate** — How a lender takes over an existing share of a facility. The transferor and the transferee sign it, and the facility agent holds it.

**Treasury** — See Capital wallet. Fees go to the capital wallet.

**Trustee** — Pipeline's Trustee. It runs the lending vehicle and its operations from the trustee console.

**Trustee (role)** — The role for loan operations: draw a loan, disburse, update, roll over and close a loan, register its debt token, assign or return incoming wires, settle or cancel wires out, open and close ramps, book expenses. Its actions run with no delay.

---

## U

**Upgrader** — The role that replaces the code of a protocol contract.

**USDC** — The stablecoin lenders deposit and withdraw.

---

## W

**Watchlist** — A loan status between Performing and Default. A cured default returns to Watchlist.

**Whitelist** — The set of addresses approved to hold PLUSD. Whitelist Admin approves an address after KYT screening. PLUSD can move only between whitelisted addresses.

**Whitelist Admin** — The role that approves addresses to hold PLUSD.

**Withdrawal queue** — The smart contract for USDC withdrawals. A lender escrows PLUSD and joins the queue in order. A request can be claimed once the withdrawal custodian holds enough USDC to cover the queue up to it, and the backend has signed its voucher. The claim pays USDC from the withdrawal custodian and burns the PLUSD.

**Write-down** — A Risk Council action that writes off part of a defaulted loan's outstanding balance. It burns PLUSD from the loan's pocket. The part the pocket does not hold is recorded as unabsorbed. No cash moves.
