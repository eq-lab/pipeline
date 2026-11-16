# Issue #1350 — Trustee sidebar badge counts

## Story

As a Trustee, I see how many items wait for me on Origination, Loans and Cash Management in the sidebar, so I know where to go first. The numbers come from `GET /v1/attention-counts` ([spec](../../product-specs/trustee-attention-counts.md)); the app does no counting.

## Test Cases

### Stellar session shows the served counts

1. Sign in to the Trustee app on Stellar testnet and open the Network tab.
2. Read the `/v1/attention-counts` response.
3. Confirm the Origination badge equals `origination.count` and the Loans badge equals `loans.count`.
4. Confirm the Cash Management badge equals `cash_management.count` of the `chains[]` entry with `chain_id` `99000001`.
5. Confirm Overview, LP Counterparties, Risk Council and Audit Log show no badge.

### Hoodi session changes only Cash Management

1. Sign in on Hoodi (`560048`).
2. Confirm Origination and Loans show the same combined counts as before.
3. Confirm Cash Management equals the `chains[]` entry with `chain_id` `560048`.

### A zero count shows no badge

1. With a section whose served count is `0`, load the sidebar.
2. Confirm that nav item shows no badge.

### A failed request shows no badges

1. Block `/v1/attention-counts` in DevTools and reload.
2. Confirm no badge shows and every nav link still works.

### Badges refresh after an action

1. Note the Origination badge, then approve a submission.
2. Within about 30 seconds, confirm the badge matches the new `origination.count` in the Network tab.
