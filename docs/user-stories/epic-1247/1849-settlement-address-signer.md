# User Stories: #1849 — LP: link a Stellar C… contract address or a separate signer as the settlement address

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1849](https://github.com/eq-lab/pipeline/issues/1849)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#settlement-address), [docs/product-specs/kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md#settlement-address)

An LP can opt in, on each settlement row, to link a settlement address that is not the connected wallet: the connected wallet signs as the signer. The connected-wallet path of [#1825](./1825-signed-settlement-link-ui.md) stays the default. Use real wallets (Freighter for Stellar, MetaMask for EVM) and the staging API: the `pipeline.mock.wallet.*` mock wallets cannot sign. The signer is always the connected wallet; to use another signer, connect that wallet.

---

## Story 1: Link a Stellar C… contract address with the connected G… wallet as signer

**Persona:** Signed-in LP with an LP record (not `Failed`), no Stellar address linked, Freighter connected.

**Steps:**

1. Open `/account`. Under the Stellar row's caption click `Use a different address`.
2. Type a valid `C…` contract address into `New settlement address` and click `Link address`. Approve the signature in Freighter.

**Expected outcomes:**

- The form shows the connected wallet as a read-only `Signer G…` line and the hint `Your connected wallet signs to link this address.`; no `Current` line appears.
- One `GET …/link-address/challenge?chain_id=…&address=C…&signer_address=G…`, then the Freighter prompt, then one `POST …/link-address/verify` whose body has `chain_id`, `address`, `signer_address` and `signature`.
- The row shows the `C…` address, a `Signer G…` line, and `Linked. Your connected wallet is the signer of this address.` with no `Change wallet` button.
- `GET /v1/lps/me` returns the `C…` as `stellar_address` and the `G…` as `stellar_signer_address`.

---

## Story 2: Link another Stellar G… address (multisig) with the connected wallet as signer

**Persona:** Same LP, Freighter connected, a second `G…` account the LP does not hold connected.

**Steps:**

1. Click `Use a different address`, type the other `G…` address (lowercase is accepted), click `Link address`, and approve.

**Expected outcomes:**

- The typed address is sent uppercased in the challenge and verify requests, with `signer_address` set to the connected `G…`.
- The row shows the typed address and the `Signer` line; `GET /v1/lps/me` returns both.

---

## Story 3: Link an EVM Safe or other 0x address with an owner EOA signer

**Persona:** Signed-in LP with an LP record, MetaMask connected with an EOA that owns a Safe (or any second `0x…` address as the target).

**Steps:**

1. Click `Use a different address` on the `Ethereum settlement address` row, type the Safe address and click `Link address`. Approve in MetaMask.

**Expected outcomes:**

- The challenge and verify requests carry the address exactly as typed (trimmed) and `signer_address` as the lowercase connected EOA.
- The row shows the stored (lowercase) address and a `Signer 0x…` line.
- Connecting the Safe itself through WalletConnect (a smart-wallet signature) ends on `The signature could not be verified. Try again to sign a new request.`; connect an owner EOA instead.

---

## Story 4: Invalid input is caught before any request

**Persona:** LP with the form open on each row kind.

**Steps:**

1. On the Stellar row type `GABC`, then tab out of the field. Edit it, then click `Link address` with it still invalid.
2. On the EVM row type `0x123` and tab out.
3. Clear the field.

**Expected outcomes:**

- Stellar shows `Enter a Stellar address: G… or C…, 56 characters.`; EVM shows `Enter an Ethereum address: 0x followed by 40 hexadecimal characters.`; the field is marked invalid and the message clears while editing.
- No request reaches the Network tab and no wallet prompt opens.
- `Link address` is disabled while the field is empty.

---

## Story 5: An address held by another LP keeps the form open

**Persona:** LP whose typed address is already linked to another LP.

**Steps:**

1. Open the form, type that address and click `Link address`. Approve the signature.
2. Replace the address with a free one and click `Link address` again.

**Expected outcomes:**

- A danger toast shows the served message, the LP is re-read, and the form stays open with the draft and `This address is already linked to another account. Enter a different address.`.
- Step 2 starts a new challenge and links the address.

---

## Story 6: Change an already linked address through the form

**Persona:** LP with a Stellar address linked, Freighter connected.

**Steps:**

1. Click `Use a different address`.

**Expected outcomes:**

- The form shows the `Current` served address in full and `Deposits processed after the change are minted to the new address.`.
- Submitting the form is the confirmation: there is no second `From` / `To` step.
- Typing the connected wallet's own address links it with no `signer_address` in either request.

---

## Story 7: The Signer line and the linked-signer row

**Persona:** LP with a `C…` address linked and the connected `G…` as its signer; then the same LP with a different `G…` connected.

**Steps:**

1. Open `/account` with the signer wallet connected.
2. Switch Freighter to a different account.

**Expected outcomes:**

- Step 1: a `Signer G…` line under the row and `Linked. Your connected wallet is the signer of this address.` with no `Change wallet` button; `Use a different address` is still offered.
- Step 2: the row shows `Your connected wallet is not this address.` and `Change wallet` as in #1825.
- A row whose signer equals its address shows no `Signer` line.

---

## Story 8: Cancel makes no request

**Persona:** LP with the form open and a valid address typed.

**Steps:**

1. Click `Cancel`.

**Expected outcomes:**

- The form closes, the draft is dropped, and no challenge, signature or verify request happens.

---

## Story 9: The default path is unchanged

**Persona:** LP with no address linked, Freighter connected.

**Steps:**

1. Click `Link wallet` and approve.

**Expected outcomes:**

- The challenge and verify requests carry no `signer_address`, exactly as in #1825.
- `Use a different address` is not offered while a request is in flight, on a `Failed` LP, without a connected wallet of the row's kind, or on the generic `Settlement address` row.

---

## Story 10: Declining in the wallet keeps the form

**Persona:** LP with the form open and a valid address typed.

**Steps:**

1. Click `Link address` and reject the signature in the wallet.
2. Click `Link address` again and approve.

**Expected outcomes:**

- Step 1 sends no verify request and no toast; the form stays open with the draft and `Your wallet did not sign. Nothing was changed.`.
- Step 2 starts a new challenge request and the link succeeds.
