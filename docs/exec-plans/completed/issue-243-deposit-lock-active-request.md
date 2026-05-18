# Issue #243: Lock /deposit amount input to active request value when one is in flight

Source: https://github.com/eq-lab/pipeline/issues/243

## Scope

When `GET /v1/requests` reports an active deposit request for the connected
wallet (status `PendingVerification` or `PendingClaim`), the `/deposit` page
should:

1. **Populate** the USDC amount input with the active request's `amount`
   (raw bigint string at 6 decimals) formatted via `formatUsdc`.
2. **Lock** the input — disable typing on the underlying `<input>` and disable
   every quick-amount chip (Min / $5,000 / $10,000 / Max) so the value reflects
   what the user has already committed on-chain.

When no active request exists (or the request resolves to `Completed` /
`VerificationFailed` / cleared), behavior is unchanged from today: the input
and chips are editable as long as the wallet is connected and the data is
ready.

In scope:

- `packages/frontend/src/routes/deposit.tsx` — derive an `isAmountLocked` flag
  from `activeRequest`, sync `amountInput` on transition into the locked state,
  thread `disabled` into the `ConversionCard.input` and into each
  `QuickAmountItem`.
- `packages/ui/src/components/TokenInput/TokenInput.tsx` — extend
  `QuickAmountItem` with an optional `disabled?: boolean` and forward it to
  `QuickAmountChip` (`QuickAmountChip` already accepts `disabled` natively).
- `packages/frontend/src/routes/-deposit.test.tsx` — new integration tests for
  the `PendingVerification` and `PendingClaim` locked cases, plus an editable
  case for `VerificationFailed` and an editable case for "no active request"
  (the last one is mostly already covered by existing tests; assert
  explicitly).

Out of scope (per Issue body):

- A small lock icon next to the input. The Figma references for `/deposit` do
  not show a lock affordance for this state; do not invent one.
- A tooltip explaining why the input is disabled.
- Auto-clearing the input on transition to `Completed` / `VerificationFailed`;
  the user can edit for a new flow themselves.
- Any change to `ConversionCard`, `QuickAmountChip`, `StepsCard`, or
  `StepRow` semantics. The only UI-package edit is the additive `disabled?`
  field on `QuickAmountItem`.

## Assumptions and Risks

- **Assumption — `activeRequest` selector is correct.** `deposit.tsx` already
  picks the latest active deposit request (status `PendingVerification` or
  `PendingClaim`) at lines ~125-135. Reuse this exact source of truth — do not
  introduce a parallel selector.
- **Assumption — `requestIsConfirmed` is *almost* equivalent.** Today
  `requestIsConfirmed` is true when `activeRequest !== null` OR when the local
  `requestDeposit.isSuccess && requestId !== undefined`. The Issue body
  explicitly anchors the lock on `activeRequest` (the API-confirmed request),
  not on the in-session local mock success. So introduce a distinct
  `isAmountLocked` flag derived only from `activeRequest`, not from
  `requestIsConfirmed`. This keeps the in-session "Confirm just clicked, API
  not yet caught up" window editable-but-irrelevant and avoids over-locking.
  (See Open Questions for the naming decision — go with `isAmountLocked`.)
- **Assumption — `formatUsdc(BigInt(activeRequest.amount), decimals)` is the
  right formatter.** `formatUsdc` already returns `"5,000.00"`-style strings;
  the Issue body specifies `.replace(/,/g, "")` so the value round-trips
  cleanly through `parseUsdc`. `formatUsdc` returns the sentinel `"—"` when
  `decimals === undefined`; we must guard against syncing that into the input.
- **Assumption — `QuickAmountItem` is the right place to add `disabled?`.**
  `QuickAmountChip` already supports `disabled` via its native
  `ButtonHTMLAttributes<HTMLButtonElement>` extension; `TokenInput` just
  doesn't forward it today. Adding `disabled?: boolean` to `QuickAmountItem`
  is an additive, backwards-compatible change. Existing call sites that omit
  the prop render unchanged.
- **Risk — sync loop.** Using a `useEffect` to copy `activeRequest.amount`
  into `amountInput` must guard against re-running on every render. Trigger
  the sync only when the locked state transitions from `false → true` (or
  when `decimals` becomes available while already locked) — never on every
  render, otherwise the user would be unable to edit even when momentarily
  unlocked.
