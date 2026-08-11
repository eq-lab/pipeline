# Issue #991: Convert flow-defining inline comments in frontend code into readable specs

Source: https://github.com/eq-lab/pipeline/issues/991

## Scope

The frontend packages carry ~7,300 comment lines (`packages/frontend/src` ~5,000 / 220 files,
`packages/trustee/src` ~1,560 / 126 files, `packages/ui/src` ~750 / 70 files). A large share of
these are not clarifying tricky code — they encode **behavior, architecture, layout/typography
rules, and Figma bindings** that belong in a reviewable spec. Examples confirmed during research:

- `packages/frontend/src/wallet/useDepositFlow.ts` — a ~30-line header docblock titled
  *Architecture / FlowState shape / Design choices* that is, verbatim, a frontend architecture
  spec for the chain-agnostic deposit/withdraw adapter.
- `packages/frontend/src/components/EarnedCard.tsx` — inline comments spelling out typography
  tokens, ink roles, responsive breakpoints, and Figma node IDs (e.g. `heading-s-mobile = 18px /
  28px (Figma node 1989:9030)`). Note: `docs/FRONTEND.md` **already** documents this exact
  behavior ("Typography token responsive behavior") — so the inline copy is duplicated drift-risk.

**In scope:**
- Establish an authoritative **comment-vs-spec rubric** and record it as a new Code-structure rule
  in `docs/FRONTEND.md` (§Code structure rules) so the standard is enforceable at review time.
- Define **where extracted specs live** (see Open Questions for the one unresolved home).
- Migrate flow-/design-defining comments out of frontend source into the appropriate doc, leaving
  behind at most a one-line pointer (`// spec: docs/frontend/wallet-flows.md#deposit-adapter`).
- Reduce inline comments to genuinely non-obvious *code* explanations (workarounds, ordering
  constraints, why-nots).
- Execute as **phased, area-batched PRs** (not one mega-PR), starting with a small pilot batch to
  validate the rubric before mass rollout.

**Out of scope:**
- Any behavioral/functional change to components, hooks, or flows. This is a docs + comment-hygiene
  pass only; rendered output and logic must be byte-for-byte equivalent.
- Renaming/restructuring files, extracting new utils/hooks, or changing the view/logic split
  (those are separate `docs/FRONTEND.md` rules 1–5, not this issue).
- Test files (`*.test.ts(x)`), `*.stories.tsx`, and generated files (`routeTree.gen.ts`) — their
  comments are test/story narration, not product spec. Left untouched.
- Backend / Rust / worker packages.

## Assumptions and Risks

- **Assumption:** `docs/FRONTEND.md` and `docs/frontend/` are the correct home for frontend-internal
  architecture/design specs (as opposed to `docs/product-specs/`, which captures product *intent*
  for users/agents). The wallet-flow docblocks are engineering architecture, not product intent, so
  they fit `docs/frontend/` better — but the exact file layout is an Open Question.
- **Risk — scale.** 400+ files touched if done exhaustively. Mitigated by area batching + a hard
  rule that each PR stays reviewable (one area, no logic changes) so the human merger can diff fast.
- **Risk — judgment drift.** "Spec vs comment" is a judgment call; different batches could apply it
  inconsistently. Mitigated by codifying the rubric in `docs/FRONTEND.md` **first** and piloting it
  on 3 exemplar files before the bulk work.
- **Risk — losing information.** Deleting a comment without faithfully carrying its content into a
  spec loses knowledge. Mitigated by the rule: a comment is only removed once its content exists in
  a doc (extract-then-trim, never trim-then-maybe-document).
- **Risk — lint-docs.** `npx tsx scripts/lint-docs.ts` validates doc structure; new/edited docs must
  pass it. New docs must be linked from an index (`docs/frontend/index.md`) per existing convention.
- **Risk — regression over time.** Without a guard, comments creep back. See Open Questions re: an
  optional lint rule.

## Open Questions

_Resolved with the issue author on 2026-07-31:_

- **Doc home for per-area behavior/flow specs** → **new topic files under `docs/frontend/`**
  (`wallet-flows.md`, `dashboard-components.md`, `trustee-flows.md`, …), each linked from
  `docs/frontend/index.md`. Keeps frontend architecture beside the existing utils/hooks catalogues.
- **Issue shape** → **#991 becomes an epic**; each area (wallet, dashboard, trustee, ui) gets a
  `docs` sub-issue + PR that closes independently. Phase 0 (rubric + scaffolding) is its own
  sub-issue.
- **Package scope / order** → **all three packages, ordered `frontend` → `trustee` → `ui`**
  (wallet flows first — highest density and most spec-like; `ui` last — mostly Figma bindings).
