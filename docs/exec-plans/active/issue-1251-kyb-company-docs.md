# Issue #1251: KYB: Company Docs upload step

Source: https://github.com/eq-lab/pipeline/issues/1251

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Branch: `feat/1251-kyb-company-docs` (draft PR #1262), cut from `main` after #1248/#1249/#1250 merged.

Figma (styling source of truth, file `A43rjYYjSwdTmiwwf5cx5n`):

- Empty: [`6486-81679`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81679&m=dev)
- Uploaded: [`6486-81817`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81817&m=dev)
- Step-badge chrome: `6486:81697` (empty) / `6486:81835` (uploaded)

All Figma facts below were recovered via the local Dev Mode MCP (`get_metadata`,
`get_variable_defs`, `get_design_context`, `get_screenshot` — all four succeeded first try on a
fresh session) during planning. Re-extraction is not required to implement; re-verification
against the live frames is still a required step (step 9).

## Scope

Build the KYB Company Docs step as a **presentational-only** screen, consistent with the
#1248/#1249/#1250 precedents: no network call, no persistence, seams left as no-ops for #1254,
and no production entry point — reachable from `/test?tab=auth` only.

In scope:

1. `AuthModalShell` gains one optional, default-identical prop: `stepLabel` (the "Step 1/2"
   badge). #1252 (Owners, "Step 2/2", node `6486:81710`) reuses it verbatim — verified.
2. New `CompanyDocsModal` + `useCompanyDocsModal` + `DocumentUploadRow` in `packages/frontend`.
3. One new theme token (`--color-pipeline-brand-secondary`) for the leading-tile fill.
4. A fourth `/test?tab=auth` trigger, and a reword of the now-stale OTP stand-in line.
5. Specs in `docs/frontend/auth-components.md`, user stories, tech debt, index links.

Out of scope:

- Any real upload, storage, progress, or retry. Files live in React state as `File` objects for
  the lifetime of the open modal; closing/reopening discards them.
- Wiring OTP → Company Docs → Owners as a sequence (that is #1254's flow orchestration; see
  "Decision 9" for why the `/test` seam deliberately does not chain them).
- The LP header entry point (epic #1247 decision 2026-09-17: separate buttons, future Figma).
- `@pipeline/ui` promotion of the row component — the Owners frame uses a different `uploader`
  component, so there is no second consumer (confirmed via `6486:81710` metadata).

## Assumptions and Risks

- **This screen is the same `AuthModalShell` modal, not a new full-page layout.** Both frames
  wrap an instance of the same `Sign In` component (`8550:10210` content pane / `8550:10546`
  image pane) with the Image slot `hidden="true"` and the Close Icon instance visible. The
  "header/Navigation/Buttons" chrome (`6486:81697`) is a sibling overlay whose `Navigation` and
  `Buttons` frames are **empty** and whose `project-logo` and `button-icon` instances are
  `hidden="true"` — the only rendered content in it is the "Step 1/2" label. So the chrome is a
  step badge, not a navigation bar: no logo, no nav links, no header buttons, no back arrow.
- The #1250 planner's note holds: these frames hide the image pane and show a subtitle. Verified
  against the shell's shipped props — `showImagePanel={false}` + `description` + `align="center"`
  cover it with no shell changes beyond `stepLabel`.
- **Figma codegen is stale for the leading tile.** `get_design_context` emits
  `bg-[var(--fill-test/primary,#262524)]` with a `#8FB3A4`-filled glyph for the empty-state tile,
  but the rendered frame shows a navy-tinted tile with a navy glyph. Pixel-sampled from the Figma
  screenshot: tile `#e4e3ed`, which is exactly `rgb(0 0 128 / 0.08)` composited over
  `--color-pipeline-paper` (`#f8f7f6`) — R 248·0.92 = 228 (`e4`), G 247·0.92 = 227 (`e3`),
  B 246·0.92 + 128·0.08 = 237 (`ed`). Trust the render, not the codegen. Risk: no Figma variable
  binding was recovered for this fill, so the new token is sampled rather than name-bound — call
  it out in the spec and let the QA Figma pass confirm.
- **Figma's uploaded state shows a rendered PDF page thumbnail** (a mock PNG asset). We cannot
  render a PDF page without a PDF renderer; decision 5 below chooses the honest subset.
- The uploaded frame's third row title is literally `certificate_of_good_standing.pdf · `
  (trailing middle-dot + space) — a broken text layer in the design file, same class of artifact
  as #1248's lone `C` submit label. Do not reproduce it; file names come from the picked `File`.
- Disabled-state opacity is confirmed twice: the codegen emits `opacity-32` on the empty frame's
  Continue button, and the sampled disabled fill `#b5b4b3` is exactly `#262524` at 32% over
  paper. No separate disabled color token is needed.
- `URL.createObjectURL` is not implemented by jsdom. Step 6 adds a guarded stub to
  `packages/frontend/src/test-setup.ts` (mirroring the existing `localStorage` stub pattern) and
  the component guards on `typeof URL.createObjectURL === "function"` so SSR/jsdom never throws.
- The shell's body-scroll-lock and capture-phase Escape are **not stack-safe** (documented caveat
  in `auth-components.md#authmodalshell`). Decision 9 keeps the `/test` triggers mutually
  exclusive so this is never exercised.
- Pre-existing and unrelated: **BUG-19** (`packages/ui` `tsc --noEmit` fails on
  `TextField.stories.tsx`). Do not fix it here; do not let it mask a real regression.

## Open Questions

_None._

Two decisions were settled in-plan rather than escalated, because both follow directly from an
existing human resolution on this epic and neither is a product question:

- Rejected-file feedback has no Figma frame. Decision 6 reuses the row's **existing caption copy**
  recolored to the negative token — zero invented copy, no new layout. Logged as TD-62 so a
  designer can specify a real treatment.
- The uploaded-row thumbnail cannot be a PDF page preview. Decision 5 ships image previews for
  jpg/png and keeps the glyph tile for pdf — both treatments already exist in the design file.
  Logged as TD-63.

## Decisions

1. **Upload affordance: per-row file picker, no drag-and-drop.** Neither frame contains a
   drop zone, a dashed target, or any "drag files here" copy. Each of the five rows carries its
   own `Upload` button; the button triggers a visually hidden, single-file
   `<input type="file" accept="application/pdf,image/jpeg,image/png">`. No `multiple`.
2. **Five fixed slots, labels verbatim** (from `get_design_context`, in frame order):
   `Certificate of Incorporation`, `Registry of Legal Entities`, `Certificate of Good Standing`,
   `Legal Address`, `Shareholder Register`. Empty-row caption, verbatim and identical on all five:
   `pdf, jpg, png files up to 10MB`. Uploaded-row caption: `Uploaded`.
3. **Step header semantics: a label, not navigation.** Renders `Step 1` in ink + `/2` in
   ink-muted, top-left. No progress bar, no back arrow, no logo (all hidden in the frame). It is
   a new optional `AuthModalShell` prop because #1252 needs the identical badge at `Step 2/2`.
   `stepLabel` and `onBack` both occupy `top-4 left-4` and are mutually exclusive — no Figma frame
   in this epic shows both; document that, do not try to lay them out together.
4. **Uploaded state** replaces, per row: the glyph tile → a 40×40 preview (decision 5); the
   document label → the picked file's `name`; the caption → `Uploaded`; the `Upload` button → a
   32×32 remove button carrying the 22px `cross-circle` glyph.
5. **Uploaded leading visual**: for `image/jpeg` / `image/png`, render an
   `object-cover` 40×40 `rounded-[var(--radius-pipeline-card)]` `<img>` from
   `URL.createObjectURL(file)`, revoked on replace/remove/unmount. For `application/pdf` (and when
   `URL.createObjectURL` is unavailable), keep the brand-tint glyph tile. Divergence from Figma's
   mock PDF-page thumbnail → **TD-63**.
6. **File validation is enforced, and its rejection reuses existing copy.** Reject when the MIME
   type is outside `{application/pdf, image/jpeg, image/png}` (falling back to the filename
   extension when `file.type` is empty) or when `file.size > 10 * 1024 * 1024`. On rejection the
   slot stays empty and its caption — the same string, `pdf, jpg, png files up to 10MB` — renders
   in `--color-pipeline-negative-strong` with `role="alert"`. It reverts to `ink-muted` on the
   next accepted file for that slot, or when the modal reopens. No invented copy, no new layout,
   no new token. Undesigned state → **TD-62**.
7. **Continue is enabled only when all five slots hold a file**, matching both frames (empty →
   disabled, all-five → enabled; no partial frame exists, and "required documents" is the framing).
   Removing any file re-disables it.
8. **Continue is a no-op seam**: `onSubmit?.(documents)` where `documents` is
   `Record<CompanyDocumentSlotId, File>`. Default no-op, exactly like `SignInModal.onSubmit` and
   `OtpModal.onSubmit`. #1254 owns the real call.
9. **`/test` wiring: a fourth independent trigger, not a chain from OTP's `onVerified`.** Simpler
   (one button, one state flag, no cross-modal coupling) and it avoids the documented
   stack-unsafety of the shell's scroll-lock/Escape handling during the OTP-close →
   Docs-open transition. The existing `auth-otp-verified` stand-in line stays — its copy is
   reworded, since "the #1251 Company Docs step opens here once it exists" becomes false the
   moment this ships.

## Figma → code mapping (confirmed, not estimated)

Layout, 400px column (all values from `get_design_context` + node geometry):

| Element | Value |
| --- | --- |
| Container | `flex flex-col gap-[32px]`, `pb-[64px]`, `w-[400px]`, vertically centered |
| Heading → description gap | 8px (shell's existing `gap-2`) |
| Heading block → rows block | 32px (shell column is `gap-6`; add `mt-2` to the children wrapper, same trick as `OtpModal`) |
| Rows block | `flex flex-col gap-[24px]` |
| Row | `h-[40px]`, `flex items-center gap-[12px]` |
| Rows block → Continue | 32px |
| Continue | `w-full`, `h-[48px]`, radius 4 |

Tokens:

| Element | Figma | Repo token |
| --- | --- | --- |
| Title "Finish account setup" | Heading L 48/56 Besley, `content-test/primary` | shell `<h2>` (unchanged) |
| Description | Body 16/22, `content-test/primary` | shell `description` prop (unchanged) |
| Row title | Body 16/22, `content-test/primary`, `truncate` | `--color-pipeline-ink` |
| Row caption | Caption 12/16, `content-test/secondary` | `--color-pipeline-ink-muted` |
| Leading tile fill | sampled `rgb(0 0 128 / 0.08)` (codegen stale) | **new** `--color-pipeline-brand-secondary` |
| Leading glyph | `content-test/brand` `#000080` | `--color-pipeline-brand` |
| Leading tile radius | `radius/radius-s` 4px | `--radius-pipeline-card` |
| `Upload` button | 32px min box, `px-[6px]`, inner label `px-[4px]`, 1px `border-test/secondary` `rgba(56,55,53,0.18)`, radius 4, Body Emphasized ink | `Button variant="secondary" size="compact"` + `border border-[color:var(--color-pipeline-line)]` — `--color-pipeline-line` is already `rgb(56 55 53 / 0.18)`, and `compact` is already `!h-8 !min-w-8 !px-1.5` with an inner `px-1` span. Exact match, no overrides needed. |
| Remove glyph | 22px `cross-circle`, `#323837` @ 0.6 | `--color-pipeline-ink-muted` (`rgb(56 55 53 / 0.6)`) — same one-channel-order artifact #1248 already resolved this way for `border-test/primary`; **no new token** |
| Continue fill | `fill-test/primary` `#262524` | `Button variant="primary-dark"` (`--color-pipeline-cta`) — **not** `primary-blue`; the sign-in submit is navy, this one is not (both re-sampled: `#0000b4` vs `#262524`) |
| Continue label | `content-test/primary-on-invert` | `--color-pipeline-on-dark` (variant default) |
| Continue disabled | `opacity-32` | `disabled:opacity-[0.32]`, same as `SignInModal` |
| Step badge | Body Emphasized 16/22; `Step 1` `content-test/primary`, `/2` `rgba(56,55,53,0.6)` | `--color-pipeline-ink` / `--color-pipeline-ink-muted` |

Step-badge geometry: header is `p-[16px]`; the `Step` frame is `h-[40px]` with `px-[8px]` and its
inner `Label` adds another `px-[8px]`, so the glyph run starts 32px from the viewport edge and is
centred in a 40px band starting at y=16. Implement as one flat element —
`absolute top-4 left-4 flex h-10 items-center px-4` — identical geometry, simpler DOM.

**Icon paths (Figma-exported, verbatim — the Dev Mode asset server is ephemeral, so these are
recorded here rather than re-fetched).** Both ship with `fill="currentColor"`; the exported fills
(`#8FB3A4` on the file glyph, `#323837` on the cross) are file artifacts, not the rendered colors.

`file-upload`, 20×20, `viewBox="0 0 20 20"`:

```
M9.97005 1.66667C10.5226 1.66667 11.053 1.88632 11.4437 2.27702L16.056 6.88932C16.4467 7.28002 16.6663 7.81042 16.6663 8.36296V16.2497C16.6663 17.4003 15.7339 18.3337 14.5833 18.3337H5.41634C4.2659 18.3335 3.33333 17.4002 3.33333 16.2497V3.74967C3.33351 2.59934 4.26601 1.66684 5.41634 1.66667H9.97005ZM5.41634 2.91667C4.95636 2.91684 4.58351 3.2897 4.58333 3.74967V16.2497C4.58333 16.7098 4.95625 17.0835 5.41634 17.0837H14.5833C15.0436 17.0837 15.4163 16.7099 15.4163 16.2497V8.95866H10.8333C10.0279 8.95866 9.37533 8.30509 9.37533 7.49967V2.91667H5.41634ZM9.55794 10.3913C9.80197 10.1473 10.1976 10.1474 10.4417 10.3913L12.1087 12.0583C12.3526 12.3024 12.3527 12.698 12.1087 12.9421C11.8647 13.1861 11.469 13.186 11.2249 12.9421L10.6253 12.3424V14.9997C10.6253 15.3447 10.3454 15.6245 10.0003 15.6247C9.65515 15.6247 9.37533 15.3449 9.37533 14.9997V12.3424L8.77572 12.9421C8.53164 13.1861 8.13503 13.1861 7.89095 12.9421C7.64714 12.6981 7.64725 12.3023 7.89095 12.0583L9.55794 10.3913ZM10.6253 7.49967C10.6253 7.61473 10.7183 7.70866 10.8333 7.70866H15.1068L10.6253 3.22624V7.49967Z
```

`cross-circle`, 22×22, `viewBox="0 0 22 22"`, `fillRule="evenodd" clipRule="evenodd"` (the rule is
load-bearing — it knocks the × out of the filled disc):

```
M11 1.83333C16.0626 1.83333 20.1667 5.93739 20.1667 11C20.1667 16.0626 16.0626 20.1667 11 20.1667C5.93739 20.1667 1.83333 16.0626 1.83333 11C1.83333 5.93739 5.93739 1.83333 11 1.83333ZM14.6944 7.30558C14.4259 7.0371 13.9907 7.0371 13.7222 7.30558L11 10.0278L8.27775 7.30558C8.00926 7.0371 7.57407 7.0371 7.30558 7.30558C7.0371 7.57407 7.0371 8.00926 7.30558 8.27775L10.0278 11L7.30558 13.7222C7.0371 13.9907 7.0371 14.4259 7.30558 14.6944C7.57407 14.9629 8.00926 14.9629 8.27775 14.6944L11 11.9722L13.7222 14.6944C13.9907 14.9629 14.4259 14.9629 14.6944 14.6944C14.9629 14.4259 14.9629 13.9907 14.6944 13.7222L11.9722 11L14.6944 8.27775C14.9629 8.00926 14.9629 7.57407 14.6944 7.30558Z
```

## Implementation Steps

> **Status (2026-09-18): all 9 steps implemented and verified — [DONE].** Gates green (ui lint,
> frontend lint, frontend build, 1715/1715 frontend tests, docs linter 0 errors). Step 9's Figma
> re-verification (re-fetched via local Dev Mode MCP after a machine-sleep interrupt) confirmed
> the plan's extracted values hold against both live frames — see the step-9 note below. The
> full-app live-render comparison still falls to epic #1255's QA pass, which has DevTools/browser
> access this coder run does not exercise.

Reminder before writing any file: **comment-minimal is a hard rule** — at most one 2–3-line
spec-pointer header per file (`// spec: docs/frontend/auth-components.md#… (Figma nodes …)`),
nothing else. No field/function JSDoc, no body comments, no test comments.

1. **Token — [DONE].** `packages/ui/src/styles/theme.css` — add
   `--color-pipeline-brand-secondary: rgb(0 0 128 / 0.08);` to **both** the `:root` block (~line
   78, beside `--color-pipeline-brand`) and the `@theme` block (~line 156), matching how
   `--color-pipeline-negative-secondary` is declared twice. In the `@theme` copy, append the
   inline provenance comment the file's other tokens carry:
   `/* KYB company-docs leading tile — sampled from Figma node 6486:81679 (issue #1251); no variable binding in the file's codegen */`.

2. **Shell prop — [DONE].** `packages/frontend/src/components/AuthModalShell.tsx` —
   add `stepLabel?: { current: number; total: number }` to `AuthModalShellProps`, defaulting to
   `undefined`. Render it last in the panel (after the close/back buttons), non-focusable:

   ```tsx
   {stepLabel ? (
     <div className="absolute top-4 left-4 z-10 flex h-10 items-center px-4 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]">
       <span>
         Step {stepLabel.current}
         <span className="text-[color:var(--color-pipeline-ink-muted)]">/{stepLabel.total}</span>
       </span>
     </div>
   ) : null}
   ```

   Every existing caller must render byte-identically without passing it. Do not touch any other
   shell behaviour.

3. **State hook — [DONE].** New `packages/frontend/src/components/useCompanyDocsModal.ts`:

   - Export `COMPANY_DOCUMENT_SLOTS` as a `readonly` tuple of `{ id, label }`, ids
     `certificate-of-incorporation`, `registry-of-legal-entities`,
     `certificate-of-good-standing`, `legal-address`, `shareholder-register`, labels per
     decision 2. Export `CompanyDocumentSlotId = (typeof COMPANY_DOCUMENT_SLOTS)[number]["id"]`.
   - Export `ACCEPTED_FILE_TYPES` (`application/pdf`, `image/jpeg`, `image/png`) and
     `MAX_FILE_BYTES = 10 * 1024 * 1024`.
   - `useCompanyDocsModal({ open, onSubmit })` returns `{ files, rejected, selectFile, clearFile,
     isComplete, handleSubmit }`, where `files: Partial<Record<CompanyDocumentSlotId, File>>` and
     `rejected: Partial<Record<CompanyDocumentSlotId, boolean>>`.
   - `selectFile(id, file)` applies decision 6: accepted → set the file and clear the slot's
     rejected flag; rejected → leave the file untouched and set the flag.
   - `isComplete` is true only when all five ids are present. `handleSubmit` no-ops unless
     `isComplete`, then calls `onSubmit?.(files as Record<CompanyDocumentSlotId, File>)`.
   - Reset all state on `open` `false → true`, matching `useAuthCredentialsForm`/`useOtpModal`.

4. **Row component — [DONE].** New `packages/frontend/src/components/DocumentUploadRow.tsx` — both glyphs
   (paths above, `fill="currentColor"`) plus the row:

   - `<li className="flex h-10 items-center gap-3">`.
   - Leading, 40×40 `shrink-0`: when a preview URL exists (decision 5) an `<img alt="" className="size-10 rounded-[var(--radius-pipeline-card)] object-cover">`; otherwise
     `<div className="flex size-10 items-center justify-center rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-brand-secondary)] text-[color:var(--color-pipeline-brand)]">` + the 20px file glyph.
   - Preview URL lifecycle lives here: `useEffect` on `file`, create only when
     `file.type` starts with `image/` **and** `typeof URL.createObjectURL === "function"`, revoke
     in the cleanup.
   - Middle, `flex min-w-0 flex-1 flex-col justify-center`: title `<p className="min-h-6 truncate …">` (file name when uploaded, else the slot label) and the caption `<p className="truncate …">` (`Uploaded` when uploaded, else the hint), with the caption switching to
     `--color-pipeline-negative-strong` + `role="alert"` while `rejected` (decision 6).
   - Trailing: when empty, the hidden `<input type="file">` (`className="sr-only"`,
     `tabIndex={-1}`, `aria-hidden="true"`, `accept="application/pdf,image/jpeg,image/png"`) plus
     `<Button variant="secondary" size="compact" aria-label={`Upload ${label}`} className="border border-[color:var(--color-pipeline-line)]" onClick={() => inputRef.current?.click()}>Upload</Button>`;
     when uploaded, a 32×32 `<button type="button" aria-label={`Remove ${file.name}`} className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-button)] text-[color:var(--color-pipeline-ink-muted)] …focus-visible ring…">` + the 22px cross glyph.
   - Reset `input.value = ""` after each change so re-picking the same file after a removal still
     fires `change`.

5. **Modal — [DONE].** New `packages/frontend/src/components/CompanyDocsModal.tsx`:

   ```tsx
   export interface CompanyDocsModalProps {
     open: boolean;
     onDismiss: () => void;
     onSubmit?: (documents: Record<CompanyDocumentSlotId, File>) => void;
   }
   ```

   Renders `AuthModalShell` with `heading="Finish account setup"`,
   `description="Upload your company documents so we can verify your account."`,
   `headingId="company-docs-modal-heading"`, `testId="company-docs-modal"`,
   `showImagePanel={false}`, `align="center"`, `stepLabel={{ current: 1, total: 2 }}`, and the
   default close button (do **not** pass `showCloseButton`/`onBack`). Children:
   `<div data-node-id="6486:81679" className="mt-2 flex w-full flex-col gap-8 pb-16">` containing
   `<ul role="list" className="flex w-full flex-col gap-6">` of five `DocumentUploadRow`s, then
   `<Button variant="primary-dark" disabled={!isComplete} onClick={handleSubmit} className="!w-full !min-w-0 disabled:opacity-[0.32]">Continue</Button>`.

6. **Test-setup stub — [DONE].** `packages/frontend/src/test-setup.ts` — define
   `URL.createObjectURL`/`URL.revokeObjectURL` only when absent (jsdom ships neither), following
   the file's existing "probe, then install a stand-in" shape. Keep it minimal: a counter-based
   `blob:` string and a no-op revoke.

7. **`/test` seam — [DONE].** `packages/frontend/src/routes/test.tsx`, `AuthTab`:

   - Add `companyDocsOpen` state and a fourth `Button variant="secondary"` labelled
     `Open Company Docs step`, and render `<CompanyDocsModal open={companyDocsOpen} onDismiss={() => setCompanyDocsOpen(false)} onSubmit={() => { setCompanyDocsSubmitted(true); setCompanyDocsOpen(false); }} />`.
   - Add the submitted stand-in line (same shape as the OTP one), `data-testid="auth-company-docs-submitted"`:
     `Company documents submitted — the #1252 Owners step opens here once it exists.`
   - Reword the OTP stand-in line (keep `data-testid="auth-otp-verified"`) to
     `OTP verified — open the Company Docs step from the button above.`
   - Update the tab's intro `<p>` to name #1251 alongside #1248/#1249/#1250.

8. **Lint/build gate — [DONE].** `yarn workspace @pipeline/frontend exec tsc --noEmit`, eslint +
   prettier on both touched packages, the full frontend vitest suite, the frontend build, and
   `npx tsx scripts/lint-docs.ts`. `packages/ui` `tsc --noEmit` still fails on BUG-19 (same three
   `TextField.stories.tsx` errors, confirmed unchanged) — not fixed here, as directed.

9. **Figma re-verification — [DONE].** Re-fetched `get_screenshot` for `6486-81679` and
   `6486-81817` via the local Dev Mode MCP (session re-established after the machine-sleep
   interrupt). Confirmed against the fresh screenshots: both frames render the identical × close
   button top-right (a prior eyeball pass over a small crop wrongly suspected it was hidden on
   the uploaded frame — a 4x zoomed crop of both top-right corners shows the glyph present and
   pixel-identical in both); the two-tone `Step 1/2` badge top-left; all five row labels and the
   `pdf, jpg, png files up to 10MB` caption verbatim on every empty row; the navy-tinted leading
   tile (consistent with the sampled `--color-pipeline-brand-secondary`); the bordered compact
   `Upload` button; the uploaded rows' file-name titles + `Uploaded` captions + circular remove
   glyph; and the Continue button's disabled-gray vs. filled-dark states. No new divergences
   beyond the two already tracked (TD-62 rejection styling, TD-63 PDF-thumbnail vs. glyph tile)
   and the already-documented stale-codegen tile-fill note. This was a static screenshot
   comparison against the two named Figma nodes, not a live `/test?tab=auth` render — the coder
   role does not drive a browser against the dev server; the full live-render pass is epic
   #1255's QA agent (Chrome DevTools MCP).

## Test Strategy

New `packages/frontend/src/components/CompanyDocsModal.test.tsx` (jsdom, mirroring
`OtpModal.test.tsx`'s shape). File inputs are hidden, so drive them with
`fireEvent.change(input, { target: { files: [file] } })` and
`new File(["x"], "doc.pdf", { type: "application/pdf" })` — not `userEvent.upload`, which
rejects non-visible targets.

1. Empty state: five rows render in frame order with their exact labels; every caption reads
   `pdf, jpg, png files up to 10MB`; five `Upload` buttons; `Continue` is disabled.
2. Shell composition: no image panel, close button present, no back button, the step badge
   renders `Step 1` and `/2`.
3. Accepting a file: the row's title becomes the file's `name`, the caption becomes `Uploaded`,
   the `Upload` button is replaced by a `Remove …` button, and `Continue` is **still** disabled.
4. Completing all five enables `Continue`; clicking it calls `onSubmit` once with all five slot
   ids mapped to the right `File` objects.
5. Removing one file reverts that row to its empty state and re-disables `Continue`.
6. Rejection — oversize: a `File` whose `size` exceeds `MAX_FILE_BYTES` leaves the slot empty,
   turns its caption into a `role="alert"` (text unchanged), and keeps `Continue` disabled.
7. Rejection — wrong type: `text/plain` behaves the same. Then picking a valid file into the same
   slot clears the alert.
8. Re-picking the identical file after a removal still registers (the `input.value` reset).
9. Reopen resets everything: fill a slot, flip `open` to `false` and back to `true`, assert the
   empty state and a disabled `Continue`.
10. Image preview: with `URL.createObjectURL` stubbed (step 6), an `image/png` file renders an
    `<img>` in the leading slot while an `application/pdf` file keeps the glyph tile.

Extend `packages/frontend/src/components/AuthModalShell.test.tsx`: `stepLabel` renders the badge
with both runs; omitting it renders no badge (guards the "existing callers unchanged" claim).

Extend `packages/frontend/src/routes/-test.test.tsx`: the fourth trigger opens
`company-docs-modal`; the reworded `auth-otp-verified` copy; the new
`auth-company-docs-submitted` line appears after a successful submit.

Regression: the full frontend suite must stay green — `SignInModal`, `CreateAccountModal`, and
`OtpModal` tests are the guard that step 2's shell change is behaviour-preserving.

## Docs to Update

- `docs/frontend/auth-components.md`
  - Add `stepLabel` to the `AuthModalShell` optional-props table (noting mutual exclusivity with
    `onBack`, and that #1252 reuses it at `Step 2/2`).
  - New `### CompanyDocsModal` section: file paths, the two Figma nodes, composition, the five
    slots and verbatim copy, the Figma → token table above (including the stale-codegen note and
    the sampled `--color-pipeline-brand-secondary`), the validation rules and the recolored-caption
    rejection treatment, the image-preview/glyph-tile split, the `onSubmit` seam, and
    accessibility (`<ul role="list">`, hidden inputs with labelled buttons, `role="alert"`).
  - Update `### Diagnostics preview seam`: three triggers → four, plus the reworded OTP line.
- `docs/user-stories/epic-1247/1251-kyb-company-docs.md` — new, following
  `1250-kyb-otp.md`'s shape: preamble naming the `/test?tab=auth` entry and the presentational-only
  scope, a "tech debt to be aware of" note covering TD-62 and TD-63 so QA does not file them as
  bugs, then stories for empty state, uploading one document, partial completion keeping
  `Continue` disabled, completing all five, submitting, removing, oversize/wrong-type rejection,
  and reopen-resets.
- `docs/user-stories/index.md` — add the `#1251` row to the Epic #1247 table (`Initial`).
- `docs/user-stories/epic-1247/1250-kyb-otp.md` — Story 5's expected-outcome quotes the OTP
  stand-in copy verbatim; update that one line to the reworded text from step 7.
- `docs/exec-plans/tech-debt-tracker.md` — **TD-62** (rejected-file state has no Figma treatment;
  the caption is recolored as a stand-in) and **TD-63** (uploaded-row thumbnail is an image
  preview or a glyph tile, never Figma's rendered PDF page). Next free number is TD-62 (TD-61 is
  the last entry).
- `packages/ui/src/styles/theme.css` — provenance comment on the new token (step 1); no
  `ui-components.md` change, since no `@pipeline/ui` component is added or modified.
