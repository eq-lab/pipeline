# Issue #259: Add Toast notification system — informational and actionable variants

Source: https://github.com/eq-lab/pipeline/issues/259

## Scope

Introduce a global toast notification system, rendered bottom-right, with two visual variants (informational and actionable) and four tones (`neutral`, `success`, `danger`, `pending`). Land:

1. **`Toast` primitive in `@pipeline/ui`** — visual pill with optional right-aligned action button. Storybook coverage for every tone × with/without action.
2. **Toast container + emitter in `@pipeline/frontend`** — `ToastProvider` (bottom-right stack, capped at 3) + imperative `useToast()` hook with `show / update / dismiss` and timer-based auto-dismiss for terminal tones.
3. **Emit toasts from existing write-call sites** on `/deposit`: approval, deposit (`useRequestDeposit`), and claim (`useClaim`). Each emission lives at the call site (in `routes/deposit.tsx`), not inside the wallet hook.
4. **Tests** for the primitive (rendering / a11y / action) and for the emitter (auto-dismiss, pending no-auto-dismiss, `update` in place, stack cap, dedupe by `id`), plus one route-level emission test on `/deposit`.
5. **Docs** — add `useToast` to `docs/frontend/hooks.md` and add a short note in `docs/FRONTEND.md` about the toast surface; update `packages/ui/src/index.ts` exports.

