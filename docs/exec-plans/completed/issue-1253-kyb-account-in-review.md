# Issue #1253: KYB: Account-in-review screens + banner

Source: https://github.com/eq-lab/pipeline/issues/1253

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Branch: `feat/1253-kyb-account-in-review` (draft PR #1264), cut from `main` after
#1248/#1249/#1250/#1251/#1252 merged (`20c80901`).

Figma (styling source of truth, file `A43rjYYjSwdTmiwwf5cx5n`, section `6486:81556`
"KYB Onboarding" on canvas `209:498` "App"):

- Default (Notify me / Go to app): [`6486-81745`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81745&m=dev)
- Notified (green confirmation / Go to app): [`6486-81764`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81764&m=dev)
- Shell instance: `6486:81757` / `6486:81776` (the same `Sign In` component `8550:10210`
  content pane + `8550:10546` image pane every KYB screen uses — image pane hidden, Close Icon
  `8591:7781` visible)
- 72px circle + shield-check glyph: `I…;6486:81752` / `I…;6486:81771` (glyph `6409:668`)
- Heading block: `I…;6486:81753` / `I…;6486:81772` (`TextCont 6539:2313` → `TitleCont 6539:2314`
  + `SubtitleCont 6539:2316`)
- Button pair: `I…;6486:81754` / `I…;6486:81773`

All Figma facts below were recovered during planning via the local Dev Mode MCP
(`get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot`, plus direct `GET`
of the exported SVG assets and a document-wide `get_metadata` on `0:0`). Every call succeeded;
nothing hung. Re-extraction is not required to implement — re-verification against the live
frames is still a required step (step 12).

## Scope

Build the post-submission **Account in review** screen as a presentational-only modal,
consistent with the #1248–#1252 precedents: no network call, no persistence, seams left as
no-ops for #1254, and no production entry point — reachable from `/test?tab=auth` only.

The two Figma frames are **one screen with two states**, not two screens. Their node trees are
structurally identical; the only delta is the first button:

| | Default `6486-81745` | Notified `6486-81764` |
| --- | --- | --- |
| Button 1 fill | `fill-test/primary` `#262524` | `fill/positive-secondary` `#20800029` |
| Button 1 content | label `Notify me`, `content-test/primary-on-invert` `#ffffff` | 24px check glyph + label `We’ll notify you`, `content-test/positive` `#208000` |
| Everything else | — | byte-identical (same circle, same title, same description, same `Go to app`) |

So the "Notified" variant is the **result of pressing "Notify me"** — a local, presentational
state flip on the same modal, in the same shape as `OtpModal`'s mocked verify.

In scope:

1. New `AccountInReviewModal` in `packages/frontend/src/components/`, composed on the existing
   `AuthModalShell`.
2. Two new optional `AuthModalShell` props — `icon` and `headingAlign` — required by this frame
   and by nothing shipped so far (see decision 2). Both default to today's behaviour, so the
   five existing modals render byte-identical without passing them.
3. One new theme token: `--color-pipeline-positive-strong: #208000` (`content-test/positive`).
4. A sixth `/test?tab=auth` trigger, plus a reword of the now-stale Owners stand-in line.
5. Specs in `docs/frontend/auth-components.md`, a user-stories doc, tech-debt entries, index
   links.

Out of scope:

- **The "review banner" named in the Issue body.** It does not exist in the source-of-truth
  Figma section — see "The banner deliverable" below and Open Question 1. Nothing is built for
  it in this issue.
- Any real "notify me" subscription, polling, or review-status fetch. The notified state lives
  in React state for the lifetime of the open modal; closing/reopening resets it.
- Wiring Owners → Account-in-review as a sequence, and the destination of `Go to app` (both are
  #1254's flow orchestration; decision 8 keeps the `/test` triggers independent, same as
  #1251/#1252).
- The LP header entry point (epic #1247 decision 2026-09-17: separate buttons, future Figma).
- Any change to the production LP dashboard (see "The banner deliverable").
- `@pipeline/ui` promotion — `AccountInReviewModal` is LP-only, following `AuthModalShell`'s
  placement in `packages/frontend`.

## The banner deliverable

The Issue body asks for "the review banner (node 6486:81744)". That node is **not** a review
banner, and no review banner exists. Evidence, gathered node-by-node during planning:

1. `6486:81744` is an `instance` named `banner`, 400×76, parked loose on the canvas at
   `x=8817 y=1686` — inside the **Owners** column (`KYB — Owners` `6486:81710` spans
   `x=8153…9881`), between the two Owners frames. Its screenshot renders
   "Upload ID and proof of address documents for each owner" with the hint glyph — i.e. the
   Owners banner, already shipped as `KybInfoBanner` in #1252. This confirms the heads-up
   comment filed on this Issue from #1252's planning.
2. A second, identical loose copy exists at `x=8817 y=1502` (`6481:80366`) in the superseded
   "Draft 14 Sept" section — same copy, same 400×76 geometry.
3. Neither `6486-81745` nor `6486-81764` contains a banner node. Their whole content column is
   `image (72×72)` → `heading` → two buttons, full stop.
4. A `name="banner"` sweep across the entire **App** canvas returns exactly three hits: the two
   `KybInfoBanner` instances embedded in the Owners frames (`I6486:81730;…;6486:81720` and
   `I6486:81804;…;6486:81792`) and the loose `6486:81744`. There is no fourth banner.
5. An "under review / in review" name sweep across the **whole document** (`get_metadata` on
   `0:0`, all 14 canvases) returns three nodes: the two frames this issue builds, plus
   `6590:86947` " PLUSD = 0, sPLUSD = 0, Account under review" — a 1728×1171 **LP dashboard**
   frame in the superseded "Draft 14 Sept" section on the Drafts canvas. It shows an
   "Account under review / We are reviewing your documents." **card** (with a `View Status`
   button) occupying a dashboard grid cell — not a banner, not in the source-of-truth section,
   and only reachable behind real auth state.

Building (5) would mean editing the production LP dashboard for an auth state that does not
exist yet — squarely against the epic's binding 2026-09-17 decision that no sub-issue touches
production entry points, and squarely inside #1254's blocked scope. Building a review banner
from scratch would mean inventing copy and layout, which this epic has consistently refused to
do. So this plan ships neither, records the finding as TD-69, and raises it as Open Question 1.

## Assumptions and Risks

- **`KybInfoBanner` is not reused by this screen.** It is already reusable (its `tooltip` prop
  is optional and it degrades to an inert `aria-hidden` glyph), but these frames have no banner
  to render. No change to `KybInfoBanner` is needed or made.
- **Two more optional shell props.** `AuthModalShell` already carries six optional props
  (#1250 added five, #1251 added `stepLabel`). This adds two more. The alternative — a bespoke
  shell for this one screen — would fork the focus trap, Escape handling and scroll lock that
  the doc explicitly keeps in one place. Accepted; the additive-and-defaulted pattern is
  unchanged, and the existing five modals must stay byte-identical (regression-guarded by the
  existing `AuthModalShell` and per-modal tests).
- **Heading wrap point.** Figma renders the title on two lines ("Your account" / "is under
  review", `TitleCont` 400×112 = 2 × 56px) from a **single** un-broken text node at 400px in
  Besley 48/56. The browser may break it after "is" instead. Step 12 verifies the rendered
  wrap; step 6 carries the fallback. Same class of risk for the description (Figma 400×44 =
  2 × 22px).
- **The check glyph's exported fill is stale.** `get_design_context` exports the 24px check
  with `fill="#34C759"` (iOS green), but the rendered instance is the same dark green as its
  label — verified by sampling a 10× crop of the `6486-81764` screenshot, where glyph and text
  are indistinguishable in hue. The exported hex is a base-component default the instance
  overrides. Ship the glyph on `currentColor` at `--color-pipeline-positive-strong`; do **not**
  hard-code `#34C759`. Same class of artifact as #1251's leading-tile fill.
- **`content-test/positive` diverges from the repo's `--color-pipeline-positive`.** Figma binds
  `#208000`; the repo's content token is `#1a6600`. Resolved token-exact with a new token
  (decision 4), divergence logged as TD-68 — the same resolution shape as TD-59
  (`--color-pipeline-negative-strong`).
- **BUG-19 is pre-existing and stays.** `yarn workspace @pipeline/ui exec tsc --noEmit` fails on
  `TextField.stories.tsx`. This issue touches neither `TextField` nor `packages/ui` components
  (only `theme.css`), so the failure must be unchanged at gate time — confirm, do not fix.
- **Shell caveats inherited unchanged**: unguarded body-scroll-lock and capture-phase Escape
  collision (documented under `auth-components.md#authmodalshell`). Not triggered here — the
  `/test` triggers stay mutually independent, so no two auth modals are ever stacked.

## Open Questions

1. **The Issue's third deliverable, the "review banner", does not exist in the source-of-truth
   Figma.** Confirm dropping it from #1253 (this plan's default — ship the two states, record
   the finding as TD-69), or point at the intended node. If the intent was the draft-only
   dashboard card `6590:86947` ("Account under review / We are reviewing your documents." +
   `View Status`), that is a production LP-dashboard change gated on auth state and belongs to
   #1254 or a new sub-issue with a promoted, non-draft Figma frame — not to #1253.

## Decisions

1. **One component, two states.** `AccountInReviewModal` holds a single `notified` boolean.
   `Notify me` sets it `true` and fires the `onNotifyMe` seam; the button then renders the
   Notified treatment. Resetting on reopen (`open` flips `false → true`) follows the
   `SignInModal`/`OtpModal`/`OwnersModal` convention.
2. **No `useAccountInReviewModal.ts` hook.** The whole state is one boolean plus one reset
   effect; the sibling hooks exist because they carry validation, timers or file records. Keep
   it inline in the component — do not create a hook file.
3. **Two new shell props**, both additive and defaulted:
   - `icon?: React.ReactNode` — rendered as the **first** child of the content column, above the
     heading block, wrapped in `<div className="mb-2 flex w-full justify-center">`. The `mb-2`
     turns the column's 24px `gap-6` into the frame's 32px, exactly mirroring how
     `CompanyDocsModal`/`OwnersModal` already add `mt-2` to their children wrapper.
   - `headingAlign?: "start" | "center"` (default `"start"`) — `"center"` adds `text-center` to
     the heading wrapper, centering both the `<h2>` and the description `<p>`. Named
     `headingAlign` and **not** `align`: `align` is already taken and means *vertical*
     centering of the column (`my-auto`).
4. **New token `--color-pipeline-positive-strong: #208000`** (`content-test/positive`), added to
   both `:root` blocks of `packages/ui/src/styles/theme.css` alongside the existing positive
   family. Not reusing `--color-pipeline-positive` (`#1a6600` — a visibly different green) and
   not reusing `--color-pipeline-positive-primary` (same value, but a *fill* token): the repo
   already keeps same-value semantic siblings (`--color-pipeline-chart-positive`), and #1248 set
   the precedent for a `-strong` content token when Figma diverges from the legacy one. TD-68
   records the divergence for designer reconciliation.
5. **`Go to app` ships as a real `<Button>` with a no-op seam**, not inert text. It is a
   designed button (48px box, own fill), unlike the inert *text* affordances "Forgot password?"
   (#1248), "Resend" (#1250) and "Back" (#1252). Its destination is cross-screen navigation and
   therefore #1254's job, so `onGoToApp?: () => void` defaults to a no-op; `/test` wires it to a
   stand-in line.
6. **The Notified button stays the same DOM element.** Render one `<Button>` whose `variant`,
   `className` and children are computed from `notified`, rather than two sibling branches —
   React reuses the underlying `<button>` node, so the user's focus survives the state flip.
   When `notified`, it carries `aria-disabled="true"` and no `onClick`; it is **not** `disabled`
   (that would drop focus out of the trapped modal, and would pull in
   `secondary`'s `disabled:opacity-[0.32]`, which the frame does not show).
7. **No new copy is invented.** Every string is verbatim from the frames, U+2019 apostrophes
   included (`We’ll`, `it’s`) — the same rule #1250 applied.
8. **`/test` triggers stay independent.** The Owners stand-in line is reworded to point at the
   new trigger rather than auto-opening this modal, for the same stack-safety reason recorded
   for the OTP → Company Docs and Company Docs → Owners pairs.

## Figma → token mapping

Confirmed via `get_variable_defs` + `get_design_context` on both frames, not estimated:

| Element | Figma | Repo token |
| --- | --- | --- |
| Screen background | `bg/primary` `#f8f7f6` | `--color-pipeline-paper` (shell default) |
| Circle tile fill (72×72) | `fill-test/primary` `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` (exact) |
| Circle tile radius | `radius/radius-full` `240` on a 72px box | `--radius-pipeline-pill` (`9999px`) |
| Shield-check glyph (36×36) | `#323837` @ 0.3 | `--color-pipeline-ink-subtle` (the one-channel-order artifact #1248/#1251/#1252 already resolved this way — no new token) |
| Title | `Heading L` — Besley, 48 / 56, `font/title-font-weight` Regular, `content-test/primary` `#262524`, centered | `--font-display` + `--text-pipeline-heading-l` + `--font-weight-regular` + `--color-pipeline-ink` (all shell defaults; alignment via `headingAlign="center"`) |
| Description | `Body` — Graphik LC 16 / 22 Regular, `content-test/primary` `#262524`, centered | `--font-body` + `--text-pipeline-body` + `--color-pipeline-ink` (shell `description`) |
| Title → description gap | 8 | shell's existing `gap-2` |
| Icon → heading, heading → buttons | 32 each | shell `gap-6` (24) + `mb-2` on the icon slot / + `mt-2` on the children wrapper |
| Column bottom padding | 64 | `pb-16` (same as `CompanyDocsModal`/`OwnersModal`) |
| Button box | min-h 48, min-w 48, `px` `size-12` (12), label pad `size-8`/`space-8` (8), radius `radius/radius-s` 4 | `Button` default size (`h-12 min-w-12 px-3` + inner `px-2`), `--radius-pipeline-button` — no size override needed |
| Button → button gap | `size-8` (8) | `gap-2` |
| `Notify me` fill / label | `fill-test/primary` `#262524` / `content-test/primary-on-invert` `#ffffff` | `Button variant="primary-dark"` (variant defaults — no override) |
| `We’ll notify you` fill | `fill/positive-secondary` `#20800029` | `--color-pipeline-positive-secondary` (exact: `rgb(32 128 0 / 0.16)`) |
| `We’ll notify you` label + check glyph | `content-test/positive` `#208000` | **new** `--color-pipeline-positive-strong` |
| `Go to app` fill / label | `fill-test/primary` `rgba(191,189,187,0.12)` / `content-test/primary` `#262524` | `--color-pipeline-fill-muted` / `--color-pipeline-ink` (`Button variant="secondary"` + `!bg-…` override, the #1248 `ContinueWithWalletButton` technique) |
| Label typography (all three) | `Body Emphasized` — Graphik LC Medium 16 / 22 | `Button` base classes (`--font-weight-emphasized`) — no override |
| Close × | `8591:7781`, 24×24 at `top 16 / right 16` | shell close button (default `showCloseButton`) |

## Icon SVG paths (verbatim from the Figma exports — do not hand-author)

`ShieldCheckIcon` — 36×36, `viewBox="0 0 36 36"`, single path with
`fillRule="evenodd" clipRule="evenodd"` and `fill="currentColor"`:

```
M17.5708 3.2343C17.8554 3.19318 18.1446 3.19318 18.4292 3.2343C18.75 3.28066 19.0624 3.39887 19.686 3.63273L26.8857 6.33244C28.0084 6.75342 28.5697 6.96395 28.9834 7.32854C29.3489 7.65065 29.6304 8.05681 29.8037 8.51213C29.9998 9.02757 30 9.62732 30 10.8266V13.5878C30 17.8993 29.9993 20.055 29.3979 22.0019C28.8476 23.7834 27.9348 25.4322 26.7158 26.8432C25.3836 28.3851 23.5548 29.5282 19.8984 31.8134C19.2155 32.2402 18.8741 32.4537 18.5083 32.5385C18.1739 32.6161 17.8261 32.6161 17.4917 32.5385C17.1259 32.4537 16.7845 32.2402 16.1016 31.8134C12.4452 29.5282 10.6164 28.3851 9.28418 26.8432C8.06522 25.4322 7.15242 23.7834 6.60205 22.0019C6.00067 20.055 6 17.8993 6 13.5878V10.8266C6 9.62732 6.00015 9.02757 6.19629 8.51213C6.36955 8.05681 6.65111 7.65065 7.0166 7.32854C7.4303 6.96395 7.99165 6.75342 9.11426 6.33244L16.314 3.63273C16.9376 3.39887 17.25 3.28066 17.5708 3.2343ZM24.7954 13.4545C24.3561 13.0152 23.6439 13.0152 23.2046 13.4545L15.75 20.9091L12.7954 17.9545C12.3561 17.5152 11.6439 17.5152 11.2046 17.9545C10.7653 18.3938 10.7653 19.106 11.2046 19.5453L14.9546 23.2953C15.3939 23.7347 16.1061 23.7347 16.5454 23.2953L24.7954 15.0453C25.2347 14.606 25.2347 13.8938 24.7954 13.4545Z
```

`CheckIcon` — 24×24, `viewBox="0 0 24 24"`, single path with
`fillRule="evenodd" clipRule="evenodd"` and `fill="currentColor"`:

```
M20.5303 5.96967C20.8232 6.26256 20.8232 6.73744 20.5303 7.03033L9.53033 18.0303C9.23744 18.3232 8.76256 18.3232 8.46967 18.0303L3.46967 13.0303C3.17678 12.7374 3.17678 12.2626 3.46967 11.9697C3.76256 11.6768 4.23744 11.6768 4.53033 11.9697L9 16.4393L19.4697 5.96967C19.7626 5.67678 20.2374 5.67678 20.5303 5.96967Z
```

Both are new glyphs in this repo. `fillRule`/`clipRule` are load-bearing on the shield (the
check is knocked out of the shield body). The 24px check is a different export from every
existing repo check glyph — do not substitute one.

## Copy (verbatim — do not paraphrase)

- Title: `Your account is under review`
- Description: `It can take up to 2 weeks. We can notify you when it’s ready.` (U+2019)
- Button 1, default: `Notify me`
- Button 1, notified: `We’ll notify you` (U+2019)
- Button 2: `Go to app`

## Implementation Steps

> **Status (2026-09-18): steps 1–11 and 13 implemented and verified — [DONE]. Step 12
> (live Figma re-verification) not run in the coder phase — see the deviation note below
> step 12.** Gates green (frontend tsc, ui tsc unchanged-BUG-19-only, eslint+prettier for
> both packages, full frontend vitest suite except 7 pre-existing unrelated timezone-dependent
> failures confirmed present on the base branch, frontend build, `cargo clippy --all -D
> warnings`, `cargo test --all`, `lint-docs.ts` 0 errors).

1. **Token — [DONE].** Add to both `:root` blocks of `packages/ui/src/styles/theme.css`, next to the
   existing positive family:
   `--color-pipeline-positive-strong: #208000;` with the comment
   `/* content-test/positive — KYB account-in-review notified label/glyph; Figma node 6486:81764 (issue #1253; diverges from --color-pipeline-positive, tech debt TD-68) */`.
   No other token is added — `--color-pipeline-fill-muted`, `--color-pipeline-positive-secondary`,
   `--color-pipeline-ink-subtle`, `--radius-pipeline-pill` and `--radius-pipeline-button` all
   already match their Figma bindings exactly.

2. **Shell — `icon` prop — [DONE].** In `packages/frontend/src/components/AuthModalShell.tsx`, add
   `icon?: React.ReactNode` to `AuthModalShellProps` and render, as the first child of the
   `max-w-[400px]` content column (before the heading wrapper):
   `{icon ? <div className="mb-2 flex w-full justify-center">{icon}</div> : null}`.

3. **Shell — `headingAlign` prop — [DONE].** Add `headingAlign?: "start" | "center"` (default `"start"`)
   and append `text-center` to the existing `flex flex-col gap-2` heading wrapper when it is
   `"center"`. Do not touch the `<h2>`/`<p>` class lists themselves, and do not change the
   column's `gap-6` — the five existing modals must render byte-identical.

4. **New component — [DONE].** `packages/frontend/src/components/AccountInReviewModal.tsx`, with the
   mandated single 2–3-line spec-pointer header
   (`// spec: docs/frontend/auth-components.md#accountinreviewmodal (Figma nodes 6486:81745 / 6486:81764 — default / notified states)`)
   and **no other comments**. Contents:
   - `ShieldCheckIcon` (36×36) and `CheckIcon` (24×24) local function components, `aria-hidden`,
     `fill="currentColor"`, paths verbatim from the section above.
   - `AccountInReviewModalProps`: `open: boolean`, `onDismiss: () => void`,
     `onNotifyMe?: () => void`, `onGoToApp?: () => void`.
   - `const [notified, setNotified] = useState(false)` plus a `useEffect` resetting it to
     `false` whenever `open` flips `false → true` (mirror `useOwnersModal`'s reset shape).

5. **Shell composition — [DONE].** Render:
   ```tsx
   <AuthModalShell
     open={open}
     onDismiss={onDismiss}
     heading="Your account is under review"
     headingId="account-in-review-modal-heading"
     testId="account-in-review-modal"
     description="It can take up to 2 weeks. We can notify you when it’s ready."
     showImagePanel={false}
     align="center"
     headingAlign="center"
     icon={/* 72px circle tile */}
   >
   ```
   No `stepLabel`, no `onBack`, default `showCloseButton` (the frames show the × and no step
   badge / back arrow). The icon tile is
   `<span className="flex size-18 items-center justify-center rounded-[var(--radius-pipeline-pill)] bg-[color:var(--color-pipeline-fill-muted)] text-[color:var(--color-pipeline-ink-subtle)]">`
   wrapping `<ShieldCheckIcon />` — use an explicit `h-[72px] w-[72px]` if the project's Tailwind
   build has no `size-18` scale step.

6. **Children — the button pair — [DONE].** A single wrapper
   `<div className="mt-2 flex w-full flex-col gap-2 pb-16" aria-live="polite">` containing:
   - The notify `<Button>` — one element, computed props:
     `variant={notified ? "secondary" : "primary-dark"}`;
     `className` always `"!w-full !min-w-0"`, plus, when `notified`,
     `!bg-[color:var(--color-pipeline-positive-secondary)]` and
     `!text-[color:var(--color-pipeline-positive-strong)]` (and no hover recolor — the frame
     designs none for the confirmed state);
     `aria-disabled={notified || undefined}`;
     `onClick={notified ? undefined : handleNotify}` where `handleNotify` sets `notified` and
     calls `onNotifyMe?.()`.
     Children: when `notified`,
     `<span className="flex items-center gap-2"><CheckIcon />We’ll notify you</span>`
     (the 24px glyph sits left of the label, `size-8` gap per the frame); otherwise the plain
     string `Notify me`.
   - The `Go to app` `<Button variant="secondary" onClick={() => onGoToApp?.()}>` with
     `className="!w-full !min-w-0 !bg-[color:var(--color-pipeline-fill-muted)] hover:!bg-[color-mix(in_oklab,var(--color-pipeline-fill-muted)_92%,black)]"`
     — the `!bg-…` override technique from `ContinueWithWalletButton` (#1248), since `secondary`
     ships `bg-transparent`.
   - The `aria-live="polite"` on the wrapper is what announces the label change to a screen
     reader after the flip (the button element itself is reused, so focus stays put).

7. **Heading wrap — [DONE, default path taken].** Shipped the title as the single verbatim
   string with no hard break (`AuthModalShell`'s `heading` prop stays `string`, not widened).
   Step 12's live-browser wrap-point verification was not run in this coder phase (see the
   deviation note below step 12) — the natural-wrap default is the plan's own first choice, so
   no fallback was applied. If a future QA/visual pass finds the browser breaking the title or
   description anywhere other than after "Your account" / after "It can take up to 2 weeks.",
   apply the `React.ReactNode` widening + explicit `<br />` described here.

8. **`/test` seam — [DONE].** In `packages/frontend/src/routes/test.tsx` → `AuthTab`:
   - Import `AccountInReviewModal`; add `accountInReviewOpen` and `wentToApp` state.
   - Add a sixth trigger button `Open Account-in-review screen` after `Open Owners step`.
   - Reword the existing `auth-owners-submitted` line to
     `Owners submitted — open the Account-in-review screen from the button above.`
   - Add a `wentToApp` stand-in line with `data-testid="auth-account-in-review-go-to-app"`:
     `Go to app — #1254 wires this to the LP dashboard.`
   - Render `<AccountInReviewModal open={accountInReviewOpen} onDismiss={…} onGoToApp={() => { setWentToApp(true); setAccountInReviewOpen(false); }} />`.
     Leave `onNotifyMe` at its no-op default — the visible confirmation is the button's own
     state change.
   - Update the intro `<p>` to list "Account-in-review (issue #1253)".
   - Do not touch `TopBar`, `ConnectModalProvider`, or any production `openConnectModal` call
     site.

9. **Tests — [DONE]** — see Test Strategy.

10. **Spec doc — [DONE]** `docs/frontend/auth-components.md`:
    - Header paragraph: drop "#1253 Account-in-review" from the list of screens still to come.
    - `### AuthModalShell`: add `icon` and `headingAlign` rows to the optional-props table,
      noting that `icon` bakes in `mb-2` (24 + 8 = the frames' 32px) and that `headingAlign` is
      *horizontal* text alignment, orthogonal to `align`'s vertical `my-auto`.
    - New `### AccountInReviewModal` section after `### OwnersModal`: node ids, composition,
      the two-state table, the copy block, the Figma → token table, the icon-sourcing note
      (including the stale `#34C759` export), the `aria-disabled` / focus-retention rationale,
      Out of scope, Accessibility. State plainly that the epic's "review banner" has no node in
      the KYB Onboarding section and that `KybInfoBanner` is **not** used here.
    - `### Diagnostics preview seam`: five triggers → six, and the reworded stand-in lines.

11. **Tracking docs — [DONE].**
    - `docs/exec-plans/tech-debt-tracker.md`:
      - **TD-68** — `content-test/positive` (`#208000`) diverges from `--color-pipeline-positive`
        (`#1a6600`); shipped as a new `--color-pipeline-positive-strong`, awaiting designer
        reconciliation (same shape as TD-59).
      - **TD-69** — the epic's "review banner" deliverable has no node in the source-of-truth
        Figma section; `6486:81744` is a loose duplicate of the Owners banner, and the only
        account-under-review affordance in the file is the superseded draft dashboard card
        `6590:86947` in "Draft 14 Sept". Deferred pending a promoted design.
      - **TD-70** — the `Notify me` → notified flip is a local, non-persistent presentational
        mock with no endpoint and no reviewed-state source; #1254 replaces it (same shape as
        TD-60).
    - `docs/user-stories/epic-1247/1253-kyb-account-in-review.md` (see Test Strategy), plus its
      row in `docs/user-stories/index.md` under "Epic #1247 — KYB login flow".
    - No `docs/product-specs/` change: this is presentational frontend work with no
      product-behavior change, and the epic's product intent already lives on #1247.
    - No `docs/exec-plans/known-bugs.md` change expected — but confirm BUG-19 still reproduces
      unchanged and file anything new found rather than fixing it inline.

12. **Figma re-verification** (required, Figma link present on the Issue) — **[NOT RUN in the
    coder phase]**. Deviation: the local Dev Mode MCP (`127.0.0.1:3845`) failed to connect this
    session (`ConnectionRefused`), and the coder skill's own contract states the actual
    pixel-level Figma comparison happens in the `ux-tester` phase, not implementation — the
    frontend flow (per `AGENTS.md`) has no per-issue QA step; visual verification for this screen
    will happen at epic #1247's final QA pass via
    `docs/user-stories/epic-1247/1253-kyb-account-in-review.md`. The originally planned checklist
    (kept here for that pass): circle 72px, fully round, muted fill, 36px shield-check centered;
    32px icon → title, 8px title → description, 32px description → buttons, 8px button → button,
    64px below the buttons; title on two lines breaking after "Your account", description on two
    lines, both centered; both buttons full-width at 48px with 4px radius; `Notify me` dark/white
    label; after clicking, pale-green fill with the dark-green check + label, `Go to app`
    unchanged in both states; × top-right, no image pane, no step badge, no back arrow, content
    vertically centered.

13. **Gate — [DONE].** `yarn workspace @pipeline/frontend exec tsc --noEmit` (clean);
    `yarn workspace @pipeline/ui exec tsc --noEmit` (fails **only** on BUG-19's
    `TextField.stories.tsx`, confirmed unchanged — no new errors); `eslint` + `prettier` for `ui`
    and `frontend` (both clean); the full frontend vitest suite (1745 tests: 1738 passed, 7 failed
    — all 7 confirmed pre-existing and unrelated: timezone-dependent date-formatting assertions in
    `PortfolioPlaceholderCard.test.tsx`/`useDeploymentMonitorPanel.test.tsx`, reproduced identically
    with this issue's changes stashed out); the frontend build (succeeds, pre-existing chunk-size
    warning only); `npx tsx scripts/lint-docs.ts` (0 errors, 39 pre-existing warnings). No Rust
    file changed by this issue, but `cargo clippy --all -- -D warnings` and `cargo test --all`
    were run anyway per `/test-fast` and both pass clean.

## Test Strategy

New `packages/frontend/src/components/AccountInReviewModal.test.tsx`, following
`OwnersModal.test.tsx`'s shape (a local `renderModal` helper with `vi.fn()` defaults, one
`describe` per behaviour, no test comments):

1. **Default state** — heading `Your account is under review` resolves via
   `getByRole("heading")`; the description text renders; both buttons render with names
   `Notify me` and `Go to app`; neither is `disabled`.
2. **Shell composition** — no image panel, close button present, **no** back button, **no** step
   badge; the content column carries `my-auto` (`align="center"`) and the heading wrapper
   carries `text-center` (`headingAlign="center"`).
3. **Icon slot** — exactly one 36×36 shield glyph renders above the heading, and it is
   `aria-hidden` (no accessible name leaks into the dialog).
4. **Notify flip** — clicking `Notify me` swaps the accessible name to `We’ll notify you`, sets
   `aria-disabled="true"`, renders the check glyph, and calls `onNotifyMe` exactly once.
5. **Focus survives the flip** — focus the notify button, click it, assert
   `document.activeElement` is still that same button element (the regression guard for
   decision 6 — a two-branch render would fail this).
6. **Notified button is inert** — clicking it again does not call `onNotifyMe` a second time and
   does not change the rendered state.
7. **`Go to app`** — calls `onGoToApp` once; is unaffected by `notified` (assert it still calls
   after the flip).
8. **Reopen resets** — flip to notified, rerender with `open={false}`, then `open={true}`; the
   button is back to `Notify me`.
9. **Dismiss** — the × button and Escape each call `onDismiss` once.
10. **Copy is verbatim** — assert the two U+2019 strings (`We’ll notify you`,
    `…when it’s ready.`) by exact text match, so a straight-quote regression fails.

Extend `packages/frontend/src/components/AuthModalShell.test.tsx` with a new
`describe("AuthModalShell — new optional props (#1253)")`:

11. Omitting `icon` renders no icon wrapper; omitting `headingAlign` leaves the heading wrapper
    without `text-center` (the defaults-unchanged guard).
12. `icon` renders the node above the `<h2>` in DOM order, inside a `mb-2` wrapper.
13. `headingAlign="center"` adds `text-center` to the heading wrapper and nothing else.

Regression guards (no new tests needed, must stay green): `SignInModal.test.tsx`,
`CreateAccountModal.test.tsx`, `OtpModal.test.tsx`, `CompanyDocsModal.test.tsx`,
`OwnersModal.test.tsx` — they assert the five existing modals' shell composition and would fail
if steps 2–3 changed any default.

Edge cases explicitly covered above: double-click on the notified button (6), reopen after
notifying (8), focus loss on state swap (5), straight-vs-curly apostrophes (10), and the
"defaults unchanged" contract for both new shell props (11).

**User stories** — `docs/user-stories/epic-1247/1253-kyb-account-in-review.md`, same format as
`1252-kyb-owners.md`: epic/issue/spec links; a preamble stating this is a presentational modal
reachable only from `/test?tab=auth`, that the notified state is local and non-persistent, and
that styling-only checks are the QA agent's Figma comparison; a "tech debt to be aware of" list
(TD-68 token divergence, TD-69 missing review banner, TD-70 non-persistent notify, plus TD-61
carried over for the shell's align opt-in); then stories covering:
opening the default state · the Notify me flip · the notified button being inert on a second
click · Go to app reaching the stand-in line · closing via × and via Escape · reopening after
notifying resets the button. Add the index row in `docs/user-stories/index.md`.

## Docs to Update

- `docs/frontend/auth-components.md` — header paragraph, `AuthModalShell` optional-props table
  (`icon`, `headingAlign`), new `### AccountInReviewModal` section, `### Diagnostics preview
  seam` (six triggers + reworded stand-ins).
- `docs/user-stories/epic-1247/1253-kyb-account-in-review.md` (new) and its row in
  `docs/user-stories/index.md`.
- `docs/exec-plans/tech-debt-tracker.md` — TD-68, TD-69, TD-70.
- `packages/ui/src/styles/theme.css` — `--color-pipeline-positive-strong` (both `:root` blocks),
  with the Figma-node comment.
- No `docs/product-specs/` change (presentational-only; product intent lives on epic #1247).
- No `docs/QUALITY_SCORE.md` change (owned by the QA flow, #1255).
