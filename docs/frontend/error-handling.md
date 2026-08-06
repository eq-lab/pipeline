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

## Out of scope (this issue)

- **Trustee app surfaces** (`-useOriginationReview.ts`, `-record-repayment.ts`'s
  `mapWaterfallError`, `-record-coupon.ts`, `-RejectReasonDialog.tsx`'s error line) — they already
  map to friendly copy and never print raw text, so they were not leaking. Adoption of
  `InlineError`/`ErrorDetailsDialog` there (and consolidating the two duplicated `mapWaterfallError`
  copies) is a follow-up.
- **Pre-submit deposit-amount validation** against `GET /v1/protocol/limits` — the real fix for the
  reported over-limit scenario (spec: `docs/product-specs/deposits.md`). No LP call site exists yet;
  this issue only fixed how the resulting error *displays*, not whether it can be avoided.
- **Typing `packages/frontend/src/api/client.ts`'s errors** — it throws an untyped `Error`,
  discarding HTTP status, which is why the HTTP mapping above works off message text rather than a
  status code. See the tech-debt tracker.
