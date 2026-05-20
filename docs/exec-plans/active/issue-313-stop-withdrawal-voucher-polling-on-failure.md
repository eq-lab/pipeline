# Issue #313: Stop withdrawal voucher polling after non-retriable failures

Source: https://github.com/eq-lab/pipeline/issues/313

## Scope

`useWithdrawalVoucher` (`packages/frontend/src/api/useWithdrawalVoucher.ts`) currently keeps
polling every 3 seconds whenever no signature is present, even after the query has entered
the `failed` state due to a non-retriable error (e.g. `409 already claimed`, `500 signing
failed`, or after the 20-attempt retry budget is exhausted on retriable errors). The hook's
`refetch: () => void query.refetch()` is also called by the consumer (`routes/withdraw.tsx`)
on user retry, which is fine — the bug is the background polling loop, not user-initiated
refetch.

**In scope**

- Extract the retriable-error predicate currently duplicated inside the `retry` callback into
  a small named helper inside `useWithdrawalVoucher.ts`.
- Use the same helper from `refetchInterval` so polling stops when:
  - `query.state.error` exists **and** the error is not retriable (e.g. 409, 500), or
  - the retry budget (20) is exhausted on a previously retriable error (no further retries
    will happen, so a 3 s timer is pure noise).
- Update the JSDoc comment on `refetchInterval` to describe the new stop conditions.
- Add unit/integration tests in `useWithdrawalVoucher.test.tsx` that cover:
  - A non-retriable HTTP error (e.g. 409 Conflict) → hook reports `status: "failed"` and
    issues exactly **one** fetch (no second 3 s poll).
  - A retriable error (404) followed by success still works (already covered — keep the
    existing test green).
- Update `docs/exec-plans/known-bugs.md` if a stale entry exists for this symptom; otherwise
  no docs change beyond the per-hook JSDoc tweak. (`packages/frontend/src/api/README.md`
  already documents the polling/retry contract at a high level; refresh the wording to say
  polling halts on non-retriable failure.)

**Out of scope**

- Refactoring the deposit twin `useDepositVoucher.ts`. It has the same bug shape but the
  Issue is scoped to withdrawal. See Open Questions — we'll surface this to the manager.
- Changing the retry budget, retry delay, or the set of retriable error substrings.
- Rewiring `routes/withdraw.tsx`. The user-visible behaviour after this fix: once
  `status === "failed"`, the UI continues to show the failed claim state until the user
  triggers a manual `refetch()`. No new UI affordances added in this Issue.
- Capping the interval after exhaustion as something *separate* from stopping. We stop
  outright when exhausted (return `false`) — there is no value left in an exponential cap
  if we no longer poll at all.

## Assumptions and Risks

- **Assumption.** `query.state.error` is set on the TanStack Query state object for
  `failureCount >= 1` when the most recent attempt threw. This is the standard React Query
  v5 contract used elsewhere in this repo (see `useRequests.ts` for a similar pattern).
- **Assumption.** `query.state.failureCount` is available in the `refetchInterval` callback
  and increments per attempted retry. Verified against the React Query v5 docs (the callback
  receives the same `query` instance whose `.state` is exposed by `useQuery`).
- **Assumption.** The hook's `retry` callback already short-circuits non-retriable errors
  (returns `false`), so by the time `refetchInterval` fires after a non-retriable error,
  no further retry attempt is in flight — only the polling timer needs to be silenced.
- **Risk.** If we make `refetchInterval` return `false` whenever an error is present and
  non-retriable, an already-failed query that later becomes retriable on a manual `refetch`
  will not auto-poll again until the next refetch resolves. This is fine because the
  consumer drives manual refetches; the polling loop is meant for the initial "verifier has
  latency" window, not for failure recovery.
- **Risk.** Behaviour parity with `useDepositVoucher.ts`. The same flaw exists there. If
  we fix only the withdrawal hook, deposit voucher polling will continue to leak on
  non-retriable errors. The Issue title and acceptance criteria are withdrawal-only, so we
  honour scope but flag this in Open Questions.
- **Risk.** Test flakes around fake timers. The existing 404-retry test already mixes
  `vi.useFakeTimers({ shouldAdvanceTime: true })` with `waitFor`. New tests will follow
  the same pattern to avoid drift.

## Open Questions

- Should `useDepositVoucher.ts` receive the same fix in this Issue (it has the identical
  bug), or should we open a follow-up Issue for deposit and keep this PR scoped to
  withdrawal as the title states?

## Implementation Steps

1. **Extract the retriable-error predicate.** In
   `packages/frontend/src/api/useWithdrawalVoucher.ts`, add a module-private function
   (above `useWithdrawalVoucher`):

   ```ts
   const MAX_RETRIES = 20;

   function isRetriableVoucherError(error: Error | null | undefined): boolean {
     const msg = error?.message ?? "";
     return (
       msg.includes("Not Found") ||
       msg.includes("not found") ||
       msg.includes("Forbidden") ||
       msg.includes("forbidden") ||
       msg.includes("not yet")
     );
   }
   ```

   Replace the inline predicate inside the `retry: (failureCount, error) => …` callback
   with `isRetriableVoucherError(error) && failureCount < MAX_RETRIES`.

