# Issue #1888: Trustee: flaky test useRiskCouncilRelay > relays schedule and execute (hash read before the success render)

Source: https://github.com/eq-lab/pipeline/issues/1888

Parent epic: #1795. Branch `fix/1888-flaky-risk-council-relay-test` (draft PR #1899). Bug label, frontend flow. No Figma reference: test-only change, no visual verification step.

## Scope

Make the Trustee hook tests deterministic. Change test files only. No hook, product or spec behaviour changes.

1. **The reported flake** (`packages/trustee/src/api/-useRiskCouncil.test.tsx`, "useRiskCouncilRelay > relays schedule and execute with the right params").
   - Line 206 reads `result.current.hash` synchronously after `act(mutateAsync)`.
   - `useRiskCouncilRelay` returns `hash: mutation.data?.hash ?? null` (`packages/trustee/src/api/useRiskCouncil.ts`).
   - In `@tanstack/query-core` 5.100.6, the `MutationObserver` delivers its result to React through `notifyManager`. Its default scheduler is `systemSetTimeoutZero`, a real `setTimeout(cb, 0)` (`node_modules/@tanstack/query-core/build/modern/timeoutManager.js:62`).
   - `mutateAsync` can resolve before that 0 ms timeout fires. React 19's async `act` drains its own queue with macrotask yields (`setImmediate`), and in Node the order of `setImmediate` and `setTimeout(0)` is not deterministic. So `act` sometimes returns before the success render and `hash` is still `null`. Under CI load this happens more often.
   - Fix: assert the hash with `await waitFor(...)`.
2. **Real-timer delayed invalidations leaking past their test.** This is hygiene, not the cause of #1888. Five Trustee hooks schedule real `setTimeout` re-invalidations at 5 s / 15 s in `onSuccess`:
   - `useRiskCouncilRelay` (`useRiskCouncil.ts:196-198`)
   - `useReverseRepay` (`useRepaymentRecovery.ts:250-252`)
   - `useRecordPayment` (`useRecordPayment.ts:86`)
   - `useRecordIncome` (`useRecordIncome.ts:86`)
   - `useCloseLoan` (`useCloseLoan.ts:81`). It has no hook test, and the route tests mock it, so nothing changes for it.

   Each test that drives one of these mutations to success on real timers leaves 2 timers per success pending after it ends. These tests switch to fake `setTimeout` / `clearTimeout` (auto-advancing), so the pending invalidations are dropped when the test tears down. Affected tests:
   - `-useRiskCouncil.test.tsx`: "relays schedule and execute…", "records a schedule into the store…" and "exposes the stage…"
   - `-useRepaymentRecovery.test.tsx`: "passes the derived refHash…" and "exposes the stage…"
   - `-useRecordPayment.test.tsx`: "invalidates loan-book, financials and waterfall immediately…" and the "useRecordPayment repay call" success test
   - `-useRecordIncome.test.tsx`: "passes amount, value date and hash through…"

Audit result (the manager asked for this): no other Trustee test reads mutation-derived state (`hash`, `data`, `isSuccess`, `error`) synchronously after `act(mutateAsync)`. Every other such read in `packages/trustee/src` is inside `waitFor` or comes after it, or reads React state that is set synchronously inside `mutationFn` (`stage`), or reads a mocked hook in the route tests.
- `useDealToken.ts` does not exist in the repo.
- `useUpdateLifecycle.ts` schedules no delayed invalidation.

Out of scope:
- Any change to `useRiskCouncil.ts` or the other hooks, such as returning timer ids or a cleanup. The test-side fake timers make that unnecessary.
- The `packages/frontend` wallet hook tests that read `result.current.isSuccess` / `data?.hash` synchronously (e.g. `useStellarDepositManager.test.tsx`). They are a different package and a different hook shape, and there is no reported flake. If they flake later, file them separately.

## Assumptions and Risks

- **The leak cannot cause #1888.** The flaky test is the first relay test in its file. Only query tests run before it, and they schedule no delayed timers. Every leaked timer also invalidates an orphaned `QueryClient` whose observers were unmounted by RTL's auto-cleanup, so it is inert. Treat part 2 as hygiene and do not present it as the root cause.
- **`waitFor` under vitest fake timers.** RTL's `waitFor` only detects Jest fake timers (`typeof jest !== "undefined"`). With vitest it takes the real-timer path: it polls with `setInterval` and enforces its timeout with `setTimeout`. The plan therefore fakes only `["setTimeout", "clearTimeout"]` with `shouldAdvanceTime: true`:
  - `setInterval` stays real.
  - `notifyManager`'s `setTimeout(0)` and `waitFor`'s timeout advance with wall-clock time.
  - React's scheduler (`setImmediate` in Node) stays real.

  If `waitFor` still times out under this config, the fallback is to leave those tests on real timers and record the leak as inert in the known-bugs entry. Do not change the hook.
- **Re-installing fake timers.** Some tests already call `vi.useFakeTimers()` themselves ("invalidates … at 5 s and at 15 s", "re-invalidates … at 5 s and 15 s", "invalidates nothing on failure"). Those must keep their full, non-advancing fake timers so the `advanceTimersByTime` assertions stay exact. Install the new config per test (or in a `beforeEach` that those tests override). Vitest 4.1.5 uninstalls the old clock when `useFakeTimers` is called again. The coder confirms these tests still pass.
- **BUG number.** BUG-35 is currently the highest in `docs/exec-plans/known-bugs.md` (BUG-34 and BUG-35 are already in the Resolved section). Use BUG-36 and re-check the number at rebase time.

