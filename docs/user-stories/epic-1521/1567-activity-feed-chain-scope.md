# User Stories: #1567 — LP: activity feed scoped to the active wallet view's chain

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1567](https://github.com/eq-lab/pipeline/issues/1567)
Spec: [docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#activity-page),
[packages/frontend/src/api/README.md](../../../packages/frontend/src/api/README.md#userequests)

LP app (`packages/frontend`) against a staging API that includes backend #1565 (PR #1566:
`GET /v1/requests?chain_id=`). The wallet used has requests on more than one chain.

---

## Story 1: The EVM view shows only the configured EVM chain's requests

**Persona:** LP with a connected EVM wallet.

**Pre-conditions:** Signed in or wallet-only; the `0x…` wallet has requests on Hoodi (`560048`)
and, if the API has a second EVM chain configured, on that chain too.

**Steps:**

1. Open `/transactions` (or the home Recent activity card) with the Network tab open.

**Expected outcomes:**

- The request is `GET /v1/requests?wallet=0x…&chain_id=560048` (the app's `VITE_EVM_CHAIN_ID`).
- Only Hoodi requests are listed; none from any other EVM chain.

---

## Story 2: The Stellar view shows only the Stellar chain's requests

**Persona:** LP with a connected Stellar wallet.

**Pre-conditions:** Stellar wallet connected and the Stellar view active.

**Steps:**

1. Open `/transactions`.

**Expected outcomes:**

- The request is `GET /v1/requests?wallet=G…&chain_id=99000001`.
- Only Stellar requests are listed.

---

## Story 3: Switching the view refetches the feed

**Persona:** LP with both wallets connected.

**Pre-conditions:** Story 1 state, Stellar wallet also connected.

**Steps:**

1. Switch the wallet view from EVM to Stellar, then back.

**Expected outcomes:**

- Each switch fires a new `/v1/requests` request carrying the other chain's `wallet` and `chain_id`; the rows change accordingly with no stale rows from the previous chain.

---

## Story 4: `/test` scenario mocks still drive the feed

**Persona:** Developer on the dev server.

**Pre-conditions:** `/test` reachable (`ENV.IS_DEV`).

**Steps:**

1. Apply the "Connected, PendingVerification request" scenario; open `/transactions`.
2. In DevTools set `pipeline.mock.api.GET./v1/requests?wallet=<addr>&chain_id=560048` to `{"requests":[]}`.

**Expected outcomes:**

- Step 1 lists the scenario's rows (the un-keyed `GET./v1/requests` alias still matches after the query string is stripped).
- Step 2 empties the feed without a reload: the exact-match per-wallet/per-chain key wins over the alias.
