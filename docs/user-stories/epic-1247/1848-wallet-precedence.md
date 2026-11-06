# User Stories: #1848 — LP app: one source of wallet precedence

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1848](https://github.com/eq-lab/pipeline/issues/1848)
Spec: [docs/frontend/wallet-flows.md](../../frontend/wallet-flows.md#single-connected-wallet), [docs/frontend/account-page.md](../../frontend/account-page.md#settlement-address)

The wallet view and the settlement rows decide which wallet wins from one function, `walletPrecedence`: EVM if connected, else Stellar. This is a refactor with no visible change; the story checks that the two never disagree.

---

## Story 1: Both wallets connected, the settlement row and the wallet view agree

**Persona:** Signed-in LP with an LP record (not `Failed`), no settlement address linked.

**Steps:**

1. Set both mock wallets (`pipeline.mock.wallet.address` and `pipeline.mock.wallet.stellar.address`), or restore a legacy both-connected session.
2. Open `/account`.

**Expected outcomes:**

- While both report connected (before the single-wallet cleanup disconnects both), the header and wallet card show the EVM namespace, and the only settlement row with a `Link wallet` action is the Ethereum row.
- After the cleanup both are disconnected and the generic `Settlement address` row with `Connect a wallet to name your settlement address.` shows.
- No wallet prompt opens at any point.

The mock layer reports both wallets disconnected when both mocks are set, so the both-connected moment is only observable with a restored real session; the automated test in `settlementAddress.test.ts` is the primary proof.
