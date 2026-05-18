# Issue #234: Render 'Done' state for both Approve and Convert steps on /deposit

Source: https://github.com/eq-lab/pipeline/issues/234

## Scope

**Recommendation: Close #234 as fully subsumed by #235 / merged PR #237.**

#234 asked to extend the `/deposit` page state machine so that both on-chain
steps render a terminal "Done" state (green checkmark badge) when their
transaction confirms. At the time the Issue was filed, `/deposit` had two
steps and only step 1 transitioned to a success state.

Since then, PR #237 ("Three-step /deposit flow: Approve, Confirm, Claim",
commit `9b4abc4` on `main`) replaced the two-step flow with three steps and
wired every step's `state` field through to `StepsCard`. On current `main`
each step is driven by a derived `stepNState` constant that resolves to
`"success"` when its phase is complete:

- Step 1 (`step1State`) → `"success"` when `!needsApproval && amountBig > 0n &&
  isConnected` OR a confirmed request exists.
  (`packages/frontend/src/routes/deposit.tsx:178-181`)
- Step 2 (`step2State`) → `"success"` when `isPendingClaim || claim.isSuccess`.
  (`packages/frontend/src/routes/deposit.tsx:184-185`)
- Step 3 (`step3State`) → `"success"` when `claim.isSuccess`.
  (`packages/frontend/src/routes/deposit.tsx:188`)

`StepsCard` already supports `state: "success"` (used in three places in the
deposit page render block, `deposit.tsx:317-348`).

The "reset on amount change" concern raised in #234's body is also obviated:
state is now sourced from `useRequests` (polled API) + `useDepositVoucher` +
`claim.isSuccess`, not from an ephemeral `requestDeposit.isSuccess` latch tied
to the amount input. Editing the amount does not produce a stale Done state
because the gates (`canApprove`, `canConfirm`, `canClaim`) keep the buttons
disabled only when the on-chain / API reality says the request is in progress.

## Assumptions and Risks

- Assumes the current `main` (`9b4abc4`) is the implementation baseline. If
  Issue #234 was filed against the two-step model (per its body referencing
  "Approve" + "Convert"), the rewrite in #237 changed the underlying model
  entirely; the literal copy ("Convert") no longer exists, so #234's text is
  stale.
- Risk: there may be a residual UX gap not covered by #237 that the human who
  filed #234 cared about — e.g. visual polish of the Done badge, or a Done
  state for step 3 in a particular intermediate condition. We have not
  verified pixel-fidelity against Figma node `1998:699` (the node referenced
  in #234 which the Issue itself flagged as unresolvable).

## Open Questions

- Should #234 be closed as a duplicate of #235, or kept open to track a
  narrower follow-up (e.g. visual-fidelity check against Figma node
  `1998:699`)? Recommend closing — `1998:699` is an obsolete reference
  predating the three-step redesign at node `1498:100812`.
- Is there any behaviour the human reviewer expected from #234 that is *not*
  visible in the merged #237 implementation? If so, we need a concrete
  description before re-planning.

## Implementation Steps

If, after answering the Open Questions above, the human confirms #234 is
subsumed:

1. Manager closes Issue #234 with a comment linking to PR #237 and explaining
   that the three-step rewrite already wires `state: "success"` for all
   steps. No code change.
2. No execution plan to implement; this file documents the analysis and is
   moved to `docs/exec-plans/completed/` together with the close.

If the human flags a residual gap, re-plan against the specific concrete
behaviour — do not re-open the original two-step framing, which is obsolete.

## Test Strategy

No new tests required for the close path. The behaviours #234 originally
asked for are already covered by tests added in PR #237 — see
`packages/frontend/src/routes/-deposit.test.tsx` (success/done states across
the three steps).

## Docs to Update

- None for the close path. If we re-plan a residual gap, that follow-up plan
  will list its own docs updates.
