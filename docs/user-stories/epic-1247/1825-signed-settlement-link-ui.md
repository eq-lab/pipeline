# User Stories: #1825 — LP: link the settlement address by signing a challenge (Stellar + EVM)

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1825](https://github.com/eq-lab/pipeline/issues/1825)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#settlement-address), [docs/product-specs/kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md#settlement-address)

A signed-in LP links the connected wallet as a settlement address from the Account page or the account-setup modal. Nothing is sent or signed until the LP clicks a button. Use real wallets (Freighter for Stellar, MetaMask for EVM) and the staging API: the `pipeline.mock.wallet.*` mock wallets cannot sign. Set the LP's status with the Trustee tooling where a story names one. This supersedes the automatic link of [#1813](./1813-link-wallet-address.md).

---

## Story 1: No prompt on sign-in or page load

**Persona:** Signed-in LP with an LP record and no settlement address, Freighter connected.

**Steps:**

1. Sign in, then open `/account`, reload it, and connect and reconnect the wallet.

**Expected outcomes:**

- No wallet signature prompt opens at any point.
- The Network tab has no request to `/v1/lps/me/link-address/challenge` or `/verify`.
- The `Stellar settlement address` row shows `—`, `Link your connected wallet to receive bank deposits to it.` and a `Link wallet` button.

---

## Story 2: Link a Stellar wallet by button

**Persona:** Same LP, Freighter connected.

**Steps:**

1. Click `Link wallet` on the Stellar row.
2. Approve the signature in Freighter.

**Expected outcomes:**

- One `GET …/link-address/challenge?chain_id=…&address=G…`, then the Freighter prompt, then one `POST …/link-address/verify` whose body has `chain_id`, `address` and `signature` and no `signer_address`.
- The row shows the full address with `Linked to your connected wallet.` and no button.
- `GET /v1/lps/me` returns the address as `stellar_address` and `stellar_signer_address`.
- The Trustee LP profile shows the same address with its signer.

---

## Story 3: Link an EVM wallet by button

**Persona:** Signed-in LP with an LP record, MetaMask connected (no Stellar wallet).

**Steps:**

1. Click `Link wallet` on the `Ethereum settlement address` row and approve the signature in MetaMask.

**Expected outcomes:**

- The challenge and verify requests carry the lowercase `0x…` address.
- The row shows the lowercase address with `Linked to your connected wallet.`.
- `GET /v1/lps/me` returns it as `evm_address` and `evm_signer_address`.

---

## Story 4: Decline in the wallet

**Persona:** Signed-in LP, wallet connected, address not linked.

**Steps:**

1. Click `Link wallet` and reject the signature request in the wallet.

**Expected outcomes:**

- No verify request is sent and no toast appears.
- The row shows `Your wallet did not sign. Nothing was changed.` and `Link wallet` again.
- The served address is unchanged.

---

## Story 5: Change the linked wallet, with a confirmation

**Persona:** LP with a Stellar address linked, a different Stellar wallet connected. Run it at `InProgress` and again at `Passed`.

**Steps:**

1. Open `/account`: the row shows the served address, `Your connected wallet is not this address.` and `Change wallet`.
2. Click `Change wallet`, then `Cancel`.
3. Click `Change wallet` again, then `Confirm change` and approve the signature.

**Expected outcomes:**

- Step 2 opens an inline confirmation with `From` (served address) and `To` (connected address) in full; no wallet prompt and no request happen, and `Cancel` closes it.
- Step 3 opens the wallet prompt only after `Confirm change`; the row then shows the new address with `Linked to your connected wallet.`.
- The same holds at `Passed`: the address can be changed.

---

## Story 6: A stale challenge fails and Try again recovers

**Persona:** LP with no address linked, the Account page open in two tabs with the same wallet.

**Steps:**

1. In both tabs click `Link wallet` so each shows a signature request.
2. Approve tab B first, then tab A.
3. In tab A click `Try again` and approve.

**Expected outcomes:**

- Tab A shows `The signature could not be verified. Try again to sign a new request.` and no toast.
- `Try again` makes a new challenge request, and the link succeeds.

---

## Story 7: The wallet is already linked to another account

**Persona:** LP whose connected wallet is linked to another LP.

**Steps:**

1. Click `Link wallet` and approve the signature.

**Expected outcomes:**

- A danger toast shows the served message, and the LP is re-read.
- The row shows `This wallet is already linked to another account. Connect a different wallet.` with no button.

---

## Story 8: Prove a legacy unsigned address

**Persona:** LP with a Stellar address linked before signed linking (no signer), the same wallet connected. Run it at `Passed` too.

**Steps:**

1. Open `/account`: the row shows `Linked without a signature. Sign with this wallet to confirm you control it.` and `Link wallet`.
2. Click `Link wallet` and approve.

**Expected outcomes:**

- No confirmation step appears, because the address does not change.
- The row then shows `Linked to your connected wallet.` and `stellar_signer_address` is set.

---

## Story 9: LP not created yet

**Persona:** Signed-in user with no LP record and a connected wallet.

**Steps:**

1. Open the account-setup modal or `/account`.
2. Save the company details.

**Expected outcomes:**

- Before saving, the row shows `—` and `Save your company details first, then link this wallet.` with no button.
- After saving, the row offers `Link wallet`, with no prompt.

---

## Story 10: A refused LP cannot link

**Persona:** LP with KYB status `Failed`, wallet connected.

**Steps:**

1. Open `/account`.

**Expected outcomes:**

- The settlement rows show the served address, or `—`, with no caption and no button.

---

## Story 11: A wallet without message signing

**Persona:** LP connected with Albedo or Rabet (no SEP-0053).

**Steps:**

1. Click `Link wallet`.

**Expected outcomes:**

- The wallet cannot sign: no verify request is sent, no toast appears, and the row shows `Your wallet did not sign. Nothing was changed.`.

---

## Story 12: Both addresses are served

**Persona:** LP with a Stellar and an EVM settlement address linked, MetaMask connected.

**Steps:**

1. Open `/account` and the account-setup modal.

**Expected outcomes:**

- Two rows appear, `Stellar settlement address` then `Ethereum settlement address`, each with its full address.
- Only the row of the connected wallet's kind carries a button, and only when that wallet differs from the served address or the address is unproven.
