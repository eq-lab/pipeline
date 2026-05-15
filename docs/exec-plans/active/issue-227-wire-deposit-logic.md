# Issue #227: Wire up /deposit logic — amount input, approval gating, low-balance banner

Source: https://github.com/eq-lab/pipeline/issues/227

## Scope

Convert `packages/frontend/src/routes/deposit.tsx` from a static composition of
`ConversionCard` + `StepsCard` with hardcoded copy and disabled buttons into a
state machine driven by:

- the user's entered amount (controlled string → bigint)
- USDC balance (via `useToken({ token: usdc, spender: DEPOSIT_MANAGER_ADDRESS })`)
- the (token → spender) allowance (same `useToken` call — its approval branch)
- the DepositManager's `minDeposit` (via `useDepositManagerMinDeposit`)

Three user-visible page states map 1:1 to three Figma frames:

| State                                       | UI                                                                                                       | Figma                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Approve needed (allowance < amount)         | Step 1 "Approve" enabled; step 2 "Convert" disabled                                                      | [1498:99874](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-99874&m=dev)  |
| Approved (allowance ≥ amount)               | Step 1 shows success badge (green check); step 2 "Convert" enabled                                       | [1497:95272](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95272&m=dev)  |
| Insufficient balance (balance < minDeposit) | StepsCard replaced by "Add funds to your USDC balance / Minimum amount — N USDC" banner with Copy Address CTA | [1825:10214](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1825-10214&m=dev)  |

Per the prompt note: the Issue body still references `useUsdcBalance`, but #220
landed and removed it. This plan uses `useToken({ token, spender })` which now
exposes balance + decimals + formattedBalance **and** the approval surface
(`allowance`, `isSufficient`, `approve`, `isApprovePending`, `isApproveSuccess`,
`refetchAllowance`). We do NOT make a separate `useApproval` call — one
`useToken` call covers everything. `useApproval` is still exported for direct
use elsewhere, but on this page it is composed via `useToken`.

### In scope

- `packages/frontend/src/routes/deposit.tsx` — replace the static composition
  with a controlled, state-driven page.
- Minimal additive prop extensions to `@pipeline/ui` `TokenInput` and
  `StepsCard` to support controlled input, click handlers, loading, and a
  per-step `state: "idle" | "success"`.
- A small `Banner` (or inline equivalent) for the low-balance state — see
  "Banner primitive decision" under Implementation Steps.
- New `packages/frontend/src/lib/usdc.ts` with parse/format helpers (decimals
  are fed by `useToken().decimals` — not hardcoded). Helpers live in
  `packages/frontend/src/lib/` per the existing repo layout (no `lib` dir under
  `@pipeline/ui` for this kind of frontend-app utility).
- Updated tests at `packages/frontend/src/routes/deposit.test.tsx` using the
  mock-key short-circuits (no real wagmi).

### Out of scope

- Tx confirmation modal / explicit success screen — rely on inline button
  pending/success states already supported by `StepRow`'s `Button`.
- Withdraw page (`/withdraw`) — separate Issue.
- Wrong-network detection / chain switching — separate concern.
- A new `EmptyState` variant or generic `Banner` component published from
  `@pipeline/ui`. If a low-balance banner needs custom layout we render it
  inline on the route using token CSS variables. See "Banner primitive
  decision".
- Migrating any other route. This Issue only touches `deposit.tsx`.

## Assumptions and Risks

- **`useToken` already supersedes `useUsdcBalance`.** The Issue body's
  `useUsdcBalance` references are stale; #220 deleted that hook. The plan uses
  `useToken({ token: usdc, spender: ENV.DEPOSIT_MANAGER_ADDRESS })` everywhere.
- **Token decimals are dynamic.** Real USDC is 6 decimals, but the plan does
  not hardcode `6`. Parsing/formatting takes `decimals` from
  `useToken().decimals` (also covered by the per-token mock key
  `pipeline.mock.wallet.contract.<token>.decimals`). While `decimals` is
  loading we treat input as not-yet-parseable and keep buttons disabled.
