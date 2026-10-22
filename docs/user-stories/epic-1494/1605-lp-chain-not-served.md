# User Stories: #1605 — LP: explicit state when the active chain isn't served by the API

Epic: [#1494 — EVM support for the LP app](https://github.com/eq-lab/pipeline/issues/1494)
Issue: [#1605](https://github.com/eq-lab/pipeline/issues/1605)
Spec: [docs/frontend/wallet-flows.md#active-chain-for-protocol-reads](../../frontend/wallet-flows.md#active-chain-for-protocol-reads)

LP app (`packages/frontend`) built with an EVM chain the API does not serve (prod today:
`VITE_EVM_CHAIN_ID=1` vs API `CHAINS=99000002`; or a local API with `CHAINS` narrowed to
Stellar), plus a Stellar wallet for the control case.

---

## Story 1: An unserved EVM chain shows one clear message instead of zeros

**Persona:** LP with an EVM wallet connected on the unserved chain.

**Steps:**

1. Open `/` with the Network tab open; then `/dashboard`, `/transactions`, `/deposit`, `/stake`.

**Expected outcomes:**

- One probe `GET /v1/pnl?wallet=0x000…0&chain_id=<id>` answers `400 unknown chain_id`; no repeated probes on navigation.
- Home keeps the welcome header; below it a card reads "Not available on Ethereum — Pipeline isn't available on Ethereum yet. Switch your wallet to a supported network to see protocol data." The stats strip shows the exchange rate only — no "$0" TVL, no "—" APY cell.
- `/dashboard` shows the title and the same notice; no Yield / Balance Sheet / Loan Book / Withdrawal Queue panels, no empty "no loans" state.
- `/transactions`, `/deposit` and `/stake` show the notice instead of the feed / flow.

---

## Story 2: A served chain is unchanged

**Persona:** LP with the Stellar wallet connected (or an EVM wallet on Hoodi against staging).

**Expected outcomes:**

- Stellar: no probe request at all; every page renders as before.
- Hoodi on staging: the probe answers 200; every page renders as before.

---

## Story 3: A flaky probe never hides a working chain

**Persona:** LP on a served EVM chain while the API briefly returns 500.

**Expected outcomes:**

- The pages render their normal content (loading/error states of their own widgets as today); the notice appears only for a definitive `400 unknown chain_id`.
