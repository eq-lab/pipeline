# User Stories: #1837 — AddEmailModal async-submit test is deterministic

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1837](https://github.com/eq-lab/pipeline/issues/1837)
Known bug: BUG-31 in [docs/exec-plans/known-bugs.md](../../exec-plans/known-bugs.md)

Test-only fix; no UI change.

---

## Story 1: The pending-then-re-enabled test passes on every run

**Persona:** A developer running the frontend suite locally or in CI.

**Pre-conditions:**
- Dependencies installed.

**Steps:**
1. Run `yarn workspace @pipeline/frontend vitest run src/components/AddEmailModal.test.tsx` ten times in a row.
2. Run the full `packages/frontend` vitest suite several times.

**Expected:**
- "AddEmailModal (#1459) > an async onSubmit disables Save while pending, then re-enables it" passes on every run, in isolation and under the full suite.
