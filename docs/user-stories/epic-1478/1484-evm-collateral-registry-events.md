# User story: #1484 — EVM indexer collects CollateralRegistry events

**Epic:** #1478 — Collateral registry events in the indexer
**Issue:** https://github.com/eq-lab/pipeline/issues/1484
**Status:** Initial

---

## Overview

Backend-only: no Figma reference and no UI surface. Stored shapes are specified in
[`docs/references/collateral-registry-events.md`](../../references/collateral-registry-events.md).
Coverage is pure unit tests (`packages/worker/tests/collateral_registry_parsers.rs`,
`evm_collateral_registry_config.rs`); there is no DB or RPC in the suite.

Deployment reality: `PipelineCollateralRegistry` is deployed on hoodi, but no environment runs the EVM
indexer arm, so the feature ships dark everywhere until an operator sets the key.

---

## Story 1 — Key unset: the worker boots and nothing is indexed

**Given** `CHAIN_<id>_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS` is unset or blank
**When** the indexer starts
**Then** startup succeeds, the registry handler contributes no addresses to the `eth_getLogs` filter, and no
registry rows are written.

## Story 2 — A pledge is indexed

**Given** the key is set to a valid address
**When** the registry emits `Pledged` for loan 7, lot 3
**Then** a `contract_logs` row has `event_name = "Pledged"` and `params = {"loan_id": "7", "lot_id": "3"}`.

## Story 3 — A stage update with a location

**When** `StageUpdated` is emitted with `hasLocation = true`
**Then** `params.stage` is the stage name (for example `"InStorage"`) and `params.location` is
`{ "location_type", "identifier", "tracking_url" }`.

## Story 4 — A stage update without a location stores null

**When** `StageUpdated` is emitted with `hasLocation = false`, even if the calldata location tuple is non-zero
**Then** `params.location` is `null`.

## Story 5 — Control and enum names

**When** `ControlUpdated` is emitted with `ControlKind` ordinal 0
**Then** `params.control` is `{ "kind": "None", "ref": ... }`, the same name the Stellar arm stores.

## Story 6 — Repeated margin calls are separate rows

**When** `MarginCall` is emitted twice for the same loan
**Then** two rows exist, each with `coverage_bps` and `floor_bps` as numbers; nothing is deduplicated.

## Story 7 — An out-of-range enum is stored as Unknown

**When** a registry event carries an enum ordinal outside the documented table (for example after a contract
upgrade appends a variant)
**Then** the row is still written with that field set to `"Unknown"`.
