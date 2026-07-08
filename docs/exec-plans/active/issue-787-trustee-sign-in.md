# Issue #787: Trustee: implement the sign-in section (Figma 4174-31660)

Source: https://github.com/eq-lab/pipeline/issues/787

Sub-issue of epic #775 (Trustee Admin Panel). Depends on #777 (scaffold — merged).
Product/technical spec: #453, persisted at `docs/product-specs/trustee-dashboard.md`.

> **BLOCKED PENDING HUMAN INPUT.** Two hard blockers must be resolved before a
> coder can execute this plan faithfully — see **Open Questions**:
> 1. The Figma frame (node `4174-31660`) could not be retrieved this session
>    (Figma MCP not connected). We refuse to guess a pixel/token-exact design.
> 2. Behavioural scope of "sign-in" is undefined and likely conflicts with the
>    deferred wallet/session layer (#778). The frame must be inspected to know
>    whether this is credentials, wallet-connect, or 2FA.
>
> The steps below are the **structural skeleton** the coder will flesh out once
> the design is retrievable and the scope question is answered. They are
> intentionally design-agnostic where the Figma is load-bearing.

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

## Open Questions

- **[BLOCKER] Figma frame not retrievable this session.** The Figma MCP is not
  connected, so node `4174-31660` could not be inspected (screenshot / metadata
  / variables / design-context all unavailable). Per manager direction we will
  not guess a pixel/token-exact design. Reconnect the Figma MCP (or have a
  human export the frame's layout + tokens) before the coder starts, so layout,
  spacing, typography tokens, form-field styling, and responsive breakpoints
  come from the design and not invention.
- **[BLOCKER] Static UI only, or real auth/session wiring?** #453 puts
  Authentication / 2FA / operator onboarding out of scope and the scaffold has
  no auth/wallet/session layer (that is #778). Confirm the intended scope:
  (a) **static sign-in UI only** — form layout + components, controlled inputs,
  no real submit/verify/redirect; or (b) **wired sign-in** — which needs a
  backend/session contract. If the frame implies **wallet-connect** sign-in, it
  depends on the wallet layer deferred to #778 (blocked). If it implies
  **credentials + 2FA**, the backend auth/session contract does not exist today
  and #453 excludes it — specify what endpoint/session shape it should target,
  or confirm UI-only. **Default assumption if unanswered: static UI only, no
  submit behaviour, `onSubmit` left as a documented no-op / TODO tied to #778.**
- **`@pipeline/ui` form primitives — add here or wait?** A credential form
  needs generic `Input`/`Label` (and maybe `PasswordField`) that the kit lacks.
  Assumed: add them to `packages/ui` (reusable, token-driven) as part of this
  issue. Confirm that is acceptable rather than deferring the primitives to a
  separate `@pipeline/ui` issue. (Moot if the frame is wallet-connect only.)

## Implementation Steps

> Execute **only after** Open Questions 1 and 2 are resolved. The Figma frame
> drives every visual decision; the scope answer decides whether step 5 exists.

1. **Retrieve the design.** With the Figma MCP reconnected, pull node
   `4174-31660` via `mcp__figma__get_screenshot`, `get_metadata`,
   `get_variable_defs`, and `get_design_context`. Record the frame's layout
   structure, spacing, typography, colour tokens, form-field styles, any hero
   imagery, and responsive breakpoints. Map every Figma variable to an existing
   `@pipeline/ui` theme token (`--color-pipeline-*`, `--font-*`,
   `--text-pipeline-*` from `packages/ui/src/styles/theme.css`); flag any token
   with no equivalent as a follow-up rather than hardcoding a raw value.

2. **Add missing form primitives to `@pipeline/ui`** (only those the frame
   uses): e.g. `packages/ui/src/components/Input/Input.tsx` +
   `index.ts`, a `Label`, and — if shown — a password field with show/hide and
   an error/help-text slot. Mirror the existing component conventions (one
   component per file, token-driven Tailwind classes, a `.stories.tsx`, and a
   type export added to `packages/ui/src/index.ts`). Match the Figma exactly
   (radius, height, padding, focus ring, disabled/error states).

3. **Create the sign-in route** at
   `packages/trustee/src/routes/sign-in.tsx` using `createFileRoute("/sign-in")`.
   Compose the screen from `@pipeline/ui` primitives (`Card`, `Button`, `Logo`,
   the new `Input`/`Label`, hero imagery if any). Keep any page-specific
   composite in its own file under `packages/trustee/src/components/`
   (e.g. `SignInForm.tsx`) per FRONTEND.md "one component per file".

4. **Decide the sign-in layout's relationship to `TrusteeShell`** based on the
   frame: if the design is chromeless (no app topbar/nav), render sign-in
   outside the shell — either give sign-in its own standalone layout (not the
   `__root.tsx` `TrusteeShell` wrapper) or make `TrusteeShell` conditionally
   omit the nav on `/sign-in`. Document the choice in a code comment. Do not
   restructure routing beyond what the design requires.

5. **Wire form behaviour per the scope answer (Open Question 2).**
   - If **static UI only** (default): controlled input state (`useState`),
     client-side field presence/format validation only, and an `onSubmit` that
     is a documented no-op / `// TODO(#778): wire auth/session` — no network
     call, no redirect. Log the deferral in
     `docs/exec-plans/tech-debt-tracker.md`.
   - If **wired**: STOP — this depends on an auth/session contract and/or the
     #778 wallet layer that do not exist. Re-open as blocked on #778 / a new
     backend auth issue rather than inventing a contract.

6. **Assets.** If the frame includes a hero image/illustration, add it under
   `packages/trustee/src/assets/` (mirror the LP app's `?url` import pattern,
   e.g. `import heroUrl from "@/assets/…?url"`). Prefer an existing
   `@pipeline/ui` illustration if the design uses one already in the kit.

7. **Accessibility.** Labelled inputs (`<label htmlFor>` / `aria-label`),
   correct `type`/`autoComplete` on credential fields, visible focus states,
   and a submit button reachable by keyboard — matching the LP app's
   accessibility bar (see `ConnectWalletModal.tsx` focus-trap conventions if
   the sign-in is modal).

8. **Run and verify locally.** `yarn workspace @pipeline/trustee dev` →
   confirm `/sign-in` renders on http://localhost:5174 with theme tokens
   applied and matches the Figma frame at desktop and mobile widths. Start the
   dev server so the user can review live (per project memory: always bring up
   the dev server after frontend changes). Do a side-by-side against the Figma
   screenshot.

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