- **Risk — `decimals` not ready while a request is active.** If `decimals`
  is `undefined` on first paint (still loading from `useToken`), we cannot
  format the amount yet. Don't crash, don't sync `"—"`. Defer the sync until
  `decimals !== undefined`. The input is already `disabled` while
  `!isConnected || !isReady`, so the user sees the same "loading" state as
  today.
- **Risk — multiple active requests.** The current selector already picks the
  most recent by `created_at`. The lock follows that same pick — no new
  selector.
- **Risk — `VerificationFailed` is NOT locked.** The current selector already
  filters to `PendingVerification` / `PendingClaim` only, so
  `VerificationFailed` correctly yields `activeRequest === null`. Behavior is
  preserved — the user can retry with a new amount.
- **Risk — interaction with #242 (PendingVerification step-2 loading).** Both
  Issues target the active-request scenario but at different surfaces. #242
  changed `loading` on step 2; #243 changes input + chips. They are
  independent and do not conflict. The same `activeRequest` source feeds both.

## Open Questions

_None_ — The Issue body's Open Question is resolved as: introduce a clearly
named `isAmountLocked` derived from `activeRequest` (PendingVerification or
PendingClaim) rather than reusing `requestIsConfirmed`, which is also true
during the brief local-mock window before the API picks up the new request.
The Issue body's own steer ("Prefer the latter for readability") confirms
this. No ambiguity remains.

## Implementation Steps

1. **Extend `QuickAmountItem` in `packages/ui/src/components/TokenInput/TokenInput.tsx`:**

   - Add `disabled?: boolean` to the `QuickAmountItem` interface.
   - In the `quickAmounts.map(...)` render block (line ~180), forward
     `item.disabled` to `<QuickAmountChip disabled={item.disabled} ... />`.
   - Update the JSDoc to mention the new field.
   - **Do not** touch `QuickAmountChip` itself; it already accepts `disabled`
     and renders the disabled styling (`disabled:opacity-50 disabled:cursor-not-allowed`)
     plus suppresses the click handler.

2. **Edit `packages/frontend/src/routes/deposit.tsx`:**

   a. **Add the `isAmountLocked` derivation** below the existing
      `isPendingVerification` / `isPendingClaim` derivations (~line 152):

      ```ts
      // The amount input is locked to the active request's amount whenever
      // the API reports a PendingVerification or PendingClaim deposit. This
      // anchors the displayed value to what's already committed on-chain.
      // VerificationFailed and "no active request" leave the input editable.
      const isAmountLocked = activeRequest !== null;
      ```

      (`activeRequest` is, by construction at lines ~125-135, non-null only
      when status is `PendingVerification` or `PendingClaim`, so this single
      check is sufficient.)

   b. **Sync `amountInput` from `activeRequest.amount` on lock transition.**
      Just below the existing `useEffect`s (~line 200) add a guarded effect:

      ```ts
      // When a deposit request becomes active (PendingVerification or
      // PendingClaim), copy its amount into the input so the displayed
      // value matches what's already committed on-chain. Do not auto-clear
      // the input when the request resolves — leave whatever the user last
      // sees for the next flow.
      useEffect(() => {
        if (!isAmountLocked) return;
        if (decimals === undefined) return;
        if (!activeRequest) return;
        const formatted = formatUsdc(
          BigInt(activeRequest.amount),
          decimals,
        ).replace(/,/g, "");
        setAmountInput(formatted);
        // Re-sync if the active request itself changes (different request_id)
        // or if decimals becomes available after lock. amountInput is
        // intentionally not a dep — we don't want the effect to fire on every
        // keystroke; the effect only re-runs when the inputs below change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [isAmountLocked, activeRequest?.request_id, activeRequest?.amount, decimals]);
      ```

      Notes for the coder:
      - Use `activeRequest?.request_id` and `activeRequest?.amount` (NOT the
        whole `activeRequest` object) to avoid stale-closure re-fires on
        every poll. The 60 s `useRequests` poll returns a fresh object each
        time even when the underlying request is unchanged.
      - Add the targeted `eslint-disable-next-line react-hooks/exhaustive-deps`
        only if the linter complains about omitting `setAmountInput`
        (stable from `useState`) — in practice it should not.

   c. **Disable the input on lock.** In the `ConversionCard` `input` prop
      (~line 261), extend the existing `disabled`:

      ```ts
      disabled: !isConnected || !isReady || isAmountLocked,
      ```

   d. **Disable each quick-amount chip on lock.** In the `quickAmounts`
      array (~line 262), add `disabled: isAmountLocked` to every chip:

      ```ts
      quickAmounts: [
        {
          label:
            minDeposit !== undefined && decimals !== undefined
              ? `${formatUsdcCurrency(minDeposit, decimals)} (Min)`
              : "Min",
          disabled: isAmountLocked,
        },
        { label: "$5,000", disabled: isAmountLocked },
        { label: "$10,000", disabled: isAmountLocked },
        { label: "Max", disabled: isAmountLocked },
      ],
      ```

   e. **Belt-and-suspenders on the click handler.** In `onQuickAmount`
      (~line 221), early-return when `isAmountLocked` so a stale event
      cannot mutate `amountInput` even if the chip's `disabled` is bypassed
      somehow (defensive; the disabled chip won't fire `onClick`, but this
      keeps the contract explicit):

      ```ts
      const onQuickAmount = useCallback(
        (idx: number) => {
          if (isAmountLocked) return;
          if (decimals === undefined) return;
          // ... existing body ...
        },
        [decimals, minDeposit, balance, isAmountLocked],
      );
      ```

   f. **Update the route-level JSDoc** at the top of `deposit.tsx`
      (lines ~22-70) to add a short paragraph documenting the lock
      behaviour, mirroring the "State machine" section's style:

      > **Amount input lock:** whenever `activeRequest` is non-null
      > (status `PendingVerification` or `PendingClaim`), the input value
      > is synced from `activeRequest.amount` and both the input and the
      > four quick-amount chips are disabled. The lock releases when the
      > request resolves (Completed / VerificationFailed / cleared); the
      > input is not auto-reset.