2. **Tighten `refetchInterval` to honour failure state.** Same file, same `useQuery`:

   ```ts
   refetchInterval: (query) => {
     const { data, error, failureCount } = query.state;
     // Stop once we have a signature.
     if (data?.signature) return false;
     // Stop when the latest error is non-retriable …
     if (error && !isRetriableVoucherError(error)) return false;
     // … or when retries are exhausted on a retriable error.
     if (error && failureCount >= MAX_RETRIES) return false;
     // Otherwise keep polling while the verifier catches up.
     return 3000;
   },
   ```

   Update the surrounding JSDoc block (lines ~97–102) to describe the three stop
   conditions: signature received, non-retriable error, exhausted retries.

3. **Refresh the file-level JSDoc.** The header comment block on
   `useWithdrawalVoucher.ts` (lines 1–18) describes mock layer behaviour but not the
   polling stop conditions. Add a short paragraph noting that polling halts on
   non-retriable failure or exhausted retries.

4. **Add tests in `packages/frontend/src/api/useWithdrawalVoucher.test.tsx`.** Three
   additions, in a new `describe("useWithdrawalVoucher — stops polling on non-retriable failure", …)`
   block placed after the existing "retry on 404" describe:

   - **409 Conflict → status "failed", no second fetch.** Use `vi.useFakeTimers({ shouldAdvanceTime: true })`,
     `fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: "already claimed" }), { status: 409, statusText: "Conflict" }))`.
     Use the retry-allowing wrapper pattern from the 404 test. Render the hook, wait for
     `result.current.status === "failed"`, then advance the timer by 10000 ms and assert
     `fetchSpy.mock.calls.length === 1`.

   - **500 Internal Server Error → status "failed", no second fetch.** Same pattern with
     a 500 response body `{ error: "signing failed" }`.

   - **Exhausted retries on 404 → polling stops.** Queue 21 × 404 responses. Use fake
     timers. Render, then advance the timer in a loop (e.g. 21 × 3500 ms) until
     `result.current.status === "failed"`. After that, advance another 10000 ms and
     assert no additional fetch beyond the 21st. (This may run slowly with the existing
     20-retry cap — if so, reduce by binding the test against the exported `MAX_RETRIES`
     constant. See step 5.)

5. **(Optional) Export `MAX_RETRIES` and `isRetriableVoucherError` for tests.** If the
   exhaustion test is awkward to write against the hard-coded 20, export the constants
   from `useWithdrawalVoucher.ts` but keep them as named non-default exports. Update
   `index.ts` only if the test file cannot reach them via deep import. Prefer to keep
   them module-internal if the test can use a smaller stub by mocking the module.

6. **Lint and verify.** Run:
   - `yarn workspace @pipeline/frontend test src/api/useWithdrawalVoucher.test.tsx`
   - `yarn workspace @pipeline/frontend lint`
   - `yarn workspace @pipeline/frontend build`
   - `npx tsx scripts/lint-docs.ts` (per `AGENTS.md` lint requirement after TypeScript
     changes)

7. **If the manager answers "yes, also fix deposit" to the Open Question**, repeat
   steps 1–4 on `useDepositVoucher.ts` / `useDepositVoucher.test.tsx`. The change is a
   straight copy-paste with `Voucher`/`DepositVoucher` renames. Do not preemptively
   touch deposit; wait for the manager's decision.

## Test Strategy

**Unit / integration (vitest, in `useWithdrawalVoucher.test.tsx`).** Required new cases:

1. **409 stops polling.** Mock a single 409 response, render the hook, wait for
   `status === "failed"`, advance fake timers by 10 s, assert `fetchSpy` was called
   exactly once.

2. **500 stops polling.** Same shape as (1), with a 500 response.

3. **Retry exhaustion stops polling.** Queue (MAX_RETRIES + 1) × 404 responses, advance
   timers past each retry delay, wait for `status === "failed"`, then advance another
   10 s and assert no extra fetch beyond the budget.

**Regression coverage to keep green.** The existing test cases in
`useWithdrawalVoucher.test.tsx` must continue to pass unchanged:

- `disabled when requestId is undefined`
- `disabled when wallet is disconnected`
- `mock-key path` (immediate ready, no fetch)
- `per-wallet mock key takes priority`
- `real-fetch path` (single fetch, ready)
- `retry on 404` (1 × 404 then success → ready, exactly 2 fetches)
- `mock-key reactivity` (mutate localStorage → refetch picks up update)

**Edge case worth verifying manually.** Confirm `query.state.failureCount` reflects the
final attempt rather than an off-by-one. The `retry` callback's `failureCount` argument
in React Query v5 is 1-based (the count of *prior* failures plus the in-flight one), so
`failureCount < 20` permits up to 20 attempts in total. Mirror that semantic in
`refetchInterval` with `failureCount >= MAX_RETRIES` to stop *after* the 20th attempt.

**No e2e tests added.** This is a single-hook polling fix; the existing route-level
tests in `routes/-withdraw.test.tsx` exercise the consumer side and do not assert on
polling cadence, so they should remain unchanged.

## Docs to Update

- `packages/frontend/src/api/useWithdrawalVoucher.ts` — file-level JSDoc and
  `refetchInterval` inline comment.
- `packages/frontend/src/api/README.md` — section "`useWithdrawalVoucher(requestId?)`"
  (lines ~82–98): tighten the sentence that says "retries up to 20 times on retriable
  errors (404/403)" to also state "and stops polling on non-retriable errors or after
  the retry budget is exhausted". One-line change.
- No product-spec change. This is a behaviour fix on an internal hook, not a
  user-visible feature change.
- No `docs/STORIES.md` change. No new user story.
- If the manager approves extending scope to deposit (Open Question), also touch
  `useDepositVoucher.ts` and the `useDepositVoucher(requestId?)` section of the same
  README.