- **`refetchAllowance` after approve.** `useApproval` already auto-refetches
  allowance on a successful approve (see `useApproval.ts` lines 178-182), so
  `useToken.refetchAllowance` does not need to be called manually here. We
  rely on that auto-behavior. If a coder finds it's not firing in practice,
  add an explicit `useEffect(() => { if (isApproveSuccess) refetchAllowance?.(); }, ...)`.
- **`refetchBalance` after a successful `requestDeposit`.** The USDC balance
  drops by `amount` once the tx settles. We call `refetchBalance()` from a
  `useEffect` keyed on `useRequestDeposit().isSuccess`, mirroring the
  approval auto-refetch pattern. Tests assert this call fires in the mock
  path.
- **Insufficient-balance gate uses live `minDeposit`.** When `minDeposit` is
  loading, we cannot decide between "approve needed" and "insufficient
  balance"; in that case render the StepsCard with both buttons disabled (no
  banner flash). Only flip to the banner once both `balance` and `minDeposit`
  are non-`undefined` AND `balance < minDeposit`.
- **Disconnected wallet.** The page renders the same layout but step buttons
  stay disabled. Connecting is handled by the global `TopBar`. No banner is
  shown when disconnected (we don't yet know the balance).
- **`StepsCard` API extension is additive.** Adding `onClick`, `loading`, and
  `state` to `StepItem` is backwards compatible. The existing call site
  (`deposit.tsx` itself) is the only consumer; storybook stays untouched
  except for one updated story showing the new `state: "success"` path.
- **`TokenInput` controlled value.** Today the `<input>` inside `TokenInput`
  is uncontrolled. Adding `value` + `onValueChange` as optional props keeps
  callers that don't pass them working unchanged.
- **Mock-friendly tests.** All four scenarios are reproducible via the
  documented mock keys in `packages/frontend/src/wallet/README.md` — no real
  wagmi calls in tests.
- **Risk: input validation.** Free-form decimal strings can be invalid
  ("1.2.3", "abc", "1e10"). We accept anything `parseUnits` from `viem`
  accepts; anything else returns `0n` and keeps buttons disabled. We do NOT
  add a visible "invalid input" error in this Issue.
- **Risk: prop drift on `StepRow`.** `StepRow` currently uses
  `variant="primary-dark"` for both Approve and Convert. The Approved state
  swaps step 1's button for a success badge — we render this by passing a
  new `state` and letting `StepRow` render either the existing `Button` or a
  `CheckBadge`-equivalent. The check badge is a tiny inline SVG/element; we
  do NOT introduce a new exported component for it.

## Open Questions

_None._

(The prompt resolves the only outstanding ambiguity: use `useToken`'s
approval surface instead of a separate `useApproval` call; everything else
follows directly from the Issue body, current code, and the documented mock
key layer.)

## Implementation Steps

### 1. Helpers — `packages/frontend/src/lib/usdc.ts`

Create a small new file. Exports:

```ts
// parseUsdc(raw: string, decimals: number | undefined): bigint
//   - Trims whitespace; returns 0n for empty string or undefined decimals.
//   - Uses viem `parseUnits(raw, decimals)` wrapped in try/catch — any throw
//     returns 0n.
// formatUsdc(value: bigint, decimals: number | undefined): string
//   - Returns "—" when decimals is undefined.
//   - Uses viem `formatUnits` then `new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
//   - No currency or token-symbol prefix/suffix (matches `useToken.formattedBalance`).
// formatUsdcCurrency(value: bigint, decimals: number | undefined): string
//   - Same as formatUsdc, prefixed with "$" — used for the quick-amount labels
//     ("$1,000 (Min)") and the banner subtitle ("Minimum amount — $N USDC").
```

`viem` is already a transitive dep of the wallet module; importing it from
`packages/frontend/src/lib/usdc.ts` is fine because the eslint
`no-restricted-imports` rule scopes the wallet boundary to wagmi/viem direct
imports outside `src/wallet/`. Verify the rule before writing — if it blocks
`viem` from `lib/`, expose `parseUnits` / `formatUnits` helpers from the wallet
barrel instead (`packages/frontend/src/wallet/index.ts`) and import those.

Tests: `packages/frontend/src/lib/usdc.test.ts` — round-trips for 6-decimal
input ("1000" → 1_000_000_000n → "1,000.00"), invalid input returns 0n,
undefined decimals returns 0n / "—".

### 2. Extend `TokenInput` props (additive only)

File: `packages/ui/src/components/TokenInput/TokenInput.tsx`.

Add optional props:

- `value?: string` — when present, makes the `<input>` controlled.
- `onValueChange?: (next: string) => void` — fired on every `onChange`.
- `disabled?: boolean` — disables the `<input>` (used when wallet
  disconnected or no `minDeposit` yet).

When `value` is undefined, the input remains uncontrolled (`placeholder` only)
so existing call sites and storybook stories still work. Add a corresponding
story variant "Controlled input" to
`packages/ui/src/components/TokenInput/TokenInput.stories.tsx` to lock in the
behavior.

Pass-through to the inner `<input>`:

```tsx
<input
  type="text"
  inputMode="decimal"
  value={value ?? undefined}
  onChange={(e) => onValueChange?.(e.target.value)}
  disabled={disabled}
  // …existing classes/aria…
/>
```

### 3. Extend `StepItem` shape on `StepsCard` (additive only)

File: `packages/ui/src/components/StepsCard/StepsCard.tsx` and
`packages/ui/src/components/StepRow/StepRow.tsx`.

Add to `StepItem`:

- `onClick?: React.MouseEventHandler<HTMLButtonElement>` — rename/alias of
  `onAction` to read better at call sites. Keep `onAction` as an alias for
  back-compat (the existing test page may call it). _Actually_, keep
  `onAction` as-is to minimise churn; coders should wire to `onAction`.
- `loading?: boolean` — when true, button shows a spinner state. Reuse the
  existing `Button` `disabled` + a tiny inline spinner element; do not invent
  new exports.
- `state?: "idle" | "success"` — when `"success"`, render a small green
  check badge instead of the action button. The badge is implemented inline
  in `StepRow.tsx` using the existing `CoinIcon`/svg pattern (no new exported
  primitive). Acceptable substitute: an inline `<span>` with a checkmark
  glyph styled via design tokens (no hardcoded hex).

Update the Storybook story for `StepsCard` with a `"Step 1 success"` variant.

### 4. Banner primitive decision (low-balance state)

Render the banner **inline** in `deposit.tsx` using the existing `Card`
primitive from `@pipeline/ui` plus design tokens. Reasoning: only one route
needs it today; promoting to a published component is premature. Structure:

```tsx
<Card variant="muted" className="flex flex-col gap-3 p-6 text-center">
  <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
    Add funds to your USDC balance
  </p>
  <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]">
    Minimum amount — {formatUsdcCurrency(minDeposit, decimals)} USDC
  </p>
  <Button variant="primary-dark" onClick={copyAddress}>
    {copied ? "Copied" : "Copy Address"}
  </Button>