- **Regression guard** → **`docs/FRONTEND.md` rule + review discipline for now**; revisit a lint
  rule (flagging over-long `packages/*/src` header docblocks) after the backlog clears. Logged as a
  tech-debt follow-up rather than built in this pass.

## Implementation Steps

**Phase 0 — Rubric + doc scaffolding (single PR, unblocks everything):**
1. Add a new rule to `docs/FRONTEND.md` §Code structure rules — **"6. Comments describe code;
   specs describe behavior."** State the test: if a comment explains *what the feature/flow must do*
   (behavior, architecture, layout/typography rules, Figma bindings, state machines, business
   logic) → it is a spec and lives in a doc. If it explains a non-obvious line of *code* (a
   workaround, an ordering constraint, a why-not) → it stays inline and stays short. Include the
   `EarnedCard.tsx` / `useDepositFlow.ts` before/after as the worked example.
2. Once the Open Question on doc home is answered, create the empty topic doc(s) under
   `docs/frontend/` and link them from `docs/frontend/index.md`. Ensure `scripts/lint-docs.ts`
   passes.

**Phase 1 — Pilot batch (single PR, validates the rubric on 3 files):**
3. `packages/frontend/src/wallet/useDepositFlow.ts` — move the Architecture/FlowState/Design-choices
   docblock into `docs/frontend/wallet-flows.md`; leave a one-line pointer at the top of the hook.
4. `packages/frontend/src/components/EarnedCard.tsx` — remove the typography/Figma comments already
   captured by `docs/FRONTEND.md` "Typography token responsive behavior"; where that doc is missing
   a detail (e.g. specific Figma node IDs), add it there, then delete the inline copy.
5. `packages/trustee/src/routes/-useLoanDetail.ts` — extract flow narration into the trustee-flows
   doc; keep only code-level comments.
6. Verify: `tsc`, `yarn lint`, `vite build`, and existing unit tests all green; rendered output
   unchanged. Human-review the pilot PR to confirm the rubric produces the desired result before
   scaling.

**Phase 2 — Area rollout (one PR per area, ordered by density/spec-likeness):**
7. **Wallet flows** — `packages/frontend/src/wallet/**` (`useStakeFlow.ts`,
   `stellar/useStellarStakedPlusd.ts`, `evm/useDepositManager.ts`, `evm/useStakedPlusd.ts`,
   `stellar/mock.ts`, etc.). Highest-value area.
8. **Dashboard / LP components** — `packages/frontend/src/components/**`, `src/routes/**`
   (`LoanBookTable.tsx`, `routes/deposit.tsx`, `routes/index.tsx`, …).
9. **Trustee** — `packages/trustee/src/**` (`api/useLoanBook.ts`, `routes/-useLoansTable.ts`,
   `auth/TrusteeSessionProvider.tsx`, `routes/loans.$id.tsx`, `-record-*.ts`).
10. **UI package** — `packages/ui/src/**` (mostly Figma-binding comments; confirm scope first).
11. For each area PR: extract → document → trim to a pointer; run the full check gate (step 6);
    update the relevant `docs/frontend/*.md` in the same PR.

**Ordering / dependency note:** Phase 0 gates Phases 1–2 (rubric + doc home must exist first). The
doc-home Open Question blocks Phase 0 step 2 onward.

## Test Strategy

This is a no-behavior-change refactor, so the test bar is **"prove nothing changed" + "docs are
valid"**:

- `npx tsx scripts/lint-docs.ts` — must pass for every new/edited doc (structure + links).
- `tsc --noEmit` (per affected package) — comment removal must not touch types; catches accidental
  code edits.
- `yarn lint` (ESLint/Prettier) on touched packages — no new violations.
- `vite build` for `packages/frontend` and `packages/trustee` — build stays green.
- Existing unit tests (`*.test.ts(x)`) run unchanged and stay green — they are the regression net
  proving logic is untouched.
- **Per-PR diff discipline:** the reviewer confirms every hunk is a comment/doc change (no
  executable-line diffs). Any non-comment line change in a supposedly comment-only PR is a defect.
- No new tests are added — there is no new behavior to test. (Documented here to satisfy the
  mandatory Test Strategy section.)

## Docs to Update

- `docs/FRONTEND.md` — new Code-structure rule "6. Comments describe code; specs describe behavior."
- `docs/frontend/index.md` — link any new topic docs.
- New topic docs under `docs/frontend/` (names pending the doc-home Open Question), e.g.
  `wallet-flows.md`, `dashboard-components.md`, `trustee-flows.md`.
- `docs/exec-plans/tech-debt-tracker.md` — if any area is deferred rather than completed, log the
  remaining backlog there so the cleanup is tracked.
