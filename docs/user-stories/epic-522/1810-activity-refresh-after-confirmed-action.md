# User Stories — Issue #1810: Activity is stale after a confirmed action

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#1810](https://github.com/eq-lab/pipeline/issues/1810)
Spec: [`docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action`](../../frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action)

The indexer lags the chain, so the list served right after a write is often the old one. After a confirmed
write the app polls `/v1/requests` every 3 s (up to 60 s) until the served list shows the change. Only the
served list is rendered, never an optimistic row. Use the real API on staging (no mock keys).

---

## Story 1 — A new withdrawal appears on Activity without a refresh

**As an** LP who just confirmed a withdrawal request,
**I want** the toast's "View activity" action to open an Activity page that already shows the new Sell row,
**so that** I do not have to reload to see my request.

### Acceptance criteria

- After the request confirms, clicking the toast "View" action opens `/transactions`.
- The Sell row appears within a few seconds with no manual refresh and no remount.
- The Network tab shows `/v1/requests` polling every 3 s, which stops once the row is served.

### How to test

1. Connect a Stellar testnet wallet with PLUSD and open `/deposit` on the Withdraw direction.
2. Submit a withdrawal request and wait for the success toast.
3. Click "View" in the toast.
4. Verify the Sell row appears on `/transactions` without reloading, and that polling stops afterwards.

---

## Story 2 — A claimed deposit shows as completed on Home

**As an** LP who just claimed a deposit,
**I want** Home's Recent activity to show the Buy row as completed and my PLUSD balance updated,
**so that** the home screen reflects what I just did.

### Acceptance criteria

- After the claim confirms and the app navigates home, the Buy row stops showing "Pending" within a few
  seconds, without a refresh.
- The PLUSD balance on Home shows the claimed amount without waiting for the 30 s balance cache.

### How to test

1. Request a deposit and wait until step 3 (Claim) is available.
2. Click Claim and wait for the success toast and the navigation to `/`.
3. Verify the Recent activity Buy row flips from Pending to completed and the PLUSD balance updates.

---

## Story 3 — Stake and unstake rows appear without a refresh

**As an** LP who just staked or unstaked,
**I want** the Stake / Unstake row to show up in Activity,
**so that** my history matches what I did.

### Acceptance criteria

- After a stake or unstake confirms, the new row appears on Home's Recent activity and on `/transactions`
  without a manual refresh.
- The Portfolio figures refetch once the row is served.

### How to test

1. Stake an amount of PLUSD and wait for the success toast and navigation home.
2. Verify the Stake row appears in Recent activity within a few seconds.
3. Repeat with an unstake.

---

## Story 4 — Polling is bounded

**As a** user on a chain whose indexer is slow,
**I want** the extra polling to end on its own,
**so that** the app does not keep hitting the API.

### Acceptance criteria

- If the row never appears, `/v1/requests` stops polling at 3 s after about 60 s (about 20 extra requests).
- Polling also stops when the page unmounts, and an action on another wallet or chain does not trigger
  polling for the active one.

### How to test

1. Open the Network tab, confirm an action, and watch `/v1/requests`.
2. Verify polling ends once the row is served, or at the latest after about 60 s.
3. Switch the wallet or chain after a confirmed action and verify the new view does not poll at 3 s.
