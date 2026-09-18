# Issue #1252: KYB: Owners step

Source: https://github.com/eq-lab/pipeline/issues/1252

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Branch: `feat/1252-kyb-owners` (draft PR #1263), cut from `main` after #1248/#1249/#1250/#1251
merged (`0a26f49f`).

Figma (styling source of truth, file `A43rjYYjSwdTmiwwf5cx5n`):

- Default (no files, Submit disabled): [`6486-81710`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81710&m=dev)
- Enabled (two files uploaded, Submit enabled): [`6486-81783`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81783&m=dev)
- Step-badge chrome: `6486:81731` (default) / `6486:81805` (enabled) — both render `Step 2/2`
- Uploaded-file row (`list-item`): `6486:81799` / `6486:81800`
- Banner hint tooltip: `6486:82392` (a loose canvas instance, see "Assumptions and Risks")

All Figma facts below were recovered during planning via the local Dev Mode MCP
(`get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot`, plus direct
`GET` of the exported SVG assets — every call succeeded, `get_design_context` did not hang on
this session). Re-extraction is not required to implement; re-verification against the live
frames is still a required step (step 11).

## Scope

Build the KYB Owners step as a **presentational-only** screen, consistent with the
#1248/#1249/#1250/#1251 precedents: no network call, no persistence, seams left as no-ops for
#1254, and no production entry point — reachable from `/test?tab=auth` only.

**This screen is a drag-and-drop file uploader, not an owner-details form.** Both frames were
read node-by-node: there is no name field, no role field, no ownership-percentage input, no
select, no "add owner" button, and no per-owner grouping anywhere. The entire step is
heading → info banner → one dashed drop zone → a flat list of uploaded files → Submit → Back.
The "owners" framing lives only in the heading and the banner copy.

In scope:

1. New `OwnersModal` + `useOwnersModal` in `packages/frontend`, composed on the existing
   `AuthModalShell` (`stepLabel={{ current: 2, total: 2 }}` — the prop #1251 shipped needs **no
   change**, confirmed against both frames' `6486:81738` / `6486:81812` badge text).
2. New `KybInfoBanner` (white 400×76 banner + 20px hint glyph + hover/focus tooltip).
3. New `FileDropZone` (dashed drop target, "Select files" picker, multi-file, validated).
4. `UploadedFileRow` extracted verbatim out of `DocumentUploadRow`'s file-present branch and
   consumed by both #1251's rows and this screen's list.
5. One new theme token: `--radius-pipeline-card-xs: 2px` (`radius/radius-xxs`).
6. Shared file-validation module `kybFileValidation.ts` lifted out of `useCompanyDocsModal.ts`.
7. A fifth `/test?tab=auth` trigger, plus a reword of the now-stale Company Docs stand-in line.
8. Specs in `docs/frontend/auth-components.md`, a user-stories doc, tech-debt entries, index
   links.

Out of scope:

- Any real upload, storage, progress, or retry. Files live in React state as `File` objects for
  the lifetime of the open modal; closing/reopening discards them.
- Wiring Company Docs → Owners → Account-in-review as a sequence (#1254's flow orchestration;
  decision 11 keeps the `/test` triggers independent, same as #1251).
- The LP header entry point (epic #1247 decision 2026-09-17: separate buttons, future Figma).
- `@pipeline/ui` promotion of any of the new components — all three are LP-only and follow
  `AuthModalShell`'s placement in `packages/frontend`.
- Associating uploaded files with individual owners (the design provides no affordance; see
  TD-66).

## Assumptions and Risks

- **Same `AuthModalShell` modal, not a new page.** Both frames wrap an instance of the same
  `Sign In` component (`8550:10210` content pane / `8550:10546` image pane) with the Image slot
  `hidden="true"` and the Close Icon instance visible, and the same `header` chrome whose
  `Navigation`/`Buttons` frames are empty and whose `project-logo`/`button-icon` instances are
  hidden — exactly the #1251 shape. Only the `Step` label differs (`2/2`).
- **No `description`.** The heading instance's `SubtitleCont` (`6539:2316`) is `hidden="true"` on
  both frames. Unlike `OtpModal`/`CompanyDocsModal`, this screen passes no `description`; the
  explanatory line lives in the banner instead. Vertical centering is `align="center"`: the
  default frame's 624px column sits at y=146 in a 916px viewport ((916−624)/2 = 146), the
  enabled frame's 752px column at y=82 ((916−752)/2 = 82). Both check out exactly.
- **The hint tooltip is a loose canvas instance, not a child of either frame.** `6486:82392`
  (240×148) sits at canvas (9071, 1742), i.e. horizontally centred on the banner's 20px `hint`
  glyph (frame-local x ≈ 1038) in the gap between the two Owners frames — and it bleeds into the
  top of the enabled frame's screenshot. Its copy answers exactly the question the banner's hint
  poses, so decision 4 ships it. What the node does *not* specify — trigger, offset, arrow — is
  TD-65.
- **Node `6486:81744` is mis-attributed on #1253.** That issue's body calls it "the review
  banner", but `get_design_context` shows it is a byte-identical duplicate of *this* screen's
  banner (same `7152:4507`/`7152:4521` children, same copy "Upload ID and proof of address
  documents for each owner"), parked loose on the canvas at (8817, 1686) inside the Owners
  column. #1253 will need its own banner node identified; `KybInfoBanner` is built here in a
  reusable shape so #1253 can consume it either way. Worth a comment on #1253 — not this issue's
  job to edit.
- **Figma codegen fallback literals are unreliable; the resolved variables are not.**
  `get_design_context` emits `rounded-[var(--radius-16,4px)]` on the Owners banner and
  `rounded-[var(--radius-16,16px)]` on its loose duplicate, and `radius/radius-s` appears with a
  `4px` fallback in the uploader and an `8px` fallback in the `list-item`. `get_variable_defs`
  resolves them unambiguously: `radius-16` = **4**, `radius/radius-s` = **4**,
  `radius/radius-m` = **4**, `radius/radius-xxs` = **2**. Use the resolved values.
- **Extraction of `UploadedFileRow` touches #1251's merged `DocumentUploadRow.tsx`.** The
  #1249 human resolution already established that a later sub-issue may refactor an earlier
  one's files inside this epic. The extraction is DOM-preserving by construction, and
  `CompanyDocsModal.test.tsx` (10 cases, including the image-preview/glyph-tile split) is the
  regression guard. If anything in that suite goes red, the extraction is wrong — do not adjust
  the test.
- **jsdom has no `DataTransfer` constructor.** Drop events must be driven with a plain object:
  `fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } })`. The component
  must therefore read `e.dataTransfer?.files` defensively rather than constructing anything.
- `URL.createObjectURL` is already stubbed in `packages/frontend/src/test-setup.ts` (#1251
  step 6) — no test-setup change needed here.
- The shell's body-scroll-lock and capture-phase Escape are **not stack-safe** (documented in
  `auth-components.md#authmodalshell`). Decision 11 keeps the `/test` triggers mutually
  exclusive so this is never exercised. Decision 4 also deliberately does **not** wire Escape to
  dismiss the tooltip — the shell owns Escape in the capture phase and would close the modal.
- Pre-existing and unrelated: **BUG-19** (`packages/ui` `tsc --noEmit` fails on
  `TextField.stories.tsx`). Re-confirmed during planning — the same three `TS2322` errors at
  lines 47, 52, 57, unchanged. Do not fix it here; do not let it mask a real regression.

## Open Questions

_None._

Four decisions were settled in-plan rather than escalated, because each follows from an existing
human resolution on this epic or from the frames themselves, and none is a product question:

- **Submit threshold (decision 8).** The default frame (0 files) renders Submit at `opacity-32`;
  the enabled frame (2 files) renders it solid. With no owner-count input anywhere in the
  design, "at least one file" is the only non-arbitrary rule consistent with both frames.
  Logged as TD-66 so a designer/PM can set a real requirement.
- **The uploader subtitle's gray (decision 3).** Rendered with the existing
  `--color-pipeline-ink-muted` rather than a new token — see decision 3 for the full reasoning.
  Logged as TD-64.
- **Undesigned drop-zone states (decision 7).** Drag-over and file-rejection have no frame.
  Both reuse an existing token on existing copy with no layout change — the same shape as
  #1251's TD-62 resolution. Logged as TD-67.
- **The hint tooltip (decision 4).** Shipped from node `6486:82392`, token-exact, copy verbatim;
  the unspecified interaction details are TD-65.

## Decisions

1. **Composition.** `AuthModalShell` with `heading="Add company owners"`, **no** `description`,
   `headingId="owners-modal-heading"`, `testId="owners-modal"`, `showImagePanel={false}`,
   `align="center"`, `stepLabel={{ current: 2, total: 2 }}`, the default close button, and no
   `onBack`. Children are one wrapper `<div data-node-id="6486:81710" className="mt-2 flex
   w-full flex-col gap-8 pb-16">` — identical to `CompanyDocsModal`'s, and for the same reason
   (the shell's column gap is 24px, the frame wants 32px under the heading, so `mt-2` adds the
   missing 8px; `gap-8` = the frame's 32px rhythm; `pb-16` = the container's `pb-64`).

2. **Banner (`KybInfoBanner`), copy verbatim.** White 400×76 card:
   `flex w-full items-center min-h-[56px] rounded-[var(--radius-pipeline-card)]
   bg-[color:var(--color-pipeline-surface)] p-4`, containing a
   `flex min-w-0 flex-1 items-center justify-center pr-12` text cell with
   `Upload ID and proof of address documents for each owner` (Body 16/22,
   `--color-pipeline-ink`) and the 20px hint glyph. The 76px height is the two-line wrap of that
   copy at the 400−16−16−48 = 320px text width (16 + 2×22 + 16 = 76) — do not hard-code a
   height; `min-h-[56px]` plus the natural wrap reproduces it.

3. **Drop zone (`FileDropZone`).** `flex w-full flex-col items-center gap-4 p-6 rounded-[var(--radius-pipeline-card-xs)]
   border border-dashed border-[color:var(--color-pipeline-ink-subtle)]`, containing, top to
   bottom: the 24px `file-upload` glyph (`--color-pipeline-ink-muted`), a
   `flex w-full flex-col gap-1 text-center` pair — `Drag and drop your files` (Body 16/22,
   `--color-pipeline-ink`) over `pdf, jpg, png files up to 10MB` (Body S 14/18) — and
   `<Button variant="secondary" size="m">Select files</Button>` with a border override. Geometry
   checks against the frame's 188px height exactly: 24 + 24 + 16 + 44 + 16 + 40 + 24 = 188.

   **The subtitle's color is `--color-pipeline-ink-muted`, not a new token.** Figma binds it to
   `text-tertairy` = `#7d7d7d` — a misspelled, non-namespaced legacy variable; every other color
   on both frames resolves through `content-test/*`, `fill-test/*`, or `border-test/*`. Its
   composite over `--color-pipeline-paper` differs from `ink-muted`'s by ≤8/255 per channel
   (`#7d7d7d` vs `#858482`), the same order as the `#323837` vs `#383735` channel-order artifact
   that #1248 and #1251 both resolved by reusing the existing token. Adding a fourth ink token
   named after a typo would outlive the reconciliation. Divergence → **TD-64**.

4. **Hint tooltip, from node `6486:82392`, token-exact.** The hint renders as a
   `<button type="button" aria-label="More information" aria-describedby={tooltipId}>` carrying
   the 20px `info` glyph in `--color-pipeline-ink-subtle` (Figma fill `#323837` @ 0.3 — the same
   one-channel-order artifact #1248/#1251 already resolved to `ink-subtle`; **no new token**).
   The tooltip is a `<div role="tooltip" id={tooltipId}>` shown on `mouseenter`/`focus` and
   hidden on `mouseleave`/`blur`, positioned `absolute bottom-full left-1/2 -translate-x-1/2
   mb-2 z-10 w-60 rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-cta)]
   p-2 text-[color:var(--color-pipeline-on-dark)]` at Body 16/22 — every value read off the node
   (`w-60` = 240, `p-2` = `size-8`, `radius/radius-m` = 4, `fill-test/primary` = `#262524`,
   `content-test/primary-on-invert` = white). Copy verbatim, U+2019 apostrophe in `driver’s`:

   > You could upload a passport, ID card, or driver’s licence, plus a recent (no older than 90
   > days) utility bill or bank statement as proof of address.

   No arrow/caret (the node has none). **Do not wire Escape to close the tooltip** — the shell's
   capture-phase Escape would close the modal. Trigger, 8px offset, and the missing arrow are
   undesigned → **TD-65**.

5. **Upload affordance: drag-and-drop *and* a picker, multi-file.** Unlike #1251 (which had no
   drop zone at all), this frame is an explicit "Drag and drop your files" target. Implement
   both: `onDragEnter`/`onDragOver` with `preventDefault()`, `onDrop` reading
   `e.dataTransfer?.files`; and a visually hidden
   `<input type="file" multiple accept="application/pdf,image/jpeg,image/png"
   className="sr-only" tabIndex={-1} aria-hidden="true">` clicked by the "Select files" button.
   `multiple` is required here (the enabled frame shows two files with no per-slot structure) —
   the opposite of #1251's single-file inputs. Reset `input.value = ""` after each change so
   re-picking the same file after a removal still fires `change`.

6. **File list is unbounded and un-slotted.** State is an ordered
   `{ id: number; file: File }[]` with a monotonically increasing `id` — not a keyed record —
   because the design has no slots and nothing prevents two files sharing a name. No maximum
   count. Each pick/drop appends; removing splices by `id`.

7. **Undesigned drop-zone states reuse existing tokens on existing copy.**
   - *Drag-over*: the dashed border recolors `--color-pipeline-ink-subtle` →
     `--color-pipeline-ink` while a drag is over the zone. No new copy, no new layout, no new
     token.
   - *Rejection*: the same rule as #1251 — reject when the MIME type is outside
     `{application/pdf, image/jpeg, image/png}` (falling back to the filename extension when
     `file.type` is empty) or when `file.size > MAX_FILE_BYTES` (10MB). The rejected file is not
     added, and the zone's own subtitle — the same string, `pdf, jpg, png files up to 10MB` —
     recolors to `--color-pipeline-negative-strong` with `role="alert"`. It reverts on the next
     accepted file, or when the modal reopens. When a multi-file drop mixes accepted and
     rejected files, the accepted ones are added *and* the alert shows.

   Both → **TD-67**.

8. **Submit is enabled once at least one file is present**, matching the two frames (0 →
   `opacity-32`, 2 → solid). Removing the last file re-disables it. Threshold → **TD-66**.

9. **Submit label is `Submit`, not `Continue`.** Confirmed in the codegen for `6486:81727`.
   `<Button variant="primary-dark" disabled={!isComplete} className="!w-full !min-w-0
   disabled:opacity-[0.32]">Submit</Button>` — `primary-dark` because the fill is
   `fill-test/primary` `#262524`, the same call #1251 made. `onClick` calls `onSubmit?.(files)`
   where `files` is `File[]` — a no-op seam exactly like `CompanyDocsModal.onSubmit`.

10. **`Back` ships inert.** It is plain centered Caption text (12/16, `content-test/primary` —
    full ink, not muted) in the content column, not a button, and the frame already carries the
    shell's × close affordance top-right. Its destination (Company Docs, Step 1/2) is
    cross-screen sequencing, which epic #1247 assigns to #1254 — so it gets the same treatment
    as "Forgot password?" (#1248) and "Resend" (#1250): rendered text, no handler, not
    focusable. Do **not** add an unused `onBack` seam prop; #1248's coder explicitly dropped
    that pattern.

11. **`/test` wiring: a fifth independent trigger.** Not chained from
    `CompanyDocsModal.onSubmit`, for the reason #1251 recorded — the shell's scroll-lock and
    capture-phase Escape are not stack-safe, and a close→open transition is exactly the untested
    path. The existing `auth-company-docs-submitted` line keeps its `data-testid` but is
    reworded, since "the #1252 Owners step opens here once it exists" becomes false the moment
    this ships.

12. **`UploadedFileRow` is extracted, not duplicated.** #1251's doc said the Owners frame "uses a
    different `uploader` component, so there is no second consumer" — true of the *empty* state,
    but the `list-item` (`6486:81799`) is byte-for-byte the same row as
    `DocumentUploadRow`'s file-present branch: 40×40 `object-cover` rounded-4 thumbnail, 12px
    gap, file name (Body 16/22 ink, truncated), `Uploaded` caption (Caption 12/16
    `content-test/secondary` = `ink-muted`), and a 32×32 trailing button carrying the same 22px
    `cross-circle` glyph (the exported path is identical to the one already in the repo). It now
    has its second consumer, so it moves to its own file.

## Figma → code mapping (confirmed, not estimated)

Layout, 400px column (from `get_metadata` geometry + `get_design_context`):

| Element | Value |
| --- | --- |
| Container | `flex flex-col gap-[32px] items-center pb-[64px] w-[400px]`, vertically centered |
| Heading (`Add company owners`) | Heading L 48/56 Besley, wraps to two lines → 112px |
| Heading → banner | 32px (shell `gap-6` + `mt-2` on the children wrapper) |
| Banner / drop zone / each file row | one `flex flex-col gap-[24px]` column — all siblings |
| Banner | `min-h-[56px]`, `p-[16px]`, radius 4, white fill; renders 76px with its 2-line copy |
| Drop zone | `p-[24px]`, `gap-[16px]`, radius 2, 1px dashed; 188px tall |
| File row | `h-[40px]`, `flex items-center gap-[12px]` |
| Block → Submit | 32px |
| Submit | `w-full`, `h-[48px]`, `px-[12px]`, radius 4 |
| Submit → Back | 32px |
| Back | 16px tall, centered |

Tokens:

| Element | Figma | Repo token |
| --- | --- | --- |
| Title | Heading L 48/56 Besley, `content-test/primary` | shell `<h2>` (unchanged) |
| Banner fill | `fill-test/on-primary` `#ffffff` | `--color-pipeline-surface` |
| Banner radius | `radius-16` = 4 | `--radius-pipeline-card` |
| Banner text | Body 16/22, `content-test/primary` | `--color-pipeline-ink` |
| Hint glyph | 20px `info`, `#323837` @ 0.3 | `--color-pipeline-ink-subtle` — **no new token** (same one-channel-order artifact #1248 resolved) |
| Tooltip fill / text | `fill-test/primary` `#262524` / `content-test/primary-on-invert` | `--color-pipeline-cta` / `--color-pipeline-on-dark` |
| Tooltip radius / pad / width | `radius/radius-m` = 4 / `size-8` / 240 | `--radius-pipeline-card` / `p-2` / `w-60` |
| Drop-zone border | 1px dashed `border-test/primary` `#3835384d` | `--color-pipeline-ink-subtle` (`rgb(56 55 53 / 0.3)`) |
| Drop-zone radius | `radius/radius-xxs` = 2 | **new** `--radius-pipeline-card-xs` |
| Drop-zone glyph | 24px `file-upload`, `#323837` @ 0.6 | `--color-pipeline-ink-muted` |
| Drop-zone title | Body 16/22, `content-test/primary` | `--color-pipeline-ink` |
| Drop-zone subtitle | Body S 14/18, `text-tertairy` `#7d7d7d` | `--text-pipeline-body-s` + `--color-pipeline-ink-muted` (decision 3, TD-64) |
| `Select files` button | 40px box, `px-[8px]` + inner `px-[8px]`, 1px `border-test/secondary` `rgba(56,55,53,0.18)`, radius 4, Body Emphasized ink | `Button variant="secondary" size="m"` + `border border-[color:var(--color-pipeline-line)]` — `size="m"` is already `!h-10 !min-w-10 !px-2` with an inner `px-2`. Exact match, no other override. |
| File-row thumbnail | 40×40 `object-cover`, `radius/radius-s` = 4 | `--radius-pipeline-card` |
| File-row title / caption | Body 16/22 `content-test/primary` / Caption 12/16 `content-test/secondary` | `--color-pipeline-ink` / `--color-pipeline-ink-muted` |
| Remove glyph | 22px `cross-circle`, `#323837` @ 0.6 | `--color-pipeline-ink-muted` (already in the repo) |
| Submit fill / label / disabled | `fill-test/primary` `#262524` / `content-test/primary-on-invert` / `opacity-32` | `Button variant="primary-dark"` + `disabled:opacity-[0.32]` |
| `Back` | Caption 12/16, `content-test/primary` (**full ink**, not muted) | `--color-pipeline-ink` |
| Step badge | Body Emphasized 16/22; `Step 2` ink, `/2` `rgba(56,55,53,0.6)` | shell `stepLabel` (unchanged) |

**Icon paths (Figma-exported, verbatim — the Dev Mode asset server is ephemeral, so these are
recorded here rather than re-fetched).** Both ship with `fill="currentColor"`; the exported
`#323837` fills and opacities are file artifacts carried by the token mapping above, not by the
path.

`info` (banner hint), 20×20, `viewBox="0 0 20 20"`, `fillRule="evenodd" clipRule="evenodd"`:

```
M10 18.3333C14.6024 18.3333 18.3333 14.6024 18.3333 10C18.3333 5.39763 14.6024 1.66667 10 1.66667C5.39763 1.66667 1.66667 5.39763 1.66667 10C1.66667 14.6024 5.39763 18.3333 10 18.3333ZM11.0417 6.25C11.0417 6.94031 10.482 7.5 9.79167 7.5C9.10136 7.5 8.54167 6.94031 8.54167 6.25C8.54167 5.55969 9.10136 5 9.79167 5C10.482 5 11.0417 5.55969 11.0417 6.25ZM7.91667 9.16667C7.91667 8.82151 8.19641 8.54167 8.54167 8.54167H10C10.3453 8.54167 10.625 8.82151 10.625 9.16667V13.125H11.6667C12.0119 13.125 12.2917 13.4048 12.2917 13.75C12.2917 14.0952 12.0119 14.375 11.6667 14.375H8.33333C7.98808 14.375 7.70833 14.0952 7.70833 13.75C7.70833 13.4048 7.98808 13.125 8.33333 13.125H9.375V9.79167H8.54167C8.19641 9.79167 7.91667 9.51182 7.91667 9.16667Z
```

`file-upload` (drop zone), **24×24**, `viewBox="0 0 24 24"` — a different export from the 20×20
path #1251 already ships in `DocumentUploadRow`; do not rescale that one, use this:

```
M11.9645 2.00033C12.6274 2.00034 13.2633 2.26313 13.7321 2.73177L19.2682 8.2679C19.7369 8.7367 19.9997 9.3726 19.9997 10.0355V19.5003C19.9995 20.8809 18.8803 22.0003 17.4997 22.0003H6.49967C5.11922 22.0001 3.99985 20.8808 3.99967 19.5003V4.50033C3.99967 3.11972 5.11911 2.0005 6.49967 2.00033H11.9645ZM6.49967 3.50033C5.94754 3.5005 5.49967 3.94815 5.49967 4.50033V19.5003C5.49985 20.0524 5.94765 20.5001 6.49967 20.5003H17.4997C18.0519 20.5003 18.4995 20.0525 18.4997 19.5003V10.7503H12.9997C12.0334 10.7501 11.2499 9.96657 11.2497 9.00033V3.50033H6.49967ZM11.4694 12.4701C11.7623 12.1772 12.2371 12.1772 12.5299 12.4701L14.5299 14.4701C14.8228 14.7629 14.8228 15.2377 14.5299 15.5306C14.237 15.8232 13.7622 15.8234 13.4694 15.5306L12.7497 14.8109V18.0003C12.7495 18.4144 12.4138 18.7503 11.9997 18.7503C11.5857 18.7502 11.2499 18.4143 11.2497 18.0003V14.8109L10.5299 15.5306C10.237 15.8232 9.76219 15.8234 9.4694 15.5306C9.17662 15.2378 9.17683 14.763 9.4694 14.4701L11.4694 12.4701ZM12.7497 9.00033C12.7499 9.13814 12.8619 9.25015 12.9997 9.25033H18.1286L12.7497 3.87142V9.00033Z
```

The 22×22 `cross-circle` path is unchanged from #1251 and moves with `UploadedFileRow`.

## Implementation Steps

> **Status (2026-09-18): all 11 steps implemented and verified — [DONE].** Gates green (ui
> lint, frontend lint, frontend build, 1731/1731 frontend tests, `cargo clippy` clean, `cargo
> test --all` green, docs linter 0 errors/39 pre-existing warnings). Step 11's Figma
> re-verification re-fetched `get_screenshot` for both `6486-81710` and `6486-81783` via curl
> JSON-RPC against the local Dev Mode MCP (the MCP tool connection itself failed at session
> start; the raw HTTP endpoint was reachable and used instead). Both screenshots match the
> implementation exactly, including the `6486:82392` tooltip bleeding into the top of the
> enabled frame's screenshot exactly as the plan predicted — see the step-11 note below. The
> full-app live-render comparison still falls to the epic's QA pass, which has DevTools/browser
> access this coder run does not exercise.

Reminder before writing any file: **comment-minimal is a hard rule** — at most one 2–3-line
spec-pointer header per file (`// spec: docs/frontend/auth-components.md#… (Figma nodes …)`),
nothing else. No field/function JSDoc, no body comments, no test comments. The `// ── Name ──`
divider rules used by the sibling auth files are the only existing exception; match them or omit
them, but add no prose.

1. **Token — [DONE].** `packages/ui/src/styles/theme.css` — add
   `--radius-pipeline-card-xs: 2px;` to **both** the `:root` block (beside
   `--radius-pipeline-card`, ~line 138) and the `@theme` block (~line 237), matching how every
   other radius token is declared twice. In the `@theme` copy, append the inline provenance
   comment the file's other tokens carry:
   `/* radius/radius-xxs — KYB owners drop zone; Figma node 6486:81710 (issue #1252) */`.
   No color token is added (decisions 3 and 4).

2. **Shared validation module — [DONE].** New `packages/frontend/src/components/kybFileValidation.ts` —
   move `ACCEPTED_FILE_TYPES`, `MAX_FILE_BYTES`, `isAcceptedFile`, and `inferTypeFromName` out
   of `useCompanyDocsModal.ts` verbatim (no behavior change). `useCompanyDocsModal.ts` then
   imports `isAcceptedFile`/`MAX_FILE_BYTES` from it and re-exports
   `ACCEPTED_FILE_TYPES`/`MAX_FILE_BYTES` in one line, so its documented public surface
   (`auth-components.md` names `MAX_FILE_BYTES`) stays true. Nothing outside that file imports
   either constant today — verified.

3. **Extract `UploadedFileRow` — [DONE].** New
   `packages/frontend/src/components/UploadedFileRow.tsx` — move `CrossCircleIcon`, the
   `previewUrl` `useEffect`, and the entire file-present JSX out of `DocumentUploadRow.tsx`,
   **byte-identical in rendered DOM**:

   ```tsx
   export interface UploadedFileRowProps {
     file: File;
     onRemove: () => void;
   }
   ```

   `<li className="flex h-10 items-center gap-3">` with the preview-or-glyph-tile leading
   element (`size-10 shrink-0 rounded-[var(--radius-pipeline-card)] object-cover` `<img>` for
   `image/*` when `URL.createObjectURL` exists, otherwise the
   `bg-[color:var(--color-pipeline-brand-secondary)] text-[color:var(--color-pipeline-brand)]`
   tile + the 20×20 `FileUploadIcon`), the name/`Uploaded` text block, and the
   `aria-label={`Remove ${file.name}`}` button. Keep `FileUploadIcon` (20×20) in
   `DocumentUploadRow.tsx` and import it, or move it alongside — either is fine, but there must
   be exactly one copy of each path in the tree.

   `DocumentUploadRow.tsx` then renders `<UploadedFileRow file={file} onRemove={onRemove} />`
   when `file` is set and keeps its own empty-state branch (label, caption, rejection recolor,
   hidden input, `Upload` button) unchanged. Its `previewUrl` state/effect goes away entirely.

4. **Drop zone — [DONE].** New `packages/frontend/src/components/FileDropZone.tsx` — the 24×24
   `file-upload` glyph (path above) plus:

   ```tsx
   export interface FileDropZoneProps {
     rejected: boolean;
     onFiles: (files: File[]) => void;
   }
   ```

   Local `dragActive` state only. `onDragEnter`/`onDragOver` call `e.preventDefault()` and set
   it; `onDragLeave` and `onDrop` clear it; `onDrop` calls `e.preventDefault()` and
   `onFiles(Array.from(e.dataTransfer?.files ?? []))`. The border class switches
   `--color-pipeline-ink-subtle` → `--color-pipeline-ink` while `dragActive` (decision 7). The
   subtitle carries `role="alert"` and `--color-pipeline-negative-strong` while `rejected`, and
   `--color-pipeline-ink-muted` otherwise. The hidden `<input type="file" multiple>` and the
   `Button variant="secondary" size="m"` are per decisions 3 and 5;
   `aria-label` on the button is unnecessary (its visible label "Select files" is its name).

5. **Banner — [DONE].** New `packages/frontend/src/components/KybInfoBanner.tsx` — the 20×20 `info` glyph
   (path above) plus the banner and the tooltip per decisions 2 and 4. Props:

   ```tsx
   export interface KybInfoBannerProps {
     children: React.ReactNode;
     tooltip?: string;
   }
   ```

   The wrapper around the hint is `relative` so the tooltip's `absolute bottom-full` anchors to
   it. With no `tooltip` prop the hint renders as a non-interactive `<span aria-hidden="true">`
   glyph (so #1253 can reuse the banner without one). Use a `useId()` for the tooltip id.

6. **State hook — [DONE].** New `packages/frontend/src/components/useOwnersModal.ts`:

   - `useOwnersModal({ open, onSubmit })` returns
     `{ entries, rejected, addFiles, removeFile, isComplete, handleSubmit }`.
   - `entries: { id: number; file: File }[]`, appended in pick/drop order; a module-scope or
     ref-held counter supplies `id` (decision 6).
   - `addFiles(files: File[])` partitions on `isAcceptedFile(file) && file.size <= MAX_FILE_BYTES`
     (imported from step 2's module); accepted files are appended, and `rejected` is set to
     `true` when at least one file was rejected and `false` when every file was accepted
     (decision 7).
   - `removeFile(id)` splices by id and clears `rejected`.
   - `isComplete` is `entries.length > 0` (decision 8). `handleSubmit` no-ops unless
     `isComplete`, then calls `onSubmit?.(entries.map((e) => e.file))`.
   - Reset all state on `open` `false → true`, matching
     `useAuthCredentialsForm`/`useOtpModal`/`useCompanyDocsModal`.

7. **Modal — [DONE].** New `packages/frontend/src/components/OwnersModal.tsx`:

   ```tsx
   export interface OwnersModalProps {
     open: boolean;
     onDismiss: () => void;
     onSubmit?: (files: File[]) => void;
   }
   ```

   Shell props per decision 1. Children:

   ```tsx
   <div data-node-id="6486:81710" className="mt-2 flex w-full flex-col gap-8 pb-16">
     <div className="flex w-full flex-col gap-6">
       <KybInfoBanner tooltip={OWNERS_HINT}>
         Upload ID and proof of address documents for each owner
       </KybInfoBanner>
       <FileDropZone rejected={rejected} onFiles={addFiles} />
       {entries.length > 0 ? (
         <ul role="list" className="flex w-full flex-col gap-6">
           {entries.map((entry) => (
             <UploadedFileRow key={entry.id} file={entry.file} onRemove={() => removeFile(entry.id)} />
           ))}
         </ul>
       ) : null}
     </div>
     <Button variant="primary-dark" disabled={!isComplete} onClick={handleSubmit} className="!w-full !min-w-0 disabled:opacity-[0.32]">Submit</Button>
     <p className="text-center font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]">Back</p>
   </div>
   ```

   The `<ul>` is conditional so an empty list contributes no stray 24px gap. `OWNERS_HINT` is a
   module const holding decision 4's copy verbatim.

8. **`/test` seam — [DONE].** `packages/frontend/src/routes/test.tsx`, `AuthTab`:

   - Add `ownersOpen`/`ownersSubmitted` state and a fifth `Button variant="secondary"` labelled
     `Open Owners step`, rendering
     `<OwnersModal open={ownersOpen} onDismiss={() => setOwnersOpen(false)} onSubmit={() => { setOwnersSubmitted(true); setOwnersOpen(false); }} />`.
   - Add the stand-in line, `data-testid="auth-owners-submitted"`:
     `Owners submitted — the #1253 Account-in-review screen opens here once it exists.`
   - Reword the Company Docs stand-in line (keep `data-testid="auth-company-docs-submitted"`) to
     `Company documents submitted — open the Owners step from the button above.`
   - Update the tab's intro `<p>` to name #1252 alongside #1248/#1249/#1250/#1251.

9. **Docs — [DONE].** Per "Docs to Update" below.

10. **Lint/build gate — [DONE].** `yarn workspace @pipeline/frontend exec tsc --noEmit`, eslint +
    prettier on both touched packages, the full frontend vitest suite, the frontend build, and
    `npx tsx scripts/lint-docs.ts`. `packages/ui` `tsc --noEmit` still fails on BUG-19 (the same
    three `TextField.stories.tsx` errors, re-confirmed unchanged during planning) — not fixed
    here, as directed.

11. **Figma re-verification — [DONE].** Re-fetched `get_screenshot` for `6486-81710` and
    `6486-81783` via curl JSON-RPC against the local Dev Mode MCP (`127.0.0.1:3845/mcp` —
    `initialize` → `notifications/initialized` → `tools/call get_screenshot`, since the MCP tool
    binding itself reported `ConnectionRefused` at session start even though the raw endpoint
    answered). Confirmed against the fresh screenshots: the `Step 2/2` badge top-left, the ×
    close button top-right, no image pane, `Add company owners` with no subtitle, the white
    banner ("Upload ID and proof of address documents for each owner" + hint glyph), the dashed
    drop zone with its three stacked elements (glyph, "Drag and drop your files" +
    "pdf, jpg, png files up to 10MB", "Select files"), the disabled-gray Submit on the default
    frame and the solid-dark Submit with two uploaded rows (`Provide_government.pdf`,
    `Proof_Address.pdf`, both "Uploaded", both with a circular remove glyph) on the enabled
    frame, and the centered `Back` caption. The enabled-frame screenshot also shows the
    `6486:82392` tooltip clipped into its top edge ("…statement as proof of address.") exactly as
    the plan's "Assumptions and Risks" predicted — confirms the node is loose-canvas and not a
    frame child, not a new divergence. No new divergence found beyond what TD-64 through TD-67
    already track. This was a static Figma comparison against the two named nodes, not a live
    `/test?tab=auth` render — the coder role does not drive a browser against the dev server; the
    full live-render pass belongs to the epic's QA agent (Chrome DevTools MCP).

## Test Strategy

New `packages/frontend/src/components/OwnersModal.test.tsx` (jsdom, mirroring
`CompanyDocsModal.test.tsx`'s shape). The file input is hidden, so drive it with
`fireEvent.change(input, { target: { files: [file] } })` and
`new File(["x"], "doc.pdf", { type: "application/pdf" })` — not `userEvent.upload`, which
rejects non-visible targets. Drops use
`fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } })` (jsdom has no
`DataTransfer` constructor).

1. Default state: heading `Add company owners`, **no** description paragraph, the banner copy,
   `Drag and drop your files` + `pdf, jpg, png files up to 10MB`, a `Select files` button, no
   file rows, and `Submit` disabled.
2. Shell composition: no image panel, close button present, no back button, the step badge
   renders `Step 2` and `/2`.
3. Picking one file adds a row whose title is the file's `name` and whose caption is `Uploaded`,
   and **enables** `Submit` (the contrast with #1251, where one file is not enough).
4. Picking two files (one `change` with a two-element `files` list) adds two rows in order.
5. Dropping a file on the zone adds a row — same assertions as 3, via `fireEvent.drop`.
6. Two files with the *same* name both render and remove independently (decision 6's id keying).
7. Removing the only file clears the list and re-disables `Submit`.
8. Rejection — oversize: a `File` whose `size` exceeds `MAX_FILE_BYTES` adds no row, turns the
   zone's subtitle into a `role="alert"` (text unchanged), and leaves `Submit` disabled.
9. Rejection — wrong type: `text/plain` behaves the same; a mixed drop (one valid + one invalid)
   adds the valid row **and** shows the alert; the next all-valid pick clears the alert.
10. Submitting calls `onSubmit` once with a `File[]` in row order.
11. Reopen resets everything: add a file, flip `open` `false` → `true`, assert the empty state
    and a disabled `Submit`.
12. Tooltip: hidden initially; `fireEvent.mouseEnter`/`focus` on the hint button reveals a
    `role="tooltip"` carrying the verbatim copy; `mouseLeave`/`blur` hides it; the hint button
    is `aria-describedby`-linked to it.
13. Image preview: an `image/png` file renders an `<img>` in the row's leading slot while an
    `application/pdf` file keeps the glyph tile (`URL.createObjectURL` is already stubbed in
    `test-setup.ts`).

Extend `packages/frontend/src/routes/-test.test.tsx`: the fifth trigger opens `owners-modal`;
the reworded `auth-company-docs-submitted` copy; the new `auth-owners-submitted` line appears
after a successful submit.

Regression (this is the important half): the full frontend suite must stay green, and
`CompanyDocsModal.test.tsx` in particular is the guard that step 3's `UploadedFileRow`
extraction and step 2's module move are behaviour-preserving. `AuthModalShell.test.tsx` must
pass untouched — this issue changes no shell code.

## Docs to Update

- `docs/frontend/auth-components.md`
  - New `### OwnersModal` section: file paths, the two Figma nodes, composition (no
    `description`, `stepLabel={{ current: 2, total: 2 }}`), the "this is an uploader, not an
    owner form" finding, the banner + tooltip (copy verbatim, node `6486:82392`, and the note
    that it is a loose canvas instance), the drop zone, the multi-file/unbounded/id-keyed state
    model, the Figma → token table above (including the `text-tertairy` decision and the new
    `--radius-pipeline-card-xs`), the validation and rejection rules, the ≥1-file Submit
    threshold, the inert `Back`, the `onSubmit` seam, and accessibility (`<ul role="list">`,
    hidden multi-file input, `role="alert"`, `role="tooltip"` + `aria-describedby`, and the
    deliberate absence of an Escape handler on the tooltip).
  - New `### Shared file validation` note pointing at `kybFileValidation.ts` and
    `UploadedFileRow.tsx`, and update the `### CompanyDocsModal` section where it describes the
    uploaded-row internals so it points at the extracted component instead.
  - Update `### Diagnostics preview seam`: four triggers → five, plus the reworded Company Docs
    line.
- `docs/user-stories/epic-1247/1252-kyb-owners.md` — new, following `1251-kyb-company-docs.md`'s
  shape: preamble naming the `/test?tab=auth` entry and the presentational-only scope, a "tech
  debt to be aware of" note covering TD-64 through TD-67 (and TD-63, which applies here too, for
  the PDF thumbnail) so QA does not file them as bugs, then stories for the default state,
  picking files, dropping files, the tooltip, partial/complete Submit enabling, submitting,
  removing, oversize/wrong-type rejection, and reopen-resets.
- `docs/user-stories/index.md` — add the `#1252` row to the Epic #1247 table (`Initial`).
- `docs/user-stories/epic-1247/1251-kyb-company-docs.md` — Story 5's expected outcome quotes the
  Company Docs stand-in copy verbatim; update that one line to the reworded text from step 8.
- `docs/exec-plans/tech-debt-tracker.md` — next free number is **TD-64** (TD-63 is the last
  entry):
  - **TD-64**: the Owners drop-zone subtitle binds to Figma's misspelled, non-namespaced
    `text-tertairy` (`#7d7d7d`); shipped as `--color-pipeline-ink-muted`. Ask design to rebind
    it to `content-test/secondary`.
  - **TD-65**: the Owners banner hint tooltip (`6486:82392`) is a loose canvas instance with no
    specified trigger, offset, or arrow; shipped as hover/focus, 8px above, no arrow, and with
    no Escape handler (the shell owns Escape).
  - **TD-66**: `Submit` enables at ≥1 file because the design provides no owner count, no
    per-owner grouping, and no required-document list for this step.
  - **TD-67**: the Owners drop zone's drag-over and rejection states have no Figma treatment;
    both reuse existing tokens on existing copy (border `ink-subtle` → `ink`; subtitle recolored
    to `negative-strong` with `role="alert"`) — the same resolution shape as TD-62.
- `packages/ui/src/styles/theme.css` — provenance comment on the new radius token (step 1). No
  `ui-components.md` change: no `@pipeline/ui` component is added or modified (`Button`'s
  existing `size="m"` already matches the `Select files` box exactly).
