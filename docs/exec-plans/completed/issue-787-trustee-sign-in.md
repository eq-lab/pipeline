# Issue #787: Trustee: implement the sign-in section (Figma 4174-31660)

Source: https://github.com/eq-lab/pipeline/issues/787

Sub-issue of epic #775 (Trustee Admin Panel). Depends on #777 (scaffold — merged).
Product/technical spec: #453, persisted at `docs/product-specs/trustee-dashboard.md`.

> **RESOLVED — implemented 2026-07-08.** Both blockers below are closed:
> 1. The Figma frame (node `4174-31660`) was exported out-of-band and provided
>    to the coder as saved artifacts (`screenshot.png`, `design-context.txt`,
>    `variables.txt`, `metadata.txt`) — pixel/token-exact, no guessing.
> 2. Scope confirmed as **(a) static UI only**: the frame is a wallet-connect
>    "Unauthenticated Overlay" / "Login Prompt" card. The "Connect Wallet"
>    button `onClick` is a documented no-op tied to #778 (see
>    `docs/exec-plans/tech-debt-tracker.md` TD-34). No credentials/2FA form
>    exists in this frame, so the `@pipeline/ui` `Input`/`Label`/`PasswordField`
>    question is moot — no new UI primitives were added.
>
> Implementation: `packages/trustee/src/routes/sign-in.tsx`,
> `packages/trustee/src/components/SignInCard.tsx`,
> `packages/trustee/src/components/LockIcon.tsx`, test
> `packages/trustee/src/routes/-sign-in.test.tsx`.

## Scope

**In scope (target)**

- A new **sign-in route/screen** in the scaffolded Trustee app
  (`packages/trustee`) at path `/sign-in`, built with Vite + React 19 +
  TanStack Router (file-based routes), reusing `@pipeline/ui` + the theme
  tokens from `@pipeline/ui/styles/theme.css`.
- Layout + components matching the Figma frame `4174-31660`,
  pixel/token-exact, responsive per the frame's breakpoints.
- New UI primitives the sign-in form needs that `@pipeline/ui` does **not**
  yet expose (see Assumptions): at minimum a generic text `Input`/`TextField`
  and its `Label`, and — only if the frame shows them — a password field with
  show/hide toggle and inline validation/error text. These are added to
  `packages/ui` so both apps can reuse them (they are generic form primitives,
  not trustee-specific).
- Route-level test(s) asserting the screen renders and its form controls exist.

**Out of scope (this issue)**

- Auth backend / session wiring, credential verification, token/cookie
  handling, 2FA logic, operator onboarding. Spec #453 lists Authentication /
  2FA / operator onboarding as **out of scope**; issue #787 adds the **UI**
  per direct user direction. **Whether any submit behaviour is in scope at all
  is an Open Question** (see below).
- The wallet/on-chain layer and the shared API client — extraction is deferred
  to #778. The trustee app currently depends on `@pipeline/ui` only. If the
  Figma implies wallet-connect sign-in, that path cannot be wired here.
- Trustee flow logic (Types 1–4).

## Assumptions and Risks

- **Figma MCP unavailable this session.** The `mcp__figma__*` tools
  (`get_screenshot` / `get_metadata` / `get_variable_defs` /
  `get_design_context`) are not connected in this environment, so node
  `4174-31660` could not be inspected. Per the manager's explicit direction we
  do **not** guess the design. This is the primary blocker (Open Question 1).
  Chrome DevTools MCP is present but only renders live web pages — it cannot
  extract exact specs/tokens from a Figma dev-mode frame, so it is not a
  substitute.
- **`@pipeline/ui` has no text-input / form-field / password primitive.**
  Confirmed by reading `packages/ui/src/index.ts` and the component list: the
  kit exposes `Button`, `Card`, `TokenInput` (an amount input, not a
  credential field), `SegmentedTabs`, etc., but no generic `Input`,
  `TextField`, `Label`, or `PasswordField`. A credential sign-in form must
  build these. Risk: building them without the Figma means guessing sizing,
  radius, focus ring, error styling — all token-exact per the design. Blocked
  on Open Question 1.
