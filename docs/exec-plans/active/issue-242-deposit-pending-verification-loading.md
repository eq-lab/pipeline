# Issue #242: Step 2 looks disabled on /deposit when request is PendingVerification — should show pending

Source: https://github.com/eq-lab/pipeline/issues/242

## Scope

Fix the visual state of step 2 ("Confirm USDC transfer") on `/deposit` when the
connected wallet has an active deposit request in status `PendingVerification`.

Today, in that situation, step 2 renders idle and greyed out (disabled idle
button) because `canConfirm = false` AND `loading = false` AND `state = "idle"`.
The user can't tell anything is happening between submitting a request and the
verifier marking it `PendingClaim`.

Target behavior: step 2 renders in the loading affordance (spinner-in-button,
full row opacity) while the request status is `PendingVerification`. The button
stays non-clickable in this state — the user cannot re-confirm — but visually it
reflects "waiting on verifier."

In scope:

- `packages/frontend/src/routes/deposit.tsx` — derive an `isPendingVerification`
  flag from `activeRequest` and feed it into step 2's `loading` prop.
- New integration test in `packages/frontend/src/routes/-deposit.test.tsx`
  covering the PendingVerification → loading affordance case.

Out of scope (per Issue body):

- Adding a textual "Verifying…" label under the button.
- A timeout / failure visual when verification stalls.
- Behavior when the request is `VerificationFailed` (separate bug Issue).
- Changes to `StepsCard` / `StepRow` primitives — the existing semantics
  (`loading=true` keeps the row at full opacity even when `disabled=true`) are
  sufficient (verified by reading
  `packages/ui/src/components/StepRow/StepRow.tsx` line 105:
  `disabled && !isSuccess && !loading ? "opacity-30" : ""`).

## Assumptions and Risks

- **Assumption — StepRow semantics already cover the case.** `StepRow` only
  applies `opacity-30` when `disabled && !isSuccess && !loading`. So when we set
  `loading: true`, the row renders at full opacity regardless of `disabled`, and
  the action button shows the spinner via `aria-busy={loading}` and the inline
  spinner span. This means no `StepsCard` / `StepRow` changes are needed.
- **Assumption — `activeRequest` is already populated correctly.** The
  `useRequests` hook is polled every 60 s and the selector at
  `deposit.tsx:123-133` already picks the latest `PendingVerification` or
  `PendingClaim` deposit. So `activeRequest?.status === "PendingVerification"`
  is a stable, available signal.
- **Risk — long verifier latency.** With a 60 s poll interval the user may see
  the spinner for a long time before it transitions to step 3. That's accepted
  by this Issue (a textual progress label is explicitly out of scope). No
  change here.
- **Risk — interaction with `requestIsConfirmed`.** `requestIsConfirmed` is
  `true` when `activeRequest !== null`, so `canConfirm` is `false` while
  `PendingVerification`. We must keep the button non-clickable, so the
  disabled-but-loading combination is intentional — `StepRow` passes
  `disabled || loading` to the underlying `<Button>`, so the click handler
  cannot fire either way. No regression risk for callers.
- **Risk — local-only `requestDeposit.isSuccess` window.** The existing
  fallback `requestDeposit.isSuccess && !requestIsConfirmed && activeRequest === null`
  on the `loading` prop still needs to fire when the API hasn't yet observed
  the new request. Keep it.

## Open Questions

_None_

## Implementation Steps

1. **[DONE] Edit `packages/frontend/src/routes/deposit.tsx`:**
   - Just below the existing `isPendingClaim` derivation (line ~147), add:

     ```ts
     const isPendingVerification =
       activeRequest?.status === "PendingVerification";
     ```

   - In the step 2 descriptor inside the `StepsCard` `steps` array (line ~323),
     update the `loading` prop to include `isPendingVerification`:

     ```ts
     {
       label: "Confirm USDC transfer",
       actionLabel: "Confirm",
       disabled: !canConfirm,
       loading:
         requestDeposit.isPending ||
         isPendingVerification ||
         (requestDeposit.isSuccess &&
           !requestIsConfirmed &&
           activeRequest === null),
       state: step2State,
       onAction: () => requestDeposit.write(amountBig),
     },
     ```

     Keep `disabled: !canConfirm` as-is. Because `canConfirm` is already `false`
     while `requestIsConfirmed === true` (which is the case during
     `PendingVerification`), the button stays non-clickable. The `loading`
     branch on `StepRow` ensures the row is not greyed.

2. **[DONE] Update the route-level JSDoc** in the same file:
   - Tweak the comment block on step 2 (lines ~31-34) to call out that step 2
     enters a loading affordance while the API reports `PendingVerification`,
     not just while the in-session `requestDeposit` write is pending.

