# Issue #1426: Home state 6: KYB not verified due to a problem

Source: https://github.com/eq-lab/pipeline/issues/1426

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (home, desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6702-104071&m=dev
— frame `6702:104071` ("Error Verification", home-frame column)
Figma (account): frame `6701:97982` ("Error Verification") · frame `6701:98022` ("Missing document")
Branch / worktree: `feat/home-state-kyb-problem` at
`/Users/luiza/Projects/pipeline-feat-home-state-kyb-problem`

## Scope

Two surfaces, one path: the home failure card and the `/account` page it navigates into.

**In scope — home (`/`)**

- `deriveHomeState` gains a sixth branch, `"kyb-problem"`: signed in · `lpRead === "loaded"` ·
  `kyb_status` is `"ChangesRequested"` **or** `"Failed"`. Gated on `kyb_status` alone — **no wallet
  gating, no balance gating** (user direction, 2026-10-12). Evaluated after `"plusd-held"` and
  before the `"legacy"` fallback.
- A new `AddUsdCard` variant, `"declined"` (Shape B), built **Figma-exact** from frame
  `6702:104071`: node `6702:104191`, heading `We can’t verify your account`, description
  `Please check and try again.`, a new 236×236 warning illustration, and a 70×40 `primary-dark`
  `View` button wired to the existing `onViewStatus` → `/account`.
- A new `WarningIllustration` in `@pipeline/ui`, Figma node `6703:106694`, following the
  `CheckIllustration` / `SignUpIllustration` CSS-mask recipe.
- A sixth desktop grid branch in `packages/frontend/src/routes/index.tsx`, built from the
  `"kyb-pending"` branch with the one card swap.

**In scope — account (`/account`), so `View` lands correctly**

- `deriveProductionDocumentsState`: map `ChangesRequested` → `"invalid"` (frame `6701:97982`) and
  `Failed` → `"under-review"` + `failed` **before** the rejected-document check, which today
  mis-routes a `Failed` LP holding a rejected document into the re-upload banner.
- `useAccountPage`'s error copy: a 403 `account_suspended` read currently renders the raw machine
  string `account_suspended` with a `Retry` button. Render the shipped declined copy instead and
  drop `Retry` — this is the page a `Failed` LP actually reaches.

**Out of scope**

- Every other card on the home frame. Total Balance, Recent activity, Get PLUSD / Stake PLUSD /
  Earnings and the FAQ strip are **formal** here (user direction, 2026-10-12): reuse what the
  existing branches already render, do not re-trace their geometry, do not add gating. The one
  exception is the Total Balance card's variant, which follows `isConnected` (see Decisions).
- Mobile. No mobile frame exists for this state; the mobile stack keeps its existing
  `isConnected`-only rendering, unchanged (same decision as #1421–#1424).
- Frame `6701:98022` ("Missing document"). It does not map to any served state — see Decisions.
- Rendering `kyb_decision_reason` / per-document `reject_reason`. Both are served and neither is
  rendered anywhere today; surfacing them is a product change, not this issue (logged as tech debt).
- Lifting the account suspension that makes `Failed` unobservable (backend, #1380 territory).
- State 5 (funded/staked, #1425), state 7 (#1460), the header/Account work of #1458, the Add-email
  screen of #1459.

## Decisions

Settled from the docs and from code research; recorded here so they are not re-litigated.

1. **The frame covers `ChangesRequested` in practice; `Failed` is included but unobservable.**
   `LpRepo::decide_kyb` (`packages/shared/src/lp_repo.rs`) sets `accounts.status = 'Suspended'` in
   the same transaction as a `Failed` verdict, and `AuthClaims::from_request_parts`
   (`packages/api/src/auth.rs`) re-reads the account status on **every** bearer request, refusing
   with `403 account_suspended` (`packages/api/src/account_status.rs`). So `GET /v1/lps/me` 403s
   from the next call, `AuthFlowProvider` maps that to `lpRead === "error"`, and the home route can
   never observe `kyb_status === "Failed"` — it renders `"legacy"`. `ChangesRequested` leaves the
   account active and `writable`, so it is the status this frame actually renders for. Both values
   stay in the condition (the derivation must be correct regardless of today's suspension
   behaviour), and the unobservability is documented in the spec and logged as tech debt.
2. **Frame `6701:98022` ("Missing document") does not map to `ChangesRequested`.** KYB documents
   are untyped — `kyb-lp-verification.md` is explicit that "nothing distinguishes a certificate of
   incorporation from a shareholder register except the filename", there is no required-document
   checklist, and `LpDocument.status` is `"Provided" | "Verified" | "Rejected"` with no
   `NotProvided`. The `missing` state's `NotProvided` row and named required file are the
   development fixture `account-page.md` already calls out as "never production data", and
   `deriveProductionDocumentsState` never returns `"missing"`. The frame stays a dev-only `?state=`
   preview; `ChangesRequested` maps to `"invalid"` only.
3. **`ChangesRequested` with no rejected document is a real case and must still show the failure
   banner.** `kyb-lp-verification.md`: "a `ChangesRequested` with neither a reason nor a single
   rejected document is therefore accepted". Today that LP sees the first-time
   `Verify your account` / `Upload your company documents to unlock bank transfers.` banner —
   indistinguishable from a brand-new account. Mapping the status (not the document set) to
   `"invalid"` fixes both shapes at once, and `uploadVisible` already admits
   `production && state === "invalid"` when `writable`, so the correction affordances (upload row,
   requirements list, Save, Submit for review) stay available.
4. **Total Balance card variant follows `isConnected`.** The frame is drawn with a wallet connected
   (`Get PLUSD to start`), but the state is not gated on connection, so a disconnected
   `ChangesRequested` LP would otherwise see a connected-only affordance. Reuse what the existing
   branches already render for each case: `variant={isConnected ? "get-plusd" : "connect-wallet"}`
   with `onConnectWallet={openConnectModal}`. One ternary, no new component work. This is the only
   connection-dependent card; `onBuy` / `onSell` / `onStake` already open the connect modal when
   disconnected, and `sellDisabled` / `stakeDisabled` already derive from served balances.
5. **No new Account-page copy is invented for `Failed`.** There is no designed Account frame for a
   declined verdict (the Account column holds only `6701:98137`, `6701:98175`, `6701:97942`,
   `6701:98061`, `6701:98099`, `6701:97982`, `6701:98022`). The 403 path reuses the already-shipped
   string `Your account verification was declined. Profile and document changes are unavailable.`
   (`AccountPage.tsx`), the same stand-in pattern `account-page.md` documents for `under-review`.
6. **The Figma typo/apostrophe.** The heading ships with the frame's typographic apostrophe:
   `We can’t verify your account` (U+2019), exactly as `get_design_context` returns it. No typo
   correction is needed here (unlike `Veryfying` in #1423).

## Assumptions and Risks

- **`AddUsdCard` is the right home for the card.** `bank-transfers.md` already assigns "Mounting
  `AddUsdCard` into the home grid for states 5–6" to #1425–#1426, and the failure card occupies the
  exact Shape B slot (313.14×246 at col 3–4 row 2, above the 82px `EarnedCard`) that `verify` and
  `verifying` occupy. `verify`/`verifying` already carry no "Add USD" semantics either.
- **The illustration is new artwork, not `CheckIllustration`.** The frame's old striped-check
  `Union` (`6702:104192`, 291×193.66 at card-box `174, 66.34` — identical to `verifying`) is
  **hidden** in the frame; the visible artwork is `warning 1` (`6703:106694`), a 236×236 striped
  warning triangle. Do not render the hidden Union; do not reuse `CheckIllustration`.
- **Figma asset URLs expire.** Re-export `6703:106694` through the Dev Mode MCP at implementation
  time (`get_design_context` returns a `localhost:3845` SVG URL; `curl` it) and commit the bytes to
  `packages/ui/src/assets/illustrations/`, as `striped-signup.svg` and `striped-check.svg` were.
- **Figma radii fallbacks are stale.** `get_variable_defs` on `6702:104191` resolves
  `radius/radius-s` to **4**, not the `8px` literal `get_design_context` prints. Card and button
  radii stay `--radius-pipeline-card` / `--radius-pipeline-button` (4px). `fill-test/primary`
  resolves to `#262524` — the existing `Button variant="primary-dark"`, no new treatment.
- **Heading width is load-bearing.** The frame's heading instance (`6702:104411`) is **227px**
  wide inside a 281.14px content box, which is what wraps `We can’t verify your account` onto two
  lines. Without the cap the heading fits on one line and the card stops matching the frame.
- **The 46px title frame is a Figma clip artifact.** `Frame 1321317268` declares h=46 while its
  content measures 82 (56 heading + 4 gap + 22 description) and the frame screenshot shows all
  three lines. Let the block flow naturally; do not reproduce 46px.
- **Shared-component churn.** `AddUsdCard`, `AccountDocumentsCard`, `accountPageState.ts` and
  `useAccountPage.ts` are shared with the zero/unverified/kyb-pending/plusd-held branches, the
  legacy branch, mobile, the `?state=` previews and `/test`. Every change must be additive and
  opt-in; existing tests stay untouched.
- **`Failed` branches cannot be verified in a running app.** They are unit-testable only
  (suspension 403s the read). QA must be told not to expect a reachable `Failed` account.
- **Account 403 handling changes an error path.** Suppressing `Retry` is correct for a terminal
  refusal but the 403 code is shared with any other `account_suspended` cause; key the new copy on
  the `account_suspended` payload, not on the bare status, so an unrelated 403 keeps today's
  behaviour.

## Open Questions

_None_

## Implementation Steps

1. **`packages/ui/src/assets/illustrations/striped-warning.svg`** — DONE. Re-exported Figma node
   `6703:106694` through the local Dev Mode MCP at implementation time (fresh export byte-identical
   to the planner's cached copy) and committed verbatim (236×236 viewBox).

2. **`packages/ui/src/components/WarningIllustration/WarningIllustration.tsx`** — DONE (+ `index`
   barrel export in `packages/ui/src/index.ts`, + a `.stories.tsx` alongside, matching
   `CheckIllustration`). Copy the `CheckIllustration` recipe verbatim: `width` prop (number → px,
   string passthrough) + `tone` (`"primary" | "muted"`), `maskImage` painting `currentColor`,
   `aria-hidden="true"`, `data-tone`, `forwardRef<HTMLSpanElement>`. Intrinsic aspect ratio
   `236 / 236`; default `width` 236.

3. **`packages/frontend/src/components/addUsdCardState.ts`** — DONE. Extended `AddUsdCardVariant` with
   `"declined"` and add it to `ADD_USD_CARD_VARIANTS` (frame order: after `verifying`). No
   derivation function is added here — epic #1419 owns the state machine.

4. **`packages/frontend/src/components/AddUsdCard.tsx`** — DONE. Added `"declined"` to the Shape B
   (`Section`) branch, `NODE_IDS["declined"] = "6702:104191"`:
   - Card: `Card variant="white"`, `relative h-[246px] overflow-hidden`, the home cards' shared
     border idiom, `role="region"` + `aria-labelledby`, `data-variant="declined"`.
   - Illustration: `<WarningIllustration />` absolutely positioned at `left: 128.86px; top: 48px`
     **from the card box** (the same positioning context `verify`/`verifying` use), clipped by the
     card — 51.72px bleeds past the right edge, 38px past the bottom.
   - Heading block at `(16, 16)`, `relative` so it paints over the artwork, text column capped at
     **227px**: title `We can’t verify your account` (Besley 20/28, `--color-pipeline-ink`) over
     description `Please check and try again.` (body 16/22, `--color-pipeline-ink-muted`), 4px gap.
   - CTA: `Button variant="primary-dark" size="m"` with the existing `!h-10` override, label
     `View`, content-width (70×40 in the frame), bottom-left at `(16, 190)` via the branch's
     existing `justify-between` column; `onClick={onViewStatus}`. Reuses the existing
     `onViewStatus` prop — no new prop.

5. **`packages/frontend/src/components/homeState.ts`** — DONE. Extended `HomeState` with `"kyb-problem"`
   and add the branch after the `"plusd-held"` check, before the `"legacy"` fallback:
   `lpRead === "loaded" && (kybStatus === "ChangesRequested" || kybStatus === "Failed")`.
   No `isConnected`, no `plusdIsZero` / `splusdIsZero`. The spec-pointer header stays the file's
   only comment.

6. **`packages/frontend/src/routes/index.tsx`** — DONE. Added the `homeState === "kyb-problem"` branch
   after the `"plusd-held"` branch, copied from `"kyb-pending"` with two edits:
   - `PortfolioPlaceholderCard` — `variant={isConnected ? "get-plusd" : "connect-wallet"}`,
     `onConnectWallet={openConnectModal}` (Decision 4); everything else unchanged.
   - `AddUsdCard variant="declined" onViewStatus={onViewStatus}` in place of `"verifying"`, no
     `flex-1` (the card owns its 246px height).

   Grid positions and `data-node-id`s from frame `6702:104071`: portfolio `6702:104180` (col 1–4,
   row 1); recent activity `6702:104081` (col 5–7, `row-span-2` from row 1); balances stack
   `6702:104425` (col 1–2, row 2); add-usd stack `6702:104190` (col 3–4, row 2); FAQ `6702:104181`
   (col 1–7, row 3). `data-testid`s match the existing branches exactly.

7. **`packages/frontend/src/components/account/accountPageState.ts`** — DONE. Reordered and extended
   `deriveProductionDocumentsState`:
   ```
   Passed            → "verified"
   Failed            → "under-review"        (new, before the Rejected check)
   UnderReview       → "under-review"
   ChangesRequested  → "invalid"             (new, before the Rejected check)
   any Rejected doc  → "invalid"
   writable          → stagedCount > 0 ? "staged" : "verify"
   otherwise         → "under-review"
   ```
   `deriveDocumentsState` (the preview path) is untouched — the `?state=` fixtures keep their
   current behaviour.

8. **`packages/frontend/src/components/account/useAccountPage.ts`** — DONE. Added an
   `account_suspended` case to `message()` returning the declined copy, keyed on
   `error.message === "account_suspended"` rather than on the bare 403 (`isAccountSuspended`
   helper). Exposed a `suspended` flag, reset alongside the other per-session state and set/cleared
   in `refresh()`'s success/404/catch branches, so `AccountPage.tsx` can render the error block
   without `Retry`.

9. **`packages/frontend/src/components/account/AccountPage.tsx`** — DONE. Consumes `suspended` to
   hide `Retry` on the error block. Deviation: the shared string was lifted to
   `ACCOUNT_DECLINED_MESSAGE` in `accountPageState.ts` (not inline in `AccountPage.tsx`) — both
   `AccountPage.tsx` (the existing `Failed` paragraph and the new suspended-error render) and
   `useAccountPage.ts`'s `message()` import it from there, which avoids both the literal
   duplication the plan calls out and a cross-file cycle `AccountPage.tsx → useAccountPage.ts →
   AccountPage.tsx` would have created.

10. **Lint/format gate** — `npx tsx scripts/lint-docs.ts`,
    `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`,
    `TZ=UTC yarn workspace @pipeline/frontend test`, plus `cargo clippy --all -- -D warnings` and
    `cargo test --all` (no Rust is touched; run them anyway per the coder gate).

## Test Strategy

- **Unit — `packages/frontend/src/components/homeState.test.ts`**: a
  `deriveHomeState — kyb-problem (#1426)` block. `ChangesRequested` and `Failed`, each with
  `lpRead: "loaded"` and a session, returning `"kyb-problem"` across the full cross-product of
  `isConnected` true/false and `plusdIsZero`/`splusdIsZero` true/false (eight cases per status) —
  this is the regression that proves the state is **not** balance- or wallet-gated. Plus: no
  session → `"zero"`; `lpRead` `"unknown"` / `"error"` / `"absent"` with either status →
  `"legacy"`; and a sweep asserting `NotStarted` / `UnderReview` / `Passed` / `InProgress` still
  reach their existing branches unchanged.
- **Unit — `packages/frontend/src/components/account/accountPageState.test.ts`**:
  `deriveProductionDocumentsState` for `ChangesRequested` **with** a `Rejected` document and
  **without** one → `"invalid"` in both; `Failed` with and without a `Rejected` document →
  `"under-review"` in both (the ordering fix); `writable: false` + `NotStarted` → `"under-review"`
  unchanged; `Passed`/`UnderReview` unchanged. Assert `deriveDocumentsState` (preview path) is
  unchanged.
- **Component — `packages/frontend/src/components/AddUsdCard.test.tsx`**: the `declined` variant
  renders the heading `We can’t verify your account` (assert the U+2019 apostrophe explicitly),
  the description `Please check and try again.`, `data-variant="declined"`,
  `data-node-id="6702:104191"`, the warning illustration, and a `View` button whose click fires
  `onViewStatus`; and that it renders **no** `Add Funds` circle and no `Start Verification` /
  `View Status` label. Regression: the other five variants are untouched.
- **Component — `packages/frontend/src/components/account/AccountDocumentsCard.test.tsx`**: the
  `under-review` + `failed` banner (`Account verification declined` /
  `Your account is frozen and cannot be changed.`, negative tone, `WarningTriangleIcon`) — today
  untested; and that a production `invalid` card for a writable LP shows the upload row,
  requirements list and Save, while a non-writable one does not.
- **Hook — `packages/frontend/src/components/account/useAccountPage.test.tsx`**: a 403
  `account_suspended` read surfaces the declined copy, not the raw `account_suspended` string,
  and sets the no-retry flag; an unrelated 403 keeps today's behaviour; 401 still renders the
  session-expired copy.
- **Route — `packages/frontend/src/routes/-index.test.tsx`**: with a session, `lpRead: "loaded"`
  and `kyb_status: "ChangesRequested"`, assert the grid renders `AddUsdCard variant="declined"`
  above `EarnedCard` in the col 3–4 stack, the compact Get PLUSD / Stake PLUSD stack in col 1–2,
  `RecentActivityCard`, `QnaSection`, and that clicking `View` navigates to `/account` with
  `state: undefined`. Repeat the key assertions with `isConnected: false` (portfolio card flips to
  `connect-wallet`, `AddUsdCard` stays `declined`) and with a non-zero PLUSD balance (still
  `"kyb-problem"` — no balance gating). Add a `Failed` case asserting the same branch.
- **Route — `packages/frontend/src/routes/-account.test.tsx`**: a `ChangesRequested` LP with no
  rejected document lands on the `invalid` documents card (`Re-upload your document`), not on
  `Verify your account`.
- **Mobile regression**: at <768px a `ChangesRequested` LP sees the existing mobile stack —
  no `We can’t verify your account` copy, no `View` button.
- **Figma verification** (required). Home frame `6702:104071`, card node `6702:104191`: re-run
  `get_screenshot` / `get_design_context` and compare the rendered card against the frame. Geometry
  to confirm: card 313.14 × 246 with 16px padding at (361.14, 322) inside the 1136px content box;
  heading block at (16, 16) capped at 227px wrapping to two lines; description one line below;
  `View` button 70 × 40 at (16, 190), `fill-test/primary` `#262524` with a white label, 4px radius;
  warning artwork 236 × 236 anchored at card-box (128.86, 48), clipped right and bottom. The teal
  connector line leaving the `View` button is a prototype wire to `/account`, not a visual element
  — not rendered. The three 1–3px Shape B deltas `bank-transfers.md` already documents for the
  shared border idiom still apply. Account frame `6701:97982`: confirm the production
  `ChangesRequested` rendering matches it (negative banner, no icon tile, rejected row with
  `Invalid document` + `Re-upload`, Verified rows below).
- **Suite**: `/test-fast` (lint + unit + integration) green before the PR.

## Docs to Update

- `docs/product-specs/home-screen-states.md` — flip state 6 to Implemented (#1426) and restate its
  condition as `kyb_status` only; add the precedence paragraph (gated on status alone, no wallet or
  balance conditions, which is why no neighbouring combination falls through to `"legacy"`); record
  that `Failed` is in the condition but unobservable while a `Failed` verdict suspends the account
  (403 on every bearer request → `lpRead === "error"` → `"legacy"`), so `ChangesRequested` is what
  this frame renders for today; note the Total Balance variant following `isConnected`, and that
  every other card on the frame is the state-3 composition reused unchanged.
- `docs/frontend/dashboard-components.md#home-route` — the sixth branch table (slot / grid position
  / content with the `6702:104…` node ids), and the `"legacy"` note updated to "until state 5
  lands".
- `docs/frontend/bank-transfers.md` — `AddUsdCardVariant` gains `"declined"`; a row in the
  per-variant presence table (node `6702:104191`, no eyebrow, heading `We can’t verify your
  account`, sub-caption `Please check and try again.`, illustration yes, action `View` → `/account`);
  a row in the Shape B frame-and-anchor table recording the new artwork, its 236 × 236 size, the
  card-box offset (128.86, 48), the 51.72/38 bleeds, the 227px heading cap and the button frame
  70 × 40 at (16, 190); a note that the frame's hidden `Union` (`6702:104192`) is the leftover
  striped check and is not rendered; and the `#1425–#1426` seam row updated.
- `docs/frontend/ui-components.md` — a `WarningIllustration` section mirroring `CheckIllustration` /
  `SignUpIllustration`: source, Figma node `6703:106694`, committed asset path, mask recipe,
  intrinsic 236 × 236, tone semantics, decorative `aria-hidden`, reuse point.
- `docs/frontend/account-page.md` — update the production data contract paragraph: `ChangesRequested`
  now renders the `invalid` state (frame `6701:97982`) whether or not a document is `Rejected`, and
  `Failed` renders the `under-review` stand-in with the declined banner, ahead of the
  rejected-document check; record that frame `6701:98022` ("Missing document") is unreachable from
  the production contract (untyped documents, no `NotProvided` status) and stays a `?state=` preview;
  extend the "under review stand-in" section to cover the declined stand-in (no designed frame) and
  the 403 `account_suspended` copy with no `Retry`; replace the "`6702-104071` … belongs to #1282,
  not this issue" sentence with a pointer to the shipped `AddUsdCard variant="declined"`.
- `docs/user-stories/epic-1419/1426-home-kyb-problem-state.md` — new, modelled on
  `1423-home-kyb-pending-state.md`: the state-6 grid (with the explicit note that only the failure
  card is pixel-traced for this issue, the rest being the reused state-3 composition), `View` →
  `/account` → the `invalid` documents card, the disconnected variant, the no-balance-gating
  behaviour, the unobservable `Failed` path, and mobile unchanged.
- `docs/exec-plans/tech-debt-tracker.md` — three new entries:
  (a) a `Failed` KYB verdict suspends the account, so no authenticated surface can ever render the
  declined copy that `AccountPage`, `AccountDocumentsCard`, `CompanyDocsModal` and now
  `AddUsdCard` all ship; (b) `kyb_decision_reason` and per-document `reject_reason` are served by
  `GET /v1/lps/me` and rendered nowhere — `documentsFromLp` drops `reject_reason` on the floor — so
  an LP is told to re-upload without being told why; (c) designer ask: no Figma frame exists for
  the Account page's declined state, which ships as a stand-in built from designed parts.
