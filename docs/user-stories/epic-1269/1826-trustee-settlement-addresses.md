# User Stories: #1826 — Trustee sees both LP settlement addresses and mints to the right one

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)
Issue: [#1826](https://github.com/eq-lab/pipeline/issues/1826)
Spec: [Trustee flows](../../frontend/trustee-flows.md#settlement-addresses) · [Deposits](../../product-specs/deposits.md)

Frontend. Exercise Trustee → LP Counterparties and an LP's detail page (`/lp-counterparties/{id}`)
against a live API, with `VITE_STELLAR_YIELD_MINTER_ID` set and a Stellar wallet connected. LPs
link addresses from the LP app (signed linking, #1824; relink at any time, #1831).

## Story 1: The list says which addresses are linked

The **Blockchain Address Available** column reads `No` for an LP with no address, `Stellar`,
`EVM`, or `Stellar + EVM`. A Stellar address linked before signed linking existed (no signer
served) reads `Stellar (unproven)`. Nothing else in the grid changes.

## Story 2: The profile shows each address with its signer

Open an LP with a Stellar and an EVM address. LP profile has one row per address, Stellar first:
the address chip, `Signer` with its own chip, and `Linked <date, UTC>`. Click a chip to reveal and
copy the full value. A Stellar `C…` contract address shows a different `G…` signer. A legacy
address with no signer shows an amber `Unproven` chip instead of a signer. An LP with no address
shows one `Settlement address` row reading `—`.

## Story 3: A Stellar deposit mints to the LP's Stellar address

On a Stellar session, the Bank deposits card says `Mints on Stellar to …` with the receiver. For an
LP with no Stellar address it adds `· capital wallet — this LP has no Stellar settlement address`
and the receiver is `VITE_STELLAR_CAPITAL_WALLET_ID`. Click `Mint PLUSD`: a dialog reads the LP
again and shows the network, amount, payment reference and the full receiver. Confirm, sign in the
wallet, and the row goes `Pending` then `Minted` as in [#1449](./1449-trustee-mint-bank-deposit.md).

## Story 4: A relink between page load and mint is caught

Load the LP page, then have the LP relink in another session. Click `Mint PLUSD`: the dialog shows
"This LP's settlement address changed since it was last shown" with `Previously shown` and `Now
minting to`. Confirm is disabled until `Mint to the new address` is checked, and it then mints to
the new address, never the old one.

## Story 5: A relink while the dialog is open is caught

Open the dialog (no notice), have the LP relink, then click confirm. Nothing is signed: the dialog
updates to the new address with the notice and an unchecked box. Check it and confirm again: the
mint goes to the new address. A failed re-read shows "Could not re-read this LP's settlement
address. Try again." with Retry, and never mints.

## Story 6: An EVM session cannot mint yet

Sign in to the Trustee on the EVM network. The card says `Mints on Hoodi to …` with the LP's EVM
address (or the EVM capital wallet). `Mint PLUSD` is disabled with "PLUSD minting on Hoodi is not
available in the Trustee app yet." until #1501 lands, and no wallet prompt ever appears.
