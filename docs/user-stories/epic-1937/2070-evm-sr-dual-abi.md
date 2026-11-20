# User story: #2070 — EVM SecurityRegistry: support the deployed f92d719 ABI alongside 150631a

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/2070
**Status:** Initial

---

## Overview

Hoodi runs the SecurityRegistry and Reader from `pipeline-contracts@f92d719`, whose `Terms` has 12 fields. The indexer (#1938) and API (#1940) were built for `150631a` (15 fields). The worker now accepts both shapes: events are chosen by topic0, view reads by a strict decode (`150631a` first, then `f92d719`). Fields that `f92d719` lacks (`default_ratio_bps`, `originator_fee_rate`, `default_breach_at`) stay `NULL` and are served as `null`; `default_breach` is `null`. Contracts and deployments are not changed. Spec: `docs/references/security-registry-events.md#deployed-versions` and `docs/product-specs/loan-security-state-evm.md`.

Persona: an operator with `curl` and the worker logs, on Hoodi (chain 560048). The worker and API keys for the registry `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, RecordNft `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09` and Reader `0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B` are set, and the worker cursor was rewound to block 3955455. Setting terms from the stage Trustee needs a separate frontend follow-up (the Trustee sends the 15-field `setTerms`), so Story 2 runs once terms exist on Hoodi.

---

## Story 1 — The deployed f92d719 registry indexes cleanly while no terms exist

**Given** the keys are set on Hoodi and the cursor was rewound to 3955455

**When** the worker catches up and a client calls `GET /v1/loan-book/<loan_id>/security?chain_id=560048`

**Then:**

- The answer is `200` with `terms: null`
- The worker logs "EVM SecurityRegistry indexer enabled" and no "failed to decode" or "unrecognised topic" warning for `0xB51E…` or `0xf643…`
- The loan-book `ltv_bps` stays `null` until terms exist

---

## Story 2 — Terms set on an f92d719 registry serve null extras

**Given** terms were set on a Hoodi loan with the `f92d719` `setTerms` (12 fields)

**When** the worker indexes the `TermsSet` log (topic0 `0xafe2a37a…`) and a client calls `GET /v1/loan-book/<loan_id>/security?chain_id=560048`

**Then:**

- `terms` carries the 12 shared fields, and `terms.default_ratio_bps` and `terms.originator_fee_rate` are `null`
- `default_breach` is `null`
- `margin_call`, `valuation` and `agent_release` are served as for any EVM loan (the Reader's `debt` is the pool debt)
- The Trustee Security page shows no "Default ratio" or "Originator fee" rows
- A scheduled `setTerms` (selector `0x36b14cd2`) in the AccessManager projection decodes as `setTerms` with 12 arguments and the loan id
