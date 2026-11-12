# User Stories: #1901 — Account wallet card: Connect Wallet continues into linking the settlement address

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1901](https://github.com/eq-lab/pipeline/issues/1901)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md) (Settlement address, "Connect then link")

Pre-condition for every story: signed-in LP on `/account` with no wallet connected, a wallet extension available for the
chain under test.

---

## Story 1: Connect Wallet continues into the signed link

**Steps:**

1. On the wallet card click **Connect Wallet**, pick a wallet, approve the connection.
2. Approve the signature request.

**Expected outcomes:**

- With no settlement address served for the chain, the settlement row moves to the signing state without clicking
  `Link wallet`, then shows the connected address as the proven settlement address.
- The wallet signature prompt appears once.

---

## Story 2: The served address equals the connected wallet

**Steps:** With that wallet's address already linked and proven, click Connect Wallet and connect it.

**Expected outcomes:** No signature prompt and no challenge request; the row shows the address as it was.

---

## Story 3: The served address differs

**Steps:** With a different address linked, click Connect Wallet and connect another wallet.

**Expected outcomes:**

- The settlement row shows the Change confirmation; no signature prompt yet.
- Cancel leaves the served address unchanged; Confirm change then asks for a signature and links the new address.

---

## Story 4: Declined signature

**Steps:** Click Connect Wallet, connect, reject the signature request.

**Expected outcomes:** The row shows the declined state with `Try again`; the wallet stays connected; `Try again` asks
for a new signature request.

---

## Story 5: KYB Failed

**Steps:** As an LP whose KYB is `Failed` (if the session is still allowed), click Connect Wallet and connect.

**Expected outcomes:** No signature prompt and no link request.

---

## Story 6: Dismissing the connect modal drops the intent

**Steps:**

1. Click Connect Wallet, then close the modal with the x button or Escape.
2. Connect a wallet from the header Connect button.

**Expected outcomes:** No signature prompt; the settlement row offers `Link wallet` as a click.

---

## Story 7: A wallet connected elsewhere never prompts

**Steps:** On `/account` connect a wallet from the header, or reload with a wallet that auto-reconnects.

**Expected outcomes:** No signature prompt; linking happens only from `Link wallet` / `Try again` / `Confirm change`.
