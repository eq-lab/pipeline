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

**Accession** — How a new lender joins a facility. The new lender signs an accession deed, and the Facility Agent holds it. The Loan Originator and other lenders join this way.

**Admin** — The top role. Admin grants and revokes roles, sets limits and custodian accounts, unpauses contracts and sets the withdrawal recovery rate. Admin actions run with no delay. A multisig holds the role.

**Advance ratio** — The highest LTV allowed at drawdown, set per loan. A margin call must bring LTV back to this level. Capped by commodity class at 80 %, 75 % or 65 %, and at least 10 points lower for open-account sales.

**Agency deed** — The facility document that appoints the Facility Agent and the Security Agent and sets their duties. Each agent is liable only for gross negligence, wilful misconduct or fraud. The Majority Lenders may replace either agent.

**AIS (Automatic Identification System)** — The maritime transponder standard that broadcasts a vessel's identity, position, course and speed in real time.

---

## B

**Bill of lading (B/L)** — The carrier's document for goods shipped by sea. It is a receipt for the cargo and a document of title. In the security registry an endorsed B/L is one type of security record.

---

## C

**Capital wallet** — The protocol account that receives Pipeline's performance fee, minted as PLUSD when interest is booked and staked into the vault for it.

**Carve-out** — The first time a loan goes into default, the protocol moves PLUSD equal to the pool's share of the loan's outstanding balance from the vault into that loan's pocket. The sPLUSD holders at that moment own the pocket pro rata to their balances. What the vault cannot cover stays recorded as unabsorbed.

**Cash Reporter** — The role that books bank events on-chain: incoming bank wires, interest, loan repayments and bank income. Its actions run with no delay.

**CMA (Collateral Management Agreement)** — A contract under which an independent collateral manager takes control of physical collateral (warehoused commodity, tank-farm stock) and releases it only against documented instructions. It gives a trade-finance lender third-party confirmation that the cargo backing a loan exists and is controlled.

**Co-lending** — The Originator lends in every facility it originates, pari passu with the lending vehicle: same rate, same security, losses shared by each lender's share. Its minimum share is 5 %, 10 % or 20 % by deal score.

**Collection account** — The borrower's account, at an investment-grade bank, that receives every drawdown and the buyer's payment. It is charged to the Security Agent, which co-signs it. The bank gives the borrower no credit facility and waives set-off. A standing instruction pays receipts to the lending vehicle. A change of mandate or a diverted payment is an event of default.

**Commodity** — The physical good financed by a given Pipeline loan, for example jet fuel JET A-1, refined metals or agricultural products.

**Corridor** — The route the cargo travels, stated as "origin country → destination country" (e.g. "South Korea → Mongolia"). Sanctioned corridors are not financed.

**CTRM** — Commodity Trade and Risk Management system. Software a commodity trader uses to book physical trades, positions and risk.

**Cure** — A Risk Council action that moves a defaulted loan back to Watchlist. The loan's pocket stays in place.

**Cure period** — The time a borrower has after a margin call to bring LTV back to the advance ratio: 3 business days, in cash or by partial repayment.

**Custodian accounts** — The accounts that hold USDC. Smart contracts hold no USDC. A deposit goes straight to the deposit custodian. Withdrawals are paid from the withdrawal custodian through an allowance it grants to the withdrawal queue. Each custodian account is an MPC wallet with a 3-of-5 quorum, in which the Independent Trustee holds a mandatory key.

---

## D

**Debt token** — One token per loan. One token equals one dollar of principal outstanding on that loan. The capital wallet holds it frozen, and it follows the loan registry. It is a record of the loan. It is not money and does not trade.

**Default** — A loan status set by the Risk Council. The action runs at once. The first default of a loan triggers the carve-out.

**Deposit manager** — The smart contract for USDC deposits. A lender sends USDC; it goes straight to the deposit custodian and a deposit request is recorded. The backend screens the deposit and signs a voucher. With the voucher, PLUSD is minted 1:1 to the lender. Limits: minimum 1,000 USDC, 5,000,000 per deposit, 10,000,000 per 24 hours across all lenders.

