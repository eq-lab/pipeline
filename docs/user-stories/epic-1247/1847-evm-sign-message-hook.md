# User Stories: #1847 — LP app: EVM message signing in its own hook

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1847](https://github.com/eq-lab/pipeline/issues/1847)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md#settlement-address), [wallet README](../../../packages/frontend/src/wallet/README.md#useevmsignmessage)

EVM message signing moves out of the shared `useEvmWallet` into a dedicated `useEvmSignMessage` hook, so wallet-state consumers no longer mount a wagmi mutation hook. This is a refactor with no visible change; the story checks that linking an EVM wallet still signs with the connected account.

---

## Story 1: Linking an EVM wallet still signs with the connected account

**Persona:** Signed-in LP with an LP record (not `Failed`), real MetaMask connected on the staging EVM chain, no Ethereum settlement address linked.

**Steps:**

1. Open `/account`.
2. Click `Link wallet` on the Ethereum row.
3. Approve the signature prompt.

**Expected outcomes:**

- The prompt shows the challenge text and the connected account.
- After approval the row shows the linked address.
- Rejecting the prompt instead ends on the `declined` caption.
- Everything else on the page (wallet card, Stellar row, connect / disconnect) behaves as before.

Mock wallets cannot sign, so this is checked with a real wallet; the automated proof is `useEvmSignMessage.test.tsx` and `useSettlementAddressLink.test.tsx`.