## Open Questions

_None_

## Implementation Steps

1. `packages/trustee/src/api/-useRiskCouncil.test.tsx`
   - In "relays schedule and execute with the right params", replace the trailing `expect(result.current.hash).toBe("H");` with `await waitFor(() => expect(result.current.hash).toBe("H"));`. `waitFor` is already imported.
   - Add a helper at module scope:
     ```ts
     function fakeRelayTimers() {
       vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
     }
     ```
     Call it as the first line of the three success-path tests: "relays schedule and execute…", "records a schedule into the store…" and "exposes the stage…". Inline the call instead if it reads cleaner. Do not touch "invalidates the listed keys now, at 5 s and at 15 s", which keeps its own `vi.useFakeTimers()`. Do not touch "rejects when not configured…", which never reaches `onSuccess`.
   - Change the module `afterEach` to `vi.clearAllTimers(); vi.useRealTimers();`. `clearAllTimers` is a no-op on real timers, so it is safe in every test.
2. `packages/trustee/src/api/-useRepaymentRecovery.test.tsx`
   - Apply the same per-test fake-timer install to "passes the derived refHash to schedule and to execute" and "exposes the stage reported by the relay".
   - Prepend `vi.clearAllTimers();` to the existing `afterEach`.
3. `packages/trustee/src/api/-useRecordPayment.test.tsx`
   - Apply the same per-test install to "invalidates loan-book, financials and waterfall immediately on success" and "signs Minter.repay with the derived ref hash, value date and sale id 0".
   - Prepend `vi.clearAllTimers();` to the existing `afterEach`, before `vi.useRealTimers()`.
4. `packages/trustee/src/api/-useRecordIncome.test.tsx`
   - Apply the same per-test install to "passes amount, value date and hash through and invalidates the caches".
   - Add `afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); })`, and add `afterEach` to the vitest import.
5. Comment rules: each file keeps its existing one-line `// spec:` header. Add no comments. Duplicating the 2-line timer install in a few tests is acceptable, and so is a small local helper per file. Do not add a shared test-utils module for this.
6. Add the known-bugs entry described under Docs to Update.

## Test Strategy

Run all commands from `packages/trustee` (not `--root` from the repo root).

1. **Deterministic repro of the old race.** Do this in a scratch edit only and do not commit it. Temporarily add `notifyManager.setScheduler((cb) => setTimeout(cb, 50))` (import from `@tanstack/react-query`) at the top of `-useRiskCouncil.test.tsx`.
   - With the old synchronous assertion, `npx vitest run src/api/-useRiskCouncil.test.tsx` should fail with `expected null to be 'H'`.
   - With the `waitFor` assertion, it should pass.

   Then revert the scheduler line. Record both outcomes in the PR description.
2. **Repeated-run stability.** Run `for i in $(seq 1 25); do npx vitest run src/api/-useRiskCouncil.test.tsx src/api/-useRepaymentRecovery.test.tsx src/api/-useRecordPayment.test.tsx src/api/-useRecordIncome.test.tsx || break; done`. All 25 runs must pass.
3. **Leak check.** In a scratch run, add `afterEach(() => expect(vi.getTimerCount()).toBe(0))`, evaluated before `clearAllTimers`, or log `vi.getTimerCount()` in the touched tests. This confirms the 5 s / 15 s timers now sit on the fake clock and are dropped at teardown. Do not commit it.
4. **Full Trustee suite.** `npx vitest run` in `packages/trustee` must stay green, including the exact-count fake-timer tests ("at 5 s and at 15 s", "re-invalidates … at 5 s and 15 s", "invalidates nothing on failure").
5. **Lint and typecheck.** Run `yarn lint` (or `npx eslint src/api`) and `npx tsc --noEmit` in `packages/trustee`. Run `npx tsx scripts/lint-docs.ts` from the repo root after the known-bugs edit.

No new test cases are added. The existing assertions keep their meaning and only become race-free.

## Docs to Update

- `docs/exec-plans/known-bugs.md`: add an entry modelled on BUG-31.
  - **Heading:** `### BUG-36: \`-useRiskCouncil.test.tsx\` — "relays schedule and execute with the right params" is timing-flaky [FIXED <date> / #1888]`
  - **Tracked:** #1888, seen on PR #1883 (CI run 42809806303).
  - **Location:** the test file and line.
  - **Symptom:** `expected null to be 'H'`.
  - **Root cause:** the `notifyManager` `setTimeout(0)` delivery races `act`'s macrotask flush.
  - **Impact:** spurious red CI.
  - **Workaround:** re-run the job.
  - **Resolved:** the assertion now uses `waitFor`. The 5 s / 15 s invalidation timers in the Trustee mutation-hook tests run on fake `setTimeout` and are cleared in `afterEach`. Hooks unchanged.
- No product-spec or `docs/frontend/trustee-flows.md` change, because behaviour is unchanged.
- On completion, the manager moves this plan to `docs/exec-plans/completed/`.
