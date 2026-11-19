# User story: #2127 — Trustee facility tiles show the right second value

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/2127
**Status:** Initial

---

## Overview

The Trustee loan detail facility tile pairs `principal` with the disbursed amount on **Facility / disbursed** and with `original_senior_tranche` on **Facility / senior**. Spec: `docs/frontend/trustee-flows.md` (Summary tiles).

Persona: Trustee reviewing a loan on `/loans/:id`.

---

## Story 1 — Performing disbursed loan

**Given** a Performing loan with `disbursed = true`, `principal` 4800 and `original_senior_tranche` 3960

**When** the Trustee opens `/loans/:id`

**Then:**

- The tile is labelled `Facility / disbursed` and reads `$4.8K / $4.8K`
- The sub reads `funded`

---

## Story 2 — Disbursing loan

**Given** a loan with `disbursed = false`

**When** the Trustee opens `/loans/:id`

**Then:**

- `Facility / disbursed` reads `$<facility> / $0` with sub `drawn, not yet funded`
- The stepper Disbursing node sub reads `drawn, not yet funded`

---

## Story 3 — Matured loan

**Given** a Matured loan with `principal` 4800 and `original_senior_tranche` 3960

**When** the Trustee opens `/loans/:id`

**Then:**

- The tile is labelled `Facility / senior` and reads `$4.8K / $3.96K`
- The sub reads `—`