**Deposit request** — The record of one USDC deposit: lender, amount, time and whether it has been claimed. A request is claimed once, with a valid voucher. There is no refund path in the contract.

---

## F

**Facility** — A single trade-finance loan, typically tied to one offtake contract for one cargo. Every facility has one record in the loan registry.

**Facility Agent** — Pipeline, appointed under the agency deed. It reviews drawdown requests, keeps the facility records, applies receipts to the lenders by share, mostly through automated protocol functions, and records payments, accessions and transfer certificates. It executes grace, extensions, margin calls and the call of the loan on lender instruction.

**Facility size** — The total committed loan amount at approval. The loan registry records it with each lender's share: the lending vehicle's, for the pool, and the Originator's.

**Funding vehicle** — The company, wholly owned by the lending vehicle, that borrows USDC from lenders under limited-recourse loan agreements, keeps the liquidity buffer and lends the rest to the lending vehicle.

---

## G

**Guardian** — The role that can cancel scheduled actions of the operational roles before they run. It cannot pause, unpause, grant or revoke roles.

---

## H

**Handover** — In the security registry, one step that makes a new security record active and releases the old one. Example: the cargo leaves the ship for a warehouse, and the warehouse pledge replaces the bill of lading.

---

## I

**Independent Trustee** — The licensed trust company that holds a mandatory key on every custody account, co-signs every payment out of the lending vehicle's and the funding vehicle's accounts, approves every drawdown, and signs on-chain through the Trustee role. Withdrawals paid automatically from the buffer are exempt from its co-signature. It holds no security and does not verify trades.

**Inspection** — An independent weight or quality check. The borrower appoints and pays an inspector from Pipeline's panel for each trade, and the inspector writes its reports into the security registry. Pipeline may also inspect at any time. The protocol computes the variance against the paper quantity and against the previous inspection. A variance above tolerance flags the record, and the Risk Council resolves the flag.

**Inspection Operator** — The role that enters and approves inspections in the security registry. It is held by the lending vehicle. It never writes security records.

**Interest** — Simple interest on outstanding principal at the loan's rate, on a 365.25-day year. A new interest period starts each time the outstanding amount or the rate changes. The platform invoices accrued interest monthly in arrears, and the borrower pays it separately from principal. When it is booked, the pool's interest, net of fees, is minted as PLUSD into the vault and the sPLUSD price steps up. There is no daily minting.

---

## K

**KYB (Know Your Business)** — Verification of a legal entity: ownership, control and sanctions. Originators, borrowers and every other party to a facility pass KYB, as do entities that wire USD to lend.

**KYC (Know Your Customer)** — Verification of an individual's identity. Individuals who wire USD to lend pass KYC.

**KYT (Know Your Transaction)** — Compliance screening of an address against sanctions and risk lists, and of a payment for source-of-funds risk. Every lender address, deposit and withdrawal request passes KYT; for USDC lenders it is the only check. Originators pass KYT too. The backend screens an address before whitelisting it and screens each deposit before signing its voucher.

---

## L

**Lending vehicle** — The bankruptcy-remote company, owned by a charitable trust, that lends pool capital in every facility under the MFA, pari passu with the Originator. An independent director approves each facility after the Risk Council.

**Letter of credit** — A bank instrument under which an issuing bank undertakes to pay the seller once stated shipping and document conditions are met. A classical trade-finance payment mechanism. Pipeline finances the seller's working capital against the underlying trade. It does not finance the letter of credit itself.

**Liquidity buffer** — 10–15 % of the pool kept in USDC in the withdrawal custodian account, so retail withdrawals can be paid at once.

**Loan Originator** — An established commodity trade finance lender, such as a private credit fund, that sources deals, underwrites them and lends at least 5–20 % of every facility it brings, on the same terms as the pool. It joins a facility as a lender by accession.

**Loan registry** — The smart contract that records each facility, added by the Risk Council on approval. Fixed at approval: borrower reference, facility size, each lender's share, offtaker price, interest rate, approval and maturity dates. Updated over the facility's life: status, amounts drawn, repaid and written down, interest periods and each repayment's split by lender. The pool's share of principal outstanding counts toward the pool's assets.