</Card>
```

If during implementation the `Card` `muted` variant doesn't match the Figma
fill, switch to `variant="white"` or pass an inline `className` with token
overrides — but do not hardcode colors/sizes/radii.

### 5. Rewrite `routes/deposit.tsx`

File: `packages/frontend/src/routes/deposit.tsx`.

Skeleton:

```tsx
import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, ConversionCard, DepositHeader, StepsCard, Button } from "@pipeline/ui";
import {
  useWallet,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useToken,
} from "@/wallet";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc, formatUsdcCurrency } from "@/lib/usdc";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function Deposit() {
  // ── State sources ─────────────────────────────────────────────────────
  const { address, isConnected } = useWallet();
  const { usdc } = useDepositManagerAddresses();
  const { minDeposit } = useDepositManagerMinDeposit();
  const usdcAddr = usdc ?? (ZERO_ADDRESS as `0x${string}`);
  const {
    decimals,
    balance,
    formattedBalance,
    allowance,
    approve,
    isApprovePending,
    isApproveSuccess,
    refetchBalance,
  } = useToken({ token: usdcAddr, spender: ENV.DEPOSIT_MANAGER_ADDRESS });
  const requestDeposit = useRequestDeposit();

  // ── Local state ───────────────────────────────────────────────────────
  const [amountInput, setAmountInput] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────
  const amountBig = parseUsdc(amountInput, decimals);
  const isReady = decimals !== undefined && balance !== undefined && minDeposit !== undefined;
  const hasBalance = isReady ? balance >= minDeposit : undefined;
  const needsApproval =
    allowance !== undefined && amountBig > 0n && allowance < amountBig;
  const canApprove =
    isConnected && hasBalance === true && amountBig > 0n && needsApproval && !isApprovePending;
  const canConvert =
    isConnected && hasBalance === true && amountBig > 0n && !needsApproval && !requestDeposit.isPending;

  // ── Refetch balance after a successful requestDeposit ────────────────
  useEffect(() => {
    if (requestDeposit.isSuccess) refetchBalance();
  }, [requestDeposit.isSuccess, refetchBalance]);

  // ── Copy address handler (1.5s "Copied" affordance) ──────────────────
  const copyAddress = useCallback(() => {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }, [address]);

  // ── Quick-amount handlers ────────────────────────────────────────────
  const onQuickAmount = useCallback(
    (idx: number) => {
      if (decimals === undefined) return;
      if (idx === 0 && minDeposit !== undefined) {
        setAmountInput(formatUsdc(minDeposit, decimals).replace(/,/g, ""));
        return;
      }
      if (idx === 1) setAmountInput("5000");
      else if (idx === 2) setAmountInput("10000");
      else if (idx === 3 && balance !== undefined) {
        setAmountInput(formatUsdc(balance, decimals).replace(/,/g, ""));
      }
    },
    [decimals, minDeposit, balance],
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        <DepositHeader title="1:1 Conversion" />

        <ConversionCard
          input={{
            token: "usdc",
            tokenLabel: "USDC",
            balanceLabel: formattedBalance ?? "—",
            placeholderValue: "0",
            value: amountInput,
            onValueChange: setAmountInput,
            disabled: !isConnected || !isReady,
            quickAmounts: [
              { label: minDeposit !== undefined && decimals !== undefined
                  ? `${formatUsdcCurrency(minDeposit, decimals)} (Min)`
                  : "Min" },
              { label: "$5,000" },
              { label: "$10,000" },
              { label: "Max" },
            ],
            onQuickAmountClick: onQuickAmount,
          }}
          output={{
            token: "plusd",
            tokenLabel: "PLUSD",
            balanceLabel: "0.00",
            value: amountInput || "0",
          }}
          exchangeRate="1 USDC = 1 PLUSD"
          networkFee="—"
        />

        {hasBalance === false ? (
          // Insufficient-balance banner — replaces StepsCard.
          <Card variant="muted" className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
              Add funds to your USDC balance
            </p>
            <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]">
              Minimum amount —{" "}
              {minDeposit !== undefined && decimals !== undefined
                ? `${formatUsdcCurrency(minDeposit, decimals)} USDC`
                : "—"}
            </p>
            <Button variant="primary-dark" onClick={copyAddress} disabled={!address}>
              {copied ? "Copied" : "Copy Address"}
            </Button>
          </Card>
        ) : (
          <StepsCard
            steps={[
              {
                label: "Allow contract to use USDC",
                actionLabel: "Approve",
                disabled: !canApprove,
                loading: isApprovePending,
                state: !needsApproval && amountBig > 0n ? "success" : "idle",
                onAction: () => approve?.(amountBig),
              },
              {
                label: "Confirm and receive PLUSD",
                actionLabel: "Convert",
                disabled: !canConvert,
                loading: requestDeposit.isPending,
                onAction: () => requestDeposit.write(amountBig),
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/deposit")({ component: Deposit });
```

Notes:

- The `output.value` echoes the `amountInput` since the exchange rate is 1:1
  per the Issue body. If the input is empty we render `"0"` to match the
  current placeholder.
- We display `formattedBalance` from `useToken` directly as the `balanceLabel`;
  no manual format here. `formattedBalance` returns `"1,000.00"` (no `$`, no
  `USDC` suffix) — matches the post-#220 contract.
- `networkFee` left as `"—"` because we do not have gas estimation wired up;
  the Issue body does not require it. The previous static `"~$0.00053 ETH ($1.20)"`
  was placeholder copy and dropping it is consistent with "no fake data" hygiene.
- `isSuccess` from `useApproval` is already wired to auto-refetch allowance
  (see `useApproval.ts` lines 178-182); the new `needsApproval` derivation
  will flip to `false` once the new allowance arrives, transitioning step 1
  to its `"success"` state automatically.

### 6. Tests — `packages/frontend/src/routes/deposit.test.tsx`

Create (or replace if it exists) using the pattern from
`packages/frontend/src/components/TopBar.test.tsx` and
`packages/frontend/src/wallet/useToken.test.tsx`:

- Mock `wagmi`, `@reown/appkit/react`, `@tanstack/react-query` providers, and
  `@/wallet/config` per the existing template.
- Seed `localStorage` mock keys in `beforeEach`. Use stable example addresses:
  - `pipeline.mock.wallet.address` = `"0x1234…0000"`
  - `pipeline.mock.wallet.isConnected` = `"true"`
  - `pipeline.mock.wallet.contract.depositManager.usdc` = USDC_ADDR
  - `pipeline.mock.wallet.contract.depositManager.plusd` = PLUSD_ADDR
  - `pipeline.mock.wallet.contract.depositManager.minDeposit` = `"1000000000"` (1,000 USDC at 6 dp)
  - `pipeline.mock.wallet.contract.<usdc>.decimals` = `"6"`
  - `pipeline.mock.wallet.contract.<usdc>.symbol` = `"USDC"`
- Stub `navigator.clipboard.writeText` exactly like `AccountDropdown.test.tsx`.
- Stub `VITE_DEPOSIT_MANAGER_ADDRESS` via the existing `withEnvOverride`
  pattern (search `withEnvOverride` for examples).

Scenarios — one `it()` block each:

1. **Approve needed.** balance = 5,000 USDC; allowance = 0; user types `"2000"`.
   - Assert step 1 button enabled and step 2 disabled.
   - Click "Approve" — assert `useApproval.approve` was called with
     `parseUsdc("2000", 6) === 2_000_000_000n`. (Via mock keys
     `pipeline.mock.wallet.allowance.<usdc>.<dm>` = `"0"` and
     `pipeline.mock.wallet.contract.<usdc>.approve` = `{ hash: "0xapprove" }`.)
2. **Approved.** allowance = 10,000 USDC; user types `"2000"`.
   - Assert step 1 renders the success badge (query by accessible name or by
     the `state="success"` data attribute we'll add).
   - Assert step 2 button enabled. Click "Convert" — assert
     `pipeline.mock.wallet.contract.depositManager.requestDeposit` mock
     settles with `{ hash: "0xdeadbeef", requestId: "42" }` and the test
     observes the eventual `isSuccess`. Confirm `refetchBalance` is invoked
     (spy via the wagmi `useReadContract` `refetch` mock).
3. **Insufficient balance.** balance = `500_000_000` (500 USDC) < minDeposit
   1,000 USDC.
   - Assert StepsCard is NOT rendered (no "Approve" button in DOM).
   - Assert the banner heading "Add funds to your USDC balance" is rendered.
   - Assert subtitle includes "$1,000.00 USDC".
   - Click "Copy Address" — assert `navigator.clipboard.writeText` is called
     with the mocked wallet address; assert the button label flips to
     "Copied" then back after the 1.5s timeout (use `vi.useFakeTimers`).
4. **Quick-amount Min / Max.** Click chip 1 ("$1,000 (Min)") → input value
   becomes `"1000"`. Click chip 4 ("Max") with balance 5,000 USDC → input
   value becomes `"5000"`.
5. **Disconnected.** isConnected = false → both step buttons disabled,
   no banner.
6. **Min label reflects live `minDeposit`.** With minDeposit = 250 USDC, chip
   1 label becomes `"$250.00 (Min)"`.

Use `@testing-library/react` + `userEvent` (already used by sibling tests).

### 7. UI lib updates

- `packages/ui/src/components/TokenInput/TokenInput.tsx` — add the three new
  props, keep existing behavior.
- `packages/ui/src/components/TokenInput/TokenInput.stories.tsx` — add a
  "Controlled" story.
- `packages/ui/src/components/StepsCard/StepsCard.tsx` — extend `StepItem`
  with `loading?: boolean` and `state?: "idle" | "success"`.
- `packages/ui/src/components/StepRow/StepRow.tsx` — render either the
  existing `Button` or an inline success check badge based on `state`. When
  `loading`, set `disabled` and render a small spinner (CSS-only) on the
  button label.
- `packages/ui/src/components/StepsCard/StepsCard.stories.tsx` — add a
  "Step 1 success / Step 2 idle" story.

### 8. Lint & build verification

After the change is wired up, run from repo root:

```bash
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/ui lint
yarn workspace @pipeline/frontend test
yarn workspace @pipeline/ui test
npx tsx scripts/lint-docs.ts
```

`AGENTS.md` requires `lint-docs` to pass after any TypeScript change.

## Test Strategy

- **Unit:** `packages/frontend/src/lib/usdc.test.ts` — covers `parseUsdc`,
  `formatUsdc`, `formatUsdcCurrency` round-trips, invalid inputs, undefined
  decimals.
- **Route integration:** `packages/frontend/src/routes/deposit.test.tsx` —
  six scenarios listed in step 6 above. Drive all state through the
  `pipeline.mock.wallet.*` localStorage keys; no direct wagmi spies are
  required except for the `useReadContract` refetch counter used to verify
  post-`requestDeposit` balance refresh.
- **Storybook:** new variants on `TokenInput.stories.tsx` and
  `StepsCard.stories.tsx`. These are visual specs; no test runner asserts
  them but they keep the design pinned.
- **UX-tester sweep:** because the Issue references three Figma frames, the
  `manager` will route to `ux-tester` after implementation. The plan deliberately
  surfaces the three Figma URLs in the Issue body so `ux-tester` can compare
  rendered states 1:1.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — no new mock keys are introduced
  (the page uses keys already documented for `useToken`, `useApproval`,
  `useDepositManagerMinDeposit`, and `useRequestDeposit`). Add a short new
  section "**Driving the `/deposit` page with mocks**" near the end that
  shows the exact DevTools console snippet to simulate each of the three
  states (approve-needed, approved, insufficient-balance) — this is high-value
  for ux-tester sessions.
- `docs/frontend/index.md` (or the appropriate `docs/frontend/*.md` page) —
  add a one-paragraph note that the deposit page is now state-driven by
  `useToken` + `useDepositManagerMinDeposit` + `useRequestDeposit`. No
  product-spec change required because the user-visible behavior matches the
  existing Figma frames (which are already the spec).
- No update to `docs/product-specs/` is needed: the behavior described here
  is the documented user story for `/deposit`. If the coder finds the user
  story is missing or stale, log an addendum in
  `docs/product-specs/user-stories.md` while implementing.
