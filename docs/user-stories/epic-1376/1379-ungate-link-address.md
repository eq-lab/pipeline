# User stories — #1379 Backend: ungate POST /v1/lps/me/link-address from kyb_status

Epic: [#1376 — KYB review lifecycle](https://github.com/eq-lab/pipeline/issues/1376)
Issue: [#1379](https://github.com/eq-lab/pipeline/issues/1379)
Spec: [docs/product-specs/kyb-lp-verification.md#settlement-address](../../product-specs/kyb-lp-verification.md#settlement-address)

This issue is backend-only — no UI changes. Stories verify observable API behavior;
`POST /v1/lps/me/link-address` is exercised with `curl` or an HTTP client against a running
`pipeline-api` instance, not a browser. `GET /v1/lps/me` reads back the result.

Nothing on `main` yet writes `lps.kyb_status` (#1274 is what makes `Passed`/`Failed`
reachable), so stories that need those statuses set them with a direct `UPDATE lps SET
kyb_status = …` against the dev database rather than through the product flow.

---

## Story 1 — An LP with no address links one while KYB is unstarted or in progress

**Setup:** Sign in as an account that has registered an LP still at `NotStarted` or
`InProgress`, with no `stellar_address` linked.

**Action:** `POST /v1/lps/me/link-address` with a valid, unused Stellar address.

**Expected outcomes:**

- The response is `200` with the address in `stellar_address` and a non-null
  `address_linked_at`.
- `GET /v1/lps/me` reflects the same address on a subsequent read.

---

## Story 2 — The address may be replaced freely before a KYB decision is final

**Setup:** The LP from Story 1, now holding the address it just linked, still
`NotStarted`/`InProgress`/`UnderReview`.

**Action:** `POST /v1/lps/me/link-address` again with a different valid, unused Stellar
address.

**Expected outcomes:**

- The response is `200`.
- `stellar_address` is the new value, and `address_linked_at` moved forward.
- The old address is now unclaimed: a different LP can successfully link it (`200`).

---

## Story 3 — A second LP cannot claim an address another LP currently holds

**Setup:** Two LPs, both eligible to write (e.g. `NotStarted`); LP A already holds address
`X`.

**Action:** Sign in as LP B's owner and `POST /v1/lps/me/link-address` with address `X`.

**Expected outcomes:**

- The response is `409`, with a message naming that the address is already linked to
  another LP.
- LP A's `stellar_address` is unchanged.

---

## Story 4 — `Passed` fixes the address the LP already holds, but a first write still succeeds

**Setup:** Two LPs set to `kyb_status = 'Passed'` directly in the database — one already
holding a `stellar_address`, one with `stellar_address IS NULL`.

**Action:** For each, `POST /v1/lps/me/link-address` with a valid, unused address.

**Expected outcomes:**

- The LP that already held an address gets `409`, with a message saying its settlement
  address is fixed; the stored address is unchanged.
- The LP with no address gets `200` and now holds the address it just set — a `Passed` LP
  that never named one is not locked out.
- A second attempt against that same now-linked LP also returns `409`.

---

## Story 5 — `Failed` refuses the write outright, with or without a stored address

**Setup:** Two LPs set to `kyb_status = 'Failed'` directly in the database — one already
holding a `stellar_address`, one with `stellar_address IS NULL`.

**Action:** For each, `POST /v1/lps/me/link-address` with a valid, unused address.

**Expected outcomes:**

- Both attempts return `409`, with a message saying the LP was refused at KYB and cannot
  set a settlement address.
- Neither row's `stellar_address` changes — in particular, the LP that held no address
  still holds none afterward (this is the case that most needs checking: a `Failed` LP
  with no address must not slip through).

---

## Story 6 — The settlement address stays writable while the rest of the profile is frozen

**Setup:** An LP set to `kyb_status = 'UnderReview'` directly in the database.

**Action:** `POST /v1/lps/me/link-address` with a valid, unused address, then
`POST /v1/lps/me` with a profile edit.

**Expected outcomes:**

- `link-address` returns `200` and the address is set — `GET /v1/lps/me` shows
  `writable: false` for this LP at the same time its address updates successfully.
- The profile edit (`POST /v1/lps/me`) returns `409` — the record itself stays frozen.
