# Error handling

Behavior spec for the reusable error-UX pattern introduced by
[issue #1034](https://github.com/eq-lab/pipeline/issues/1034): raw wallet/RPC/HTTP error strings
must never render inline on a user-facing surface. Extracted from source comments per
[`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

## The problem

Raw thrown-error text (e.g. a Soroban simulation error's full diagnostic-event dump, or a bare
`HostError: Error(Contract, #3) ...` string) used to be piped straight into `StepRow`'s
`errorMessage` and other display surfaces. This is meaningless to an LP, fills the card with a wall
of red text, and pushes the layout around.

## The two-layer pattern

Every error surface renders exactly two things:

1. **A short, generic-or-specific human line** — one sentence, always safe to render. Mapped by
   `toUserError` (see below). Rendered by `InlineError`'s `message` prop / a `StepRow`'s
   `errorMessage`.
2. **A "View details" disclosure** — opens `ErrorDetailsDialog`, a modal showing the full raw text
   in a scrollable monospace `<pre>` with a copy-to-clipboard button. Only rendered when raw
   `details` text is available (i.e. `errorDetails` / `InlineError`'s `details` prop is a non-empty
   string).

Raw text is **never** rendered outside this dialog.

### Components (`@pipeline/ui`)

- **`ErrorDetailsDialog`** (`packages/ui/src/components/ErrorDetailsDialog/`) — controlled dialog:
  `open`, optional `title` (defaults to "Error details") and `summary` (echoes the mapped message
  above the raw block for context), required `details`, `onClose`. Shell/a11y pattern copied from
  the `NetworkSwitchDialog` idiom (#1032) / `-RejectReasonDialog.tsx` (informational 440px
  proportions): fixed backdrop, `role="dialog"` + `aria-modal` + `aria-labelledby`, Escape closes,
  backdrop click closes, panel click does not, initial focus on Close. The raw block uses
  `whitespace-pre-wrap break-words` so a single very long line (the common Soroban shape) never
  forces horizontal page scroll. Copy button flips its label to "Copied" for 1.5s; clipboard
  rejection (non-secure context) is a silent no-op.
- **`InlineError`** (`packages/ui/src/components/InlineError/`) — the piece every surface adopts:
  `message` (always rendered, `role="alert"`) plus an optional `details` string. When `details` is
  present, a "View details" trigger appears and owns the paired `ErrorDetailsDialog`'s open state
  (via the co-located `useInlineError` hook) — callers never manage disclosure state themselves.

Two components, not one, because `docs/FRONTEND.md` rule 1 is one component per file, and keeping
`StepRow`/`StepsCard` view-only (rule 2) means the disclosure state has to live in something
`StepRow` composes rather than in `StepRow` itself.

### Nested dialogs (#1037)

`InlineError`'s `ErrorDetailsDialog` can mount as a descendant of an already-open dialog — e.g. the
trustee's Approve/Reject/Request-changes dialogs render their mutation error via `InlineError`, so
clicking "View details" opens a details dialog *inside* the parent dialog's DOM subtree. Checked
before shipping this shape (issue #1037's D4):

- **Stacking is fine.** Every dialog's backdrop is `fixed inset-0 z-50`, which creates its own
  stacking context; a nested `ErrorDetailsDialog` with the identical class paints above the parent
  with no z-index change needed — later-in-DOM wins at equal `z-index`.
- **Backdrop click is fine.** A nested backdrop's `onClick` is a React synthetic handler; it bubbles
  up the React tree into the parent panel's `onClick={(e) => e.stopPropagation()}`, so it never
  reaches the parent's own backdrop-close handler. The parent dialog stays open.
- **Escape needed a fix.** `useErrorDetailsDialog` and every dialog shell in this codebase register
  `window` keydown listeners for Escape. `window.addEventListener` ignores React's
  `stopPropagation`, and registration order determines firing order for same-phase listeners — so
  without a fix, the parent dialog (mounted first) would consume Escape before the nested details
  dialog ever saw it, closing the parent and unmounting the details dialog with it.

  **The fix:** `useErrorDetailsDialog` registers its keydown listener in the **capture** phase
  (`{ capture: true }`) and calls `e.stopImmediatePropagation()` before `onClose()`. Capture-phase
  listeners run before bubble-phase listeners for the same event, regardless of registration order,
  so the topmost (most recently opened) details dialog always consumes Escape first. This is
  backward-compatible — no existing LP surface nests dialogs today — but it does mean any *other*
  future dialog that wants to safely nest inside a parent must stay bubble-phase itself, so it
  doesn't out-race a details dialog nested inside it in turn.
- **Latent duplicate DOM id.** `ErrorDetailsDialog` hardcodes `id="error-details-title"`. It renders
  `null` when closed and realistically only one instance is open at a time, so two simultaneously-
  open instances would collide on that id — a latent concern, not exercised by any current adoption
  site, and not worth parameterising until it actually happens.

## The mapping layer (`toUserError`)

**Source:** `packages/frontend/src/utils/userError.ts`.

```ts
export interface UserFacingError {
  message: string; // short human copy, safe to render inline
  details: string; // normalized raw text for ErrorDetailsDialog, never rendered inline
  isSpecific: boolean; // true when a known shape matched
}

export function toError(err: unknown): Error;
export function toUserError(err: unknown): UserFacingError;
export function parseSorobanContractErrorCode(raw: string): number | null;
```

`details` is **always** the full normalized raw text — never truncated — regardless of whether a
specific mapping matched. `toError` (#1024) is stage 1: it normalizes any thrown value (real
`Error`, a plain object with a string `.message`, a string, or anything else via JSON /
`String()` fallback) into a readable `Error`. It moved here from
`wallet/stellar/useStellarWithdrawalQueue.ts`, which still re-exports it for its three existing
call sites — see [`wallet-flows.md` → Error normalization](./wallet-flows.md#error-normalization).

### Match order

`toUserError` checks shapes in this order, returning on the first match:

1. **Wallet / user rejection.** Checked **first** because a rejection can arrive wrapped inside a
   simulation/revert string (e.g. the wallet rejected the signing request before a Soroban
   simulation error ever formed). Case-insensitive match on: `user rejected`, `user declined`,
   `declined by user`, `user cancelled`/`canceled`, `request rejected`, `ACTION_REJECTED`, or the
   EIP-1193 rejection code `4001` / `-4001` (matched as `"code":4001` / `"code":-4001` since
   `toError` JSON-stringifies bare `{ code }` objects) → `"You cancelled the transaction in your
   wallet."`.
2. **Soroban contract error.** `parseSorobanContractErrorCode` matches `Error(Contract, #N)` (first
   occurrence wins on multiple matches) and looks the code up in a seed table:

   | Code | Copy | Confidence |
   |------|------|------------|
   | `#3` | "Amount exceeds the deposit limit." | **Unconfirmed** — see below. |
   | `#11` | "Your PLUSD balance is not authorized yet. Try again shortly." | Established empirically (`useDepositFlow.ts`, "balance is deauthorized" window). |
   | `#13` | "A required trustline is missing. Enable the asset and try again." | Established empirically (issue #604, "trustline entry is missing"). |

   Unlisted codes fall through to the generic line (`details` is still preserved).

   **`#3` is not resolvable from this repo** — the Soroban contracts are not vendored here, and
   `docs/generated/stellar-protocol-contracts.md` has no `#[contracterror]` enum. Circumstantial
   evidence points at the $5M per-transaction / per-LP-window deposit-amount guard (issue #1034's
   report: amounts over ~5M on `/deposit` trip it; `docs/user-docs/lenders/deposit.md` states the
   $5M single-deposit cap; `docs/references/smart-contracts.md` gives `maxPerLPPerWindow` default
   `5_000_000e6`). Shipped as a flippable table entry per the issue's resolved Open Question — see
   `docs/exec-plans/tech-debt-tracker.md` for the tracked unconfirmed-assumption row and how to
   confirm it (Soroban introspection against the live contract, or the contract author).
3. **HTTP / API failure.** Narrow text matching on the LP `apiFetch`'s untyped `Error` message:
   `Not Found`/`not found` → "That request could not be found. It may have already been
   processed."; `Forbidden`/`Unauthorized` → "You are not authorized for this action.";
   `Internal Server Error`/`Bad Gateway`/`Service Unavailable` → "The service is temporarily
   unavailable. Please try again." Deliberately does **not** touch the four voucher hooks'
   existing `msg.includes("Not Found")` predicates (`api/useDepositVoucher.ts` and three
   siblings) — those drive RETRY control flow and are load-bearing.
4. **EVM revert / network.** `execution reverted` → "The transaction was rejected by the
   contract."; `insufficient funds`/`insufficient balance` → "Insufficient balance for this
   transaction."; `timeout`/`network` → "Network problem. Please try again."
5. **Generic fallback** (`isSpecific: false`) — **"The transaction could not be completed."** Same
   wording on every surface (step row, toast title, dashboard panel) — there is no per-surface
   variant.

## Toast title rule

Danger toasts (`routes/deposit.tsx`, `routes/stake.tsx`) use the mapped `message` as the toast
`title` when `isSpecific` is `true`; otherwise they keep their pre-#1034 hardcoded generic title
("Deposit failed" / "Withdrawal failed" / "Claim failed" / "Stake failed" / "Unstake failed" /
"Approval failed" / "sPLUSD trustline failed" / "PLUSD trustline failed"). The raw payload is never
put in the toast — `console.error` still receives it for support/debugging — but every danger toast
also gets a **"Details"** action (`ToastAction`) that opens a page-level `ErrorDetailsDialog`. That
dialog's open state lives in the route component (`errorDialog` state in `deposit.tsx` / `stake.tsx`)
rather than the toast itself, because the dialog must outlive the toast's 5-second auto-dismiss.

## Adopted surfaces

- **`StepRow` / `StepsCard`** (`@pipeline/ui`) — `errorMessage` is the mapped line; `errorDetails`
  (new) carries the raw text and renders via `InlineError`. See
  [`wallet-flows.md` → Step error state](./wallet-flows.md#step-error-state).
- **`useDepositFlow`** — all four raw `.message` reads (EVM step 2/3, Stellar step 2/3) route
  through `toUserError`. `StepTxState.userError` exposes the mapped result so `deposit.tsx`'s toast
  effects don't re-map (the effects re-map from `error` anyway to keep their `useEffect` dependency
  arrays on stable primitives rather than a freshly-allocated object each render — see the inline
  comment at each toast effect).
- **`useStakeFlow`** — gained the `"error"` step state it lacked entirely before #1034
  (`StakeStepState` was `"idle" | "success"` only). Derived for both the approve/trustline step
  (step 1) and the stake/unstake write step (step 2), mirroring `useDepositFlow`'s
  success-wins-over-error rule.
- **Dashboard panel hooks** — `useBalanceSheetPanel`, `useDeploymentMonitorPanel` (both the Active
  Loans `errorMessage` and the origination-tab `originationErrorMessage`),
  `useWithdrawalQueuePanel`, `useYieldHistoryPanel` — each panel's `errorMessage` field is
  `toUserError(error).message` instead of the raw `error.message`. `PanelError`'s default
  "Couldn't load this panel" copy is unchanged; the panel layouts do not (yet) surface a details
  dialog for these — see the tech-debt tracker for the follow-up.
- **Trustee app** (`packages/trustee/`, issue #1037) — the full adoption sweep described in
  ["Trustee mapping layer"](#trustee-mapping-layer) below, across nine areas: origination review
  (the Approve/Reject/Request-changes dialogs and the footer), the origination list, record-coupon
  and record-repayment (loan load + waterfall preview + the three on-chain write actions), loan
  detail (P&C / registry / the loan-load error + the disbursement/rollover/lifecycle dialogs), the
  loans list, all three risk-council flows (escalate/reterm/writedown), cash management (ramp-event
  load + review + the withdrawal queue), the audit log, and the Capital Allocation card.

## Trustee mapping layer

**Source:** `packages/trustee/src/utils/userError.ts` — a **trustee-local** module, deliberately
*not* hoisted into `@pipeline/wallet-connect` or `@pipeline/ui` (issue #1037 decision D1):

- **The hoist wouldn't actually deduplicate.** `packages/frontend` declares no workspace dependency
  on `@pipeline/wallet-connect` — TD-35 records that the LP's wallet-connect code was *copied*
  there, not moved, and has never been re-pointed. Moving the chain-generic half into
  `@pipeline/wallet-connect` today would leave the LP's copy in `packages/frontend/src/utils/
  userError.ts` untouched, producing three copies instead of two.
- **`@pipeline/ui` is the wrong layer too.** It has no `utils/` directory and is a presentational
  design-system package; encoding Soroban contract-error codes and Pipeline operator copy there
  inverts the dependency direction.
- **Most of the mapping isn't chain-generic anyway.** The trustee's dominant error source is
  `ApiError`, which carries a typed numeric `.status` (issue #829) — trustee branches on status,
  which the LP's `matchHttp` structurally cannot do (the LP's `apiFetch` throws an untyped `Error`,
  so its HTTP mapping works off brittle text matching — see "Out of scope" in #1034's original
  writeup, still tracked as debt below). The copy differs by role, too — "This submission has
  already been reviewed" means nothing to an LP.
- **The genuinely shared ~60 lines** (`toError`, `parseSorobanContractErrorCode`, the
  wallet-rejection regex list) are duplicated verbatim rather than shared, matching the existing
  trustee/LP util-duplication precedent (`docs/frontend/utils.md` → "Trustee app",
  TD-38/TD-42/TD-46). Tracked as TD-52, gated on TD-35.

```ts
// packages/trustee/src/utils/userError.ts
export interface UserFacingError { message: string; details: string; isSpecific: boolean }

export function toError(err: unknown): Error;
export function parseSorobanContractErrorCode(raw: string): number | null;
export function toUserError(err: unknown, fallback?: string): UserFacingError;
export function mapWaterfallError(error: Error | null): UserFacingError | null;
```

`toUserError` takes an optional per-call-site `fallback` (default: **"Something went wrong. Please
try again."**) — this replaces the `{errorMessage ?? "Friendly fallback"}` anti-pattern that used to
sit in JSX: previously the friendly copy only rendered when the raw message happened to be falsy
(rare — the raw message is usually present), so a real failure almost always showed the raw text.
Now every load surface passes its own fallback string into the hook, and the mapper's return value
*is* the friendly copy on every failure, not just the null case.

### Trustee match order

`toUserError` checks shapes in this order, returning on the first match (`details` is always the
full normalized raw text — never truncated — on every branch, matched or not):

1. **Wallet / user rejection** — same regex list as the LP's `toUserError` (ported verbatim) →
   `"You cancelled the transaction in your wallet."`. Checked first because a rejection can arrive
   wrapped inside a simulation/revert string.
2. **Trustee preflight guard** — the five on-chain hooks (`useDrawLoan`, `useRollover`,
   `useUpdateLifecycle`, `useRecordPayment`, `useCloseLoan`) throw these BEFORE any RPC call, and
   the text is already a short, hook-specific, human sentence — not a diagnostic dump:
   - `/not configured for this environment/i` → the guard's own sentence, rendered verbatim (e.g.
     "On-chain payment recording is not configured for this environment.").
   - `/wallet not connected/i` → `"Connect your trustee wallet to approve on-chain."`.
3. **Soroban contract error** — `parseSorobanContractErrorCode` matches `Error(Contract, #N)`
   (first occurrence wins). The lookup table is currently **empty** for the trustee — unlike the
   LP's confirmed `#3`/`#11`/`#13` codes, no trustee-side contract-error code has been confirmed
   against a live contract yet. The mechanism stays wired so a confirmed code can be added later
   without a match-order change.
4. **Simulation-error shape** — `/simulation error/i` (no specific contract code matched) →
   `"Could not verify this action on-chain. No signature was requested — safe to retry."` All five
   on-chain writes simulate before requesting a wallet signature, so this generic copy is accurate
   for record-payment/close-loan/rollover/update-lifecycle. (Approve's own mint action uses more
   specific "the loan"-scoped wording — see D3 below — so it does **not** go through this generic
   branch; `mapMintError` stays a separate, self-contained function.)
5. **`ApiError.status`** — checked via `err instanceof ApiError`, never text matching:

   | Status | Copy |
   |---|---|
   | 401 | "Your session has expired or is not authorized. Please sign in again." |
   | 409 | "This submission has already been reviewed. Refresh to see the latest status." |
   | 403 | "You are not authorized to review submissions." |
   | 400 | "This request was invalid." |
   | 404 | "That request could not be found. It may have already been processed." |
   | ≥500 | "The service is temporarily unavailable. Please try again." |

   Seeded with exactly the copy `-useOriginationReview.ts`'s pre-#1037 `mapReviewError` already
   shipped for 401/403/409/400 (the origination review endpoint is the only place these were
   empirically observed); 404/5xx are new additions for the other surfaces that can now hit them.
   An unmapped status (e.g. a stray 418) falls through to the caller's `fallback`.
6. **Fallback** (`isSpecific: false`) — the caller-supplied `fallback`, or the generic default.

### Preserved origination-review copy (D3)

`-useOriginationReview.ts` already had partly-humanized copy before #1037. It was preserved as-is —
only the raw interpolation moved out of the rendered sentence and into `details`:

| Site | Before | After |
|---|---|---|
| review 401/409/403 | already clean copy | unchanged (now via the shared `ApiError.status` table above), `details` attached |
| review 400 | `error.message` rendered raw | `"This request was invalid."` + `details` |
| review default | `` `Something went wrong: ${raw}` `` | `"Something went wrong. Please try again."` + `details` |
| mint simulation | `` `Could not verify the loan on-chain (${raw}). No signature was requested — safe to retry.` `` | same sentence minus the parenthetical; `raw` → `details` |
| mint reject/cancel | `"Signature cancelled. Click Approve again to retry."` | unchanged + `details` |
| mint not-configured | `"On-chain minting isn't configured for this environment."` | unchanged + `details` |
| mint not-connected | `"Connect your trustee wallet to approve on-chain."` | unchanged + `details` |
| mint default | `` `The on-chain transaction failed (${raw}). Please try again.` `` | same sentence minus the parenthetical; `raw` → `details` |
| mint-succeeded/review-failed | interpolated `reviewMutation.error.message` | same sentence minus the parenthetical; `raw` → `details` |

`mapMintError` (the Approve dialog's on-chain-mint mapper) stays a small local function in
`-useOriginationReview.ts` rather than folding into `toUserError` — every branch above carries
Approve-specific wording ("the loan", "Click Approve again") that would be wrong generic copy for
the other four on-chain hooks sharing `toUserError`.

### Waterfall preview: no details on the expected-input case (D5)

`mapWaterfallError` (consolidated from the two byte-identical copies previously in
`-record-coupon.ts` / `-record-repayment.ts`) special-cases its 4xx branch: the backend's waterfall
validation returning a client error means "this amount doesn't fit the loan's terms" — an
**expected user-input** case (#916), not a diagnostic failure. That branch returns `details: ""` so
`InlineError` renders no "View details" trigger — there is nothing to disclose. The non-4xx
(unexpected) branch keeps its full `details`.

## Out of scope (this issue)

- **Pre-submit deposit-amount validation** against `GET /v1/protocol/limits` — the real fix for the
  reported over-limit scenario (spec: `docs/product-specs/deposits.md`). No LP call site exists yet;
  this issue only fixed how the resulting error *displays*, not whether it can be avoided.
- **Typing `packages/frontend/src/api/client.ts`'s errors** — it throws an untyped `Error`,
  discarding HTTP status, which is why the HTTP mapping above works off message text rather than a
  status code. See the tech-debt tracker.
- **Trustee `NeedsAttention`** (#1037) — a load failure is computed by `useNeedsAttention` but never
  rendered by `NeedsAttention.tsx` at all (no error branch exists) — a pre-existing silent failure,
  logged as BUG-16 rather than fixed inline (out of scope: needs a new render branch, not just a
  copy swap).
- **Trustee `-origination-detail.ts`** (#1037) — has no `error` state; a failed submissions fetch
  falls through to the same "not found" UI a genuinely-missing id would produce. Logged as BUG-15.
- **Trustee sign-in / auth** (#1037) — `TrusteeSessionProvider.tsx` / `SignInCard.tsx` already
  discard the raw value at the `catch` and never read `.message`, so they already meet the
  acceptance bar without adopting `toUserError`.
- **Trustee T-Bills swap form / On-off-ramp `SwapDialog`** (#1037, #983/#943) — UI shells with no
  wired error state at all (execution blocked on Type-2 MPC #781) — nothing to adopt.
- **Trustee risk-council submit errors** (#1037) — the three risk-council pages have no mutations
  wired yet, only load errors (which the sweep does cover).
