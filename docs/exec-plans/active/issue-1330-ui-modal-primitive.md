# Issue #1330: Extract Modal / ModalOverlay primitive into @pipeline/ui

Source: https://github.com/eq-lab/pipeline/issues/1330

Parent epic: #2029 (Frontend tech debt, 2026-09-22 batch). Tracker source: TD-10 (Switch half
resolved by #1158; this closes the Modal half).

## Scope

The LP app hand-rolls the same modal mechanics (portal into `document.body`, `z-[9999]` overlay,
`role="dialog" aria-modal="true" aria-labelledby`, Tab focus trap, initial focus, capture-phase
Escape, body-scroll lock, scrim click-to-dismiss) in several places. This Issue adds one shared
primitive to `@pipeline/ui` and moves the LP callers that share its shape onto it. It is a
**behaviour-preserving refactor**: rendered DOM, classes/token values, `data-testid`s and
`data-node-id`s of the migrated modals stay the same. The only intended behaviour changes are
listed under "Behaviour decisions" below.

### In scope

1. **`ModalOverlay`** (`packages/ui/src/components/Modal/ModalOverlay.tsx` + co-located
   `useModalOverlay.ts`): the behaviour layer. It handles the portal, the overlay element, the
   dialog panel element with ARIA wiring, focus trap, initial focus, Escape, the body-scroll lock
   and scrim click. It has two layouts:
   - `centered`: tinted scrim `rgba(56,55,53,0.6)`, `flex items-center justify-center`, scrim
     click dismisses, and a click inside the panel does not.
   - `fullscreen`: no scrim, no scrim click, and the panel fills the viewport. This is the
     `AuthModalShell` / `ConnectWalletModal` frame.
2. **`Modal`** (`packages/ui/src/components/Modal/Modal.tsx`): the centered 420 px "card" modal
   that `FirstConnectionModal` and `FundingDetailsModal` both draw today. It is `ModalOverlay
   layout="centered"` plus:
   - the panel box: 420 px wide, `max-width: calc(100vw - 32px)`, `max-height: min(80vh, 90dvh)`,
     `--color-pipeline-paper` background, `--radius-pipeline-card` radius, 24 px padding,
     `relative flex flex-col overflow-y-auto`;
   - the top-right 32 px `×` close button (`aria-label="Close"`, same classes and glyph), rendered
     as the panel's first child as it is today.
3. **Migrate callers**:
   - `packages/frontend/src/components/FirstConnectionModal.tsx`, the caller the Issue names, to
     `Modal`.
   - `packages/frontend/src/components/FundingDetailsModal.tsx`, the second consumer TD-10 was
     waiting for (same card geometry, scrim and testid scheme), to `Modal`. Delete
     `useFundingDetailsModal.ts`, since everything it does moves into the primitive.
   - `packages/frontend/src/components/AuthModalShell.tsx` keeps its own two-pane layout, right
     image panel, back/step/close chrome and props. It only replaces its private `FOCUSABLE` /
     `trapFocus` / four `useEffect`s / `createPortal` with `ModalOverlay layout="fullscreen"`.
     Its 9 consumers (`SignInModal`, `CreateAccountModal`, `OtpModal`, `AddEmailModal`,
     `ForgotPasswordModal`, `ResetLinkSentModal`, `ResetPasswordModal`, `CompanyDocsModal`,
     `AccountInReviewModal`) need no change.
4. Storybook story, `ui-components.md` section, and spec/tracker updates (see "Docs to Update").

### Out of scope (each logged or already tracked)

- **`packages/frontend/src/components/ConnectWalletModal.tsx`**: tracked by **#1342** (TD-58,
  "render through `AuthModalShell`"). Once #1342 lands it gets the primitive through the shell.
  Not touched here: it is on the critical connect path.
