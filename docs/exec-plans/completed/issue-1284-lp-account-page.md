# Issue #1284: LP: Account page — wallet, corporate email, KYB documents hub

Source: https://github.com/eq-lab/pipeline/issues/1284

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247) (V1.0 scope).
Branch: `feat/1284-lp-account-page` (draft PR #1290), cut from `main` with #1286 (Owners retired),
#1287 (Forgot Password), #1289 (create-account validation error) and the 2026-09-21 header
normalization already merged.

## Scope

A **new LP route `/account`** — the V1.0 surface that owns wallet connection, the account's
corporate email, and the KYB documents hub. Per the epic's 2026-09-21 flow-semantics comment this
page is the **resume surface** for dismissible onboarding: a returning unverified LP lands here to
continue, instead of being pushed back into a linear wizard. The home page's `View` / `View Status`
CTAs point here (a prototype wire from home frame `6702-104071` confirms it).

**Presentational only.** No network calls, no persistence, no auth. Every side-effecting action is
a named, no-op-by-default seam for the wiring issues.

### In scope

1. `packages/frontend/src/routes/account.tsx` — the route, its dev-only guard, and the `?state=`
   preview search param.
2. `packages/frontend/src/components/account/**` — page shell, wallet card, corporate-email card,
   documents card with its six designed states plus one stand-in.
3. `packages/frontend/src/wallet/useActiveWalletAccount.ts` — the active-namespace wallet
   derivation, extracted so #1282's header rewrite can adopt it.
4. `packages/frontend/src/components/kybDocumentRequirements.ts` — the requirements list, placed
   flat so #1278's modal redesign can import it.
5. Dev preview/QA seam: `?state=<id>` deep links, surfaced from `/test?tab=auth`.
6. Spec `docs/frontend/account-page.md` (new, linked from `docs/frontend/index.md`).
7. User stories `docs/user-stories/epic-1247/1284-lp-account-page.md` (+ index row).
8. Tests for every new module, plus existing suites as untouched-reuse regression guards.

### Out of scope

| Concern | Owner |
| --- | --- |
| Uploading file bytes anywhere | #1267 (backend file-upload transport) |
| Reading documents back (resume, statuses) | #1273 (backend GET documents) |
| Wiring register / documents / `kyb_status` / link-address | #1254 |
| Wiring sign-in / create-account / OTP / Log Out to real auth | #1265 |
| Header auth buttons, the account icon, the home card states | #1282 |
| The redesigned onboarding-time Company Docs **modal** (`6701-96852` / `6701-96881`) | #1278 |
| Add Funds wire-transfer modal | #1283 |
| Reconciling the flat upload with the backend's typed `(doc_type, subject)` model | #1267 (classify-at-review, per the epic's 2026-09-21 decision) |

`TopBar.tsx`, `MobileNavMenu.tsx`, `ConnectModalProvider`, `CompanyDocsModal.tsx` and
`useCompanyDocsModal.ts` are **not modified**. Touching `TopBar` would collide head-on with #1282.

## Figma reference

File `A43rjYYjSwdTmiwwf5cx5n`, URL form
`https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=<node>&m=dev`. Read via the
local Dev Mode MCP at `http://127.0.0.1:3845/mcp` (no auth; over curl JSON-RPC when the session's
`figma` tools are unavailable — `initialize`, capture the `mcp-session-id` header,
`notifications/initialized`, then `tools/call`). **`get_design_context` hangs on first call; retry
it** — recorded in `auth-components.md#signinmodal`.

A planning-time pass over all seven nodes already ran; its findings are folded into this plan. The
coder still re-reads each frame before building it, because exact geometry, exported SVG paths and
token bindings must be confirmed at the node, never estimated.

### The six Account-panel frames

All six are Account-page-only frames (no dashboard content), 1728 wide, background
`bg/primary #f8f7f6`, page padding 128, one centered `Content` column **max-width 480**, section
gap **32**, plus the fixed 80px header.

| # | Node | Figma name | Wallet card | Documents card |
| --- | --- | --- | --- | --- |
| 1 | `6701-98099` | No Connected Wallet | **disconnected** | 7 rows, all Verified. No banner, no upload row, no Save |
| 2 | `6701-98137` | No Verified Account | connected | warning banner + upload row + requirements + **disabled** Save. No file rows |
| 3 | `6701-98175` | No Verified Account — Documents Uploaded | connected | warning banner + upload row + requirements + 6 "Uploaded" rows + **enabled** Save |
| 4 | `6701-98022` | Missing document | connected | negative banner with an inline **Upload** button + 6 Verified rows. No upload row, no Save |
| 5 | `6701-97982` | Error Verification | connected | negative banner (no button) + 1 **Invalid document** row + 6 Verified rows. No upload row, no Save |
| 6 | `6701-98061` | Verified Account | connected | 7 Verified rows. No banner, no upload row, no Save |

