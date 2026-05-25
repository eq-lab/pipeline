# Issue #385: First-connection terms acknowledgement modal gates wallet connect

Source: https://github.com/eq-lab/pipeline/issues/385

## Scope

Add a one-time **"Before you continue"** modal that interposes between a user clicking **Connect Wallet** and the wagmi/Reown AppKit connect modal. The user must toggle a jurisdiction self-attestation switch and click **Continue** before AppKit `open()` is called. The acknowledgement is persisted in `localStorage` under `pipeline.wallet.termsAcknowledged`; subsequent connects skip the modal entirely.

In scope:

- New component `packages/frontend/src/components/FirstConnectionModal.tsx` matching Figma init + checked states (visual specs and copy in the Issue body).
- New hook `packages/frontend/src/wallet/useTermsAcknowledgement.ts` exposing `{ acknowledged, acknowledge() }` with cross-tab `storage`-event sync.
- Gate `useWallet().connect()` in `packages/frontend/src/wallet/useWallet.ts` so the real path (`useAppKit().open()`) is only reached when `acknowledged === true`. Mock-wallet short-circuit (the early-return at `useWallet.ts:60`) stays untouched — see Open Questions #3 below; recommended answer: mocks bypass the gate.
- Mount the modal at the wallet provider boundary so any caller of `connect()` (TopBar, ConnectWalletPromoCard, future surfaces) triggers it without per-call wiring.
- Accessibility: focus trap, focus restoration to originating Connect button, Escape closes, scrim click closes, `role="dialog" aria-modal="true"`, `aria-labelledby` on the heading.
- Unit tests for the hook, the modal component, and the gating behavior in `useWallet`.

Out of scope:

- Extracting Modal / Switch primitives into `@pipeline/ui` — defer until a second consumer appears (log to `tech-debt-tracker.md` if reused later).
- Backend KYC enforcement; the mock-bridge layer (`pipeline.mock.wallet.*`) is not affected.
- Terms of Service URL target — see Open Question #2; placeholder `/terms` until resolved.

## Assumptions and Risks