- **`packages/wallet-connect/src/ConnectWalletModal.tsx`** (the Trustee's copy): could adopt
  `ModalOverlay` directly, since wallet-connect already depends on `@pipeline/ui`. It has
  Trustee-specific props (`signMessageOnly`, `onWalletSelect(kind)`), so it is left for a
  follow-up. Log as a new TD entry, or fold it into #1342's scope (see Open Questions).
- **`MobileNavMenu`**: a side-drawer layout whose Escape / scroll-lock lives in
  `useMobileNavMenu`, which also owns the open state. It is a third layout, not this shape.
  Log as a TD entry.
- **Trustee inline dialogs** (~18 `role="dialog"` blocks under `packages/trustee/src/routes/`)
  and **`@pipeline/ui`'s `NetworkSwitchDialog` / `ErrorDetailsDialog`**: a different visual
  family (white panel, shadow, `z-50`, not portaled). `ErrorDetailsDialog` also has documented
  nested-dialog semantics (`docs/frontend/error-handling.md#nested-dialogs-1037`). Log as a TD
  entry for a later pass. No change here.
- Focus restore on close stays with the caller (`triggerRef`, per
  `dashboard-components.md#firstconnectionmodal`). The primitive does not add it.

### Behaviour decisions (deliberate, documented in the specs)

- **Escape**: one listener per open overlay on `document`, capture phase, `e.stopPropagation()`.
  This is the `FirstConnectionModal` / `AuthModalShell` behaviour today. Keeping it on `document`
  rather than `window` means a nested `ErrorDetailsDialog` still consumes Escape first:
  `window`-capture + `stopImmediatePropagation` fires before any `document` listener. Moving the
  modal to `window` capture would invert that and close the parent instead.
  `FundingDetailsModal` moves from `window`-capture to this. The user-visible result is the same.
  - **Stack-aware Escape**: the module keeps a stack of open overlays, and only the top-most one
    reacts to Escape and traps Tab. This resolves the "Escape-key capture-phase collision"
    caveat in `auth-components.md` for primitive users.
- **Body-scroll lock** is reference-counted at module level. On the first lock it saves the
  current `body.style.overflow` and sets `hidden`; on the last unlock it restores the saved
  value. This resolves the "unguarded body-scroll-lock" caveat for primitive users. Today the
  saved value is always `""`, so single-modal behaviour (and every existing `overflow` test)
  is unchanged.
- **Focus trap selector**: the union of today's two selectors:
  `button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`,
  filtered by `!el.closest("[aria-hidden]")`. `[role="switch"]` is dropped because the `Switch`
  is a `<button>`.
- **Initial focus**: `initialFocusRef?.current` if given, otherwise the first focusable element
  in the panel, in both cases after `setTimeout(0)` as today. `FirstConnectionModal` passes its
  Switch ref. `AuthModalShell` keeps "first focusable" (`OtpModal`'s `holdsDeliberateFocus`
  depends on this).
- **`FundingDetailsModal` gains a focus trap and initial focus on the `×`.** Today it has
  neither, so this is a small a11y improvement and is specced in `bank-transfers.md`. See Open
  Questions if this should instead be opt-out.

### Proposed API (coder may adjust names, not semantics)

```ts
export interface ModalOverlayProps {
  open: boolean;
  onDismiss: () => void;
  labelledBy: string;
  children: React.ReactNode;
  layout?: "centered" | "fullscreen";
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  overlayTestId?: string;
  testId?: string;
  nodeId?: string;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
}

export interface ModalProps
  extends Omit<ModalOverlayProps, "layout" | "panelClassName" | "panelStyle"> {
  className?: string;
}
```

`centered` always dismisses on a scrim click and `fullscreen` has no scrim, which matches every
in-scope caller, so no `dismissOnScrimClick` flag is needed.

## Assumptions and Risks

- **No Figma reference** on the Issue. This is a refactor with no visual delta. Verification is
  that the migrated modals render the same DOM, classes and token values, not a Figma
  comparison.
- **Inline styles become classes.** `FirstConnectionModal` / `FundingDetailsModal` set
  width/max/bg/radius/padding through `style={{…}}`. The `Modal` panel expresses the same values
  with Tailwind arbitrary values and theme tokens (`#f8f7f6` = `--color-pipeline-paper`,
  4 px = `--radius-pipeline-card`). The rendered computed style must be identical. No tests
  assert the inline style today (checked).
- **Tailwind v4 `@source`**: the new classes live in `packages/ui/src`, which the frontend and
  trustee entry CSS already `@source` (other `@pipeline/ui` components render styled), so no CSS
  change is expected. Confirm the scrim and panel look right in the running LP app.
- **Panel-specific gap/overflow**: `FirstConnectionModal` uses `gap-6`, while
  `FundingDetailsModal` uses `gap-5` and adds `overflow-x-hidden`. These go through `Modal`'s
  `className`. Do not bake either into the primitive.
- **Stack order**: the Escape/focus-trap stack is ordered by when each overlay's effect ran.
  Sequential opens (every real flow) are correct. Two overlays mounting in the same commit would
  register child-first. No caller does that, so this is noted in the spec, not engineered
  around.
- **Mixed families**: `ConnectWalletModal` (both copies) and `MobileNavMenu` still write
  `body.style.overflow` directly and are not in the stack. Stacking one of them with a primitive
  modal keeps today's hazard. Document it in `auth-components.md` until #1342 and the follow-ups
  land.
- **`EmailAuthFlow` swap invariant** (`auth-components.md`: exactly one dialog, scroll lock
  survives a screen swap) must still hold. Outgoing cleanup runs before incoming effects in one
  commit: refcount 1→0 restores `""`, then 0→1 sets `hidden`. Existing `-test.test.tsx` /
  `EmailAuthFlow.test.tsx` assertions cover it.
- `@pipeline/ui` has no test runner. DOM tests for ui components run in the frontend's Vitest
  (`*.dom.test.tsx` precedent: `ErrorDetailsDialog.dom.test.tsx`).
- Lint guards: new files get exactly one 2–3-line `spec:` header and no other comments.
  `scripts/lint-comments.baseline.json` lists `FirstConnectionModal.test.tsx`, so if the coder
  touches it, shrink its entry. Stripping the narrative comments from the migrated `.tsx` files
  is expected, because the refactor rewrites those blocks anyway.
- Possible overlap: #1329 (Tokens Storybook story, same epic) also edits Storybook but not these
  files. No conflict is expected.

## Implementation Steps

1. **Primitive hook**: create `packages/ui/src/components/Modal/useModalOverlay.ts` (header:
   `// spec: docs/frontend/ui-components.md#modal`).
   - Module-level `overlayStack: symbol[]` and `scrollLockCount` + `savedOverflow`.
   - `useModalOverlay({ open, onDismiss, initialFocusRef })` returns `panelRef`. While `open` it:
     - pushes a stable per-instance token onto the stack and removes it on cleanup;
     - acquires/releases the ref-counted scroll lock;
     - schedules initial focus with `setTimeout(0)` (the `initialFocusRef` target, otherwise the
       first `FOCUSABLE` in the panel) and clears it on cleanup;
     - adds one `document` keydown listener in the capture phase. If this instance is the top of
       the stack: on Escape it calls `e.stopPropagation()` and then the latest `onDismiss` (keep
       it in a ref so a changing callback does not re-register); on Tab it runs the trap
       (`FOCUSABLE` union, `aria-hidden` filter, wrap first↔last).
   - The today-separate Escape and Tab listeners merge into one capture listener. The Tab trap
     moves from bubble to capture. Confirm no test depends on bubble-phase Tab (the trap only
     `preventDefault`s at the edges, so it should not).
2. **`ModalOverlay`**: create `packages/ui/src/components/Modal/ModalOverlay.tsx`. It returns
   `null` when `!open` or `typeof document === "undefined"`. Otherwise it portals into
   `document.body`:
   - the overlay `div`: `fixed inset-0 z-[9999] flex`, plus `items-center justify-center` and
     `style={{ backgroundColor: "rgba(56,55,53,0.6)" }}` and `onClick={onDismiss}` for
     `centered`; `data-testid={overlayTestId}`;
   - the panel `div` inside it: `ref={panelRef}`, `role="dialog"`, `aria-modal="true"`,
     `aria-labelledby={labelledBy}`, `onClick={(e) => e.stopPropagation()}` for `centered`,
     `className={panelClassName}`, `style={panelStyle}`, `data-testid={testId}`,
     `data-node-id={nodeId}`, then `{children}`.
3. **`Modal`**: create `packages/ui/src/components/Modal/Modal.tsx`. It renders `ModalOverlay
   layout="centered"` with the panel classes from Scope §2 plus `className`, and the `×` button
   (classes and SVG copied verbatim from `FirstConnectionModal`) as the first child, then
   `children`.
4. **Barrel**: add `packages/ui/src/components/Modal/index.ts` exporting `Modal`,
   `ModalOverlay` and their prop types. Export them from `packages/ui/src/index.ts`. Do not
   export the hook (component-local per FRONTEND.md rule 2).
5. **Story**: add `packages/ui/src/components/Modal/Modal.stories.tsx` (follow
   `Toast.stories.tsx`). Include a `Modal` card with sample content, an `initialFocusRef`
   variant, and a `ModalOverlay` fullscreen variant, each toggled by a button so the portal and
   scroll lock work in Storybook.
6. **Migrate `FirstConnectionModal.tsx`**: delete `FOCUSABLE`, `trapFocus`, the focus, Escape,
   trap and scroll-lock effects, `handleScrimClick`, the overlay/panel/`×` markup and
   `createPortal`. Render:
   `<Modal open onDismiss labelledBy={headingId} initialFocusRef={toggleRef} overlayTestId="first-connection-modal-scrim" testId="first-connection-modal" nodeId="1572:123328" className="gap-6">…body…</Modal>`.
   Keep the toggle-reset effect and `handleContinue`. Per FRONTEND.md rule 2, move that state
   into a new co-located `useFirstConnectionModal.ts` if the view still holds non-trivial logic.
   Optional; keep it if it is just `useState` + reset.
7. **Migrate `FundingDetailsModal.tsx`**: replace the overlay/panel/`×` markup and
   `createPortal` with
   `<Modal … overlayTestId="funding-details-modal-scrim" testId="funding-details-modal" nodeId="6701:97113" className="gap-5 overflow-x-hidden">`.
   Remove the `useFundingDetailsModal` call and delete
   `packages/frontend/src/components/useFundingDetailsModal.ts`. Keep the rest of the body
   (rows, copy, toast, notices) untouched.
8. **Migrate `AuthModalShell.tsx`**: delete `FOCUSABLE`, `trapFocus`, the four effects and
   `createPortal`. Wrap the existing panel content in
   `<ModalOverlay layout="fullscreen" open onDismiss labelledBy={headingId} overlayTestId={`${testId}-overlay`} testId={testId} panelClassName="relative flex h-full w-full overflow-hidden bg-[var(--color-pipeline-paper)]">`.
   Leave the left pane, `RightImagePanel`, close/back/step buttons and props exactly as they
   are.
9. **Tracker and docs** (see "Docs to Update"). Add new TD entries for the out-of-scope copies
   (wallet-connect `ConnectWalletModal`, `MobileNavMenu`, Trustee inline dialogs plus
   `NetworkSwitchDialog`/`ErrorDetailsDialog`). Cross-reference #1342 for the LP
   `ConnectWalletModal`.
10. **Verify**:
    - `yarn workspace @pipeline/frontend test`
    - `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/ui lint`,
      `yarn workspace @pipeline/trustee build` (ui type changes)
    - `yarn workspace @pipeline/frontend build`
    - `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts` (update the baseline
      if a listed file shrank)
    - `yarn workspace @pipeline/ui build-storybook`

    Then ask the user to hard-refresh their running dev server and open the "Before you
    continue" gate, the Funding details modal (home → Add funds) and Sign in / Create account,
    and confirm they look and behave the same. Do not start or kill the dev server, and do not
    drive their browser.

## Test Strategy

- **New `packages/frontend/src/components/Modal.dom.test.tsx`** (imports from `@pipeline/ui`;
  jsdom; ErrorDetailsDialog precedent):
  - `open={false}` renders nothing. `open` portals into `document.body` with `role="dialog"`,
    `aria-modal="true"` and `aria-labelledby`. `testId`, `overlayTestId` and `nodeId` are
    applied.
  - `centered`: scrim click calls `onDismiss`, panel click does not. `fullscreen`: no scrim
    background and the overlay click does not dismiss.
  - Escape on `document` calls `onDismiss`. A changed `onDismiss` prop is the one called.
  - Focus trap: Tab on the last focusable element wraps to the first, and Shift+Tab on the
    first wraps to the last. Disabled and `aria-hidden` descendants are skipped.
  - Initial focus: the `initialFocusRef` target when given, otherwise the first focusable
    element (use fake timers or `waitFor`).
  - Scroll lock: `hidden` while open and restored on close. With **two stacked overlays**,
    closing the inner one keeps `hidden`, and closing both restores the pre-existing value
    (set `body.style.overflow = "scroll"` before mounting to prove the restore).
  - Stack: with two open, Escape dismisses only the top one, and Tab trapping applies only to
    the top panel.
  - Nested `ErrorDetailsDialog` inside a `Modal`: Escape closes the details dialog only and the
    `Modal` stays open (guards the document-vs-window decision).
  - `Modal`: the `×` is the panel's first child with `aria-label="Close"` and calls
    `onDismiss`.
- **Existing suites must pass without edits** (they are the regression net for "behaviour
  preserved"):
  - `FirstConnectionModal.test.tsx` (scrim/Escape/toggle/focus)
  - `FundingDetailsModal.test.tsx` (scrim, Escape, `overflow`)
  - `AuthModalShell.test.tsx`
  - every `*Modal.test.tsx` consumer of the shell, `OtpModal.test.tsx` (Escape → back, focus
    behaviour), `EmailAuthFlow.test.tsx`, `routes/-test.test.tsx` (one dialog per swap, scroll
    lock survives), `WalletGateProvider` / `ConnectModalProvider` tests

  If one fails, fix the primitive, not the test. The only exception is an assertion that pinned
  removed internals (for example a `useFundingDetailsModal` unit test, if one exists); delete
  or move that and say so in the PR.
- Add to `FundingDetailsModal.test.tsx`: focus lands on the `×` after open, and Tab wraps
  within the panel (covers the new behaviour).

## Docs to Update

- `docs/frontend/ui-components.md`: new `## Modal` section between `## Logo` and `## NavIcon`.
  Cover:
  - source paths and the `Modal` vs `ModalOverlay` split;
  - the props table;
  - centered card geometry and tokens, the scrim colour, `z-[9999]` (toast stack sits at
    `z-[10000]` above it);
  - the behaviour contract: portal, ARIA, focus-trap selector, initial focus, document-capture
    Escape and why (nested `ErrorDetailsDialog` precedence), stack-aware Escape/trap,
    ref-counted scroll lock and its limit (non-primitive modals still write overflow directly);
  - what is not included: focus restore stays with the caller.
- `docs/frontend/dashboard-components.md#firstconnectionmodal`: renders through `@pipeline/ui`
  `Modal` (`initialFocusRef` = Switch). Accessibility text unchanged.
- `docs/frontend/bank-transfers.md`:
  - FundingDetailsModal renders through `Modal`;
  - remove the `useFundingDetailsModal.ts` paragraphs (lines ~96 and ~114);
  - in `## Accessibility`, add the focus trap and initial focus on `×`;
  - Escape is handled by the primitive.
- `docs/frontend/auth-components.md#authmodalshell`:
  - the shell's mechanics now come from `ModalOverlay layout="fullscreen"`;
  - rewrite the two "Known shell caveats" as resolved for primitive-based modals, and keep the
    warning for stacking with `ConnectWalletModal` (until #1342) and `MobileNavMenu`;
  - adjust the later references to "the shell's stacking hazards" (~lines 1121, 1135).
- `docs/exec-plans/tech-debt-tracker.md`:
  - mark **TD-10** `[RESOLVED <date> / #1330]` with a resolution line;
  - add a note under **TD-58** that `AuthModalShell` now sits on `ModalOverlay`, so #1342
    inherits it;
  - add new TD entries for the wallet-connect `ConnectWalletModal`, `MobileNavMenu`, and the
    Trustee inline dialogs plus `NetworkSwitchDialog` / `ErrorDetailsDialog`.
- `docs/frontend/hooks.md`: no entry (`useModalOverlay` is component-local and not exported).

## Open Questions

- Is migrating `AuthModalShell`'s internals onto `ModalOverlay` (9 KYB/auth modals, no DOM
  change) in scope here, or should this Issue stop at `FirstConnectionModal` +
  `FundingDetailsModal` and leave the shell to #1342? The plan includes it, because TD-10 says
  "update all consumers" and the shell is the largest copy of the effects.
- Should the Trustee's `packages/wallet-connect/src/ConnectWalletModal.tsx` be added to #1342's
  scope (adopt `ModalOverlay layout="fullscreen"`), or filed as a separate tech-debt follow-up?
  The plan logs a new TD entry and does not touch it.
- `FundingDetailsModal` gains a focus trap and initial focus on the `×` button, which it lacks
  today. Accept this as a fix (plan default), or keep it focus-neutral?