3. **[DONE] Add a test in `packages/frontend/src/routes/-deposit.test.tsx`:**
   - In the existing "Deposit page — three-step flow" `describe`, add a new
     `it` after the `"step 2 shows Done badge when request status is PendingClaim"`
     case:

     ```ts
     it("step 2 shows loading affordance (not greyed) when request status is PendingVerification", async () => {
       mockRequestsData = {
         requests: [
           {
             type: "Deposit",
             request_id: "42",
             amount: "2000000000",
             status: "PendingVerification",
             created_at: new Date().toISOString(),
           },
         ],
       };
       renderDeposit();

       const confirmBtn = await screen.findByRole("button", { name: "" });
       // Confirm button is disabled (user cannot re-submit) but shows
       // aria-busy="true" (spinner visible) so the row reads as active.
       await waitFor(() => {
         const btn = screen.getByRole("button", { name: /confirm/i, hidden: true })
           ?? screen.getAllByRole("button").find(b => b.getAttribute("aria-busy") === "true");
         // ...
       });
     });
     ```

     Practical assertions (use whichever combination is stable against
     `StepRow`'s spinner-replaces-text rendering — when `loading=true`,
     `actionLabel` is replaced by a spinner span, so the button is no longer
     queryable by `name: "Confirm"`):

     - Locate step 2's button via `data-testid` on the StepRow if available,
       OR via `getAllByRole("button")` and filter by `aria-busy === "true"`,
       OR by adding `aria-label` to `StepRow` only if no other path works
       (additive; do not break existing call sites).
     - Assert the matched button has `aria-busy="true"`.
     - Assert the button is disabled (it must remain non-clickable).
     - Assert the row's parent does NOT have `opacity-30` (query the closest
       row container and check its `className`).

   - If selector stability is shaky, the simplest reliable assertion is:
     `expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument()`
     (because while loading, the text "Confirm" is replaced by the spinner)
     paired with `expect(screen.getAllByRole("button").some(b => b.getAttribute("aria-busy") === "true")).toBe(true)`.
     This unambiguously distinguishes the buggy "Confirm idle disabled" state
     (still queryable by name) from the fixed "spinner active" state.

4. **[DONE] Run the test suite** to confirm:
   - New PendingVerification test passes.
   - Existing `PendingClaim` test (`step 2 shows Done badge ...`) still passes.
   - Existing `Approve needed` and `approved` flows still pass.

## Test Strategy

Unit / integration tests (vitest + React Testing Library) in
`packages/frontend/src/routes/-deposit.test.tsx`:

- **New: PendingVerification → active loading affordance.**
  Mock `useRequests` with a single `Deposit` whose status is
  `PendingVerification`. Assert:
  - The button labelled `Confirm` is no longer present by accessible name
    (because `StepRow` replaces the label with a spinner when `loading=true`).
  - At least one button in the StepsCard has `aria-busy="true"`.
  - The step 2 row container does NOT carry the `opacity-30` class.
  - The active "spinner" button is still `disabled` (the user cannot
    re-trigger `requestDeposit.write`).

- **Regression: PendingClaim → success badge.**
  Existing test in the same describe block continues to pass — step 2 shows the
  `Done` badge when `status === "PendingClaim"`.

- **Regression: Approved + no active request → Confirm enabled.**
  Existing "Confirm button is enabled when allowance covers the entered amount"
  test continues to pass.

- **Regression: Disconnected wallet → Confirm disabled (idle, not loading).**
  Existing "renders all step buttons as disabled when disconnected" test
  continues to pass — `Confirm` should still be queryable by name (because
  `loading` is false in this scenario).

Edge cases worth covering if implementation introduces them (not required by
this Issue but listed for the coder's awareness):

- `activeRequest.status === "PendingVerification"` while the user's wallet
  changes mid-session — `useRequests` should re-poll and `activeRequest` should
  flip to `null`. This is governed by `useRequests` and out of scope here.

Manual / UX verification (optional, post-merge):

- The Issue does not reference a Figma node for this state — the Figma node
  `1497-95272` covers step 2's enabled state, not the verifier-waiting state.
  Skip the Figma diff step; lean on the unit test.
- Connect a wallet that has an existing `PendingVerification` request,
  reload `/deposit`, confirm: step 2 row is full opacity, button shows
  spinner, no click possible.

## Docs to Update

- **JSDoc** in `packages/frontend/src/routes/deposit.tsx` — adjust the step 2
  description to mention the PendingVerification loading affordance.
- No product spec or design doc change required: this is a bug fix that aligns
  the UI with the intent already described in the JSDoc and in #235.
- No changes to `docs/STORIES.md` — this case is implicit in the three-step
  flow story; no new user story is introduced.

