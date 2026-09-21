# Account page

The LP `/account` route for epic #1247 (V1.0, issue #1284) — wallet connection, the account's
corporate email, and the KYB documents hub. Per the epic's 2026-09-21 flow-semantics decision this
page is the **resume surface** for dismissible onboarding: a returning unverified LP lands here to
continue instead of being pushed back into a linear wizard. A new area doc rather than a section
in `auth-components.md` (whose own scope is "LP-facing email+password authentication **modals**",
not a route) or `dashboard-components.md` (already 1580+ lines) — this surface keeps growing
through #1254, #1265, #1267, #1273 and #1282.

**Presentational only.** No network calls, no persistence, no auth. Every side-effecting action is
a named, no-op-by-default seam — see [Seams and who wires them](#seams-and-who-wires-them).

`6702-104071` ("Error Verification" in the home-frame column) is **not** part of this page —
despite sharing a name with one of the Account frames it is the **home dashboard**'s failure card
("We can't verify your account"), whose `View` button is the prototype wire into this page. It
belongs to #1282, not this issue.

## Route and dev-only guard

`packages/frontend/src/routes/account.tsx`. `beforeLoad` throws `redirect({ to: "/" })` when
`ENV.IS_DEV` is false — the same shape as `routes/test.tsx` (#1259/#1260). The epic's standing
rule is that **no sub-issue in #1247 changes a production entry point**; the frames confirm the
real entry point is the header's account icon, which #1282 owns, so #1282 removes this guard in
the same change that wires the icon (tracked as tech debt, `docs/exec-plans/tech-debt-tracker.md`).
This also makes `?state=` inherently dev-only — one guard, not two.

## Page composition

`AccountPage.tsx` (shell) → `AccountWalletCard.tsx`, `AccountEmailCard.tsx`,
`AccountDocumentsCard.tsx`, and a full-width `Log Out` button, in a `max-w-[480px]` centered
column at `gap-8` (32px), below the fixed header. A 72×72 `--color-pipeline-fill-muted` circle with
a user glyph sits above the centered Besley 28/36 `Account` heading.

The page container itself carries **uniform 128px padding on all four sides** (`p-4 md:p-32`,
matching the Figma frame's `p-[128px]` — confirmed at the node, not just the horizontal half the
component previously implemented) below `md`, dropping to 16px per [No mobile
frames](#no-mobile-frames). `Log Out` is `Button variant="secondary"` with a `!bg-[color:var(--color-pipeline-surface)]`
override — the `!` is required: `secondary`'s own `bg-transparent` and an unprefixed override are
the same Tailwind specificity, so the surface fill is not guaranteed to win without it (the
established precedent is `AccountInReviewModal.tsx`'s `!bg-[...]` override of the same variant).

The page root itself carries `min-h-screen bg-[color:var(--color-pipeline-paper)]
text-[color:var(--color-pipeline-ink)]` — the frame's own root fill (`bg/primary`, `#f8f7f6`) and
the same convention every other route (`dashboard.tsx`, `deposit.tsx`, `stake.tsx`,
`transactions.tsx`, `index.tsx`, `test.tsx`) already applies to its page root; a prior pass left
this off `AccountPage.tsx`, so the page rendered on the default (white) canvas instead of the
paper tone (issue #1291, no `?state=` fixture exercises the root div's own background so this
was invisible to state-scoped snapshots).

## Wallet card

`AccountWalletCard.tsx` is a *view switch* over the existing `useWalletView()` (`kind: "evm" |
"stellar"`, persisted at `pipeline.wallet.view.kind`) — the same state `AccountDropdown`'s
segmented control drives. It does **not** own a second wallet system. `packages/frontend/src/wallet/useActiveWalletAccount.ts`
is the extracted derivation (see [Hooks](./hooks.md)): `kind`/`setKind` from `useWalletView()`,
`isConnected`/`address` from `useEvmWallet()`/`useStellarWallet()` per `kind` (all hooks called
unconditionally, branched only in the derivation — the shape `TopBar.tsx` already used inline),
`truncatedAddress` via `@/utils/truncateAddress`, `formattedBalance` from `useEvmToken`/
`useStellarToken`, and `connect` = `useConnectModal().open` (routes through the shared
first-connection terms gate, same as `TopBar`, the home promo card, and the deposit/stake
banners). Selecting a namespace tab is a *view* switch only — it never disconnects the other
namespace. `TopBar.tsx` itself is untouched by this issue; #1282 should adopt the extracted hook
when it rewrites the header (tech debt).

`SegmentedTabs` (`@pipeline/ui`, `variant="track"`) renders the `Ethereum`/`Stellar` tabs —
its documented anatomy (2px-padded `--color-pipeline-fill-muted` track at radius 6, equal-width
32px tabs at radius 4) already matches the frame. Connected state shows two rows (`Wallet` +
truncated address + copy button; `USDC balance` + `CoinIcon token="usdc" size="lg"` + formatted
balance); disconnected shows a 72px `--color-pipeline-fill-muted` circle with a generic wallet
glyph and a full-width 48px `Button variant="primary-dark"` labelled `Connect Wallet`. A missing
balance renders `—`, never a computed or placeholder number.

**The wallet row's leading icon in the frame is a literal MetaMask fox logo** (`get_design_context`
emits it as an `imgMetamask` asset on node `I6701:98146;8905:4082`) — scratch/placeholder art from
whoever mocked the frame, the same category of design-file artifact as the "Verify your
identity"/"Verify your account" inconsistency below. This row renders for **either** namespace tab
(`Ethereum` or `Stellar`), so a brand-locked browser-extension logo would be product-wrong; the
generic ink-colored `WalletGlyph` (`AccountWalletCard.tsx`) is intentional and unchanged. Logged as
a designer ask, not a defect.

**The wallet card's copy button and the upload row's `Upload` button each sit inside an invisible
40×40 touch-target wrapper, not flush against the row's own padding** — confirmed via
`get_metadata` at `6701:98146` (`ButtonCont` node `I6701:98146;8902:3635`: `x=416 w=40 h=40`,
containing the 32×32 visible control at a 4px inset) and `6701:98157` (`ButtonCont` node
`I6701:98157;8902:3622`: `x=373 w=83 h=40`, containing the 75×32 `Upload` button at the same 4px
inset). Both rows are `p-[8px]` with a `gap-[12px]` between content and this wrapper — matching the
existing `AccountListRow`/`AccountUploadRow` padding — but a prior pass placed the compact control
directly in that gap with no wrapper, landing it 4px closer to the card edge than the frame. Fixed
by wrapping each control in a `p-1` (4px) container (`size-10` for the copy button, matching its
`size-8` control; unsized for the `Upload` button, whose own `size="compact"` height already
matches the wrapper's content height) — issue #1292.

`packages/frontend/src/components/account/accountPageState.ts` — pure data and pure functions, no
React.

```ts
export type AccountDocumentsState =
  | "verify" | "staged" | "under-review" | "missing" | "invalid" | "verified";

export type KybStatus = "NotStarted" | "InProgress" | "UnderReview" | "Passed" | "Failed";
export type KybDocumentStatus = "NotProvided" | "Provided" | "Verified" | "Rejected";
export interface AccountDocumentRecord { name: string; status: KybDocumentStatus }
```

These names mirror the backend vocabulary so #1254 is a drop-in: `deriveDocumentsState({
kybStatus, documents, stagedCount })` maps a `(KybStatus, AccountDocumentRecord[], stagedCount)`
triple onto one `AccountDocumentsState`, with an explicit precedence — `Passed` → `verified`; any
`Rejected` → `invalid`; a `NotProvided` document → `missing`; `UnderReview` → `under-review`;
`stagedCount > 0` → `staged`; otherwise `verify`. #1254 feeds it real data; today `AccountPage`
calls it with `kybStatus: "NotStarted"`, `documents: []`, `stagedCount` from the live staging hook
— the honest default is always `verify` until a backend exists.

There is **no doc-type or subject selector anywhere in this UI** — the epic's 2026-09-21 decision
puts classification in the trustee's review screen (#1267); this page's requirements list
(`kybDocumentRequirements.ts`) is informational text only.

### Per-state presence table

| State | Figma node | Banner | Upload row | Requirements | File rows | Save |
| --- | --- | --- | --- | --- | --- | --- |
| `verify` | `6701-98137` | warning, "Verify your account" | yes | yes | none | disabled |
| `staged` | `6701-98175` | warning, "Verify your identity" | yes | yes | staged (`UploadedFileRow`, removable) | enabled |
| `under-review` | *(no frame — stand-in)* | warning, "Verifying account" | no | no | submitted (`Provided`, "Uploaded" caption, no remove) | absent |
| `missing` | `6701-98022` | negative + tile, "{name} required" | no | no | Verified only (the missing one is in the banner) | absent |
| `invalid` | `6701-97982` | negative, no tile, "Re-upload your document" | no | no | 1 Rejected ("Invalid document" + Re-upload) + Verified | absent |
| `verified` | `6701-98061` | none | no | no | all Verified (decorative chevron) | absent |

Container padding flips with the state (`AccountDocumentsCard.tsx`): `py-4 px-2 gap-4` for the two
upload states (`verify`/`staged` — confirmed uniform top/bottom at the node; a prior pass had this
as asymmetric `pt-4 pb-2`, which was wrong), `pt-4 pb-2 px-2 gap-2` for the banner-over-list states
(`missing`/`invalid`, and the `under-review` stand-in), `p-2 gap-2` for the list-only `verified`
state.

The `<ul>` of `AccountDocumentRow`s (`under-review`/`missing`/`invalid`/`verified`) itself carries
`gap-2` (8px) — confirmed at `6701-98099` (verified frame): each row's own `p-2` plus this 8px gap
reproduces the frame's ~24px dead space between consecutive rows. A prior pass left the `<ul>`
without a gap, which under-spaced rows to 16px (issue #1291).

### The "under review" stand-in (no designed frame)

Confirmed across all six Account frames — there is no designed "under review" state on this panel.
It exists only on the **home** dashboard (`6701-98417`: "Veryfying account…" / "We are reviewing
your documents." / `View Status`), and that card's CTA navigates *into* this page, so a returning
LP under review does land here and must see something. The stand-in is built from designed parts
only: the warning banner chrome from `6701-98137`, title `Verifying account`, caption `We are
reviewing your documents.` (verbatim from the home card, correcting its "Veryfying" typo per the
#1248 design-file-artifact precedent), the submitted files with the `Uploaded` caption and no
remove control, no upload row, no Save. Logged as a designer ask (tech debt).

## Verbatim copy

Page chrome: `Account` · `Ethereum` · `Stellar` · `Connect Wallet` · `Wallet` · `USDC balance` ·
`Corporate email` · `Email` · `Documents` · `Log Out`.

Banners: `Verify your account` · `Verify your identity` (staged state only — a design-file
inconsistency, see below) · `Verifying account` (stand-in) · `Upload your company documents to
unlock bank transfers.` · `{Document name}` + ` required` (two-span composite) · `Please upload
the document.` · `Re-upload your document` · `Some information may be missing or incorrect`.

Upload area: `Upload documents` · `pdf, jpg, png files up to 10MB` · `Upload` · `Save`.

Requirements list — lead line `Requirement documents:`, then a disc list of six items, the last
owning a nested lower-alpha list of two:

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

The first five are exactly `COMPANY_DOCUMENT_SLOTS` (`useCompanyDocsModal.ts`), imported rather
than retyped. Per-file captions: `Verified` · `Uploaded` · `Invalid document` · `Re-upload`.

**`6701-98137` says "Verify your account"; `6701-98175` says "Verify your identity"**, with an
identical caption and identical styling — nothing about the user's situation changes between the
two frames. Treated as a design-file inconsistency (the #1248 artifact precedent) and shipped
verbatim per-frame; logged as a designer ask.

**Preview fixtures never ship the frames' placeholder filenames** (`bill.pdf.pdf`,
`provide_government.pdf.pdf`, `dfvfv.pdf`, the trailing `" · "` on
`certificate_of_good_standing.pdf`) — those are scratch data in the design file. Clean names are
used instead (e.g. `certificate-of-incorporation.pdf`).

## Figma → token mapping

| Figma | Value | Repo token |
| --- | --- | --- |
| `bg/primary` | `#f8f7f6` | `--color-pipeline-paper` |
| `bg/secondary`, `fill-test/on-primary` | `#ffffff` | `--color-pipeline-surface` |
| `fill-test/primary` (circles, tab track) | `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` |
| `fill/warning-secondary` (verify banner) | `rgba(211,235,117,0.16)` | `--color-pipeline-promo` |
| `fill/negative-secondary` (error banners) | `rgba(178,0,0,0.16)` | `--color-pipeline-negative-secondary` |
| leading-tile fill (wallet/email/upload) | sampled screenshot, pale navy tint | `--color-pipeline-brand-secondary` |
| `border-test/secondary` | `rgba(56,55,53,0.18)` | `--color-pipeline-line` |
| `content-test/primary` | `#262524` | `--color-pipeline-ink` |
| `content-test/secondary` | `rgba(56,55,53,0.6)` | `--color-pipeline-ink-muted` |
| `content-test/positive` ("Verified") | `#208000` | `--color-pipeline-positive-strong` |
| `content-test/negative` ("Invalid document") | `#b20000` | `--color-pipeline-negative-strong` |
| `radius/radius-s` | 4 | `--radius-pipeline-card` |
| `radius/radius-xl` (tab track) | 6 | `--radius-pipeline-card-sm` |
| `radius/radius-full` (72px circles) | 240 | `--radius-pipeline-pill` |
| Heading "Account" | Besley 28/36 | `--text-pipeline-heading-m` |
| Body / row title | 16/22 | `--text-pipeline-body` |
| Caption | 12/16 | `--text-pipeline-caption` |
| Requirements list | 14/18 | `--text-pipeline-body-s` |

**The verify banner fill is the pale olive `promo` tint, not a positive-green** — the Issue body
calls it "green"; `--color-pipeline-promo` (`#f8fce9`, itself documented as "solid equivalent of
`rgb(211 235 117 / 0.16)` on white") matches exactly, since the banner sits on a white card. QA
should not file this as a colour defect.

**The flat upload row's trailing `Upload` button (`AccountUploadRow.tsx`) carries a
`border border-[color:var(--color-pipeline-line)]` override on `Button variant="secondary"
size="compact"`** — confirmed at both `6701:98157` (verify) and `6701:98195` (staged); a prior pass
shipped it borderless. This is the same override `DocumentUploadRow.tsx` already uses for its own
`Upload` button. The banner's own inline `Upload` action (the `missing` state,
`AccountStatusBanner`'s `action` prop) has **no** border — confirmed at `6701:98040` — so that one
stays as `Button variant="secondary" size="compact"` with no extra className.

**The 40×40 leading tiles (wallet row, email row, upload row) render a pale navy tint, not
`#262524`** — confirmed by sampling `get_screenshot` at the node: `get_design_context`'s codegen
is stale here (same class as #1251's `content-test/primary` finding), literally emitting
`bg-[var(--fill-test/primary,#262524)]` for all three tiles, but only the email tile's *icon*
(hardcoded SVG fill `black`) reads as dark; the tile background itself is the same
`--color-pipeline-brand-secondary` pale tint `UploadedFileRow` already ships (TD-63). `AccountIconTile`
uses that fill uniformly; only the icon's own color varies — ink for envelope/wallet, solid
`--color-pipeline-brand` navy for the upload glyph (`AccountUploadRow.tsx`'s `FileUploadIcon`,
`currentColor`). The upload icon is a second stale-codegen spot (issue #1292): the raw exported
`file-upload` SVG asset hardcodes `fill="#8FB3A4"` (sage green) with no `currentColor`, but
`get_variable_defs` on this frame resolves a bound `content-test/brand: #000080` variable — exactly
`--color-pipeline-brand` — and the screenshot shows a solid navy icon, not sage; the asset's baked
fill is stale, not the target.

## Reuse verdicts

| Piece | Verdict |
| --- | --- |
| `kybFileValidation.ts` (`isAcceptedFile`, `MAX_FILE_BYTES`) | **Reused verbatim.** `{pdf, jpeg, png}` + 10 MB is exactly the frame's rule. |
| `UploadedFileRow.tsx` | **Reused verbatim** for staged rows — 40×40 leading tile, title/caption order, 32×32 cross-circle remove is exactly what the frame shows. The leading element is a glyph tile rather than a rendered PDF thumbnail (TD-63, pre-existing, not new debt here). |
| `SegmentedTabs` (`@pipeline/ui`, `variant="track"`) | **Reused** — anatomy matches the frame's wallet tabs exactly. |
| `COMPANY_DOCUMENT_SLOTS` | **Reused** for the first five requirements-list entries. |
| `FileDropZone.tsx` | **Not used.** There is no dashed drop zone anywhere in V1.0; the "flat upload area" is a plain list-item row (tile + text + bordered secondary `Upload` button), which `AccountUploadRow.tsx` implements directly. Retains no consumer after this issue — #1278 decides its fate. |
| `KybInfoBanner.tsx` | **Not used.** It is a neutral white surface with centred single-line text and a tooltip; the frames need a tinted, bordered, 72px two-line banner with a 32px status icon and an optional trailing button (`AccountStatusBanner.tsx`) — a rewrite, not a variant. Retains no consumer after this issue. |

## Seams and who wires them

| Seam | Default | Wired by |
| --- | --- | --- |
| `AccountWalletCard`'s `Connect Wallet` | opens the shared connect modal (real behavior, not a stub) | already wired — no follow-up |
| `AccountDocumentsCard.onAddFiles` / staged `removeFile` | stages/unstages `File` objects in local component state only | already wired (client-only); #1267 adds the upload transport |
| `AccountDocumentsCard.onSave` (`useAccountDocuments().handleSave`) | calls `onSave?.(files)`, default no-op — **does not transition `AccountDocumentsState`** | #1267 (upload) + #1273 (read-back), composed by #1254 |
| `AccountDocumentsCard.onUploadMissingDocument` | no-op | #1254/#1267 |
| `AccountDocumentsCard.onReuploadDocument` | no-op | #1254/#1267 |
| `AccountPage.onLogOut` | no-op | #1265 |
| Reading `kyb_status` / documents / corporate email | always the honest default (`NotStarted`, `[]`, `—`) | #1254 (register/documents/link-address wiring) |

**Save is a pure seam and never fakes a state transition.** Clicking it does not move the page to
`under-review` — that transition is a server round-trip (upload + read-back), and synthesizing it
client-side is exactly the fabricated-state antipattern the project bans (show only backend-served
values; render `—` for what is missing). `under-review` is reachable in this issue only through the
dev `?state=` override.

## `?state=` preview contract

`routes/account.tsx`'s `validateSearch` parses `state` via `parseAccountStatePreview`, which
accepts only the six `AccountDocumentsState` ids and returns `undefined` for anything else
(missing, empty, unknown, or non-string). When set, it **overrides** `deriveDocumentsState`'s
output and feeds `AccountDocumentsCard` from `ACCOUNT_STATE_PREVIEWS[state]` (a `{ kybStatus,
documents, missingDocumentName? }` fixture with clean filenames); for `state=staged` specifically,
`createPreviewStagedFiles()` also seeds `useAccountDocuments`'s local staging state with a handful
of empty-content `File` objects so the real removable-row / enabled-Save behavior renders exactly
as it would live. With no `state` param the page renders the honest default described above. Since
the guard makes the whole route dev-only, `?state=` is inherently dev-only too — one guard, not
two.

Preview links live in the existing `/test?tab=auth` block (`routes/test.tsx` → `AuthTab`) — one
link per state, alongside the six existing modal triggers. See [Diagnostics preview
seam](./auth-components.md#diagnostics-preview-seam).

## Out of scope

| Concern | Owner |
| --- | --- |
| Uploading file bytes anywhere | #1267 |
| Reading documents back (resume, statuses) | #1273 |
| Wiring register / documents / `kyb_status` / link-address | #1254 |
| Wiring sign-in / create-account / OTP / Log Out to real auth | #1265 |
| Header auth buttons, the account icon, the home card states | #1282 |
| The redesigned onboarding-time Company Docs modal | #1278 |
| Add Funds wire-transfer modal | #1283 |
| Reconciling the flat upload with the backend's typed `(doc_type, subject)` model | #1267 (classify-at-review) |

`TopBar.tsx`, `MobileNavMenu.tsx`, `ConnectModalProvider`, `CompanyDocsModal.tsx` and
`useCompanyDocsModal.ts` are not modified by this issue.

## Accessibility

The verified-row trailing chevron is `aria-hidden` (decorative, not a button) — no document-detail
frame exists anywhere in V1.0, so it has no destination (tech debt, designer ask). The upload
row's file input is visually hidden (`sr-only`) but reachable via its trailing `Upload` button. The
status banner uses `role="status"`. `Log Out` and `Connect Wallet` are real `<button>` elements,
focusable and clickable with no throw even with no handler wired (the inert-seam contract).

## No mobile frames

V1.0 Account frames are desktop-only; the 480px column already behaves as a mobile-friendly single
column. Page padding drops from 128px to 16px below `md`. Logged as tech debt.