- **"Sign-in" is semantically ambiguous for this product.** The LP app's
  equivalent surface is **wallet-connect**, not credentials:
  `packages/frontend/src/components/ConnectWalletModal.tsx` is a full-viewport
  two-pane layout (left: "Connect Wallet" heading + EVM/Soroban tabs +
  per-wallet rows; right: hero photo + logo + headline; Figma node
  `2858-57637`). If frame `4174-31660` is a *wallet-connect* screen, it needs
  the wallet layer that #778 defers — a hard dependency conflict. If it is
  *credentials/2FA*, it needs an auth/session contract that #453 puts out of
  scope and that does not exist in the backend today. Either way the
  behavioural contract is undefined → Open Question 2.
- **No auth/session layer exists in the scaffold.** `packages/trustee/src`
  has no wallet, no API client, no session store (`main.tsx` wires only the
  router; deps are `@pipeline/ui`, `@tanstack/react-router`, `react`,
  `react-dom`). Any real submit behaviour would introduce plumbing that the
  scaffold plan (#777) and epic (#775) explicitly deferred to #778. Static UI
  only is the safe default; confirm via Open Question 2.
- **Dependency ordering.** #777 (scaffold) is merged — good. #778 (shared
  wallet/api extraction) is **not** done. If sign-in requires wallet-connect or
  a shared API client, #787 is blocked on #778.
- **Route-tree generation.** `routeTree.gen.ts` is generated by
  `@tanstack/router-plugin` on `dev`/`build`; a new `src/routes/sign-in.tsx`
  regenerates it. It is git-ignored by eslint/prettier already. The coder must
  run `dev`/`build` once so the new route is registered.
- **Shell/topbar interaction.** The current `__root.tsx` renders `TrusteeShell`
  (topbar + flow-type nav) around every route. A sign-in screen is typically
  chromeless (no app nav). Whether sign-in should render *outside* the
  `TrusteeShell` (e.g. a pathless/standalone layout or a conditional in the
  shell) depends on the Figma — deferred to the design (noted in steps).

## Open Questions — resolved

- **Figma frame.** Retrieved out-of-band (node `4174-31660`, saved artifacts).
  It is an "Unauthenticated Overlay" / "Login Prompt" — a centered card over a
  blurred content backdrop, not a form.
- **Scope.** Confirmed (a) static UI only. The card's single action is a
  "Connect Wallet" pill button — this **is** wallet-connect sign-in per the
  design, so real wiring is correctly blocked on #778; the button ships as a
  documented no-op (see TD-34 in `docs/exec-plans/tech-debt-tracker.md`).
- **`@pipeline/ui` form primitives.** Moot — the frame has no text/password
  fields, only a heading, subtext, one button, and a caption. No `Input`/
  `Label`/`PasswordField` were added. The existing `Button` (`primary-dark`
  variant) was reused with a `!`-prefixed className override for the pill
  radius and full width (same override pattern the Button component itself
  uses for its `compact` size, per the Tailwind v4 equal-specificity note in
  `Card.tsx`) — no new Button variant needed.
- One new component was added: `packages/trustee/src/components/LockIcon.tsx`
  (24×24 padlock glyph), kept trustee-local rather than promoted to
  `@pipeline/ui` since only this screen uses it today.

## Implementation Steps — completed 2026-07-08

1. **[DONE] Retrieve the design.** Pulled from the saved out-of-band Figma
   export (`design-context.txt`, `variables.txt`, `metadata.txt`,
   `screenshot.png`) for node `4174-31660`. Layout, spacing, typography, and
   colour tokens recorded and mapped to `@pipeline/ui` theme tokens (see
   `SignInCard.tsx` header comment for the full mapping table). Two values
   have no existing token and are documented one-off arbitrary values scoped
   to this component: the card's 24px corner radius (existing radii are 4/6/16
   px) and the overlay's `rgba(246,248,248,0.8)` tint + blur.

2. **[SKIPPED — moot]** No form primitives needed; the frame has no text
   fields. See "Open Questions — resolved" above.

3. **[DONE] Create the sign-in route** at
   `packages/trustee/src/routes/sign-in.tsx` using `createFileRoute("/sign-in")`.
   Composed from `@pipeline/ui`'s `Button` plus a new page-local
   `SignInCard.tsx` (the "Login Prompt" card) and `LockIcon.tsx` (the badge
   glyph), both under `packages/trustee/src/components/` per FRONTEND.md
   "one component per file".