- **Single connect entry point.** All connect flows already funnel through `useWallet().connect()`. Verified call sites: `packages/frontend/src/components/TopBar.tsx:184`, `packages/frontend/src/components/ConnectWalletPromoCard.tsx` (wired via `routes/index.tsx`). No direct `useAppKit().open()` call sites exist outside `useWallet.ts`. Risk: if a future surface bypasses `useWallet().connect()` it would skip the gate — mitigate by keeping AppKit access encapsulated in `useWallet`.
- **AppKit modal vs our modal.** Reown AppKit's `open()` is non-cancellable from outside, so the gate must occur strictly before the call, not as a wrapper around the open promise.
- **Mock wallet path.** The existing mock short-circuit returns before AppKit is called; gating mocks would break the dev affordance. Recommended: mocks bypass the gate (see Open Q #3).
- **Cross-tab sync.** `storage` event fires only on other tabs. Same-tab updates need explicit setState in `acknowledge()`. Pattern used by existing `useMock` hook in `wallet/mock.ts` is a good reference (custom event), but the canonical `storage` event suffices for "another tab persisted ack — reflect here".
- **SSR / localStorage absence.** `localStorage` access must guard `typeof window === "undefined"` (TanStack Router app uses SSR-less Vite client by default, but defensive guard is cheap).
- **No `@pipeline/ui` Switch primitive** today — the toggle is built inline. Risk of style drift; mitigate by binding to the existing token vars listed in the Issue (`#208000`, `rgba(56,55,53,0.18)`, `#262524`).

## Open Questions

1. **Address-scoped vs global ack?** Spec recommends global (one key, no per-address suffix); please confirm — implementation will proceed with the global key `pipeline.wallet.termsAcknowledged`.
2. **Terms of Service URL.** Footer link target is TBD; will ship as `/terms` placeholder unless a real URL is provided.
3. **Mock wallet path.** Should mocks (set via `pipeline.mock.wallet.*`) also pass through the gate, or stay a dev affordance that bypasses it? Recommended: bypass.

## Implementation Steps

1. **Add the acknowledgement hook.** Create `packages/frontend/src/wallet/useTermsAcknowledgement.ts`:
   - Constant `TERMS_ACK_KEY = "pipeline.wallet.termsAcknowledged"`.
   - Hook returns `{ acknowledged: boolean, acknowledge: () => void }`.
   - Read initial value from `localStorage`; subscribe to the browser `storage` event to update state when another tab writes the key.
   - `acknowledge()` writes `"true"` and updates local state (same-tab `storage` events do not fire).
   - Export a non-hook helper `readTermsAcknowledged(): boolean` for the gate check inside `connect()` (avoids needing to re-render `useWallet` consumers when ack flips, and lets the gate run synchronously inside the click handler).
2. **Add the modal component.** Create `packages/frontend/src/components/FirstConnectionModal.tsx`:
   - Props: `{ open: boolean; onContinue: () => void; onDismiss: () => void }`.
   - Renders a portal-style fixed overlay (scrim `bg-[rgba(56,55,53,0.6)]`), centered modal panel 420px wide, `max-h-[80vh] md:max-h-[80vh]` (mobile `90vh`), `bg-[#f8f7f6]`, 24px padding, 4px radius.
   - Hero: 72px round tinted container with shield-check icon. Reuse existing `HeroIcon` from `@pipeline/ui` if compatible; otherwise inline an SVG (decide during implementation — log to tech-debt if a new variant is needed).
   - Heading: "Before you continue" (Heading M token).
   - Bullet list with forbidden + magnifier glyphs (copy as in Issue body). Use existing icon assets or inline SVG.
   - Toggle switch (inline component): off track `rgba(56,55,53,0.18)`, on track `#208000`, white thumb. Label: "I'm not a US person and not located in a restricted jurisdiction". Focusable with `role="switch"` + `aria-checked`.
   - Primary CTA "Continue": disabled when toggle off (opacity ~32%, `cursor-not-allowed`, `aria-disabled`); enabled solid `#262524`. Calls `onContinue` on click.
   - Secondary CTA "Disconnect": calls `onDismiss`.
   - Footer: "By continuing, you agree to our Terms of Service" with link to `/terms` (placeholder until OQ #2 resolved).
   - Behavior: Escape and scrim click both call `onDismiss`. Implement focus trap (cycle Tab/Shift+Tab among `[role="switch"]`, "Continue", "Disconnect", "Terms" link). On open, focus the toggle. On close, return focus to the trigger (the wallet provider tracks `document.activeElement` at open time).
   - `data-node-id` annotations referencing Figma nodes `1572:123328` (init) and `1582:69059` (checked) for traceability.
3. **Gate `connect()` at the provider boundary.** Update `packages/frontend/src/wallet/WalletProvider.tsx` to:
   - Wrap children with a React context that exposes a `requestConnect()` action and an `isGateOpen` boolean.
   - Render `<FirstConnectionModal />` at the provider level.
   - Inside `useWallet.connect()` (in `useWallet.ts`):
     - Keep the mock short-circuit (line 60) as-is.
     - If `readTermsAcknowledged()` is `true`, call `open()` directly.
     - Otherwise, dispatch the "open gate" action via the new context (e.g., via a module-level event emitter or a shared `useGateController` hook) — modal mounts, user toggles + clicks Continue, the provider calls `acknowledge()` then `open()`.
   - Keep `connect()` synchronous-looking from the caller's perspective; the modal lives in the provider tree.
4. **Wire up trigger-focus restoration.** The provider captures `document.activeElement as HTMLElement | null` when the gate opens and restores focus to it after dismiss or continue. (TopBar's Connect button and ConnectWalletPromoCard's Connect button are both real `<button>` elements, so this works out of the box.)
5. **Tests.**
   - `useTermsAcknowledgement.test.tsx`: initial false, reads existing `"true"`, `acknowledge()` flips state and writes localStorage, cross-tab `storage` event flips state in second hook instance.
   - `FirstConnectionModal.test.tsx`: renders init state with toggle off + Continue disabled, toggling enables Continue, click Continue → `onContinue`, click Disconnect / press Escape / click scrim → `onDismiss`, focus trap holds inside the dialog, `aria-modal` set.
   - `useWallet.test.tsx`: extend the existing `connect()` describe block:
     - When ack flag is absent → `mockOpen` is NOT called immediately (gate opens instead — assert via the gate-controller indirection or a spy on the provider's `requestConnect`).
     - When ack flag is set to `"true"` in `localStorage` → `mockOpen` is called directly (no modal).
     - Mock-wallet short-circuit still bypasses both gate and AppKit.
   - `routes/-index.test.tsx`: update the existing "clicking Connect calls useWallet().connect() → opens AppKit modal" assertion if needed so it primes `pipeline.wallet.termsAcknowledged = "true"` before clicking (keeps the test scoped to the AppKit handoff).
6. **Manual verification (handed to ux-tester).**
   - Clear `localStorage`. Click Connect on home or TopBar → our modal appears, AppKit does not.
   - Toggle off → Continue disabled. Toggle on → Continue enabled (Figma checked frame parity).
   - Click Disconnect / X / scrim / Escape → modal closes, no AppKit, no flag.
   - Click Continue with toggle on → flag set, AppKit opens.
   - Reload page → click Connect → AppKit opens directly (no modal).
   - DevTools: `localStorage.removeItem('pipeline.wallet.termsAcknowledged')` → gate returns on next Connect.
   - Keyboard: Tab cycles inside modal, Escape closes, focus returns to Connect button.

## Test Strategy

- **Unit (vitest + RTL):** new tests for the hook and modal; extend `useWallet` tests to cover gated and acknowledged paths. Keep mock-wallet path test green.
- **Integration:** existing `routes/-index.test.tsx` flow updated to pre-seed the ack flag so it still asserts the home-page Connect → AppKit handoff.
- **Manual UX (ux-tester via the manager flow):** Figma parity for both init and checked states; full acceptance checklist from the Issue body (8 items) including keyboard navigation and `localStorage` clearing.
- **Edge cases to verify in tests / manually:**
  - Two tabs open: ack in tab A → tab B's hook reflects via `storage` event.
  - Connect clicked twice quickly while modal already open → second click is a no-op (gate context dedupes).
  - Toggle on → Toggle off again → Continue re-disabled.
  - SSR/`window` absent → no crash on import (defensive guards).

## Docs to Update

- `docs/frontend/index.md` or the wallet-stack reference doc (`project_wallet_stack.md` in memory): add a short note that wallet connect is gated by `pipeline.wallet.termsAcknowledged`.
- `docs/STORIES.md`: add a story for the first-connection gate (init + acknowledged paths) so ux-tester can regress it.
- No product spec exists for onboarding/jurisdiction gating yet; if maintainers want this captured, add a short section to `docs/product-specs/lp-onboarding.md`. Logged here as a soft recommendation rather than a hard requirement — the change is UI-only and the Issue body already serves as the behavioral spec.
- `docs/exec-plans/tech-debt-tracker.md`: log "extract Modal + Switch primitives to `@pipeline/ui` when a second consumer appears" entry.