Figma references:
- Informational success — node [1497:95187](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95187&m=dev)
- Actionable success — node [1497:95109](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95109&m=dev)
- Base shape (eq-lib) — node [6860:833](https://www.figma.com/design/2KxIsFZuVbKwO7qhVwouoq/eq-lib?node-id=6860-833&m=dev)

Out of scope (preserved from the Issue):
- Drag/swipe-to-dismiss gestures.
- Stack regions other than bottom-right.
- Notification center / history.
- i18n of toast copy.
- Stake / unstake emissions (those hooks don't exist yet).
- Replacing the existing inline step-row affordances on `/deposit` — toasts complement them.

## Assumptions and Risks

- **No `danger` color token yet.** `packages/ui/src/styles/theme.css` already declares `--color-pipeline-success` (#3a7d44) and `--color-pipeline-warning` (#b58a00), but no `--color-pipeline-danger`. The Issue requires monochrome success-green and danger-red tones. **Decision:** introduce `--color-pipeline-danger` + `--color-pipeline-on-danger` in the same PR — flag this in the PR description as the new token spec. (The Issue explicitly says: "define new tokens in `theme.css` only if a matching one doesn't exist yet — flag in the PR".) The exact hex will be sampled from the Figma base node 6860:833 during implementation; if Figma disagrees with a plausible default (e.g. #c0392b or similar), `coder` chooses the Figma value.
- **Action button uses the existing `Button` primitive.** The Issue calls for "a smaller variant of the existing `Button` primitive (extend the `Button` variants if needed; do not introduce a new component)." Today `Button` has four variants — `primary-dark`, `primary-blue`, `secondary`, `circular-blue` — and all are 48px tall. Toasts are ~40px tall, so a 32–36px-tall action button is needed. **Decision:** add one new `ButtonVariant` named `"toast-action"` (compact, pill-shaped, on-success / on-danger fill that inherits the toast tone via CSS custom properties propagated by `Toast`). Keep it scoped to toast usage so existing buttons are unaffected. Confirm the exact spec from Figma 1497:95109 at implementation time.
- **`useToast` outside the provider.** The hook must throw a clear error when called outside `<ToastProvider>`. Tests cover that path.
- **Auto-dismiss timer leaks.** Each toast registers a `setTimeout`; the provider must clear timers on unmount and on `dismiss` / `update`. Use `useEffect` cleanup + a `Map<id, NodeJS.Timeout>` ref. Vitest fake timers cover the auto-dismiss assertions deterministically.
- **Stack cap behaviour.** Issue says "caps the visible stack at N (e.g. 3); oldest toasts collapse / drop off when N+1 fires." **Decision:** N = 3, oldest is hard-dropped (no collapse animation in v1). New entrant pushes onto the bottom, oldest is removed from the top of the stack. Document this in the `useToast` JSDoc.
- **`pending` toasts and the `id` contract.** Callers must provide a stable `id` to upgrade a pending toast to a terminal toast. If `show` is called twice with the same `id`, the second call replaces the first in place (same DOM node, no flicker). If `id` is omitted, the provider generates a `crypto.randomUUID()` and the caller cannot upgrade.
- **Risk — duplicate emissions from React StrictMode.** `StrictMode` mounts effects twice in dev. The emission code on `/deposit` lives inside `useEffect` blocks that watch `isPending` / `isSuccess` / `isError` from each wallet hook. The `id`-based dedupe (one stable `id` per write hook instance, e.g. `"deposit-tx"`, `"approve-tx"`, `"claim-tx"`) prevents double-toasts because `show({ id, … })` upserts rather than appending.
- **Risk — toast firing for guard rejections.** Issue notes: "sanity-check that no 'Deposit failed' toast fires for a guard rejection" (e.g. sub-min deposit, where the button is disabled). Because emissions are gated on `requestDeposit.isError === true`, and the button is disabled when `meetsMin` is false, no write is dispatched and no error toast fires. We will add a regression test that confirms no toast appears for a sub-min amount where the button is disabled.
- **Dependency on #235.** `/deposit` three-step flow is the primary consumer. #235's plan is already in `docs/exec-plans/active/`, and the live route (`packages/frontend/src/routes/deposit.tsx`) already exposes the three hooks we will emit from (`useApproval.approve` via `useToken`, `useRequestDeposit`, `useClaim`). No blocker.
- **Risk — `useApproval` removal (#223).** Issue #223 plans to remove `useApproval`. The approval toast emission uses `useToken`'s composed approval surface (`approve`, `isApprovePending`, `isApproveSuccess` — already wired in `deposit.tsx`), so we are insulated from that refactor; the emission code follows the page-level state, not the hook identity.

## Open Questions

_None_

## Implementation Steps

### 1. Add the `danger` design token [DONE]

File: `packages/ui/src/styles/theme.css`

- Add to both the `:root` and `@theme` blocks (mirroring the existing `--color-pipeline-success` / `--color-pipeline-on-success` rows):
  - `--color-pipeline-danger: <hex from Figma base node 6860:833>;`
  - `--color-pipeline-on-danger: #ffffff;`
- Add a short Figma-node comment in the same `/* … */` style as the existing tokens.

### 2. Create the `Toast` primitive in `@pipeline/ui` [DONE]

New folder: `packages/ui/src/components/Toast/`

Files:
- `Toast.tsx` — visual pill component (one component per file, per FRONTEND.md rule 1).
- `Toast.stories.tsx` — Storybook coverage.
- `index.ts` — re-export.

`Toast.tsx`:

```tsx
export type ToastTone = "neutral" | "success" | "danger" | "pending";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: ToastTone;            // default "neutral"
  title: React.ReactNode;
  action?: ToastAction;
  icon?: React.ReactNode;      // override leading icon
}
```

Visual rules (all via design tokens — no raw hex):

- Container: `inline-flex items-center gap-3 px-4 py-2 rounded-[var(--radius-pipeline-pill)]`, fixed height ~40 px, `shadow-sm`.
- Background per tone:
  - `neutral`  → `--color-pipeline-ink`           (white text)
  - `success`  → `--color-pipeline-success`       (white text)
  - `danger`   → `--color-pipeline-danger`        (white text)
  - `pending`  → `--color-pipeline-ink-muted`     (white text)
- Leading icon:
  - default for `neutral` / `success` / `danger` → reuse `packages/ui/src/assets/icons/check-circle.svg` (already in `assets/icons/`).
  - default for `pending` → reuse `packages/ui/src/assets/icons/clock-pending.svg`.
  - Honour `icon` prop override.
- Title: existing body type tokens (`--text-pipeline-body` + `--font-weight-emphasized`, `--font-body`).
- Action button: `<Button variant="toast-action">{action.label}</Button>` (new variant — see step 4 below). Right-aligned, ~32 px tall.

A11y:
- Container `role="alert"` when `tone === "danger"`, otherwise `role="status"`.
- `aria-live="assertive"` for danger, `aria-live="polite"` otherwise.
- The action button is a real `<button>` — focus styles inherit from `Button`.

### 3. Add Storybook coverage [DONE]

File: `packages/ui/src/components/Toast/Toast.stories.tsx`

Stories (one per cell in the tone × action matrix):

- `NeutralInformational` — `tone="neutral"`, `title="You staked 1,000.00 PLUSD"`.
- `SuccessInformational` — `tone="success"`, `title="Deposit confirmed"`.
- `DangerInformational` — `tone="danger"`, `title="Deposit failed"`.
- `PendingInformational` — `tone="pending"`, `title="Sending…"`.
- `SuccessActionable` — `tone="success"`, `title="+1,000.00 PLUSD"`, `action={{ label: "Stake", onClick: () => {} }}`.
- `NeutralActionable` — `tone="neutral"`, `title="Deposit submitted"`, `action={{ label: "View", onClick: () => {} }}`.
- `CustomIcon` — demonstrates the `icon` override.

### 4. Extend `Button` with a `toast-action` variant [DONE]

File: `packages/ui/src/components/Button/Button.tsx`

- Extend `ButtonVariant` to include `"toast-action"`.
- Add a new entry in `variantClasses`:
  - 32 px tall, `rounded-[var(--radius-pipeline-pill)]`, horizontal padding tuned to Figma 1497:95109.
  - Background: white (`--color-pipeline-on-success` / `on-danger` — both `#ffffff`).
  - Text: `--color-pipeline-ink`.
  - Focus ring on the surrounding paper tone.
- Add a Storybook story `ToastAction` in `Button.stories.tsx`.

### 5. Create the toast container + emitter (`@pipeline/frontend`) [DONE]

New folder: `packages/frontend/src/lib/toast/`

Files:
- `ToastProvider.tsx` — JSX-only component (per FRONTEND.md rule 2). Renders the bottom-right stack region.
- `useToast.ts` — co-located hook holding the queue state and the imperative API. Exports `useToast`. The provider's internal state lives here too, exposed via a `ToastContext`.
- `useToast.test.tsx` — unit tests (see Test Strategy).
- `index.ts` — re-exports `ToastProvider`, `useToast`, `ToastTone` (re-export from `@pipeline/ui` for caller convenience).

Container layout:
- `<div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3 items-end">`.
- Each toast wrapper is `pointer-events-auto` so clicks land.
- Cap visible stack at 3: when a 4th `show` arrives, drop the oldest (top of the stack).

Imperative API:

```ts
export interface ToastInput {
  id?: string;                  // omit → uuid; provide → upsert-by-id
  tone?: ToastTone;             // default "neutral"
  title: React.ReactNode;
  action?: ToastAction;
  icon?: React.ReactNode;
  /** Override auto-dismiss in ms. `pending` is always sticky regardless. */
  durationMs?: number;          // default 5000 for non-pending
}

export interface ToastApi {
  show: (input: ToastInput) => string;       // returns id
  update: (id: string, patch: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
}

export function useToast(): ToastApi;
```

Behaviour:
- `show({ id, … })` — if `id` is unknown, append (drop oldest if > 3). If known, replace in place (no DOM remount), reset the timer per the new tone.
- `show({ tone: "pending", … })` does NOT register an auto-dismiss timer.
- `update(id, patch)` — merge patch into the existing toast; if the resulting tone is non-pending, (re)arm the auto-dismiss timer.
- `dismiss(id)` — remove immediately; clear the timer.
- Clear all timers on `ToastProvider` unmount.

### 6. Mount the provider [DONE]

File: `packages/frontend/src/main.tsx`

- Wrap `<RouterProvider>` with `<ToastProvider>` inside `<WalletProvider>`:

```tsx
<WalletProvider>
  <ToastProvider>
    <RouterProvider router={router} />
  </ToastProvider>
</WalletProvider>
```

### 7. Emit toasts from `/deposit` call sites [DONE]

File: `packages/frontend/src/routes/deposit.tsx`

- Add `import { useToast } from "@/lib/toast";` and `import { useNavigate } from "@tanstack/react-router";`.
- In `Deposit()`, call `const toast = useToast();` and `const navigate = useNavigate();`.
- Three `useEffect` blocks (one per write hook) that watch transition into pending / success / error states and upsert the corresponding toast using a stable `id`:

  - **Approve** (`id: "approve-tx"`) — when `isApprovePending` transitions to `true`, `toast.show({ id: "approve-tx", tone: "pending", title: "Approving USDC…" })`. When `isApproveSuccess` flips true, `toast.update("approve-tx", { tone: "success", title: "Approval confirmed" })`. No error toast for approval — wagmi surfaces the error inline via the disabled button.
  - **Deposit** (`id: "deposit-tx"`) — `requestDeposit.isPending` → `pending: "Sending…"`. `requestDeposit.isSuccess` → `success: "Deposit submitted"` with `action: { label: "View", onClick: () => navigate({ to: "/transactions" }) }`. `requestDeposit.error` → `danger: "Deposit failed"` (drop the action so the toast is purely informational).
  - **Claim** (`id: "claim-tx"`) — `claim.isPending` → `pending: "Claiming…"`. `claim.isSuccess` → `success: "PLUSD claimed"` (no action — the success state already updates the page). `claim.error` → `danger: "Claim failed"`.

  Each effect's dependency array tracks only the relevant `isPending` / `isSuccess` / `error` booleans (and `toast` / `navigate`, which are stable). Use a previous-value `useRef` if needed to detect the transition edge so the toast fires once per event rather than on every render.

- Confirm: do NOT touch the inline step-row affordances. The toast is additive.

### 8. Export and document [DONE]

- `packages/ui/src/index.ts` — add `Toast`, `ToastProps`, `ToastTone`, `ToastAction` exports.
- `docs/frontend/hooks.md` — add a `useToast` row (import path `@/lib/toast`, one-line description).
- `docs/frontend/index.md` / `docs/FRONTEND.md` — short paragraph noting the toast surface and where to emit from (call sites, not hooks).

### 9. Validate [DONE]

- `npx tsx scripts/lint-docs.ts` — passes after the JSDoc + catalogue edits.
- `yarn workspace @pipeline/frontend test` — green.
- `yarn workspace @pipeline/ui build-storybook` — green (verifies the new stories build).
- `yarn workspace @pipeline/frontend build` — green (typecheck).
- Manual ux-tester pass against Figma nodes 1497:95187 (informational), 1497:95109 (actionable), and 6860:833 (base shape). Verify bottom-right placement, 24 px offset from viewport edges, stack gap, auto-dismiss timing.

## Test Strategy

### `packages/ui/src/components/Toast/Toast.test.tsx` (new file)

`@pipeline/ui` doesn't currently ship unit tests, only Storybook. **Decision:** add a Vitest + `@testing-library/react` test file colocated with the component. If `@pipeline/ui` lacks the runner today, configure it the same way `packages/frontend` is (vitest already present in workspace; add the minimal `package.json` script + vite config update). If that adds non-trivial scope, fall back to covering the primitive via the frontend's existing vitest runner by adding `packages/frontend/src/lib/toast/Toast.dom.test.tsx` that imports the primitive from `@pipeline/ui` — keeps the test budget tight and avoids new infra. Pick the lighter-weight path at implementation time.

Cases:
- Renders title text.
- Each tone renders the expected role / aria-live combination (`role="alert"` + `aria-live="assertive"` only for `danger`; otherwise `role="status"` + `aria-live="polite"`).
- `action` renders a `<button>` with the action label; clicking invokes `onClick`.
- `icon` prop overrides the default per-tone icon.

### `packages/frontend/src/lib/toast/useToast.test.tsx` (new file)

Uses `vi.useFakeTimers()` and `@testing-library/react`'s `act`.

Cases:
1. `show({ tone: "success", title: "ok" })` adds a toast; after 5000 ms it auto-dismisses (asserted via `act(() => vi.advanceTimersByTime(5000))`).
2. `show({ tone: "pending", title: "…" })` does NOT auto-dismiss; advancing 10 s leaves it on screen.
3. `update(id, { tone: "success", title: "Done" })` replaces the pending toast in place (assert one toast still rendered, new text visible) and arms the auto-dismiss timer.
4. `dismiss(id)` removes the toast and cancels its timer (no errors after the timer would have fired).
5. Stack cap: `show` 4 times → only 3 toasts on screen, the oldest is gone.
6. `show({ id, … })` with an existing `id` upserts (same DOM node, no flicker — assert via stable test-id or returned id equality).
7. `useToast()` called outside `<ToastProvider>` throws a clear error.

### `packages/frontend/src/routes/-deposit.test.tsx` (extend)

Add one new describe block: **"Deposit page — toast emissions"**. Reuse the existing wagmi / AppKit / react-query mocks. Wrap the test render with a `<ToastProvider>` (since the route now consumes `useToast`).

Cases:
1. Simulate `requestDeposit.isPending = true` → assert a toast with `"Sending…"` is on screen.
2. Flip `isPending` → `isSuccess = true` → assert the toast text becomes `"Deposit submitted"` and a `View` button appears.
3. Click `View` → assert navigation to `/transactions` (mock `useNavigate`).
4. Simulate `requestDeposit.error` → assert a `Deposit failed` toast with `role="alert"` / `aria-live="assertive"`.
5. **Regression** — sub-min amount (`meetsMin === false`) leaves the Confirm button disabled and no toast fires.

### Edge cases / negative assertions

- StrictMode double-mount does NOT produce duplicate toasts (covered implicitly by the `id`-based upsert; add an explicit regression assertion in the route test by re-rendering and checking the queue length).
- Toast text uses design tokens (smoke-check via Storybook visual diff or by asserting className contains `bg-[var(--color-pipeline-success)]` etc. in one tone test).

### ux-tester pass (Figma-driven)

After implementation, ux-tester verifies the rendered toasts on `/deposit` match:
- node 1497:95187 (informational placement + monochrome success-green pill, bottom-right).
- node 1497:95109 (actionable variant with inner `Stake`-style action button).
- node 6860:833 (base shape — corner radius, padding, height).

## Docs to Update

- `docs/FRONTEND.md` — add a short subsection under "Application structure" or as its own section pointing to `@/lib/toast` as the canonical surface for transient global feedback, and re-iterate the "emit from the call site, not the hook" rule.
- `docs/frontend/hooks.md` — add a `useToast` row.
- `docs/frontend/index.md` — no change required (the toast hook is auto-listed via `hooks.md`).
- `packages/ui/src/index.ts` — export `Toast`, `ToastProps`, `ToastTone`, `ToastAction`.
- No `docs/product-specs/` update required — this is a UI-affordance change, not a product-behaviour change. The Issue's "Why" section is design rationale, not a new spec. (If a future review disagrees, surface as an Open Question.)
- No `docs/design-docs/` update required — the toast surface is a primitive, not an architectural decision.