4. **[DONE, deviated] Shell/topbar relationship.** Per direct instruction
   (issue #787 comment), the "Overview" heading + timestamp header row visible
   behind the overlay in the Figma frame is out of scope (#786's scope) — this
   route does not attempt to reproduce or hide it. `/sign-in` still renders
   inside the existing `TrusteeShell` topbar (logo + flow nav); the route body
   is the overlay-tinted, blurred full-bleed area with the centered card, per
   the plan's "on the paper background is fine" allowance. Revisit when #778
   defines the real gate (likely wants the shell nav hidden while
   unauthenticated).

5. **[DONE] Form behaviour — static UI only (confirmed).** No `useState`
   needed (no fields). The "Connect Wallet" button's `onClick` is a documented
   no-op / `// TODO(#778): wire auth/session`. Logged as TD-34 in
   `docs/exec-plans/tech-debt-tracker.md`.

6. **[SKIPPED — moot]** No hero image/illustration in this frame.

7. **[DONE] Accessibility.** The icon badge is `aria-hidden`; the button is a
   real `<button>` element (keyboard-reachable, uses `Button`'s existing
   focus-visible ring). No form fields to label.

8. **[DONE] Run and verify locally.** `yarn workspace @pipeline/trustee build`
   and `dev` both confirmed `/sign-in` renders and returns HTTP 200
   (route-tree regenerated). Dev server left available for live review per
   project convention.

## Test Strategy

- **Route render test:** add `packages/trustee/src/routes/-sign-in.test.tsx`
  (leading `-` so the router plugin ignores it), mirroring
  `packages/trustee/src/routes/-index.test.tsx`: render the route component via
  `Route.options.component`, assert the heading text and that each form control
  (inputs, labels, submit button) is present and correctly labelled. If a
  password show/hide toggle exists, assert it flips the input `type`.
- **UI primitive tests (if primitives added):** for each new `@pipeline/ui`
  component add a co-located test/story asserting variants, disabled, and error
  states render — matching the kit's existing test conventions.
- **Static-UI submit guard:** if scope is UI-only, assert the submit handler
  performs no navigation/network side effect (e.g. it does not throw and does
  not call a router navigate) so the no-op contract is pinned.
- **Lint/build parity:** `yarn workspace @pipeline/trustee lint`
  (`eslint . && prettier --check .`) and
  `yarn workspace @pipeline/trustee build` (`tsc -b && vite build`) pass. If
  primitives were added to `@pipeline/ui`, run `yarn workspace @pipeline/ui lint`
  too, and confirm the LP `packages/frontend` build still passes (no shared-kit
  regression).
- **Docs lint:** `npx tsx scripts/lint-docs.ts` passes.
- **Figma verification:** side-by-side of the rendered `/sign-in` against frame
  `4174-31660` at the design's breakpoints; note any residual pixel/token
  deltas. (No dedicated QA phase for the frontend flow, but this is the
  acceptance check.)

## Docs to Update

- **Product spec:** likely none. `docs/product-specs/trustee-dashboard.md`
  (#453) explicitly scopes auth out; a **UI-only** sign-in screen adds no
  product behaviour, so no spec edit is required. If Open Question 2 comes back
  as "wired auth", a spec addition **is** required first (do not ship behaviour
  ahead of the spec).
- **`docs/FRONTEND.md` / `docs/frontend/index.md`:** if new generic form
  primitives (`Input`, `Label`, `PasswordField`) are added to `@pipeline/ui`,
  note them in the component inventory.
- **`docs/exec-plans/tech-debt-tracker.md`:** if sign-in ships as static UI
  with a no-op submit, log that the auth/session wiring is deferred (tie it to
  #778 / a future backend auth issue) so the stub is tracked, not forgotten.
- **User stories:** add/append a story under
  `docs/user-stories/epic-775/` for the sign-in screen if the epic's QA pass
  will exercise it, and link it from `docs/user-stories/index.md`.
- Move this plan to `docs/exec-plans/completed/` when the issue closes
  (manager/coder housekeeping).