**Loan status** — Approved, Performing, Watchlist, Default, Closed. A facility starts as Approved when the Risk Council adds it to the loan registry. A loan becomes Performing at its first drawdown. A cured default returns to Watchlist.

**LTV (Loan-to-Value)** — Outstanding principal plus accrued interest, divided by the value of the loan's active security. Goods count at counted quantity times market price. Cash, receivables, letter-of-credit proceeds and prepayments count at face. Insurance never counts. The platform feeds market prices on-chain.

---

## M

**Majority Lenders** — Lenders holding the MFA threshold of commitments. They decide grace, extensions, default, the call of the loan, enforcement, write-downs, inspection flags, price overrides and the replacement of either agent. Changes to economics and release of security outside its release condition need all lenders.

**Margin call** — Opened when LTV rises 5 points above the advance ratio. Cured when LTV is back at or below the advance ratio within 3 business days. A stale price blocks a margin call. An uncured margin call is an event of default, which the Risk Council declares.

**MFA (master facility agreement)** — The agreement between the borrower and the lenders for a facility. It sets the lenders' decisions, the priority of payments and the conditions for each drawdown.

**Mint limits** — Caps on new PLUSD per entry and per 24 hours. Deposit manager: 5,000,000 per deposit, 10,000,000 per 24 hours. Minter: 1,000,000 per entry, 10,000,000 per 24 hours, counting bank wires in, interest and fees.

**Minter** — The smart contract that keeps the protocol's cash book. It makes every PLUSD mint other than USDC deposits: bank wires in, interest and fees when interest is booked, bank income. It also books drawdowns, bank wires out, USDC-bank ramps, expenses and reversals.

**MOPS** — Mean of Platts Singapore. Benchmark price assessment used for refined-products pricing.

---

## O

**Offtake contract** — A commercial agreement under which the Offtaker commits to buy a specified cargo at a stated price and schedule. Pipeline typically originates one facility per offtake contract and records the offtaker price in the loan registry.

**Offtaker** — The end buyer of the physical commodity in a trade-finance deal. The offtaker pays in USD into the borrower's collection account, from where receipts pass to the lending vehicle. The Cash Reporter books the payment on-chain as a repayment. The offtaker never touches USDC or the chain.

**Originator** — Short for Loan Originator.

---

## P

**Pauser** — The role that stops a contract at once in an emergency. Seven contracts can be paused; the access manager and the debt token factory cannot. Only Admin unpauses.

**Platts / Argus** — Independent commodity price-assessment providers: Platts (S&P Global) and Argus.

**PLUSD** — Pipeline's dollar token. 1 PLUSD = 1 USD of claim on the pool. Minted 1:1 for USDC deposits and for bank wires in, and for interest and fees when interest is booked. Only whitelisted addresses can hold it. Burned when a withdrawal is paid.

**Pocket** — A holding account opened for each defaulted loan. It holds the pool's share of the loan in PLUSD, carved out of the vault for the sPLUSD holders at the moment of default. Recoveries on the loan go into the pocket, and those holders claim them pro rata. A write-down burns PLUSD from the pocket.

**Priority of payments** — The order in which a facility's recoveries are applied: enforcement and recovery costs, then principal to all lenders pro rata, then interest pro rata, then protocol fees accrued up to the default date, then any surplus to the borrower.

---

## Q

**Quarterly withdrawal window** — The dates on which withdrawals above the retail cap are paid.

---

## R

**Ramp** — A conversion between USDC and USD at the bank, booked on-chain by the Trustee role. A shortfall on a ramp is booked as an expense and taken from the vault.

**Recovery rate** — A rate below 1 that Admin may set once on the withdrawal queue. Queued withdrawals are then paid in USDC at that rate. It cannot be changed after it is set.

