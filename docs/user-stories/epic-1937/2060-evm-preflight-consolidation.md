# User story: #2060 — Trustee + wallet-connect: consolidate duplicated EVM preflight and helpers

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/2060
**Status:** Initial

---

## Overview

A pure refactor. The EVM arm of every Trustee write hook now runs one `evmPreflight` helper, every wallet-connect EVM binding validates addresses through one `requireAddress`, the Risk Council chain gate delegates to `loanActionChainReason`, and raw/decimal conversion lives in `utils/stellarSacUnits.ts`. No behaviour changes: the stories below are the behaviours the existing and new vitest suites pin. Spec: `docs/frontend/trustee-flows.md#evm-1574`, `docs/frontend/wallet-flows.md#trustee-evm-contract-client`, `docs/frontend/error-handling.md`.

Persona: Trustee or Risk Council member on the Trustee console, signed in on the EVM chain with an EVM wallet. There is no UI change, so nothing here needs a live pass beyond the existing #1574, #1942 and #1943 stories.

---

## Story 1 — Each write hook fails in the same order on EVM

**Given** an EVM loan and one of Rollover, Update lifecycle, Close loan, Record payment, Disburse, Approve & draw, or a Risk Council relay or execute

**When** the action is submitted

**Then:**

- The chain gate is checked first (for Approve & draw, `drawChainReason`; for Risk Council, `riskCouncilChainReason`), then the "not configured for this environment" sentence of that hook, then "EVM wallet not connected."
- Disburse and the pending-operation execute keep their earlier checks (configured, target mismatch, paused) before the wallet check
- The writer receives `ENV.EVM_CHAIN_ID`, the connected wallet address and the same registry, access manager or minter addresses as before

---

## Story 2 — Stellar output is byte-identical

**Given** a Stellar loan or wire-out

**When** an amount is rendered or parsed

**Then:**

- `rawToDecimal7` renders 7 decimals exactly as before ("10000000" is "1", "12345678" is "1.2345678", "5" is "0.0000005", "12345670" is "1.234567")
- The disburse form still parses strictly (no truncation, no `$` or `,`) and `usdInputToSacBaseUnits` still strips separators, truncates to 7 decimals and accepts ".5"
- The Stellar arms of every hook are unchanged

---

## Story 3 — Address validation messages are unchanged

**Given** an EVM binding in wallet-connect (LoanRegistry, Minter, Risk Council, DealTokenFactory, SecurityRegistry)

**When** an address argument is empty or invalid

**Then:**

- The error reads "`<who>: <name> must not be empty`" or "`<who>: invalid <name> <value>`", with the same `who` and `name` as before (`drawEvmLoan` for the draw call)
- `requireAddresses` in `accessManager.ts` still reports every empty field before any invalid one
