# User story: #1888 — Deterministic Trustee mutation-hook tests

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1888
**Status:** Initial

---

## Overview

Test-only fix. The Trustee hook test "useRiskCouncilRelay > relays schedule and execute with the right params" no longer reads the mutation hash before the success render, and the Trustee mutation-hook tests no longer leave 5 s / 15 s invalidation timers running after they end. There is no UI change, so the stories run in a terminal from `packages/trustee`. Known-bugs entry: `docs/exec-plans/known-bugs.md#bug-36`.

---

## Story 1 — The relay test passes when the mutation result arrives late

**Given** `packages/trustee/src/api/-useRiskCouncil.test.tsx` with a scratch line `notifyManager.setScheduler((cb) => setTimeout(cb, 50))` added after the imports (import `notifyManager` from `@tanstack/react-query`)

**When** you run `npx vitest run src/api/-useRiskCouncil.test.tsx`

**Then:**

- All tests pass, including "relays schedule and execute with the right params"
- Reverting the final assertion to a synchronous `expect(result.current.hash).toBe("H")` makes that test fail with `expected null to be 'H'`
- Remove the scratch line when done

---

## Story 2 — The hook tests are stable across repeated runs

**Given** a clean checkout of the branch

**When** you run `npx vitest run src/api/-useRiskCouncil.test.tsx src/api/-useRepaymentRecovery.test.tsx src/api/-useRecordPayment.test.tsx src/api/-useRecordIncome.test.tsx` 25 times in a row

**Then:**

- Every run passes
- The exact-count tests "invalidates the listed keys now, at 5 s and at 15 s", "re-invalidates loan-book and financials at 5 s and 15 s" and "invalidates nothing on failure" still pass

---

## Story 3 — The full Trustee suite stays green

**Given** the same checkout

**When** you run `npx vitest run`, `npx tsc --noEmit` and `yarn lint` in `packages/trustee`

**Then:**

- All three succeed
- The diff touches only the four `-use*.test.tsx` files named above, plus docs
