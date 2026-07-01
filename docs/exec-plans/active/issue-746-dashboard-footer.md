# Issue #746: Protocol Dashboard: add page footer (logo, nav links, disclaimer, copyright)

Source: https://github.com/eq-lab/pipeline/issues/746

Parent epic: #712 (Protocol Dashboard). Frontend flow (labels: `frontend`, `implementation`).

## Scope

Add a page footer to the Protocol Dashboard route, matching Figma `3283-13463`.

In scope:

- A new **reusable, global** `Footer` component (per human decision on Open Question 2) placed in the general components dir (`packages/frontend/src/components/Footer.tsx`, not a `dashboard/`-scoped path), mounted globally so every route renders it. It sits on the page background (`--color-pipeline-paper`), **outside/below** any route's content container (Figma `3283:12101`).
- Structure (per Figma `3283-13463`):
  - Row 1 ("Footer links container", node `3283:13464`): thin divider lines top **and** bottom (`--color-pipeline-ink` primary ink), `py-16px` (gap-s), `justify-between`.
    - Left: `Pipeline` wordmark via the `@pipeline/ui` `Logo` component, scaled up to the footer size (Figma vector is 232×64; pass `width={232}`).
    - Right: horizontal nav links — **Docs · White Paper · GitHub · X (Twitter) · Telegram**, `gap-24px` (gap-m), Body 16px, primary ink.
  - Row 2 ("Footer Container", node `3283:13472`): `justify-between`, Caption 12px, `--color-pipeline-ink-muted` (secondary `#38373599`). Left: 3-line disclaimer (`max-w-[480px]`); right: `© 2026 Pipeline Trust Company`.
  - Outer container: vertical stack, `gap-48px` (gap-xl) between the two rows, `p-96px` (gap-xxl) desktop padding (reduce on mobile — see responsive note).
- Responsive behavior: stack the logo/links row and the disclaimer/copyright row into single columns below `md`; reduce the `p-96px` outer padding on small screens.
- Token discipline (FRONTEND.md): display serif via `Logo` (currentColor), body/caption type tokens, `--color-pipeline-ink` / `--color-pipeline-ink-muted`; **no raw hex**.

Out of scope:

- Building a new shared `@pipeline/ui` primitive; the footer is an app-level component that lives in `packages/frontend/src/components/`.
- Any change to the existing four dashboard panels or the content container.

## Assumptions and Risks

- **Link component style**: the footer links are inline horizontal anchors (plain text, gap-24, no border/arrow). This is **not** the `LinkCard` primitive (which renders a bordered 40px row with an arrow-up-right icon, used by `QnaSection`). Use plain `<a>` anchors, not `LinkCard`. All external links open in a new tab with `target="_blank" rel="noopener noreferrer"`, matching the QnaSection precedent.
- **Logo scale**: Figma shows the wordmark at 232×64 (2× the `Logo` intrinsic 116×32, same 29:8 aspect ratio), so `Logo` with `width={232}` reproduces it exactly. The `Logo` default color is brand navy; the footer wordmark in Figma is primary ink (`#262524`) — override the color via `className="text-[color:var(--color-pipeline-ink)]"`.
- **Border color**: Figma variable `content-test/primary` = `#262524` = `--color-pipeline-ink`. The row-1 divider uses full-opacity ink on both top and bottom edges (`border-y`).
- **Responsive frame**: the issue references a mobile frame but no distinct mobile footer frame exists in Figma (`3283-72387` resolves to an unrelated `heading` component). The stacking behavior is therefore a reasonable design default, not a pixel-matched frame — see Open Question on responsive layout in the risk note below; the desktop `justify-between` rows must not overflow on narrow viewports.
- **Dependency**: builds on the merged #744 content-container work already on this branch (`fix/744-dashboard-content-container-bg`). No unmerged blockers. Coordinate branch/base with the manager.
- **Risk**: link hrefs are unknown (Open Question 1). If unresolved, links will be stubbed and must not ship as broken/misleading targets — see the Open Questions section for the stubbing default.

## Open Questions

_Resolved by human (issue comment, 2026-07-01):_

1. **Link targets** — RESOLVED: **all five links render with empty hrefs for now.** No real URLs exist yet; ship the labels (`Docs`, `White Paper`, `GitHub`, `X (Twitter)`, `Telegram`) as non-navigating placeholders. Use `href="#"` with `aria-disabled="true"` (or an equivalent non-navigating anchor) so nothing points at a wrong destination, and log a tech-debt entry to wire real URLs later (Step 5). No `target="_blank"` needed while stubbed.
2. **Global vs dashboard-only footer** — RESOLVED: **make it a global, reusable component.** Place it in the general components dir (`packages/frontend/src/components/Footer.tsx`) and mount it globally (in `__root.tsx` / the shared layout) so it appears on every route, below/outside each route's content container. Keep it presentational and route-agnostic so it can be reused later.

Note (resolved, not blocking): **Copyright year** — hard-code `2026` per the Figma copy (`© 2026 Pipeline Trust Company`). Deriving it dynamically would silently drift the legal-entity string away from the reviewed design; keep it a static string and revisit only if legal requests a rolling year.

## Implementation Steps