**Relayer** — Pipeline's off-chain backend service. It screens addresses, deposits and withdrawal requests, whitelists approved addresses, signs deposit and withdrawal vouchers and matches bank wires to on-chain records. It cannot mint PLUSD on its own.

**Repayment waterfall** — The split of each payment, recorded in the loan registry: principal and interest by lender share, the Originator's servicing fee where the facility terms provide one, and Pipeline's performance fee. Fees are capped at 50 % of interest plus fees. The pool's interest, net of fees, goes to the vault. Pipeline's fee goes to the capital wallet as sPLUSD.

**Retail withdrawal** — A withdrawal up to the retail cap, paid at once from the liquidity buffer once screened.

**Risk Council** — The body of three voting members that approves every facility and adds it to the loan registry, and the role for loan risk actions: approval, default, write-down, cure, interest adjustment, changes to loan terms including extensions, closing a defaulted loan, and reversals and corrections of cash records. Approval, default and the reversal of a repayment run at once. Its other actions run 24 hours after they are scheduled. In the security registry it resolves inspection flags and may set a manual price. Its members hold the role through the Risk Council Multisig.

---

## S

**Security Agent** — The independent security trustee appointed under the agency deed, independent of Pipeline and of every Originator. It holds the security on trust for all lenders by the priority of payments. Bills of lading are endorsed to it by way of pledge. It is loss payee on cargo and trade credit insurance and co-signs the collection account. In the security registry it writes the security records and attests them.

**Security registry** — The smart contract that records the security behind each loan, one record per security instrument: bill of lading, warehouse pledge, CMA, receivable, letter-of-credit proceeds, cash cover, prepayment, insurance. Only active records count toward LTV. There is no haircut. A facility is funded only where the lenders' security ranks first, confirmed by a local legal opinion.

**Signed voucher** — The backend's signature that releases a deposit or a withdrawal. It names the request, the lender, the amount and a deadline. A voucher works once.

**Split-rail** — Pipeline keeps cash and tokens apart. USDC sits in custodian accounts and USD in the bank. Smart contracts hold no USDC. They record loans and cash, and mint and burn PLUSD.

**sPLUSD** — Staked Pipeline USD, the share of the staking vault over PLUSD. A lender stakes PLUSD and receives sPLUSD. Unstaking returns PLUSD at the current share price at once. The share price rises when interest or bank income is minted into the vault. It falls when the vault absorbs a loss, an expense or a carve-out. The vault keeps each holder's balance history to fix who owns a pocket at default. sPLUSD transfers are not limited to whitelisted addresses.

**Stale price** — A market price older than the allowed age. A stale price blocks a margin call.

---

## T

**Transfer certificate** — How a lender takes over an existing share of a facility. The transferor and the transferee sign it, and the Facility Agent holds it.

**Treasury** — See Capital wallet. Fees go to the capital wallet.

**Trustee** — See Independent Trustee.

**Trustee (role)** — The role for facility operations, held by the Independent Trustee: record drawdowns, update, roll over and close a facility, register its debt token, assign or return incoming wires, settle or cancel wires out, open and close ramps, book expenses. Its actions run with no delay.

---

## U

**Upgrader** — The role that replaces the code of a protocol contract.

**USDC** — The stablecoin lenders deposit and withdraw.

---

## W

**Watchlist** — A loan status between Performing and Default. A cured default returns to Watchlist.

**Whitelist** — The set of addresses approved to hold PLUSD. Whitelist Admin approves an address after KYT screening. PLUSD can move only between whitelisted addresses.

**Whitelist Admin** — The role that approves addresses to hold PLUSD.

**Withdrawal queue** — The smart contract for USDC withdrawals. A lender escrows PLUSD and joins the queue. Once the backend has signed its voucher, a retail request is paid from the liquidity buffer; when the buffer runs short, requests are paid in order. Larger withdrawals are paid at the quarterly windows. The claim pays USDC from the withdrawal custodian and burns the PLUSD.

**Write-down** — A Risk Council action that writes off part of a defaulted loan's outstanding balance. It burns PLUSD from the loan's pocket. The part the pocket does not hold is recorded as unabsorbed. No cash moves.
