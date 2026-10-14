# User story: #1481 — Stellar indexer collects CollateralRegistry events

**Epic:** #1478 — Collateral registry events in the indexer
**Issue:** https://github.com/eq-lab/pipeline/issues/1481
**Status:** Initial

---

## Overview

Backend-only: no Figma reference and no UI surface. Stored shapes are specified in
[`docs/references/collateral-registry-events.md`](../../references/collateral-registry-events.md).
Coverage is pure unit tests (`packages/worker/tests/stellar_collateral_registry_parsers.rs`,
`stellar_collateral_registry_config.rs`); there is no DB or RPC in the suite.

---

## Story 1 — A lot pledge is indexed

**Given** `CHAIN_<id>_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS` is set
**When** the registry emits `pledged` for loan 7, lot 3
**Then** a `contract_logs` row has `event_name = "Pledged"` and `params = {"loan_id": "7", "lot_id": "3"}`.

## Story 2 — A revaluation carries a hex report hash

**When** the registry emits `revalued`
**Then** the row has `value_per_unit` as a decimal string, `benchmark` as a plain string (for example `"PAR"`),
and `report_hash` as 64 lowercase hex characters.

## Story 3 — A stage update with and without a location

**When** `stage_updated` is emitted with no location
**Then** `params.location` is `null`.
**When** it is emitted with a location
**Then** `params.location` is `{ "location_type", "identifier", "tracking_url" }`.

## Story 4 — Release and liquidation quantities

**When** `released` or `liquidated` is emitted
**Then** the row stores `quantity` as a decimal string at native 7dp scale, `reason` as the variant name for
`Released`, and `sale_id` as a decimal string for `Liquidated`.

## Story 5 — Repeated margin calls are separate rows

**When** `margin_call` is emitted twice for the same loan
**Then** two rows exist, each with `coverage_bps` and `floor_bps` as numbers; nothing is deduplicated.

## Story 6 — Key unset means no registry rows

**Given** the env key is unset
**When** the poller runs
**Then** the registry id is not in the `getEvents` filter, no registry rows are written, and no warnings are logged.

## Story 7 — A same-named event from another contract is not attributed to the registry

**Given** the key is set
**When** another contract emits an event named `released`
**Then** it is not decoded by the registry parsers and no `Released` row is attributed to the registry.
