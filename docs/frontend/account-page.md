# Account page

The LP `/account` route for epic #1247 (V1.0, issue #1284) — wallet connection, the account's
corporate email, and the KYB documents hub. Per the epic's 2026-09-21 flow-semantics decision this
page is the **resume surface** for dismissible onboarding: a returning unverified LP lands here to
continue instead of being pushed back into a linear wizard. A new area doc rather than a section
in `auth-components.md` (whose own scope is "LP-facing email+password authentication **modals**",
not a route) or `dashboard-components.md` (already 1580+ lines) — this surface keeps growing
through #1254, #1265, #1267 and #1282.

The page reads and edits the LP profile and documents through the LP API. The original six visual
fixtures remain development-only previews.

## Production LP data contract (#1373)

The authenticated page reads `GET /v1/lps/me` before displaying profile or document state. It
distinguishes loading, 404 (a new LP), and request error; an error offers retry and never becomes
an empty LP. For a missing LP, the page shows the profile and document controls without an
additional account-setup description (#1401). `AccountEmailCard` displays `contact_email` from a returned LP, or the authenticated
session email on 404. A legacy session without email cannot create an LP until the user signs in
again. The wallet card, logout button, and centered 480px column remain. UnderReview and Passed
use the document status banner without an additional generic freeze paragraph (#1408); Failed
retains its distinct verification-declined message. Edit restrictions still follow the server.

A new profile card sits above the document card and uses the shared `TextField` for labelled Name
(`legal_name`) and Country (`country`). Both fields have a visible one-pixel
`--color-pipeline-line` border while unfocused (#1399); the existing focus border and disabled
behavior remain. A targeted child selector styles the shared TextField control, so it does not
add a second border to the outer wrapper or change other TextField consumers. The form preloads returned values, requires a nonblank Name,
and sends the complete profile, including the stored `contact_email` and unchanged country, in
JSON to `POST /v1/lps/me`. Profile-only edits save without another file. Draft text survives a
same-LP document upload, deletion, or refetch; a successful profile save refreshes its baseline.
The API's `writable` flag disables profile and document writes for `UnderReview` and `Passed`.

The document card displays all persisted `original_filename` values and Provided/Verified/Rejected
statuses from the LP response after reload. Writable LPs can stage more files and upload them by
multipart `POST /v1/lps/me/documents`. A new LP is created from a valid profile before its first
upload. The returned per-file results are matched by request order, so duplicate filenames do
not confuse partial success; confirmed successes leave the retry batch, failures stay staged with
their reasons. A persisted row uses its server id for `DELETE /v1/lps/me/documents/{doc}` and
stays visible until deletion succeeds. Verified files cannot be removed. A Rejected file on a
writable LP offers deletion followed by replacement upload. After all staged uploads succeed, the page calls `POST /v1/lps/me/submit` and adopts its returned
LP state. Partial or uncertain uploads never submit. Submit for review is also available for
eligible persisted documents with no staged files, rejected documents, or unresolved writes.
Name/Country drafts must be saved first; profile-only Save never submits. Failed submission
retains uploaded files for submit-only retry. Unknown submission requires Check submission
status; a read showing UnderReview or a newer verdict adopts that state without another POST.

The existing `missing` preview contains a synthetic `NotProvided` row and a named required file;
the API supplies neither field. That content remains a development fixture, never production
data. All `?state=` fixtures stay dev-only and do not fetch or mutate LP data.

`6702-104071` ("Error Verification" in the home-frame column) is the **home dashboard**'s failure
card, not an Account frame — despite sharing a name with `6701-97982` below it is
`AddUsdCard variant="declined"` ("We can’t verify your account", #1426,
`docs/frontend/bank-transfers.md#addusdcard`), whose `View` button navigates into this page. A
`ChangesRequested` LP lands on the `invalid` state below; a `Failed` LP lands on the
`under-review` stand-in's declined banner (see "The under review stand-in" below) — in practice
unreachable while a `Failed` verdict suspends the account (tech debt), and since #1465 the LP is
signed out before `/account` renders at all (see "The declined stand-in" below).

## Route gate

`packages/frontend/src/routes/account.tsx`. The access gate lives in the `AccountRoute` component,
not `beforeLoad` (issue #1458) — wallet connection is not synchronously readable at `beforeLoad`
time: EVM reconnects through wagmi after mount, and Stellar hydrates asynchronously via
`StellarWalletsKit.getAddress()` in a mount effect (`wallet/stellar/useStellarWallet.ts`). A
`beforeLoad` check would bounce a connected visitor who hard-refreshes `/account`. Instead,
`blocked = !ENV.IS_DEV && !isAuthenticated && !isAnyConnected` (`useAuthSession` + the
`useWalletPresence()` hook, see [Hooks](./hooks.md)) is computed on every render; the component
renders nothing (`return null`) while `blocked`, and a `useEffect` navigates to `/` (`replace:
true`) **only once `useWalletPresence().isSettled` is also true** — so there is no flash and no
bounce while reconnection is still in flight. An authenticated LP, or a visitor with any wallet
namespace connected, reaches `/account` in any environment; a visitor with neither is redirected to
`/` outside the dev server once wallet state has settled. On a dev deployment the gate never
blocks, same as before.

Access and the `?state=` preview override are not the same guard: an authenticated or
wallet-connected production user can reach the route without `ENV.IS_DEV`, so `validateSearch`
gates `state` behind `ENV.IS_DEV` explicitly (`parseAccountStatePreview` only runs when
`ENV.IS_DEV`) — otherwise a real LP could append `?state=verified` in production and see fixture
data instead of their own documents.

`onLogOut` (passed down from the route) ends everything the visitor is identified by (#1553): an
authenticated LP's session is cleared with `signOut()`, **and** every connected wallet namespace is
disconnected with `useWalletPresence().disconnectAll()` — for a wallet-only visitor only the latter
applies. Either way it navigates to `/`, so the header reverts to Sign In / Sign Up and the home
page shows the zero state. The forced session-end path (expiry, `401`, suspension — see
`auth-components.md#session-module`) is different: it keeps wallets connected.

## Page composition

`AccountPage.tsx` (shell) → `AccountWalletCard.tsx`, `AccountEmailCard.tsx`,
`AccountProfileCard.tsx`, `AccountDocumentsCard.tsx`, and a full-width `Log Out` button, in a `max-w-[480px]` centered
column at `gap-8` (32px), below the fixed header. A 72×72 `--color-pipeline-fill-muted` circle with
a user glyph sits above the centered Besley 28/36 `Account` heading.

The page container uses the sibling LP routes' padding rhythm (`px-4 py-8 md:px-8 md:py-16`) —
`dashboard.tsx` / `index.tsx` style — **a deliberate deviation from the Figma frame's `p-[128px]`**
(#1309, user direction 2026-09-22): the 128px page padding the earlier fidelity pass adopted read
as too much wasted space in the real app. The content is a centered `max-w-[480px]` column, so
horizontal padding beyond the gutter is moot; the QA Figma comparison should expect this reduced
padding, not the frame value. `Log Out` is `Button variant="secondary"` with a `!bg-[color:var(--color-pipeline-surface)]`
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

## Wallet-only variant (#1458)

Design added a visitor state: a wallet is connected (EVM or Stellar) but there is no auth session.
**The wallet is display-only, not a credential** — connecting it only lets the visitor see it on
this page; nothing links the address to an account. Renders when `useAuthSession().isAuthenticated`
is `false` and the route gate has already admitted the visitor (i.e. a wallet is connected — see
[Route gate](#route-gate)); `AccountPage` branches on `isAuthenticated` alone (not on wallet state
again), since the gate already guarantees one of the two. In that branch `AccountPageContent`
renders with `walletOnly` and **does not call `useAccountPage()`**, so there is no
`GET /v1/lps/me` request for a visitor with no session.

The wallet card shows the single connected wallet ([Wallet card](#wallet-card), #1512).

Composition (frame `6701:98137`, "No Verified Account"): the heading, `AccountWalletCard` (its
connected state — [Wallet card](#wallet-card)), `Corporate email` with an `Add email` row, the
Documents card in its `verify` composition (`{ kybStatus: "NotStarted", documents: [], stagedCount:
0 }` derives to `verify` via `deriveDocumentsState`), and a full-width `Log Out`. **No profile
card** — node `6701:98148` is hidden in the frame, and the card is already gated on a present
`account` object, which is `undefined` here.

`Add email` (`AccountEmailCard`, row `7129:15860`): when `email` is falsy and an `onAddEmail`
handler is supplied, the row renders as a real `<button>` with title `Add email` instead of the
read-only `—` row. `walletOnly` wires `onAddEmail={openAddEmail}`, `openAddEmail` coming from
`useAuthFlow()` (see
[`auth-components.md#authflowprovider`](./auth-components.md#authflowprovider)) — clicking it opens
`AddEmailModal` (#1459), the normal create-account registration (email + password → OTP → session)
with its own chrome; see
[`auth-components.md#addemailmodal`](./auth-components.md#addemailmodal). The authenticated path
never passes `onAddEmail`, so its read-only row is unchanged.

`Upload` (`AccountUploadRow`, via `AccountDocumentsCard`'s `onUploadIntercept`): document writes
need a session (`POST /v1/lps/me/documents`), so in the wallet-only variant `Upload` calls
`openAddEmail()` instead of opening the hidden file input — the input is not even rendered in that
case. `Save` needs no interception: `canSave` is `false` in this variant (nothing can be staged),
so the frame's disabled `Save` renders as-is; `Submit for review` does not render at all
(`AccountDocumentsCard` gates it on `production && documents.length > 0`, and `production` is
`false` here).

`Log Out` disconnects every connected namespace (`useWalletPresence().disconnectAll()`, not just
the connected wallet) and navigates to `/` — so the header reverts to Sign In / Sign Up. Since
#1553 the signed-in variant does the same on top of `signOut()` — a connected wallet no longer
survives a log out (the `Disconnect` row still exists for dropping the wallet while staying signed
in).

No new `?state=` fixture: the variant is fully reachable for real (connect a wallet, no session),
so it is exercised live rather than through a dev-only preview — per the project's no-mocks rule,
nothing about this variant is faked.

## Wallet card

**Single connected wallet (#1512).** The LP holds at most one wallet connection at a time, and the
card has no `Ethereum`/`Stellar` tabs. It reverses the #444 "both namespaces stay live" decision
and removes #1475's entry-tab selection (the route no longer chooses a tab). `useWalletView().kind`
is derived — `evm` when the EVM wallet is connected, else `stellar` when the Stellar wallet is
connected, else the deployment default (`evm`) — so there is no `setKind` and no persisted
`pipeline.wallet.view.kind`. Rules and the legacy both-connected cleanup live in
[`wallet-flows.md#single-connected-wallet`](./wallet-flows.md#single-connected-wallet).

| Card state | Renders |
|---|---|
| Wallet connected (`6701:98142`) | the chain block (below), then the connected block: icon tile, `Wallet` row, `USDC balance` row, divider, `Disconnect` |
| No wallet connected (`6701:98104`) | the full-width `Connect Wallet` CTA |

**Chain block (`6701:98144`, #1512 follow-up).** The track area where the `Ethereum`/`Stellar`
tabs used to sit is kept, with the same size and style as the former `SegmentedTabs variant="track"`
(`px-2` wrapper, full-width `p-0.5` `rounded-[6px]` `--color-pipeline-fill-muted` track, one
`h-8` `--color-pipeline-surface` pill, caption/medium ink text) but it is a static label, not tabs:
a 16px chain logo (`ChainLogo`, inline SVG in `AccountWalletCard.tsx`; `data-testid="account-wallet-chain-logo"`,
`data-chain`) followed by the chain name (`data-testid="account-wallet-provider-name"`), derived purely
from `useActiveWalletAccount().kind`: `Ethereum` for `evm`, `Stellar` for `stellar` (never the wallet
app's name). The Ethereum logo is the two-tone diamond; the Stellar logo is the official circular mark
(circle with two diagonal bars, no wordmark) redrawn as `currentColor` paths so it takes the ink token.
It renders only while a wallet is connected; the disconnected state is unchanged (no block). No
`tablist` role.

The card keeps its outer classes and both state blocks unchanged (sizes, paddings, node ids). `AccountWalletCard.tsx` does
**not** own a second wallet system: `packages/frontend/src/wallet/useActiveWalletAccount.ts` is the
extracted derivation (see [Hooks](./hooks.md)): `kind` from `useWalletView()`,
`isConnected`/`address` from `useEvmWallet()`/`useStellarWallet()` per `kind` (all hooks called
unconditionally, branched only in the derivation), `truncatedAddress` via
`@/utils/truncateAddress`, `formattedBalance` from `useEvmToken`/`useStellarToken`, `connect` =
`useConnectModal().open` (routes through the shared first-connection terms gate; a no-op while any
wallet is connected), and `disconnect` (issue #1458) = the connected wallet's own `disconnect()`.
To switch chains the LP disconnects and connects the other wallet through the connect modal, which
keeps its EVM / Soroban tabs for that choice.

**`Disconnect` row (issue #1458, closes TD-111).** Every connected state of the card renders a
24px divider (`7127:15564`, a centered 1px `--color-pipeline-line` rule) followed by a full-width
`Disconnect` row (`7127:15570`) after the `Wallet`/`USDC balance` rows — confirmed on every
connected Account frame (`6701:97942`, `6701:97982`, `6701:98022`, `6701:98137`, `6701:98061`,
each with its own divider id). It is a plain `<button>`, not an `AccountListRow` (that primitive
requires `leading`/`caption`) — body-typography text only, no leading tile, no trailing control.
Clicking it calls `useActiveWalletAccount().disconnect` for the connected wallet (not
`disconnectAll`) — with no session left, the header's account icon reverts to Sign In / Sign Up
and the home route falls back to the zero state. This ships for signed-in LPs too, since the row
lives in the card's shared connected branch — there was previously no UI anywhere to disconnect a
wallet (TD-111). The connected-rows container's gap is `gap-0`, not `gap-2` — `get_metadata` on
`6701:98145` places the two rows and the divider+Disconnect block with **no** inter-row gap (`y=0`
h56, `y=56` h56, `y=112` h24, `y=136` h40, total 176px); a prior pass had `gap-2` (8px too much),
corrected in the same pass that added the new rows to this exact container.

`TopBar.tsx` was untouched by #1284 at the time; #1362 later removed all wallet balance/pill UI
from the header entirely, and #1458 added back a presence-only read (`useWalletPresence()`, no
balance, no token reads) for the header icon rule — see
[`dashboard-components.md#topbar`](./dashboard-components.md#topbar).

The frame's `Ethereum`/`Stellar` tabs row (`6701:98144`) is built as the static chain block above (#1512), not as tabs. Connected state shows two
rows (`Wallet` +
truncated address + copy button; `USDC balance` + `CoinIcon token="usdc" size="lg"` + formatted
balance); disconnected shows a 72px `--color-pipeline-fill-muted` circle with a generic wallet
glyph and a full-width 48px `Button variant="primary-dark"` labelled `Connect Wallet`. A missing
balance renders `—`, never a computed or placeholder number.

**The wallet row's leading icon in the frame is a literal MetaMask fox logo** (`get_design_context`
emits it as an `imgMetamask` asset on node `I6701:98146;8905:4082`) — scratch/placeholder art from
whoever mocked the frame, the same category of design-file artifact as the "Verify your
identity"/"Verify your account" inconsistency below. This row renders for **either** chain's wallet, so a brand-locked browser-extension logo would be product-wrong; the
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

**The staged uploaded-file rows (`6701:98198`–`6701:98203`) carry the same 40×40 touch-target
convention on their remove control, plus their own `p-[8px]` row padding** — confirmed via
`get_metadata` at `6701:98197` (six `list-item` children, each `464×56`, `y` stepping by 60px —
i.e. a 4px gap between 56px-tall rows) and at `6701:98198` (leading tile at `x=8 y=8` 40×40,
`ButtonCont` at `x=416 y=8` 40×40 containing a 32×32 control at a 4px inset — identical geometry to
the `CompanyDocsModal` uploaded frame's own remove button, confirmed at `6486:81826`). `56 = 40
(icon) + 2×8 (row padding)`; the `4px` gap between rows plus each row's own `8px` top/bottom padding
reproduces the frame's 20px dead space between consecutive rows.

`UploadedFileRow.tsx` (shared with `CompanyDocsModal`, #1278) now always wraps its
remove `<button>` in a `flex size-10 shrink-0 items-center justify-center p-1` touch target — safe
for both consumers since `CompanyDocsModal`'s own frame confirms the identical 40×40/4px-inset
geometry, and the row's overall height was already governed by its 40×40 leading tile (removing the
now-redundant `h-10` on the `<li>` changes nothing rendered). The row's own `p-[8px]` padding is
**not** shared — `CompanyDocsModal`'s frame uses a plain `h-[40px]` row with the modal's `<ul
gap-3>` doing the spacing, a genuinely different spec — so `UploadedFileRow` gained an additive
`className` prop instead, and `AccountDocumentsCard`'s staged-rows `<ul>` passes `className="p-2"`
as a local override; the `<ul>`'s own `gap-1` (4px) is unchanged and already matched the frame.

`packages/frontend/src/components/account/accountPageState.ts` — pure data and pure functions, no
React.

```ts
export type AccountDocumentsState =
  | "verify" | "staged" | "under-review" | "missing" | "invalid" | "verified";

export type KybStatus =
  | "NotStarted" | "InProgress" | "ChangesRequested" | "UnderReview" | "Passed" | "Failed";
export type KybDocumentStatus = "NotProvided" | "Provided" | "Verified" | "Rejected";
export interface AccountDocumentRecord { id?: number; name: string; status: KybDocumentStatus }
```

These names mirror the backend vocabulary: `deriveDocumentsState({
kybStatus, documents, stagedCount })` (the `?state=` preview path, unchanged by #1426) maps a
`(KybStatus, AccountDocumentRecord[], stagedCount)` triple onto one `AccountDocumentsState`, with an
explicit precedence — `Passed` → `verified`; any `Rejected` → `invalid`; a `NotProvided` document →
`missing`; `UnderReview` → `under-review`; `stagedCount > 0` → `staged`; otherwise `verify`.

Production uses `deriveProductionDocumentsState` with the server's `kyb_status`, persisted document
statuses, and `writable` flag, in its own precedence order: `Passed` → `verified`; `Failed` →
`under-review` (checked before the `Rejected` check, so a `Failed` LP holding a rejected document
is not mis-routed into the re-upload banner — #1426); `UnderReview` → `under-review`;
`ChangesRequested` → `invalid` (also checked before the `Rejected` check — a `ChangesRequested`
with neither a reason nor a single rejected document is a real case per
[kyb-lp-verification.md](../product-specs/kyb-lp-verification.md), and must still show the
re-upload banner rather than the first-time "Verify your account" banner); any `Rejected` document →
`invalid`; a writable LP → `staged` or `verify`; otherwise `under-review`. Writable LPs retain
upload controls and all persisted rows, including Provided rows. The `missing` state and named
required document remain fixture-only — `deriveProductionDocumentsState` never returns `"missing"`,
since KYB documents are untyped and carry no `NotProvided` status (see
[kyb-lp-verification.md](../product-specs/kyb-lp-verification.md)); frame `6701-98022` stays a
`?state=` preview, unreachable from production data.

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

**The declined stand-in (#1426, also no designed frame).** A `Failed` kyb_status reuses the same
`under-review` banner slot with `failed` set: negative tone, `WarningTriangleIcon`, title
`Account verification declined`, caption `Your account is frozen and cannot be changed.` There is
no designed Account frame for a declined verdict either (decision 5 of the #1426 exec plan) — the
Account column holds only `6701-98137`, `6701-98175`, `6701-97942`, `6701-98061`, `6701-98099`,
`6701-97982`, `6701-98022`. The same situation reaches the page a second way: a `Failed` verdict
suspends the account (`accounts.status = 'Suspended'`), so every bearer request 403s with
`account_suspended` and the read never reaches `readState: "loaded"`. `useAccountPage` keys that
403 on the payload's `account_suspended` string (not the bare status, so an unrelated 403 keeps
today's behaviour) and renders the already-shipped stand-in copy,
`Your account verification was declined. Profile and document changes are unavailable.`, in the
read-error block with its `Retry` button suppressed — retrying a terminal refusal can never
succeed. **Since #1465 this is a defensive fallback, not the realistic path**: the same
`account_suspended` 403 fires the global `subscribeSessionEnded` seam
(`docs/frontend/auth-components.md#session-module`), which signs the LP out and lands them on `/`
before `/account` can render this branch — it stays shipped and tested for a tree mounted without
the root subscriber (today, component tests) or a future authenticated call site the header sniff
does not recognise. The `kyb_status === "Failed"` banner above is unit-testable only, since the
suspension makes the read itself unreachable in a running app (tracked as tech debt alongside the
home-route unobservability note in
[home-screen-states.md](../product-specs/home-screen-states.md)).

## Verbatim copy

Page chrome: `Account` · `Connect Wallet` · `Wallet` · `USDC balance` ·
`Disconnect` · `Corporate email` · `Email` · `Add email` · `Documents` · `Log Out`.

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

The first five are the five company-document labels inlined directly into
`KYB_DOCUMENT_REQUIREMENTS` (`kybDocumentRequirements.ts`, #1278 — previously imported from the
now-deleted `useCompanyDocsModal.ts`'s `COMPANY_DOCUMENT_SLOTS`). Per-file captions: `Verified` ·
`Uploaded` · `Invalid document` · `Re-upload`.

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
| `fill-test/primary` (leading tiles: wallet/email/upload) | `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` (corrected by #1458 — see below) |
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
stays as `Button variant="secondary" size="compact"` with no extra className. **That same button
does carry the touch-target wrapper** — `get_metadata` at `6701:98040` shows `ButtonCont` (node
`I6701:98040;8926:10405`) at `x=351 w=83 h=40` containing the 75×32 `button` at a 4px inset,
identical geometry to `AccountUploadRow`'s own wrapper — so `AccountStatusBanner` wraps its
`action` button in the same `flex items-center justify-center p-1` container (issue #1294).

**The `invalid` state's per-row `Re-upload` action (`AccountDocumentRow.tsx`) is a borderless,
text-only `Button variant="secondary" size="compact"`, wrapped in the same `p-1` touch-target
convention** — confirmed via `get_metadata` at `6701:98001` (the `dfvfv.pdf` row): `ButtonCont`
(node `I6701:98001;8902:3622`) at `x=349 w=107 h=40` containing the 32-tall `button` at a 4px inset
on every side, and `get_design_context` shows no `bg-*`/`border` class on that `button` node —
`secondary`'s own `bg-transparent` with no border already matches. Text color is
`content-test/secondary` (ink-muted), not `secondary`'s default ink, so the row overrides with
`!text-[color:var(--color-pipeline-ink-muted)]` — the `!` is required for the same specificity
reason as `Log Out`'s `!bg-` override above. A prior pass rendered this as a bare unstyled `<button
px-1>` with no touch-target wrapper (issue #1295). The `invalid` banner itself (`6701:98000`) has
**no** trailing action — confirmed no `ButtonCont`/button node in its subtree, unlike the `missing`
banner's inline `Upload`.

**The 40×40 leading tiles (wallet row, email row, upload row) are `fill-test/primary` =
`rgba(191,189,187,0.12)` → `--color-pipeline-fill-muted`.** `get_design_context`'s codegen emits a
stale `bg-[var(--fill-test/primary,#262524)]` literal for all three tiles (same class as #1251's
`content-test/primary` finding); #1284 read the tile as a pale navy tint from a screenshot sample
and shipped `--color-pipeline-brand-secondary`. #1458 resolved the binding live with
`get_variable_defs` on `7129:15860` and `6701:98112` (both `#bfbdbb1f`) and corrected
`AccountIconTile` to `--color-pipeline-fill-muted` — the same token the circles and the tab track
already use. Only the icon's own color varies — ink for envelope/wallet, solid
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
| `UploadedFileRow.tsx` | **Reused, with an additive `className` prop** (issue #1293) — 40×40 leading tile, title/caption order, and the 32×32 cross-circle remove control are exactly what the frame shows. The leading element is a glyph tile rather than a rendered PDF thumbnail (TD-63, pre-existing, not new debt here). Second consumer: `CompanyDocsModal` (#1278, no `className`). |
| `SegmentedTabs` (`@pipeline/ui`, `variant="track"`) | **Not used by the wallet card (#1512)** — its track styling is reproduced by the static chain block; the component stays in `@pipeline/ui`. |
| `COMPANY_DOCUMENT_SLOTS` | **Retired (#1278).** The five labels are now inlined directly into `KYB_DOCUMENT_REQUIREMENTS` (`kybDocumentRequirements.ts`); the `{ id, label }` tuple and `CompanyDocumentSlotId` type had no other purpose once the raw-upload model dropped per-slot structure everywhere. |
| `FileDropZone.tsx` | **Deleted (#1278).** There is no dashed drop zone anywhere in V1.0; the "flat upload area" is a plain list-item row (tile + text + bordered secondary `Upload` button), which `AccountUploadRow.tsx` implements directly. No sub-issue of epic #1247 gained a consumer for it. |
| `KybInfoBanner.tsx` | **Deleted (#1278).** It is a neutral white surface with centred single-line text and a tooltip; the frames need a tinted, bordered, 72px two-line banner with a 32px status icon and an optional trailing button (`AccountStatusBanner.tsx`) — a rewrite, not a variant. No sub-issue of epic #1247 gained a consumer for it. |
| `AccountUploadRow.tsx` / `AccountRequirementsList.tsx` | **Second consumer added (#1278).** Both gained additive optional `dataNodeId`/`testId` props (and `AccountRequirementsList` gained `className`, default `"px-2 pb-6"`) whose defaults reproduce this page's DOM byte-for-byte — `AccountDocumentsCard.test.tsx` is the regression guard. `CompanyDocsModal` passes its own node ids and, for the requirements list, `className="px-2"` (no bottom padding — its card supplies the gap instead). |
| `useAccountDocuments` | **Second consumer added (#1278).** `CompanyDocsModal` calls it as `useAccountDocuments({ onSave: onSubmit })` — the same `{ files, rejected, addFiles, removeFile, canSave, handleSave }` surface this page uses. Since #1572 both consumers also share `reconcileUploads.ts` (`reconcileUploadedDocuments` + `reconciliationMessage`), so the uncertain-upload rule below is one implementation. |

## Production actions and remaining seams

`useAccountPage` fetches the LP, keeps the saved profile baseline separate from the input draft,
and coordinates full-replace profile writes, ordered file uploads, and id-based deletion. A
document Save uploads staged files and does not save an existing LP's unsaved profile draft. For a
404 LP it first creates the valid profile using the session email. A failed network upload is
reconciled against newly returned document ids before retry (the pure `reconcileUploadedDocuments`
in `components/account/reconcileUploads.ts`, shared with `CompanyDocsModal` since #1572); if
reconciliation fails, retry is blocked until Check uploads succeeds. During that read, file selection and staged removal are
locked. If new server documents and staged files share a duplicate filename, the page keeps all
ambiguous staged copies and blocks retry. The LP must explicitly discard those staged copies,
review the returned documents, and select any missing files again. Rejected rows use Re-upload to delete the rejected original,
then the visible upload controls accept the correction. Provided rows on writable LPs have a
remove button; Verified and frozen rows do not.

`AccountWalletCard`'s Connect Wallet / Disconnect and the route's Log Out remain wired to the
shared wallet and auth flows. `AccountDocumentsCard.onUploadMissingDocument` exists only for the
synthetic `missing` preview. Review submission changes KYB only through the backend endpoint; its
server response determines the displayed status and freezes controls.

## `?state=` preview contract

`routes/account.tsx`'s `validateSearch` parses `state` via `parseAccountStatePreview`, which
accepts only the six `AccountDocumentsState` ids and returns `undefined` for anything else
(missing, empty, unknown, or non-string). When set, it **overrides** `deriveDocumentsState`'s
output and feeds `AccountDocumentsCard` from `ACCOUNT_STATE_PREVIEWS[state]` (a `{ kybStatus,
documents, missingDocumentName? }` fixture with clean filenames); for `state=staged` specifically,
`createPreviewStagedFiles()` also seeds `useAccountDocuments`'s local staging state with a handful
of empty-content `File` objects so the real removable-row / enabled-Save behavior renders exactly
as it would live. With no `state` param the page reads the LP API.
`validateSearch` only calls `parseAccountStatePreview` when `ENV.IS_DEV` (#1362) — the route guard
itself now admits authenticated production LPs too, so the preview override needs its own explicit
`ENV.IS_DEV` check rather than inheriting dev-only-ness from route access.

Preview links live in the existing `/test?tab=auth` block (`routes/test.tsx` → `AuthTab`) — one
link per state, alongside the six existing modal triggers. See [Diagnostics preview
seam](./auth-components.md#diagnostics-preview-seam).

## Out of scope

| Concern | Owner |
| --- | --- |
| Home page KYB orchestration and wallet linking | #1254 |
| Wiring sign-in / create-account / OTP to real auth | #1265 |
| Header auth buttons, the account icon | #1362 (shipped — this doc's [Route gate](#route-gate)), extended to wallet-only visitors by #1458 |
| The Add email screen itself and the OTP hand-off | #1459 (shipped — `AddEmailModal`, see [`auth-components.md#addemailmodal`](./auth-components.md#addemailmodal)) |
| The home grid for a wallet-only visitor (home state 7) | #1460 — `deriveHomeState` is untouched; a wallet-only visitor keeps rendering the zero-state grid on `/` (see [home-screen-states.md](../product-specs/home-screen-states.md)) |
| The home card states, composite Total Balance, merged activity feed | #1282 |
| The redesigned onboarding-time Company Docs modal | #1278 |
| Add Funds wire-transfer modal | #1283 |

`TopBar.tsx`, `MobileNavMenu.tsx`, and `ConnectModalProvider` were not modified by #1284 — #1362
later changed `TopBar.tsx`/`MobileNavMenu.tsx` to add the header auth entry point (see
`dashboard-components.md#topbar`); `ConnectModalProvider` itself is still untouched.
**Update (#1278):** the onboarding-time `CompanyDocsModal` was redesigned to compose
`AccountUploadRow`, `AccountRequirementsList`, and `useAccountDocuments` directly (see
[`auth-components.md#companydocsmodal`](./auth-components.md#companydocsmodal)); `useCompanyDocsModal.ts`
was deleted as part of that redesign.

## Accessibility

The verified-row trailing chevron is `aria-hidden` (decorative, not a button) — no document-detail
frame exists anywhere in V1.0, so it has no destination (tech debt, designer ask). The upload
row's file input is visually hidden (`sr-only`) but reachable via its trailing `Upload` button. The
status banner uses `role="status"`. `Log Out` and `Connect Wallet` are real `<button>` elements,
focusable and clickable with no throw even with no handler wired (the inert-seam contract).

`Disconnect` (`AccountWalletCard.tsx`) and `Add email` (`AccountEmailCard.tsx`, issue #1458) are
also real `<button>` elements. `AccountListRow` gained an optional `onActivate` prop (#1458): when
present the root renders as `<button type="button">` instead of a `<div>`, and its inner content
wrapper and the two text nodes render as `<span>` rather than `<div>`/`<p>` so the button's content
model stays valid (a `<button>` cannot contain block-level `<div>`/`<p>` descendants) — no visual
change, since Tailwind preflight already zeroes `<p>` margins. `AccountIconTile` renders a `<span>`
for the same reason (it is used as a `<button>`'s leading icon in the `Add email` row).

## No mobile frames

V1.0 Account frames are desktop-only; the 480px column already behaves as a mobile-friendly single
column. Page padding is `px-4 py-8` below `md`, `md:px-8 md:py-16` above (#1309). Logged as tech debt.