3. **Tests — extend `packages/frontend/src/routes/-deposit.test.tsx`:**

   Add a new `describe` block titled `"Deposit page — locked amount on active request"`
   (placed after the existing `"three-step flow"` describe). Mocks already
   support `mockRequestsData`. Reset it in `beforeEach`/`afterEach` per the
   existing pattern.

   Cases:

   a. **`PendingVerification` locks the input to the request amount.**
      ```ts
      mockRequestsData = {
        requests: [{
          type: "Deposit",
          request_id: "42",
          amount: "5000000",        // 5 USDC at 6 decimals
          status: "PendingVerification",
          created_at: new Date().toISOString(),
        }],
      };
      ```
      Assertions (use `waitFor`):
      - `(input as HTMLInputElement).value === "5.00"` — matches what
        `formatUsdc(5_000_000n, 6).replace(/,/g, "")` returns.
      - `(input as HTMLInputElement).disabled === true`.

   b. **`PendingClaim` also locks.** Same as (a) but
      `status: "PendingClaim"`. Same assertions.

   c. **Quick-amount chips are disabled while locked.** Reuse the
      `PendingVerification` mock; assert every chip is disabled:
      ```ts
      const chips = screen.getAllByRole("button");
      const min = screen.getByRole("button", { name: /\(Min\)/ });
      const max = screen.getByRole("button", { name: "Max" });
      expect(min).toBeDisabled();
      expect(max).toBeDisabled();
      // $5,000 / $10,000 chips
      expect(screen.getByRole("button", { name: /5,000/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /10,000/ })).toBeDisabled();
      ```

   d. **Clicking a disabled chip does not mutate the input.** While locked
      with a `PendingVerification` request (`amount: "5000000"`), attempt
      `user.click(maxChip)` and assert the input still reads `"5.00"`.
      (HTML disabled buttons don't fire `onClick`; this is mostly a
      regression guard.)

   e. **`VerificationFailed` is NOT locked — input editable.**
      ```ts
      mockRequestsData = {
        requests: [{
          type: "Deposit",
          request_id: "42",
          amount: "5000000",
          status: "VerificationFailed",
          created_at: new Date().toISOString(),
        }],
      };
      ```
      Assert the input is **not** disabled and that typing into it works
      (`user.type(input, "1234"); expect(input.value).toBe("1234")`).
      Assert chips are not disabled (`expect(min).not.toBeDisabled()`).

   f. **No active request → input editable (regression).** Already covered
      by existing tests, but add an explicit assertion in the new describe
      block for completeness: `mockRequestsData = { requests: [] };` →
      input not disabled.

   g. **Lock releases when request transitions away.** Render with
      `PendingClaim` mock, then rerender with `mockRequestsData = { requests: [] }`
      and assert the input becomes editable. *Note for coder:* if
      `mockRequestsData` is read inside the hook closure and React Query
      caches the previous response, a forced rerender (e.g. unmount/remount
      via a `rerender` call from RTL) may be required. If the existing mock
      seam doesn't easily support this transition (it's a module-level
      `let`), this case may be deferred — the lock-transition logic is
      verified in (a), (b), and (e) above. Document the decision in the
      test comment.

   h. **Sync happens once on transition, not on every poll.** Optional but
      valuable: render with the locked state and a stable `amount`, then
      simulate a user typing in the (still-disabled) input via the
      lower-level `fireEvent.change(input, { target: { value: "999" } })`
      — note this should be a no-op because `disabled` blocks the
      `onChange`. Skip this case if it adds more friction than value;
      coverage from (a)+(d) is sufficient.

