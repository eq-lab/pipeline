# User story: #1794 / #1854 — Stellar contract ids and signer roles synced with deployments #36 + #42 (testnet) / #37 (mainnet)

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1794 (testnet refresh: https://github.com/eq-lab/pipeline/issues/1854)
**Status:** Initial

---

## Overview

`.env.example` and `docs/references/backend.md` carry the Stellar contract ids and signer roles of the live testnet (#36 + #42) and mainnet (#37) deployments of `pipeline-stellar-contracts`, recorded at the commit named in `.env.example`. Spec: `docs/references/backend.md#stellar-contract-ids-and-signer-roles`.

Persona: operator. Every step is a shell step (`jq`, `rg`, the `stellar` CLI) run from the repo root. `$C` is the local `pipeline-stellar-contracts` checkout at the commit recorded in `.env.example`; `$T` / `$M` are `$C/deployments/networks/testnet` and `.../mainnet`.

---

## Story 1 — Every backend Stellar contract id is a deployed id under the mapped key

**Given** `.env.example` and `$C` at the recorded commit

**When** the operator lists the 56-character `C…` / `G…` values on non-`VITE_` lines (`rg -o '^#? ?[A-Z0-9_]+=[CG][A-Z2-7]{55}' .env.example`)

**Then:**

- Each value (except the legacy testnet `…_COLLATERAL_REGISTRY_ADDRESS` `CBSMJS5Q…`, which testnet `addresses.json` no longer holds) appears in `$T/addresses.json` (`CHAIN_99000001_` keys), `$M/addresses.json` (`CHAIN_99000002_` keys), a `config.json` `usdc` / `withdrawal_queue.custodian` / `verifier` field, or is a documented example
- Each key maps to the JSON key listed in the backend.md key map (for example `…_INDEXER_MINTER_ADDRESS` to `minter`; testnet `…_SECURITY_REGISTRY_ADDRESS` to `collateral_registry`)
- None of `CARFA2Q`, `CC3TWGF`, `CDO4X3H`, `CBJUO44`, `CAC7JMG`, `CCWX3TK`, `GDH66JAF`, `CAPL5WN3`, `CAIBACM6` remains on a non-`VITE_` line of `.env.example`
- `CDTUMAT6…` appears only on the `…_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS` line

---

## Story 2 — pipeline-test holds the same testnet ids

**Given** `eq-lab/argocd` `origin/main` `pipeline/test.yaml`

**When** the operator compares every `CHAIN_99000001_*` Stellar key and `JOB_INDEXER_STELLAR_ASSET_ID` set in both files

**Then:**

- The values are equal for every key both files set
- The pocket keys are absent from `test.yaml` because no code reads them yet

---

## Story 3 — The testnet `collateral_registry` id is the SecurityRegistry

**Given** `collateral_registry` in `$T/addresses.json` (contracts #42), and the legacy `CBSMJS5Q…`

**When** the operator runs `stellar contract info interface --id <id> --network testnet` for each

**Then:**

- `addresses.json` `collateral_registry` returns `register`, `perfect`, `record`, `attest`, `handover`, `record_inspection` and none of `pledge`, `lot`; it is configured as `…_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`, not as the collateral key
- `CBSMJS5Q…` returns `pledge` and `lot`; it stays on `…_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS`
- Mainnet `collateral_registry` (`CA76K5CU…`) is still the legacy CollateralRegistry

---

## Story 4 — The relayer signer holds `WHITELIST_ADMIN` with delay 0

**Given** the relayer signer's `G…` (public key of `CHAIN_99000001_RELAYER_STELLAR_SIGNER_SECRET`) and the testnet access-manager id

**When** the operator runs `stellar contract invoke --id <AM> --network testnet --send=no -- has_role --role WHITELIST_ADMIN --account <G…>`

**Then:**

- The result is `execution_delay: 0, is_member: true`

---

## Story 5 — The DM and WQ verifier equals the configured verifier

**Given** `config.json` `deposit_manager.verifier` and `withdrawal_queue.verifier`, and the public key of `STELLAR_VERIFIER_SECRET`

**When** the operator runs `stellar contract invoke --id <DM|WQ> --network testnet --send=no -- verifier`

**Then:**

- Both contracts return the same key as `config.json` and as the `.env.example` note (testnet `GCZAXE3C…`, mainnet `GAUCCZEC…`)
- The public key of `STELLAR_VERIFIER_SECRET` equals it