`6702-104071` is **not an Account page** — despite sharing the name "Error Verification" it is the
**home dashboard** in the neighbouring frame column (x = 10015 vs the Account column's 13747),
carrying the failure card "We can't verify your account" / "Please check and try again." / dark
**View** button. Its only relevance here is the prototype wire from that `View` button into the
Account page. It belongs to #1282, not this issue — say so in the spec so the next reader does not
re-chase it.

### Verbatim copy (the frames are the source of truth; never paraphrase)

Page chrome: `Account` · `Ethereum` · `Stellar` · `Connect Wallet` · `Wallet` · `USDC balance` ·
`Corporate email` · `Email` · `Documents` · `Log Out`.

Banners: `Verify your account` · `Upload your company documents to unlock bank transfers.` ·
`{Document name}` + ` required` (a two-span composite; the name is the variable part) ·
`Please upload the document.` · `Re-upload your document` ·
`Some information may be missing or incorrect`.

Upload area: `Upload documents` · `pdf, jpg, png files up to 10MB` · `Upload` · `Save`.

Requirements list — lead line `Requirement documents:`, then a disc `<ul>` of six items, the last
of which owns a nested lower-alpha `<ol>` of two:

```
Certificate of Incorporation
Registry of Legal Entities
Certificate of Good Standing
Legal Address
Shareholder Register
Personal KYC for each shareholder / UBO:
    a. Government-issued ID.
    b. Proof of Address (bill, bank or credit card statements)
```

The first five are **exactly** the labels already in `COMPANY_DOCUMENT_SLOTS`
(`useCompanyDocsModal.ts`) — reuse that constant rather than retyping the strings (rule 3).

Per-file captions and actions: `Verified` · `Uploaded` · `Invalid document` · `Re-upload`.

**Do not ship the frames' placeholder filenames.** `bill.pdf.pdf`, `provide_government.pdf.pdf`,
`dfvfv.pdf` and the trailing `" · "` on `certificate_of_good_standing.pdf` are scratch data in the
design file, not copy. Preview fixtures use clean, boring names.

### Token mapping (verify each at the node; most already exist)

| Figma | Value | Repo token |
| --- | --- | --- |
| `bg/primary` | `#f8f7f6` | `--color-pipeline-paper` |
| `bg/secondary`, `fill-test/on-primary` | `#ffffff` | `--color-pipeline-surface` |
| `fill-test/primary` (circles, tab track) | `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` |
| `fill/warning-secondary` (verify banner) | `rgba(211,235,117,0.16)` | see note below |
| `fill/negative-secondary` (error banners) | `rgba(178,0,0,0.16)` | `--color-pipeline-negative-secondary` |
| `border-test/secondary` | `rgba(56,55,53,0.18)` | `--color-pipeline-line` |
| `content-test/primary` | `#262524` | `--color-pipeline-ink` |
| `content-test/secondary` | `rgba(56,55,53,0.6)` | `--color-pipeline-ink-muted` |
| `content-test/primary-on-invert` | `#ffffff` | `--color-pipeline-on-dark` |
| `content-test/positive` ("Verified") | `#208000` | `--color-pipeline-positive-strong` |
| `content-test/negative` ("Invalid document") | `#b20000` | `--color-pipeline-negative-strong` |
| `radius/radius-s` | 4 | `--radius-pipeline-card` |
| `radius/radius-xl` (tab track) | 6 | `--radius-pipeline-card-sm` |
| `radius/radius-full` (72px circles) | 240 | `--radius-pipeline-pill` |
| Heading "Account" | Besley 28 / 36 | `--text-pipeline-heading-m` |
| Body / row title | 16 / 22 | `--text-pipeline-body` |
| Caption | 12 / 16 | `--text-pipeline-caption` |
| Requirements list | 14 / 18 | `--text-pipeline-body-s` |

Two notes the coder must resolve at the node rather than assume:

- **The "verify" banner fill.** `rgba(211,235,117,0.16)` is precisely the value
  `--color-pipeline-promo: #f8fce9` documents itself as ("solid equivalent of
  `rgb(211 235 117 / 0.16)` on white"), and the banner sits on a white card — so `promo` should
  composite identically. Prefer it. Only if it does not match the screenshot, add
  `--color-pipeline-warning-secondary` named after the Figma variable, and log the divergence the
  way TD-59 / TD-68 did. The Issue calls this banner "green"; it is the pale olive promo tint, not
  a positive-green. Record that in the spec so QA does not file it as a colour defect.
- **Leading 40×40 tiles.** `get_design_context` emits `#262524` for these, but #1251 established
  that Figma's codegen is **stale for exactly this element** — the rendered fill is the navy tint
  now shipped as `--color-pipeline-brand-secondary`. Sample `get_screenshot` before choosing. If
  it renders navy-tinted, `UploadedFileRow`'s existing tile is already correct and no new tone is
  needed.

### What can and cannot be reused (checked against the frames — this corrects the Issue body)

| Piece | Verdict |
| --- | --- |
| `kybFileValidation.ts` | **Reuse verbatim.** `{pdf, jpeg, png}` + 10 MB is exactly the frame's rule. |
| `UploadedFileRow.tsx` | **Reuse verbatim** for staged rows. The frame's uploaded row is 40×40 leading element, title 16/22 ink, caption `Uploaded` 12/16 muted, trailing 32×32 cross-circle remove — which is what this component already renders. Figma mocks the leading element as a rendered PDF thumbnail; the glyph-tile substitute is already tracked as **TD-63**, no new debt. |
| `SegmentedTabs` (`@pipeline/ui`, `variant="track"`) | **Reuse.** Its documented anatomy — 2px-padded `--color-pipeline-fill-muted` track at radius 6, equal-width 32px tabs at radius 4, caption-emphasized 12/16 — matches the frame's wallet tabs exactly. |
| `COMPANY_DOCUMENT_SLOTS` | **Reuse** for the first five requirements-list entries. |
| `FileDropZone.tsx` | **Does not fit. Do not use it.** There is no dashed drop zone anywhere in V1.0. The "flat upload area" the Issue describes is a plain `list-item` row — tile, `Upload documents`, the helper caption, and a bordered secondary `Upload` button. |
| `KybInfoBanner.tsx` | **Does not fit. Do not use it.** It is a neutral white surface with centred single-line text and a tooltip; the frames need a tinted, bordered, 72px two-line banner with a 32px status icon and an optional trailing button. Extending it into that shape would be a rewrite, not a variant. |

Consequence: `FileDropZone` and `KybInfoBanner`, retained by #1279 on the expectation that this
issue would consume them, end V1.0 with **no consumer**. Do not delete them here (#1278 may still
want a drop zone in the redesigned modal) — record the finding in `auth-components.md` and log
tech debt so the decision is made once, deliberately.

## Assumptions and Risks

### Decisions taken (with their precedent), not open questions

1. **Route path `/account`.** File-based routing: adding `src/routes/account.tsx` regenerates
   `src/routeTree.gen.ts` on the next `vite dev` / `vite build`. That file is committed and must
   never be hand-edited (`docs/FRONTEND.md` → Application structure).

2. **The route is dev-only guarded, exactly like `/test`.** `beforeLoad` throws
   `redirect({ to: "/" })` when `ENV.IS_DEV` is false. Precedent: #1259/#1260 restricted `/test`
   this way, and `auth-components.md` records as a standing epic rule that **no sub-issue in #1247
   changes a production entry point**. The frames confirm the entry point is the header's account
   icon, which **#1282 owns** — so #1282 removes this guard in the same change that adds the link,
   and the page never ships reachable-but-unwired. Logged as tech debt so the removal is not
   forgotten. It also makes `?state=` inherently dev-only: one guard, not two.

3. **No new wallet system.** The `Ethereum` / `Stellar` tabs are a *view* switch over the existing
   `useWalletView()` (`kind: "evm" | "stellar"`, persisted at `pipeline.wallet.view.kind`) — the
   same state `AccountDropdown`'s segmented control drives. Selecting a namespace never
   disconnects the other. `Connect Wallet` calls the shared `useConnectModal().open()` picker
   (which routes through the first-connection terms gate), exactly as TopBar, the home promo card
   and the deposit/stake banners do — **not** a namespace-specific `connect()`.

4. **`Save` is a pure seam and does not fake a state transition.** `onSave?: (files: File[]) =>
   void`, default no-op, enabled iff at least one file is staged. Clicking it does **not** move the
   page to "under review". That transition is a server round-trip (#1267 upload + #1273 read-back);
   synthesising it client-side is exactly the fabricated-state antipattern the project bans (show
   only backend-served values; render `—` for what is missing). "Under review" is reachable in this
   issue only through the dev `?state=` override.

5. **Staged documents live in React state as `File` objects for the lifetime of the mounted page**
   and are discarded on unmount — the contract `CompanyDocsModal` already documents.

6. **The Account panel has no designed "under review" state; ship a stand-in.** Confirmed across
   all six frames. The state exists only on the **home** dashboard (`6701-98417`: "Veryfying
   account…" / "We are reviewing your documents." / "View Status"), and that card's CTA navigates
   *into* this page — so a returning LP under review does land here and must see something. Build
   it from designed parts only: the warning banner chrome from `6701-98137`, title `Verifying
   account`, caption `We are reviewing your documents.` (verbatim from the home card), the
   submitted files listed with the `Uploaded` caption and **no** remove control, and no upload row
   and no Save. Precedent: #1250 / #1280's approved stand-in pattern for an undesigned state, plus
   #1248's treatment of a design-file typo as an artifact (the home card's "Veryfying" is a
   misspelling; do not ship it). Log tech debt and name the designer ask.

7. **"Verify your account" is the banner title in both upload states.** `6701-98175` renders
   "Verify your **identity**" where `6701-98137` renders "Verify your **account**", with an
   identical caption and identical styling, and nothing about the user's situation changes between
   them. Treated as a design-file inconsistency (the #1248 artifact precedent); the Issue body
   itself quotes "Verify your account". Log it for the designer.

8. **The verified rows' trailing chevron is decorative.** `.drill-in` chevron-right appears on
   every Verified row, but no document-detail frame exists anywhere in V1.0. Render it
   `aria-hidden`, not as a button — #1248's precedent for an affordance with no destination frame
   and no sub-issue. Log tech debt.

9. **Where a frame contradicts a shipped component, the frame wins for this page and the
   divergence is recorded** rather than silently retrofitted into the shipped component — the
   `CompanyDocsModal` surface stays byte-identical and its tests remain the guard.

### Risks

- **Icon sourcing is the largest volume of work.** Needed at exact Figma-exported paths: 36×36
  user glyph and 36×36 wallet glyph (the 72px circles), 32×32 shield-check and 32×32
  warning-triangle (banners), 20×20 envelope (email tile), 22×22 copy (wallet row), 24×24
  chevron-right, and the 16×16 check / cross inside the 20×20 file badge. Reuse an existing glyph
  **only** when its Figma node is the same one — `AccountInReviewModal`'s `ShieldCheckIcon` and
  `UploadedFileRow`'s `FileUploadIcon` / `CrossCircleIcon` are exact exports and are strong
  candidates; `AccountDropdown`'s `WalletGlyph` and `CopyGlyph` are **hand-authored** and must not
  be copied onto a Figma-specified surface.
- The wallet row's leading tile shows a **MetaMask** mark in the frame. Connector-specific
  branding is not derivable presentationally; ship the generic wallet glyph and record the
  divergence.
- `truncateAddress` yields `0x7a3f…9f3f` (one ellipsis character); the frame shows
  `0x8493...3b92` (three periods). Use the repo helper — do not add a second truncator — and note
  the glyph divergence.
- **Backend mismatch is real but not this issue's to solve.** The flat, filename-based upload
  carries no `doc_type`/`subject`, while `kyb_documents` still has
  `UNIQUE (lp_id, doc_type, COALESCE(subject,''))` over a seven-value `doc_type` CHECK
  (`packages/shared/migrations/20260915000001_kyb_lps_and_documents.sql`). The epic resolved this
  as classify-at-review inside #1267. This plan only requires the presentational types be **named
  after the backend vocabulary** so #1254 drops in: `kyb_status` ∈
  `NotStarted | InProgress | UnderReview | Passed | Failed`, document `status` ∈
  `NotProvided | Provided | Verified | Rejected`.
- **Overlap with #1278.** The redesigned Company Docs *modal* uses the same flat-upload model, so
  the requirements list goes in `src/components/kybDocumentRequirements.ts` — flat, beside
  `kybFileValidation.ts` — not inside `components/account/`.
- **No mobile frames.** V1.0 Account frames are desktop-only; the 480px column already behaves as
  a mobile-friendly single column. Cap at `max-w-[480px]`, reduce the 128px page padding below
  `md`, and log tech debt.
- **Pre-existing, do not chase:** BUG-19 (`packages/ui` `tsc --noEmit` on `TextField.stories.tsx`)
  and BUG-20 (unreachable submit-attempt validation path) — `docs/exec-plans/known-bugs.md`.

## Open Questions

_None_

Every decision was resolvable from a recorded precedent: the epic's 2026-09-17
no-production-entry-point decision, its 2026-09-21 flow-semantics and
raw-upload/classify-at-review decisions, #1259/#1260's dev-only route guard, #1250/#1280's
approved stand-in pattern for an undesigned state, #1248's design-file-artifact handling, #1251's
stale-codegen warning, and `docs/FRONTEND.md`'s code-structure rules. Three items are decided here
but are genuine **designer asks** the manager may want to surface to the user — none blocks
implementation, and all three are logged as tech debt: the missing Account-panel "under review"
state (decision 6), the "Verify your account" / "Verify your identity" inconsistency (decision 7),
and the dead-end chevron on Verified rows (decision 8).

## Implementation Steps

**Status: all six steps implemented (2026-09-21).** See the coder's report on the Issue for
deviations (banner-icon color mapping resolved from `get_screenshot`, the exact node ids carried
into `data-node-id`, and tech debt numbered TD-74 through TD-82 due to a pre-existing duplicate
TD-73 in the tracker).

### 1. Re-read the frames before building each section — done

Work frame by frame in the order of the table above, pulling `get_metadata`,
`get_variable_defs`, `get_design_context` and `get_screenshot` per node. Confirm geometry and
exported SVG paths at the node; resolve the two token questions flagged above against the
screenshot, not the codegen.

### 2. `useActiveWalletAccount` — the wallet derivation, extracted — done

New `packages/frontend/src/wallet/useActiveWalletAccount.ts`, exported from
`packages/frontend/src/wallet/index.ts`. Returns
`{ kind, setKind, isConnected, address, truncatedAddress, formattedBalance, connect }`:

- `kind` / `setKind` from `useWalletView()`.
- `isConnected` / `address` from `useEvmWallet()` or `useStellarWallet()` per `kind`.
- `truncatedAddress` from the existing `@/utils/truncateAddress`.
- `formattedBalance` — USDC for the active namespace:
  `useEvmToken({ token: useDepositManagerAddresses().usdc ?? ZERO_ADDRESS }).formattedBalance`
  for EVM, `useStellarToken().formattedBalance` for Stellar. Call every hook unconditionally
  (rules of hooks) and branch only in the derivation — the shape `TopBar.tsx` already uses.
- `connect` — `useConnectModal().open`.

This is deliberately the derivation `TopBar.tsx` performs inline. **Leave `TopBar.tsx` untouched**;
#1282 rewrites the header and should adopt this hook there. Catalogue the hook in
`docs/frontend/hooks.md` (rule 5) with a unit test.

### 3. Presentational state model — done

New `packages/frontend/src/components/account/accountPageState.ts` — pure data and pure functions,
no React, unit-tested.

```ts
export type AccountDocumentsState =
  | "verify"        // 6701-98137 — warning banner, upload row, requirements, Save disabled
  | "staged"        // 6701-98175 — as above plus staged rows, Save enabled
  | "under-review"  // no frame — stand-in per decision 6
  | "missing"       // 6701-98022 — negative banner with inline Upload
  | "invalid"       // 6701-97982 — negative banner, per-file Re-upload
  | "verified";     // 6701-98061 — no banner, all rows Verified
```

Backend-shaped record types so #1254 is a drop-in, not a rewrite:

```ts
export type KybStatus = "NotStarted" | "InProgress" | "UnderReview" | "Passed" | "Failed";
export type KybDocumentStatus = "NotProvided" | "Provided" | "Verified" | "Rejected";
export interface AccountDocumentRecord { name: string; status: KybDocumentStatus }
```

Also here:

- `deriveDocumentsState({ kybStatus, documents, stagedCount })` — the pure mapping, with an
  explicit precedence: `Passed` → `verified`; any `Rejected` → `invalid`; a required document
  `NotProvided` after a review → `missing`; `UnderReview` → `under-review`; `stagedCount > 0` →
  `staged`; otherwise `verify`. #1254 feeds it real data.
- `ACCOUNT_STATE_PREVIEWS` — one `{ kybStatus, documents, missingDocumentName? }` fixture per
  state, with clean filenames (not the design file's scratch names).
- `parseAccountStatePreview(raw: unknown): AccountDocumentsState | undefined` — the search-param
  validator.

New `packages/frontend/src/components/kybDocumentRequirements.ts` — the requirements-list data:
the lead line, the six top-level items (the first five imported from `COMPANY_DOCUMENT_SLOTS`,
the sixth the "Personal KYC for each shareholder / UBO:" heading), and the two nested items.
Flat placement, beside `kybFileValidation.ts`, so #1278 can import it. There is **no doc-type or
subject selector anywhere in this UI** — the epic's 2026-09-21 decision puts classification in the
trustee's review screen; the list is informational text only.

### 4. Components — done

All under `packages/frontend/src/components/account/`, one component per file, view separated from
logic per `docs/FRONTEND.md` rules 1–2 — the layout `components/dashboard/` already uses.

- `useAccountDocuments.ts` — staged-file state. Mirrors `useCompanyDocsModal.ts` but for a **flat
  list**, not five fixed slots: `files: File[]`, `rejected: boolean`, `addFiles(files: File[])`
  (validating each via `isAcceptedFile` + `MAX_FILE_BYTES`), `removeFile(index)`, `canSave`,
  `handleSave()`. A rejection recolors the upload row's existing helper caption to
  `--color-pipeline-negative-strong` with `role="alert"` — no new copy, no new layout (the #1251
  precedent, TD-62).
- `AccountIconTile.tsx` — the repeated 40×40 radius-4 tile with a 20×20 glyph slot (wallet row,
  email row, upload row). Three consumers ⇒ extract (rule 3). Its fill is the tile-tone question
  from the token section.
- `AccountListRow.tsx` — the wallet/email row shape: leading slot, **caption above, title below**
  (note this is the inverse of `UploadedFileRow`, which puts the title first), optional trailing
  slot. Two consumers ⇒ extract.
- `AccountWalletCard.tsx` — `SegmentedTabs variant="track"` with
  `[{ id: "evm", label: "Ethereum" }, { id: "stellar", label: "Stellar" }]` bound to
  `useActiveWalletAccount().kind` / `setKind`, then either the connected pair of `AccountListRow`s
  (`Wallet` + truncated address + copy button; `USDC balance` + `CoinIcon token="usdc"` + the
  formatted balance) or the disconnected block (72px `--color-pipeline-fill-muted` circle with the
  wallet glyph, then a full-width 48px `Button variant="primary-dark"` labelled `Connect Wallet`).
  A missing balance renders `—`, never a computed or placeholder number.
- `AccountEmailCard.tsx` — the `Corporate email` section label plus one `AccountListRow`
  (envelope tile, caption `Email`, the address). `email?: string` renders `—` when absent. The
  frames show **no** edit control; do not add one.
- `AccountStatusBanner.tsx` — `tone: "warning" | "negative"`, a 32px icon (optionally inside a
  `--color-pipeline-fill-muted` tile — `6701-98022` has the tile, `6701-97982` does not), title
  (which may be the two-span `{name}` + ` required` composite), caption, and an optional trailing
  action. 72px tall, padding 16, gap 12, radius 4, 1px `--color-pipeline-line` border.
- `AccountUploadRow.tsx` — the flat upload area: `AccountIconTile` with the file-upload glyph,
  title `Upload documents`, caption `pdf, jpg, png files up to 10MB`, and a trailing
  `Button variant="secondary" size="compact"` labelled `Upload` with a
  `border-[color:var(--color-pipeline-line)]` override (the `DocumentUploadRow` precedent), driven
  by a visually hidden `<input type="file" multiple accept="application/pdf,image/jpeg,image/png">`.
- `AccountRequirementsList.tsx` — the disc `<ul>` with its nested lower-alpha `<ol>`, at
  `--text-pipeline-body-s` in `--color-pipeline-ink-muted`.
- `AccountDocumentRow.tsx` — a **submitted** document row: leading thumbnail-substitute with the
  20×20 badge overlay (green check when `Verified`, red cross when `Rejected`, no badge otherwise),
  the filename, the status caption in its tone, and the trailing control that discriminates the
  state — decorative chevron when `Verified`, a `Re-upload` text button in
  `--color-pipeline-ink-muted` when `Rejected`. Staged rows keep using `UploadedFileRow` verbatim
  (it takes a `File`, which a server record has not got).
- `AccountDocumentsCard.tsx` — the state machine's view. Per-state composition follows the table in
  the Figma section exactly, including the padding that flips with the state: `py 16 / px 8, gap 16`
  for the two upload states, `pt 16 / pb 8 / px 8, gap 8` for the banner-over-list states, and
  `p 8, gap 8` for the list-only states. `Save` is a full-width 48px
  `Button variant="primary-dark"` with `disabled:opacity-[0.32]` (the `CompanyDocsModal` Continue
  precedent).
- `AccountPage.tsx` — shell only: 72px circle with the user glyph, the centred Besley 28/36
  `Account` heading, then the wallet, email and documents cards and the full-width white
  `Log Out` button, in a `max-w-[480px]` column at gap 32.

**Comment rule (hard).** Each new file gets at most ONE bare single-line
`// spec: docs/frontend/account-page.md#<anchor>` pointer as its first line. Nothing else — no
section banner comments, no field or function JSDoc, no body comments, no test comments. Figma
node ids, constraints and rationale go in the spec doc. Carry node ids into the DOM as
`data-node-id` attributes where the repo already does (`TopBar.tsx`, `CompanyDocsModal.tsx`) —
that is data, not commentary.

### 5. Route and the dev preview seam — done

`packages/frontend/src/routes/account.tsx` — thin: the route definition plus a component that
reads the search param and renders `<AccountPage />`.

```ts
beforeLoad: () => { if (!ENV.IS_DEV) throw redirect({ to: "/" }); },
validateSearch: (raw) => ({ state: parseAccountStatePreview(raw.state) }),
```

Copy the guard shape from `routes/test.tsx` exactly. Do not hand-edit `src/routeTree.gen.ts`; it
regenerates on the next `vite dev` / `vite build` — commit the regenerated file.

`state` selects an `ACCOUNT_STATE_PREVIEWS` fixture. With no `state` param the page renders the
honest default: the real wallet state from `useActiveWalletAccount`, `—` for the corporate email,
and the `verify` documents state (nothing is readable until #1273).

Preview links go in the existing `/test?tab=auth` block (`routes/test.tsx` → `AuthTab`) — one short
paragraph and one link per state. **Do not add a new `/test` tab**: the auth tab is this epic's
established discovery surface and the page itself is the preview surface. Leave the six existing
modal triggers and their stand-in confirmation lines untouched.

### 6. Tech debt — done (TD-74 through TD-82; renumbered from TD-73 due to a pre-existing duplicate)

Append to `docs/exec-plans/tech-debt-tracker.md`, continuing from TD-73:

- `/account`'s dev-only guard — **#1282 removes it** when it links the header account icon.
- `Save` is a pure no-op seam; no client-side transition to "under review". Needs #1267 + #1273,
  wired by #1254.
- **Designer ask:** the Account panel has no "under review" frame; shipped as a stand-in built
  from `6701-98137`'s banner chrome and `6701-98417`'s copy (decision 6).
- **Designer ask:** `6701-98137` says "Verify your account", `6701-98175` says "Verify your
  identity", with no other difference (decision 7).
- **Designer ask:** Verified rows carry a `.drill-in` chevron with no destination frame; shipped
  decorative (decision 8).
- `FileDropZone.tsx` and `KybInfoBanner.tsx` end V1.0 with no consumer — #1278 decides whether the
  redesigned modal wants them or they are deleted.
- The flat, filename-based upload versus `kyb_documents`'
  `UNIQUE (lp_id, doc_type, COALESCE(subject,''))` over a seven-value `doc_type` CHECK; #1267's
  classify-at-review must land before #1254 can wire Save.
- `useActiveWalletAccount` duplicates `TopBar`'s inline derivation; #1282 should adopt it.
- Wallet-namespace labels now diverge three ways: `ConnectWalletModal` says "EVM"/"Soroban",
  `AccountDropdown` says "EVM"/"Stellar", this page says "Ethereum"/"Stellar". One designer
  decision, not three local guesses.
- The wallet row's MetaMask mark is not derivable presentationally; a generic wallet glyph ships.
- No mobile frames for the Account page.

Do not fix BUG-19 or BUG-20.

## Test Strategy

Runner: `yarn workspace @pipeline/frontend test` (`TZ=UTC vitest run`). Tests are co-located; under
`src/routes/` they must be `-`-prefixed so TanStack's generator ignores them.

1. **`src/routes/-account-route-dev-only.test.tsx`** — a direct copy of
   `-test-route-dev-only.test.tsx`'s shape (`vi.hoisted` plus a mocked `@/lib/env` whose `IS_DEV`
   is a getter; invoke `Route.options.beforeLoad` and inspect the thrown redirect): redirects to
   `/` in production builds, does not redirect under the dev server.
2. **`accountPageState.test.ts`** — `deriveDocumentsState` over every branch **including the
   precedence order** (`Passed` before `Rejected` before `NotProvided` before `UnderReview` before
   staged), and `parseAccountStatePreview` accepting each valid id and rejecting `undefined`, `""`,
   an unknown string and a non-string.
3. **`useAccountDocuments.test.ts`** — accepts pdf/jpeg/png; rejects a wrong MIME type, an
   oversized file, and an extension-only file whose `type` is empty (the `inferTypeFromName`
   path); a mixed batch stages the good files and still raises the rejection flag; `removeFile`
   removes the right index; `canSave` flips on the first accepted file and back off when the last
   is removed; the rejection flag clears on the next accepted file.
4. **`AccountDocumentsCard.test.tsx`** — one case per `AccountDocumentsState` asserting, by exact
   string, which banner renders and with which tone; whether the upload row, requirements list and
   Save are present at all; Save's disabled/enabled state; and which trailing control each file row
   carries (remove button / decorative chevron / `Re-upload` button). This is the test that pins
   the state machine — the per-state presence table in the Figma section is its oracle.
5. **`AccountWalletCard.test.tsx`** — mock `@/wallet` in the style of `-transactions.test.tsx`:
   connected EVM renders the truncated address and the USDC balance; disconnected renders the
   72px circle and `Connect Wallet`, and clicking it calls `useConnectModal().open`; selecting the
   `Stellar` tab calls `setKind` and **never** calls `disconnect`; a missing balance renders `—`.
6. **`AccountEmailCard.test.tsx`** — the address renders when supplied and `—` when not; no edit
   control exists.
7. **`AccountPage.test.tsx`** — `Log Out` is present, focusable, and clicking it with no handler
   does not throw (the inert-seam contract).
8. **`useActiveWalletAccount.test.tsx`** — both namespaces, connected and disconnected; `connect`
   routes to the shared connect modal.
9. **`src/routes/-account.test.tsx`** — integration: render the route component for a couple of
   `?state=` fixtures and assert the four sections compose in the frame's order; assert clicking
   `Save` with staged files calls the seam **and leaves the rendered state unchanged** (decision 4
   — this is the test that pins "no fabricated transition").
10. **Regression guards, unchanged and expected to stay green:** `CompanyDocsModal.test.tsx`
    (proves the shared-file-row surface was not disturbed), `-test.test.tsx` (the auth-tab edits
    must not break the sign-in ↔ forgot-password swap invariant it asserts), and
    `AccountDropdown.test.tsx` / `TopBar.test.tsx` (proves the wallet-view extraction left the
    header alone).

Edge cases worth an explicit assertion: dropping a mixed accepted/rejected batch; removing the
only staged file; a filename long enough to truncate; and an `image/*` staged file, which makes
`UploadedFileRow` call `URL.createObjectURL` (guarded, but the jsdom path should be exercised).

Gates before handing back: `yarn workspace @pipeline/frontend test`, `yarn workspace
@pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`, and
`npx tsx scripts/lint-docs.ts`. If `packages/ui` is touched for a new token, run its `lint` too —
its `tsc --noEmit` is red for a pre-existing reason (BUG-19), which is not a regression.

Manual/visual verification (the Figma-driven step the planner skill requires): run the LP dev
server and compare `http://localhost:5173/account?state=<id>` against its frame, token by token,
at the frame's 480px content width, for all six designed states.

## Docs to Update

- **New:** `docs/frontend/account-page.md` — the area spec: route and dev-only guard, page
  composition, the wallet card's relationship to `useWalletView`, the documents state machine and
  its mapping onto `kyb_status` / document `status`, the per-state presence table, verbatim copy,
  the Figma → token mapping table, what each seam does and who wires it, the `?state=` preview
  contract, the reuse verdicts (including why `FileDropZone` and `KybInfoBanner` are **not** used),
  the note that `6702-104071` is a home frame belonging to #1282, plus out-of-scope and
  accessibility sections. A **new doc rather than a section in `auth-components.md`**: that doc's
  own scope line is "LP-facing email+password authentication **modals**" and this is a route;
  `dashboard-components.md` is already 1580 lines; and this surface keeps growing through #1254,
  #1265, #1273 and #1282. Write it in the style of `auth-components.md#signinmodal`.
- `docs/frontend/index.md` — add the new doc under "Area specs". **Required**: `lint-docs` rule 2
  errors on any `docs/**.md` unreachable from `AGENTS.md`. (The >150/>200-line size limit is
  `docs/product-specs/`-only, so length is not a constraint here.)
- `docs/frontend/auth-components.md` — two edits. `### OwnersModal` currently predicts that #1284
  will consume `KybInfoBanner` and `FileDropZone`; correct it to record that the V1.0 Account
  frames use a tinted two-line banner and a plain upload row, so both remain consumerless and
  #1278 owns the decision. `### Diagnostics preview seam` gains the Account-page preview links.
- `docs/frontend/hooks.md` — a row for `useActiveWalletAccount` (rule 5), alphabetically placed.
- `docs/user-stories/epic-1247/1284-lp-account-page.md` — **new**, committed in the same PR
  (`ISSUE_PROTOCOL` §6). Model it on `epic-1247/1281-create-account-error.md`: a header naming the
  epic, the issue and the spec; a note that the page is presentational and reachable only at
  `/account?state=…` under the dev server; then one story per designed state, the staging flow
  (pick files → rows appear → Save enables → remove the last → Save disables), the rejected-file
  path, the Save-is-inert story, the wallet connected/disconnected branches, and the namespace tab
  switch. Styling-only assertions stay out — visual fidelity is the QA agent's Figma comparison.
- `docs/user-stories/index.md` — a row in the "Epic #1247 — KYB login flow" table.
- `docs/exec-plans/tech-debt-tracker.md` — the entries listed in Step 6.
- No `docs/product-specs/` change: this is a presentational frontend surface with no new product
  behavior — the behavior it will eventually have belongs to #1254/#1265/#1267/#1273.

Do **not** commit and do **not** touch the Issue's labels — the manager owns both.