4. **Run the full frontend test suite** and lint:

   ```bash
   cd packages/frontend && yarn vitest run src/routes/-deposit.test.tsx
   cd packages/frontend && yarn lint
   npx tsx scripts/lint-docs.ts
   ```

   Ensure no regressions in any pre-existing `-deposit.test.tsx` case
   (Approve, Confirm, Insufficient balance, Quick chips, Disconnected,
   minDeposit gating, Min chip label, three-step flow).

## Test Strategy

Unit / integration tests (vitest + React Testing Library) in
`packages/frontend/src/routes/-deposit.test.tsx`, plus a small
visual-styling sanity in the UI package only if the additive
`QuickAmountItem.disabled` change warrants it (it does not — the prop is
already exercised through `QuickAmountChip`'s own stories/tests).

New tests (per step 3 above):

- `PendingVerification` → input value matches `formatUsdc(amount, 6)`, input
  disabled, chips disabled, click on a disabled chip is a no-op.
- `PendingClaim` → same lock behavior.
- `VerificationFailed` → input editable, chips enabled.
- No active request → input editable (explicit assertion in the new block).
- Optional: lock release on transition (deferred if mock seam doesn't
  support a clean unmount/rerender).

Regression coverage already in the file (must continue to pass):

- Approve / Approved flows (input editable, no `mockRequestsData`).
- Insufficient balance banner.
- Quick-amount chips (Min / Max) when no active request.
- Disconnected wallet.
- minDeposit gating.
- Three-step flow (Approve, Confirm, Claim labels and disabled states).
- #242 — PendingVerification → step 2 spinner / non-greyed row.

Edge cases worth coding into the test (not all required):

- `decimals === undefined` at first paint while `activeRequest` is already
  populated → input should stay disabled but NOT show `"—"` as a value
  (the sync effect early-returns until `decimals` is defined). A targeted
  test for this requires manipulating `mockUseReadContract` to return
  `undefined` for `decimals`; if the existing seeded mocks always provide
  `decimals === 6`, this can be a code-review-only invariant.

Manual / UX verification (post-merge, optional):

- The Issue does not link a Figma node for the locked state. The Figma
  reference at the top of `deposit.tsx` (`1498-100812`) and #235's nodes
  cover the editable state only. There is no design diff to verify; lean
  on the unit tests and a quick spot-check at `/deposit` with a wallet
  that has a `PendingVerification` request seeded via the DevTools mock
  panel.

## Docs to Update

- **JSDoc in `packages/frontend/src/routes/deposit.tsx`** — add the "Amount
  input lock" paragraph described in step 2.f.
- **JSDoc in `packages/ui/src/components/TokenInput/TokenInput.tsx`** —
  add a one-line mention of the new `QuickAmountItem.disabled?` field.
- **No product spec change required.** The change is a small, contained
  UX clarification; the three-step flow's intent (operate on the
  already-on-chain request) is already documented in #235's spec.
- **No `docs/STORIES.md` update required.** The locked-input behavior is
  implicit in the active-request scenarios already covered by the
  three-step story; no new user story is introduced.
- **No `docs/exec-plans/known-bugs.md` or `tech-debt-tracker.md` entries**
  — this is the planned fix itself.
