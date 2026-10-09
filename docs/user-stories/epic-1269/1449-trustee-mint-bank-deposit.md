# User Stories: #1449 — Trustee mints the PLUSD leg of an LP bank deposit

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)
Issue: [#1449](https://github.com/eq-lab/pipeline/issues/1449)
Spec: [Trustee flows](../../frontend/trustee-flows.md) · [Deposits](../../product-specs/deposits.md)

Frontend. Exercise the **Bank deposits** card on Trustee → LP Counterparties → an LP's detail page
(`/lp-counterparties/{id}`) against a live API, with `VITE_STELLAR_YIELD_MINTER_ID` set and a
Stellar wallet connected. The on-chain leg needs a signer holding `CASH_REPORTER` at execution
delay 0; without it every attempt stops at simulation (Story 6) and nothing is signed.

## Story 1: An unminted deposit offers a Mint PLUSD action

Record a deposit (Story 1 of [#1413](./1413-lp-bank-deposits.md)) and reload the LP detail page.
Its row shows `Not minted` in the PLUSD column and a `Mint PLUSD` button in the trailing **Action**
column. A row whose `is_minted` is already `true` shows `Minted` and no button at all — there is no
control to re-mint it.

## Story 2: The mint goes to the LP's linked wallet

For an LP whose `stellar_address` is set and whose `address_linked_at` is non-null, click
`Mint PLUSD`. The wallet prompts for a signature on a transaction that invokes `record_wire_in` on
the contract in `VITE_STELLAR_YIELD_MINTER_ID` — one invocation, no executor/`execute` wrapper. The
`receiver` argument is the LP's own address; the `caller` and the transaction source account are
the connected trustee wallet. Check the simulated arguments in the wallet or the Network tab: five
positional args, the amount at 7 decimals (a `$50,000.00` deposit is `500000000000`), the value
date as the deposit's `occurred_at` in Unix seconds, and the 32-byte reference hash equal to the
row's served `ref_hash`.

## Story 3: Without a linked wallet the mint goes to the capital wallet

For an LP with no linked address (`address_linked_at` null), the same click sends the mint to
`VITE_STELLAR_CAPITAL_WALLET_ID` instead — nothing else about the call changes. The USDC custody
account is never used as the receiver. With neither a linked address nor a configured capital
wallet, the button is disabled and its hint reads "This LP has no linked Stellar wallet and no
capital wallet is configured."

## Story 4: The button says why it cannot be used

Each of these disables the button and shows its reason under it, as the hover title too:
disconnect the wallet ("Connect your trustee wallet to mint PLUSD."); unset
`VITE_STELLAR_YIELD_MINTER_ID` ("On-chain PLUSD minting is not configured for this environment.");
start a mint on one row and look at another ("Another mint is in flight. Wait for it to finish.").
No disabled state ever fires a wallet prompt.

## Story 5: Submitted, then waiting for the indexer

Sign and submit. The button label moves through `Awaiting signature…`, `Submitting…` and
`Confirming…`, then the cell becomes the text `Waiting for the indexer` and the PLUSD column reads
`Pending`. The deposits list polls every ~5 s while anything is pending. `Pending` is not a claim
that the mint succeeded: the row only becomes `Minted` when the API's own `is_minted` turns true
after the worker matches the `WireIn` event on `ref_hash`. Reload the page mid-wait — the pending
state is gone (it is in-memory only) and the row reads `Not minted` again until the served flag
flips. Leave it for ~2 minutes without the flag flipping and the row returns to `Not minted` with
the button offered again.

## Story 6: Failures surface verbatim, and a replay is named

Cancel the signature in the wallet: the row returns to idle, nothing is recorded. Point the app at
a minter where the connected wallet lacks `CASH_REPORTER` and try again: the attempt stops at
simulation, no signature is requested, and the card shows an error whose "details" dialog carries
the raw contract text. Mint a deposit whose reference has already been minted on-chain: the message
reads "This deposit's reference has already been minted on-chain. Refresh the list." with the raw
`RefHashSeen` text in the details. In every failure case the PLUSD column still reflects only the
served `is_minted`.