1. Create `packages/frontend/src/components/Footer.tsx` exporting a single `Footer` component (one-component-per-file rule, FRONTEND.md §Code structure 1). Mark it up as a `<footer>` landmark with `data-node-id="3283:13463"` and a stable `data-testid="site-footer"`.
   - Define a typed `FOOTER_LINKS` const array (`{ label, href, testId }[]`) analogous to `QnaSection`'s `QUESTIONS`. Per Open Question 1: all hrefs are empty placeholders for now (`href="#"` + `aria-disabled="true"`).
   - Row 1 (`data-node-id="3283:13464"`): a flex row, `items-center justify-between`, `border-y border-[color:var(--color-pipeline-ink)]`, `py-4` (16px, gap-s). Left: `<Logo width={232} className="text-[color:var(--color-pipeline-ink)]" />` from `@pipeline/ui`. Right: a nav (`<nav aria-label="Footer">`) flex row `gap-6` (24px, gap-m) of `<a>` anchors; each uses Body type tokens (`text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] font-[family-name:var(--font-body)] text-[color:var(--color-pipeline-ink)]`), is a non-navigating placeholder (`href="#"`, `aria-disabled="true"`), and keeps a focus-visible ring.
   - Row 2 (`data-node-id="3283:13472"`): flex row `items-end justify-between`, Caption type tokens (`text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)]`), `text-[color:var(--color-pipeline-ink-muted)]`. Left: a `<p>` with the three disclaimer lines separated by `<br />`, `max-w-[480px]` (`3283:13473`). Right: a `<p>` `© 2026 Pipeline Trust Company` (`3283:13474`), `text-right whitespace-nowrap`.
   - Outer wrapper: flex column `gap-12` (48px, gap-xl). Padding: `p-24 md:p-24` is 96px only at desktop — apply `p-8 md:p-24` (32px mobile → 96px desktop) so the footer breathes on mobile without overflowing (padding is layout sizing, not a token; document the pixel intent in a comment as done in `dashboard.tsx`).
2. Responsive stacking: on row 1 and row 2 use `flex-col gap-* md:flex-row md:items-center md:justify-between` (and `md:items-end` for row 2) so the logo/links and disclaimer/copyright stack vertically below `md` and sit side-by-side at `md+`. Left-align the stacked links and copyright on mobile.
3. Mount the footer **globally** in `packages/frontend/src/routes/__root.tsx` (or the shared layout that wraps all routes): import `Footer` and render it once, **after** each route's content/`<main>` so it sits at the bottom on `--color-pipeline-paper`, outside/below any white content container. Verify placement on `/dashboard` (below the content container, matching Figma `3283:12101`) and that it does not double-render or overlap on other existing routes (`/`, `/deposit`, `/withdraw`, `/stake`, `/transactions`). Add a short comment tying it to Figma `3283-13463` and issue #746.
4. Token/lint sanity: confirm no raw hex or literal font-family strings; only `var(--...)` token utilities and layout pixel hints (`width`, `max-w`, padding). Follow the class-composition style used by `QnaSection`/`dashboard.tsx`.
5. Links are stubbed (Open Question 1 resolved to empty hrefs): add a tech-debt entry in `docs/exec-plans/tech-debt-tracker.md` noting the placeholder footer hrefs (Docs / White Paper / GitHub / X / Telegram) and that real URLs must be wired later.

## Test Strategy

Co-locate a test with the route (extend the existing dashboard route integration test) and/or a dedicated component test, following the repo's Testing-Library + Vitest pattern (see `packages/frontend/src/routes/-dashboard.test.tsx`).

- **Footer renders**: the footer (`data-testid="site-footer"`) renders on `/dashboard` **after** the `dashboard-content-container` (assert DOM order / that the footer is not a descendant of the content container), and appears globally via the root layout.
- **Landmark + wordmark**: footer is a `<footer>` (or has `role="contentinfo"`); the `Logo` renders with its `aria-label="Pipeline"`.
- **Nav links**: all five labels (`Docs`, `White Paper`, `GitHub`, `X (Twitter)`, `Telegram`) render as anchors; each is a non-navigating placeholder (`href="#"`, `aria-disabled="true"`) per the resolved decision.
- **Disclaimer + copyright**: the three disclaimer lines and `© 2026 Pipeline Trust Company` render.
- **Responsive class assertions**: assert the `md:flex-row` / `flex-col` stacking classes on the two rows (mirrors the existing `DeploymentMonitorPanel` responsive-class test approach).
- Run `yarn workspace @pipeline/frontend test` (or the repo's frontend test command) and `tsc` build; run `npx tsx scripts/lint-docs.ts` after any docs edit (AGENTS.md).
- **Figma verification** (frontend flow): visually verify the rendered `/dashboard` footer against Figma `3283-13463` (divider lines top+bottom on row 1, logo left / links right, disclaimer left / copyright right, muted caption color, on the paper background). The manager runs UX/QA verification per the frontend flow; no separate testing phase.

## Docs to Update

- No product-spec change required — this is presentational UI on an existing route (no new user/agent behavior).
- If a new shared util/hook were extracted, `docs/frontend/utils.md` / `docs/frontend/hooks.md` would need updating — but this component has no shared util/hook, so no catalogue change is expected.
- `docs/exec-plans/tech-debt-tracker.md` — only if links are stubbed (Step 5).
- On completion, this plan moves from `docs/exec-plans/active/` to `docs/exec-plans/completed/` per the protocol (manager-owned).
