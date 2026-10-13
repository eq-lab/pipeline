# Issue #1034: Reusable error UX: generic message + expandable details dialog (raw Soroban errors leak into the stepper)

Source: https://github.com/eq-lab/pipeline/issues/1034

Branch: `feat/1034-error-details-dialog` (cut from `origin/main`)

## Scope

### The bug this fixes

`/deposit?direction=deposit` with an amount above ~5M USDC makes step 3 ("Confirm USDC transfer")
render the **raw Soroban simulation error** — `DepositManager.request_deposit simulation error:
HostError: Error(Contract, #3) Event log (newest first): 0: [Diagnostic Event] contract:CB3CW…,
topics:[error, Error(Contract, #3)], data:"escalating error to VM trap from failed host function
call: fail_with_error" …` — as the red line under the step label.

The mechanism (`StepRow` `state="error"` + `errorMessage`, added by #1024) is correct. The **content**
is not: the string is produced verbatim at
`packages/frontend/src/wallet/stellar/contracts/depositManager.ts:228`
(`throw new Error(\`DepositManager.request_deposit simulation error: ${simResult.error}\`)`, where
`simResult.error` is the stellar-sdk simulation error including the full diagnostic event log) and is
piped straight through:

- `packages/frontend/src/wallet/stellar/useStellarDepositManager.ts:330` → `setError(…)`
- `packages/frontend/src/wallet/useDepositFlow.ts:1269-1275` → `errorMessage: (…).error?.message`
- `packages/ui/src/components/StepRow/StepRow.tsx:154-161` → renders it as-is.

There are **four** such raw pass-throughs in `useDepositFlow.ts` (`:934-938`, `:960-963`,
`:1269-1275`, `:1316-1320`), and the same raw strings also reach the dashboard panels
(`useBalanceSheetPanel.ts:182`, `useDeploymentMonitorPanel.ts:133,158`,
`useWithdrawalQueuePanel.ts:106`, `useYieldHistoryPanel.ts:136`).

### In scope

1. **`ErrorDetailsDialog`** — new shared component in `@pipeline/ui`: a modal showing the full raw
   error in a scrollable monospace `<pre>` with a copy-to-clipboard button.
2. **`InlineError`** — new shared component in `@pipeline/ui`: the *inline* half of the pattern — one
   short human line + an optional "View details" trigger that owns the dialog's open state. This is
   the piece adopted at each error surface. (Two components because `docs/FRONTEND.md` rule 1 is one
   component per file, and rule 2 keeps `StepRow`/`StepsCard` view-only — see
   [Assumptions and Risks](#assumptions-and-risks).)
3. **A message-mapping layer** — `toUserError(err: unknown): { message: string; details: string }`.
   `message` is human copy (specific where the shape is recognised, generic otherwise); `details` is
   the normalized raw text for the dialog. Extends the #1024 `toError` normalizer. Recognised shapes:
   Soroban `Error(Contract, #N)`, wallet/user rejections, EVM revert dumps, HTTP/API failures.
   **Raw text never renders inline.**
4. **Adoption sweep in the LP app (`packages/frontend`)**:
   - `StepRow`/`StepsCard` gain an `errorDetails` prop; `errorMessage` becomes the *mapped* line.
   - `useDepositFlow` — all four error derivations route through `toUserError`.
   - `useStakeFlow` — gains the `"error"` step state it currently lacks entirely
     (`useStakeFlow.ts:47`: `StakeStepState = "idle" | "success"`), mirroring #1024's derivation, so
     stake/unstake failures stop being toast-only.
   - Danger toasts in `routes/deposit.tsx` (`:253-262`, `:326-328`) and `routes/stake.tsx`
     (`:143-152`) — use the mapped **specific** message as the toast title when the mapper recognised
     the shape, otherwise keep today's hardcoded generic title.
   - Dashboard panel hooks (the four listed above) — route their `error.message` through the mapper.
5. **Docs** — a new `docs/frontend/error-handling.md` spec, linked from `docs/frontend/index.md`;
   catalogue rows in `docs/frontend/utils.md`; one-line `// spec:` pointers in code per rule 6.

### Out of scope (log as follow-ups, do not implement)

- **Trustee app surfaces** (`-useOriginationReview.ts:150`, `-record-repayment.ts:122`
  `mapWaterfallError`, `-record-coupon.ts:120`, `-RejectReasonDialog.tsx` error line). They already
  map to friendly copy and never print raw text, so they are not leaking. File a follow-up sub-issue
  to adopt `InlineError` + `ErrorDetailsDialog` there and consolidate the two duplicated
  `mapWaterfallError` copies.
- **Pre-submit amount validation** against the $5M per-transaction / $10M rolling-24h caps
  (`GET /v1/protocol/limits`, already specified in `docs/product-specs/deposits.md:116` and
  `docs/product-specs/user-stories.md:125` but **not implemented** in the LP app — no call site
  exists). This is the real fix for the reported scenario; file it as a separate sub-issue.
- **Typing `packages/frontend/src/api/client.ts`** — it throws an untyped `new Error(message)` at
  `:83`, discarding the HTTP status, which is why four voucher hooks resort to
  `msg.includes("Not Found")` string matching (`api/useDepositVoucher.ts:110-118` and three
  siblings). `packages/trustee/src/api/client.ts:32-48` already has the `ApiError { message, status }`
  class to lift. Porting it is a separate refactor; this issue's HTTP mapping works off the message
  text only. Log as tech debt.
- `packages/frontend/src/routes/test.tsx` (dev-only harness, `:343`, `:420`, static toasts).
- Changing what the wallet hooks *throw*. The developer-facing strings
  (`[requestDeposit] Transaction … failed with status …`, `simulation error: …`) stay as-is — they
  are the `details` payload. Only the display layer changes.

## Assumptions and Risks

- **`packages/ui` has no test runner.** No `test` script, no `vitest` dependency, zero `*.test.*`
  files. The established workaround is to DOM-test `@pipeline/ui` components from the frontend's
  jsdom environment — see `packages/frontend/src/lib/toast/Toast.dom.test.tsx:1-17`, whose header
  explicitly records this as the chosen fallback. This plan follows that precedent rather than adding
  a new runner to `packages/ui`.
- **`NetworkSwitchDialog` is on an unmerged branch.** The dialog idiom cited by the issue lives at
  `packages/ui/src/components/NetworkSwitchDialog/NetworkSwitchDialog.tsx` on
  `origin/feat/1032-network-switcher` (PR #1033), not on `main`. **Do not import it and do not depend
  on it.** Copy the *shell* pattern (fixed backdrop `bg-[rgba(38,37,36,0.4)]`, `w-[440px]
  max-w-[calc(100vw-32px)]`, `rounded-[6px] bg-white`, `shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]`,
  `role="dialog"` + `aria-modal` + `aria-labelledby`, Escape listener, backdrop click closes, initial
  focus). The equivalent already on `main` is
  `packages/trustee/src/routes/-RejectReasonDialog.tsx:78-155` — same shell, 640px wide. Use the
  440px `NetworkSwitchDialog` proportions since this dialog is informational, not a form.
- **`packages/ui/src/index.ts` will conflict with PR #1033.** Both branches append export lines to the
  end of the same file. The conflict is trivial (keep both). **Merge order: land #1033 first**, then
  rebase this branch — otherwise #1033 inherits the conflict.
- **Contract error `#3` is not resolvable from this repo.** The Soroban contracts are not vendored
  (`Cargo.toml` workspace members are `packages/api`, `packages/worker`, `packages/shared` — the Rust
  backend only), and `docs/generated/stellar-protocol-contracts.md` documents the interface but
  contains **no `#[contracterror]` enum**. Circumstantial evidence that `#3` is an amount/limit guard:
  the reported threshold is ~5M and `docs/user-docs/lenders/deposit.md:49` states "A single deposit
  cannot exceed $5M", `docs/references/smart-contracts.md:195` gives `maxPerLPPerWindow` default
  `5_000_000e6`, and `docs/product-specs/deposits.md:29-31` lists the cap guards in positions 2–4
  after `BelowMinimum`. Prior art for the same guesswork problem: `#13` = "trustline entry is missing"
  (`docs/exec-plans/completed/issue-604-stellar-trustline-dual-enable.md:21`) and `#11` = "balance is
  deauthorized" (`useDepositFlow.ts:1128`), both established empirically. **Risk:** shipping
  "Amount exceeds the deposit limit." for `#3` without confirmation could mislabel a different guard.
  Mitigation in step 3 below: put `#3` behind a table entry the coder can flip, and default to a
  *hedged* specific line rather than a confident one if the Open Question is unanswered.
- **The LP full vitest suite is broken independently of this work** — issue #1003, "Frontend vitest
  suite broken (jsdom localStorage undefined) — and not run in CI" (open, `backlog`). Do not attempt
  to fix it here. Use targeted `vitest run <file>` invocations and record that the pass/fail set of
  untouched files is unchanged.
- **Test churn.** ~30 existing wallet-hook tests assert on raw error strings (full list in
  [Test Strategy](#test-strategy)). Those assert what the *hooks throw*, which this plan does not
  change, so they should keep passing. The at-risk ones are the four dashboard-panel tests that assert
  the *mapped* field (`useBalanceSheetPanel.test.tsx:147` asserts
  `result.current.errorMessage === "network failure"`) — those must be updated.
- **No Figma reference.** The issue carries a screenshot of the bug, not a design. There is no Figma
  node for the dialog or the "View details" affordance. See Open Questions.
- **No mono font token exists.** `packages/ui/src/styles/theme.css` has no `--font-mono`. The `<pre>`
  must use Tailwind's built-in `font-mono` utility (the `ui-monospace` system stack). This does not
  violate the no-inline-hex rule (that rule covers colour/radius/typography *values*), but flag it in
  the PR so a token can be added later if design wants one.

## Open Questions

_All resolved (user in-session, 2026-08-06):_

1. **Error #3 copy** → ship the specific `"Amount exceeds the deposit limit."` now, behind a
   flippable mapping-table entry; record the unverified-assumption in the tech-debt tracker.
2. **Generic copy** → `"The transaction could not be completed."` (the issue's own phrasing),
   same on every surface.
3. **Mapping table location** → `packages/frontend/src/utils/userError.ts` (plan's
   recommendation; wallet-connect keeps only what's chain-generic).
4. **Disclosure** → dialog (the issue explicitly asks for a dialog window; an inline expander
   reintroduces the layout push).
5. **Toasts** → YES, danger toasts gain a "Details" action opening the dialog (page-level dialog
   state outliving the 5s toast).
6. **Dashboard panel hooks** → IN scope (the issue says "all possible places").

_Original questions retained below for provenance:_


1. **What is DepositManager Soroban contract error `#3`?** Not derivable from this repo (no contract
   source, no error enum in `docs/generated/stellar-protocol-contracts.md`). Circumstantial evidence
   points at the $5M per-transaction / per-LP-window cap. Needs confirmation from the contract author
   or a Soroban introspection run before we commit copy like "Amount exceeds the deposit limit."
   Should the coder ship a hedged line ("This amount is outside the allowed deposit range.") until
   confirmed, or hold `#3` at the generic fallback?
2. **Exact generic copy.** The issue suggests "The transaction could not be completed." Is that the
   approved wording, and does it differ per surface (step row vs. toast title vs. dashboard panel,
   which today says "Couldn't load this panel")?
3. **Where does the mapping table live?** Recommendation: `packages/frontend/src/utils/userError.ts`
   (LP-scoped, matching this issue's LP-only sweep), lifted to `@pipeline/wallet-connect`
   (`src/errors/`) when the trustee adoption follow-up lands. The alternative is putting the
   chain-shape half in `wallet-connect` now — it is the only shared package besides `ui` that has a
   vitest runner, and Soroban/EVM error taxonomy arguably belongs beside the chain clients. But HTTP
   status mapping does not belong in a wallet package, so the shared version would be a partial move.
   Which do we want?
4. **Disclosure mechanism: dialog vs. inline expand?** The issue specifies a dialog. An inline
   `<details>`-style expander inside the step card avoids a modal for a non-blocking, purely
   informational payload — but it reintroduces the layout-push problem the issue complains about
   ("pushes the layout around"). Confirm the dialog is wanted.
5. **Should danger toasts get a "Details" action?** `ToastInput` has only a `title` slot
   (`lib/toast/useToast.ts:37-51`) — no description field — and toasts currently discard the error
   into `console.error` entirely. Adding an action button that opens the shared dialog is feasible but
   requires page-level dialog state in `deposit.tsx`/`stake.tsx` and a decision about a dialog
   outliving its 5-second toast. Include, or leave toasts title-only this pass?
6. **Are the four dashboard panel hooks in scope?** They are not in the issue's adoption list, but
   they render `error.message` verbatim (e.g. "network failure") and so violate the acceptance
   criterion "no user-facing surface renders a raw … string inline". Included in step 7 below; drop it
   if the answer is no.

## Implementation Steps

### 1. `ErrorDetailsDialog` — `@pipeline/ui`

Create `packages/ui/src/components/ErrorDetailsDialog/ErrorDetailsDialog.tsx` (+ `index.ts` barrel if
neighbouring components have one — check `packages/ui/src/components/Button/`).

Props (controlled — no internal open state):

```ts
export interface ErrorDetailsDialogProps {
  open: boolean;
  /** Dialog heading. Defaults to "Error details". */
  title?: string;
  /** The short human line, echoed above the raw block for context. */
  summary?: string;
  /** The full raw error text rendered verbatim in the <pre>. */
  details: string;
  onClose: () => void;
}
```

Shell + a11y: copy the pattern from
`git show origin/feat/1032-network-switcher:packages/ui/src/components/NetworkSwitchDialog/NetworkSwitchDialog.tsx`
(equivalently `packages/trustee/src/routes/-RejectReasonDialog.tsx:78-155` on `main`):
`if (!open) return null`; fixed backdrop `bg-[rgba(38,37,36,0.4)]` with `onClick={onClose}`; inner
panel `w-[440px] max-w-[calc(100vw-32px)] rounded-[6px] bg-white px-7 py-6
shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]` with `onClick={(e) => e.stopPropagation()}`;
`role="dialog" aria-modal="true" aria-labelledby="error-details-title"`; window-level `keydown`
listener closing on Escape; initial focus on the Close button.

Body: the raw block is

```
<pre data-testid="error-details-raw"
     className="max-h-[280px] overflow-auto rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]
                p-3 font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-words
                text-[color:var(--color-pipeline-ink)]">
  {details}
</pre>
```

(Verify the muted-surface token name against `packages/ui/src/styles/theme.css` — use whatever
`Card variant="muted"` consumes.) `whitespace-pre-wrap break-words` matters: the Soroban payload is
one very long line and must not force horizontal page scroll.

Footer: a "Copy" `Button variant="secondary"` (label flips to "Copied" for 1.5s) and a "Close"
`Button variant="primary-dark"`, both `className="!h-10"`.

Copy + Escape + focus state go in a co-located `useErrorDetailsDialog.ts` per `docs/FRONTEND.md`
rule 2 (the `.tsx` stays JSX-only). Reuse the guarded clipboard pattern from
`packages/frontend/src/components/useAccountDropdown.ts:29-41` — feature-detect
`navigator.clipboard`, `setCopied(true)` then reset after 1500ms, silently no-op on rejection
(non-secure context). Add `data-testid`s: `error-details-backdrop`, `error-details-dialog`,
`error-details-copy`, `error-details-close`, `error-details-raw`.

### 2. `InlineError` — `@pipeline/ui`

Create `packages/ui/src/components/InlineError/InlineError.tsx` + `useInlineError.ts`.

```ts
export interface InlineErrorProps {
  /** The short human line. Always safe to render — never raw. */
  message: string;
  /** Raw error text. When present, a "View details" trigger appears. */
  details?: string;
  /** Optional dialog heading override. */
  detailsTitle?: string;
  className?: string;
}
```

Renders `role="alert"` on the message line (matching today's `StepRow` behaviour), then — only when
`details` is a non-empty string — a `type="button"` "View details" trigger styled as an underlined
inline link at the current 13px/18px error scale, and the `ErrorDetailsDialog` (open state owned by
`useInlineError`). `data-testid`s: `inline-error`, `inline-error-view-details`.

This is the component every surface adopts, which is why the disclosure state lives here rather than
in each caller.

Export both components + their prop types from `packages/ui/src/index.ts` (append at the end,
matching the file's existing ordering convention — see the merge-order note under Assumptions).

### 3. The mapping layer — `packages/frontend/src/utils/userError.ts`

(Location pending Open Question 3.)

```ts
export interface UserFacingError {
  /** Short human copy. Safe to render inline. */
  message: string;
  /** Normalized raw text for ErrorDetailsDialog. Never rendered inline. */
  details: string;
  /** True when a known shape matched — callers may use `message` as a toast title. */
  isSpecific: boolean;
}

export function toError(err: unknown): Error;          // moved, see below
export function toUserError(err: unknown): UserFacingError;
export function parseSorobanContractErrorCode(raw: string): number | null;
```

Implementation order inside `toUserError`:

1. Normalize with `toError` → `details = normalized.message`.
2. **Wallet / user rejection** → `"You cancelled the transaction in your wallet."`
   Detect case-insensitively on the message: `user rejected`, `user declined`, `declined by user`,
   `user cancelled`/`canceled`, `request rejected`, `ACTION_REJECTED`, and EIP-1193 code `4001`
   (also `-4001` — `toError` JSON-stringifies bare `{ code: -4001 }` objects, asserted at
   `useStellarWithdrawalQueue.test.tsx:713`). Check this **first**: a rejection can arrive wrapped in
   a simulation/revert string.
3. **Soroban contract error** → `parseSorobanContractErrorCode` matches
   `/Error\(Contract,\s*#(\d+)\)/` on the raw text and looks the code up in a table. Seed the table
   with the codes already established empirically in this repo:
   - `11` → `"Your PLUSD balance is not authorized yet. Try again shortly."`
     (`useDepositFlow.ts:1128`; `docs/user-stories/epic-498/672-…md:15`)
   - `13` → `"A required trustline is missing. Enable the asset and try again."`
     (`docs/exec-plans/completed/issue-604-stellar-trustline-dual-enable.md:21`)
   - `3` → **pending Open Question 1.** Wire the entry but leave the copy as the answer dictates;
     until then use the hedged `"This amount is outside the allowed deposit range."` and mark it with
     an `// unconfirmed:` comment plus a `docs/exec-plans/tech-debt-tracker.md` row.
     Unlisted codes fall through to the generic line but still keep `details`.
4. **HTTP / API failure** — the LP `apiFetch` throws an untyped `Error` whose message is the JSON
   body's `error` field or `statusText` (`packages/frontend/src/api/client.ts:76-84`), so match on
   text: `Not Found`/`not found` → `"That request could not be found. It may have already been
   processed."`; `Forbidden`/`Unauthorized` → `"You are not authorized for this action."`;
   `Internal Server Error`/`Bad Gateway`/`Service Unavailable` → `"The service is temporarily
   unavailable. Please try again."`. Keep the matcher list *narrow* — the four voucher hooks already
   do `msg.includes("Not Found")` for **retry control flow**
   (`api/useDepositVoucher.ts:110-118`, `useWithdrawalVoucher.ts:105-113`,
   `useStellarDepositVoucher.ts:126-134`, `useStellarWithdrawalVoucher.ts:144-152`) — do not touch
   those predicates, they are load-bearing.
5. **EVM revert / network** → `execution reverted` → `"The transaction was rejected by the
   contract."`; `insufficient funds`/`insufficient balance` → `"Insufficient balance for this
   transaction."`; timeout/network → `"Network problem. Please try again."`
6. **Generic fallback** → the approved generic line (Open Question 2), `isSpecific: false`.

Also in this step: **move `toError`** out of
`packages/frontend/src/wallet/stellar/useStellarWithdrawalQueue.ts:116-137` into this module and
import it back at its three existing call sites (`:363`, `:511`, `:697`). Update the import in
`useStellarWithdrawalQueue.test.tsx:25` — the `describe("toError (#1024)")` block at `:700-714` moves
to the new module's test file unchanged. Do **not** attempt to route the other eight Stellar/EVM
write hooks through `toError` in this issue (behaviour change, not display).

Add `toUserError` / `toError` / `parseSorobanContractErrorCode` rows to `docs/frontend/utils.md`
(alphabetical) in the same commit, per rule 4.

### 4. `StepRow` / `StepsCard` — carry the raw payload

`packages/ui/src/components/StepRow/StepRow.tsx`:

- Add `errorDetails?: string` to `StepRowProps` (right after `errorMessage`, line 52).
- Replace the inline error `<span>` at `:154-161` with
  `{isError && errorMessage && <InlineError message={errorMessage} details={errorDetails}
  className="mt-0.5 block" />}`. `InlineError` already carries `role="alert"` and the
  13px/`--color-pipeline-negative` styling, so the visual result for the no-details case is
  unchanged.
- Note the "View details" trigger is a `<button>` nested inside the label `<span>` — change that
  wrapper to a `<div>` if HTML validity or the flex layout demands it, keeping the existing classes.

`packages/ui/src/components/StepsCard/StepsCard.tsx`: add `errorDetails?: string` to `StepItem`
(`:46`) and forward it in the destructure (`:80-89`) and the `<StepRow>` call (`:91-101`).

### 5. `useDepositFlow` — map all four error derivations

`packages/frontend/src/wallet/useDepositFlow.ts`:

- Add `errorDetails?: string` to `StepInfo` (`:60-69`), documented as "raw error text for the details
  dialog — never rendered inline".
- Replace each of the four raw `.message` reads with a `toUserError` result:
  - `:934-938` (EVM step 2), `:960-963` (EVM step 3), `:1269-1275` (Stellar step 2),
    `:1316-1320` (Stellar step 3).
  - Pattern: compute `const u = err ? toUserError(err) : null;` in the same `useMemo`/derivation that
    produces the step object, then set `errorMessage: u?.message`, `errorDetails: u?.details`. Keep
    the existing `state === "error"` gating untouched (`:791-828`, `:1063-1090`) — success still wins
    over error per `docs/frontend/wallet-flows.md#step-error-state`.
- Also expose the mapped result on `StepTxState` (`:71-76`) — add
  `userError?: UserFacingError` alongside `error` — so `deposit.tsx`'s toast effects can read the
  mapped copy without re-mapping. (Alternative: map at the call site in `deposit.tsx`. Prefer the
  hook so the mapping happens once.)

`packages/frontend/src/routes/deposit.tsx`: pass `errorDetails: flow.step2.errorDetails` /
`flow.step3.errorDetails` alongside the existing `errorMessage` at `:587`, `:596` (Stellar
`StepsCard`) and `:621`, `:630` (EVM `StepsCard`).

### 6. `useStakeFlow` — add the missing error state

`packages/frontend/src/wallet/useStakeFlow.ts`:

- Widen `StakeStepState` (`:47`) to `"idle" | "success" | "error"`.
- Add `errorMessage?: string` and `errorDetails?: string` to the step info type.
- Derive `"error"` exactly as `useDepositFlow` does — mutation `error` set **and** not pending, with
  the success condition winning — for the stake/unstake write step (wired at `:646`, `:651`) and the
  approve/trustline step 1 (`:569`, `:574`). Fill the message/details from `toUserError`.
- `routes/stake.tsx:278` renders `<StepsCard steps={flow.steps} />`, so the rows pick the new fields
  up with no change there. Add the missing error branch to the step-1 toast effect (`:100-115`,
  which today has none) mirroring the step-2 branch at `:143-152`.

### 7. Toasts + dashboard panels

`routes/deposit.tsx:253-262` and `:326-328`, `routes/stake.tsx:143-152`: keep `console.error(…, err)`
(the raw payload stays in the console for support), and set the toast `title` to the mapped
`message` when `isSpecific` is true, otherwise keep today's hardcoded generic title
("Deposit failed" / "Withdrawal failed" / "Claim failed" / "Stake failed" / "Unstake failed"). No raw
text ever reaches a toast. (The "Details" action is Open Question 5 — do not build it unless
answered yes.)

Dashboard panel hooks (Open Question 6 — skip this sub-step if the answer is no):
`components/dashboard/useBalanceSheetPanel.ts:182`, `useDeploymentMonitorPanel.ts:133,158`,
`useWithdrawalQueuePanel.ts:106`, `useYieldHistoryPanel.ts:136` — replace `error.message` with
`toUserError(error).message`. `PanelError` (`components/dashboard/PanelError.tsx:14,23,31`) keeps its
`"Couldn't load this panel"` default; wire `details` through to an `InlineError` only if the panel
layout allows it without pushing content.

### 8. Docs

- **New** `docs/frontend/error-handling.md` — the behaviour spec: the two-layer pattern (generic
  inline line + raw-in-dialog), the full known-shape → copy table from step 3 (including the
  unconfirmed `#3` entry and how to confirm it), the `isSpecific` toast rule, and the inventory of
  adopted surfaces. Link it from `docs/frontend/index.md` under "Area specs".
- `docs/frontend/wallet-flows.md` — extend `### Step error state` (`:97-112`) with two sentences: the
  message is now mapped, never raw, and the raw payload moved to the details dialog; cross-link
  `error-handling.md`. Extend `### Error normalization` (`:177+`) to record that `toError` moved to
  `packages/frontend/src/utils/userError.ts` and is now the first stage of `toUserError`. Add a
  stake-flow error-state note under `## Stake / unstake adapter`.
- `docs/frontend/utils.md` — rows for the three new exports (step 3).
- `docs/FRONTEND.md` — no change needed; the new components are documented via `docs/frontend/`
  per rule 6.
- Source comments: one-line `// spec: docs/frontend/error-handling.md#…` pointers only. Do not
  restate the mapping table in a docblock (rule 6).
- `docs/exec-plans/tech-debt-tracker.md` — two rows: the unconfirmed contract-error-`#3` copy, and
  the untyped `packages/frontend/src/api/client.ts` error (blocks status-based mapping; trustee's
  `ApiError` is the target shape).
- After the docs edits run `npx tsx scripts/lint-docs.ts` (AGENTS.md → Lint & style).

### 9. Follow-up issues to file (do not implement)

1. Pre-submit deposit-amount validation against `GET /v1/protocol/limits` (the real fix for the
   reported scenario — spec exists at `docs/product-specs/deposits.md:116`, no LP call site does).
2. Trustee adoption of `InlineError`/`ErrorDetailsDialog` + consolidating the duplicated
   `mapWaterfallError`.
3. Port `ApiError { message, status }` from `packages/trustee/src/api/client.ts:32-48` into
   `packages/frontend/src/api/client.ts`, then replace the text matchers in step 3.4 and the four
   voucher retry predicates with status checks.

## Test Strategy

`packages/ui` has no runner (see Assumptions); component DOM tests therefore live in
`packages/frontend`, following `packages/frontend/src/lib/toast/Toast.dom.test.tsx`.

**New — `packages/frontend/src/utils/userError.test.ts`** (pure unit, the highest-value tests):

- Each recognised shape → expected `message` + `isSpecific: true`:
  the real reported string (paste the full `DepositManager.request_deposit simulation error:
  HostError: Error(Contract, #3) …` payload verbatim as a fixture) → the `#3` copy;
  `Error(Contract, #11)`, `Error(Contract, #13)`; `"User rejected"`, `"User cancelled"`,
  `"Declined by user"`, `{ code: 4001 }`, `{ code: -4001 }`; `"execution reverted"`;
  `"Internal Server Error"`, `"Not Found"`.
- Unknown shapes → the generic line, `isSpecific: false`, and **`details` preserved byte-for-byte**.
- `details` always equals the normalized raw text (assert the `#3` fixture's `details` still contains
  `"Diagnostic Event"` — proof nothing is truncated on the way to the dialog).
- Rejection detection wins over a wrapping simulation string.
- `parseSorobanContractErrorCode`: match, no-match, multiple occurrences (first wins), malformed
  (`Error(Contract, #)`).
- The migrated `toError` block from `useStellarWithdrawalQueue.test.tsx:700-714` (four cases:
  `Error` passthrough, `{message}`, string, JSON fallback).

**New — `packages/frontend/src/components/ErrorDetailsDialog.dom.test.tsx`**:

- `open={false}` renders nothing.
- `open` renders `role="dialog"` with `aria-modal="true"` and the `<pre>` containing the full raw
  fixture (assert on the long Soroban string, including its tail).
- Escape → `onClose`; backdrop click → `onClose`; panel click → does **not** close.
- Copy button calls `navigator.clipboard.writeText` with the exact `details` string and flips the
  label to "Copied". Stub clipboard with the `Object.defineProperty(navigator, "clipboard", …)`
  pattern from `packages/frontend/src/components/AccountDropdown.test.tsx:178`; use fake timers for
  the 1.5s reset.
- Clipboard rejection → no throw, label stays "Copy".

**New — `packages/frontend/src/components/InlineError.dom.test.tsx`**:

- `message` only → renders the line with `role="alert"`, **no** "View details" trigger.
- `message` + `details` → trigger present; click opens the dialog; the raw text is in the DOM
  **only after** opening.
- **Regression guard for this bug:** with the real `#3` fixture as `details` and the mapped copy as
  `message`, assert the raw text is absent from the document before the trigger is clicked
  (`expect(screen.queryByText(/Diagnostic Event/)).not.toBeInTheDocument()`).

**New — `packages/frontend/src/components/StepRow.dom.test.tsx`** (`packages/ui` currently has zero
`StepRow`/`StepsCard` tests, and `grep step-row-.*-error` across both packages returns nothing):

- `state="error"` + `errorMessage` only → red line, action button still present (the #1024
  invariant), no trigger.
- `state="error"` + `errorMessage` + `errorDetails` → trigger present, dialog opens with the raw text.
- `state="success"` → green pill, no error line (guards against regressing the success branch).

**Updated — `packages/frontend/src/wallet/useDepositFlow.test.tsx`**: add cases that today do not
exist (the file only ever sets `error: null` in fixtures). For each of the four derivations, feed a
mock mutation with the `#3` fixture error and assert `step.errorMessage` is the mapped copy, `!==`
the raw string, and `step.errorDetails` equals the raw string. Also assert success-wins-over-error
still holds.

**Updated — `packages/frontend/src/wallet/useStakeFlow.test.tsx`**: new cases for the new `"error"`
state on step 1 and step 2 (mapped message, raw details, success wins).

**Updated — `packages/frontend/src/routes/-deposit.test.tsx`**: extend the existing negative toast
assertion at `:1614` with a positive case — on a step-2 failure the toast title is the mapped copy
(or the hardcoded generic when unrecognised) and **never** contains `"HostError"` or
`"Diagnostic Event"`.

**Updated — dashboard panel tests** (only if step 7's panel sub-step is included):
`useBalanceSheetPanel.test.tsx:147` currently asserts `errorMessage === "network failure"` — update to
the mapped generic line. `useDeploymentMonitorPanel.test.tsx:219`,
`useWithdrawalQueuePanel.test.tsx:233`, `useYieldHistoryPanel.test.tsx:183` only assert
`toBeDefined()` and should pass unchanged — verify.

**Expected to be unaffected — do not "fix" these:** the ~30 wallet-hook assertions on raw strings
(`useStellarDepositManager.test.tsx:306,354,473,581,596`;
`useStellarWithdrawalQueue.test.tsx:303,348,372,377,392,505,524,544,650`;
`useStellarStakedPlusd.test.tsx:302,325,343,361,444,460,777`;
`useApproval.test.tsx:485,574,591,608,979,1002`;
`useStakedPlusd.test.tsx:949,984,1165,1199,1339,1433,1580`;
`useDepositManager.test.tsx:567,810,934,1412,1542`;
`useWithdrawalQueue.test.tsx:301,452,577,659,788`;
`contracts/depositManager.test.ts:264,314` and siblings). They assert what the hooks *throw*, which
is unchanged. If any break, that means the mapping leaked into the throw path — fix the code, not the
test.

**Commands** (issue #1003: the full LP suite is broken independently — do **not** run bare
`yarn workspace @pipeline/frontend test` and treat failures as yours):

```bash
# Targeted, per touched file
yarn workspace @pipeline/frontend vitest run src/utils/userError.test.ts
yarn workspace @pipeline/frontend vitest run src/components/ErrorDetailsDialog.dom.test.tsx
yarn workspace @pipeline/frontend vitest run src/components/InlineError.dom.test.tsx
yarn workspace @pipeline/frontend vitest run src/components/StepRow.dom.test.tsx
yarn workspace @pipeline/frontend vitest run src/wallet/useDepositFlow.test.tsx
yarn workspace @pipeline/frontend vitest run src/wallet/useStakeFlow.test.tsx
yarn workspace @pipeline/frontend vitest run src/wallet/stellar/useStellarWithdrawalQueue.test.tsx
yarn workspace @pipeline/frontend vitest run src/routes/-deposit.test.tsx
yarn workspace @pipeline/frontend vitest run src/components/dashboard

# Types + lint (all three touched packages)
yarn workspace @pipeline/ui lint
yarn workspace @pipeline/frontend lint
npx tsc -p packages/frontend --noEmit      # confirm the exact tsc invocation from package.json
npx tsx scripts/lint-docs.ts
```

Record the before/after pass-fail counts for the full LP suite in the PR body to show the #1003
breakage set is unchanged.

**Manual verification** (the acceptance sketch): connect a Stellar wallet on `/deposit`, enter an
amount above 5M, run to step 3, and confirm the step shows one short line + "View details", that the
dialog shows the complete `HostError` text, that Copy puts the full string on the clipboard, and that
the card no longer changes height when the error appears. Note in the PR that this needs stage (the
guard is on-chain) — see Open Question 1, since the observed copy depends on what `#3` turns out to
be. No Figma reference exists for this dialog (Open Question 4); verify the shell against
`NetworkSwitchDialog` / `-RejectReasonDialog` instead.

## Docs to Update

| Doc | Change |
|-----|--------|
| `docs/frontend/error-handling.md` | **New.** The error-UX behaviour spec: two-layer pattern, known-shape → copy table, `isSpecific` toast rule, adopted-surface inventory. |
| `docs/frontend/index.md` | Add the new doc under "Area specs". |
| `docs/frontend/wallet-flows.md` | `### Step error state` — message is mapped, raw moved to the dialog. `### Error normalization` — `toError` relocated, now stage 1 of `toUserError`. `## Stake / unstake adapter` — new error step state. |
| `docs/frontend/utils.md` | Rows for `toUserError`, `toError`, `parseSorobanContractErrorCode` (alphabetical, per rule 4). |
| `docs/exec-plans/tech-debt-tracker.md` | Unconfirmed contract-error-`#3` copy; untyped `packages/frontend/src/api/client.ts` error blocking status-based mapping. |

**No product-spec change required.** This is presentation of existing failures — no protocol or
product behaviour changes. (The pre-submit cap validation *would* touch
`docs/product-specs/deposits.md`, but that is a separate follow-up issue.)

**No generated docs change.** `docs/generated/stellar-protocol-contracts.md` lacks the DepositManager
`#[contracterror]` enum; adding it requires the `stellar` CLI against the live contract and is gated
on Open Question 1. If the answer arrives with an authoritative enum, add an "Error codes" section to
that file in this PR.
