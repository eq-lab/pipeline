# User story: #2049 — LP compact USD rounds before choosing the unit

**Epic:** #2029
**Issue:** https://github.com/eq-lab/pipeline/issues/2049
**Status:** Initial

---

## Overview

`formatCompactUsd` rounds to its one-decimal precision before choosing the K or M unit, so a value just under a unit boundary never prints a four-digit mantissa. Spec: `docs/frontend/utils.md` (`formatCompactUsd` row).

Persona: LP viewing the Loan Book table, header cards, portfolio or dashboard values.

---

## Story 1 — Values just under a million show the M unit

**Given** a loan-book amount of `999950.000000` (or `999999.000000`)

**When** the amount renders through `formatCompactUsd`

**Then:**

- It shows `$1.0M`, never `$1000.0K`
- `999949.000000` still shows `$999.9K`
- `1000000.000000` shows `$1.0M`

---

## Story 2 — Values just under a thousand show the K unit

**Given** an amount of `999.996`

**When** the amount renders through `formatCompactUsd`

**Then:**

- It shows `$1.0K`, never `$1,000.00`
- `999.99` still shows `$999.99` (sub-thousand keeps two-decimal cents)
- `1000` shows `$1.0K`
