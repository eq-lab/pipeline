# Issue #1254: KYB: wire data screens to /v1/lps endpoints (register, documents, status, link-address)

Source: https://github.com/eq-lab/pipeline/issues/1254

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Branch: `feat/1254-kyb-data-wiring` (draft PR #1268)
Related: #1265 (auth slice, blocked), #1266 (backend auth, backlog), #1267 (backend upload transport, backlog)

## Scope

The **data-wiring slice** of epic #1247: give the LP frontend a real, typed, tested client for
the `/v1/lps/*` KYB workflow group, and sequence the six shipped presentational screens into one
flow behind the existing `/test?tab=auth` diagnostics seam.

In scope:

1. **Authorization plumbing** for the LP frontend's `apiFetch` — it currently attaches no
   `Authorization` header at all (verified: `packages/frontend/src/api/client.ts` has no token
   path, and nothing under `packages/frontend/src` references `Authorization`/`Bearer`). Every
   `/v1/lps/*` call requires an `auth_users` JWT, so this is a hard prerequisite.
2. **Four typed API hooks** in `packages/frontend/src/api/`, each with unit tests and mock-key
   support:
   - `useRegisterLp` — `POST /v1/lps` `{legal_name, country?, contact_email}` → `{id}`
   - `useUploadKybDocument` — `POST /v1/lps/{id}/documents` `{doc_type, subject?, file_ref}`
   - `useLp` — `GET /v1/lps/{id}` (polling; drives the Account-in-review state)
   - `useLinkStellarAddress` — `POST /v1/lps/{id}/link-address` `{stellar_address}`
3. **Flow orchestration** — `KybFlow.tsx` + `useKybFlow.ts` under
   `packages/frontend/src/components/`, sequencing Company Docs (Step 1/2) → Owners (Step 2/2) →
   Account-in-review, holding the `lpId`, and driving `AccountInReviewModal` from the polled
   `kyb_status`. Mounted **only** from a new `/test?tab=auth` trigger.
4. **Docs** — `packages/frontend/src/api/README.md` (public API + mock keys),
   `docs/frontend/auth-components.md` (new `KybFlow` section), `docs/frontend/hooks.md` rows,
   `docs/user-stories/epic-1247/1254-kyb-data-wiring.md` + index row, tech-debt entries.

Out of scope:

- **The production entry point.** Per the epic's 2026-09-17 decision the LP header gets separate
  auth buttons via a forthcoming Figma; nothing here touches `TopBar`, `ConnectModalProvider`, or
  any of the six production `openConnectModal` call sites. `KybFlow` is mounted by `/test` only.
- **Auth screens** (`SignInModal`, `CreateAccountModal`, `OtpModal`) — #1265, blocked on #1266.
  Their seams stay at their current no-op defaults; `MOCK_VALID_CODE` stays (TD-60).
- **File byte transport** — #1267. See "Assumptions and Risks" for the seam that stands in.
- **Any visual change** to the six shipped screens. Their rendered DOM must stay byte-identical;
  the existing component tests are the regression guard.
- The six independent `/test?tab=auth` triggers stay exactly as they are — they are the surface
  the QA stories for #1248–#1253 execute against. This issue **adds** a seventh trigger.

## Assumptions and Risks

**The backend cannot complete the KYB lifecycle today.** Four separate gaps were found while
reading the landed code; all four bound what this slice can honestly claim:

1. **`kyb_status` never advances.** `packages/shared/src/lp_repo.rs` exposes exactly four methods
   — `insert`, `list`, `find`, `link_address`. Nothing writes `kyb_status` after the column
   default (`NotStarted`); `KybDocumentRepo::review` decides individual documents but does not
   roll up to the LP row. Consequence: `GET /v1/lps/{id}` will report `NotStarted` forever, and
   `POST /v1/lps/{id}/link-address` — whose SQL is
   `WHERE id = $1 AND kyb_status = 'Passed' AND stellar_address IS NULL` — is **unreachable in
   practice** and always returns `409`. The frontend will be wired correctly and verified against
   mocked `kyb_status` values; it cannot be verified end-to-end against a live backend. Log as
   **TD-71** and recommend a backend sub-issue of #1247 (status roll-up / trustee status setter).
2. **No byte-upload transport** (#1267). `UploadDocumentRequest.file_ref` is documented as "the
   caller supplies an already-stored file reference" and there is no endpoint that produces one.
3. **No read-back of uploaded documents.** The router exposes `/lps`, `/lps/{id}`,
   `POST /lps/{id}/documents`, `POST /lps/{id}/documents/{doc}/review`,
   `POST /lps/{id}/link-address` — there is **no** `GET` for an LP's documents, and `LpResponse`
   carries no `documents` field (contrary to a common reading of the Issue). The flow therefore
   cannot resume or show per-document review state; it is one-shot within a session.
4. **Registration requires a pre-allow-listed wallet.** `lps_owner_fk` is a FK onto
   `auth_users (chain_id, address)`, and `POST /v1/lps` records `claims.(chain_id, sub)` as the
   owner. A walk-up LP cannot register until #1266 lands an email identity in `auth_users`.

**The `(doc_type, subject)` uniqueness trap.** `idx_kyb_documents_current` is
`UNIQUE (lp_id, doc_type, COALESCE(subject, '')) WHERE is_current`, and `upload_document`
supersedes the prior current row for the same key. Posting N Owners files as `UboId` with no
`subject` would leave exactly **one** current row — silent data loss, not an error. `OwnersModal`
produces a flat `File[]` with no owner identity and no ID/proof-of-address distinction (the spec
is explicit: "there is no name field, no role field… no per-owner grouping"). This is a genuine
design gap, not an implementation choice — see Open Questions. Log as **TD-72**.

**`legal_name` / `country` have no collector.** `CreateAccountModal` gathers email + password
only. Adding a field to a shipped, Figma-verified screen without a Figma node would create a QA
diff and pre-empt the designer. See Open Questions.

**Session-token risk.** Porting the Trustee's wallet challenge → sign → verify session into the
LP app (it would need `signMessage` added to `packages/frontend/src/wallet/stellar/useStellarWallet.ts`,
which today exposes `signTransaction` only; the LP app does not depend on `@pipeline/wallet-connect`)
is **deliberately not done here**: the epic resolved the identity model as *account-first*, so the
login identity will be email (#1266), and a wallet-sign LP session would be throwaway work that
#1265 immediately replaces. This plan builds the durable half (a session store + header injection)
and fills it from a dev-only affordance. If the user would rather have the wallet-sign path now,
it is an additive change to the same store.

**Blast radius on `apiFetch`.** `client.ts` is used by every LP data hook. The change is additive
(header injection when a token exists; `Error` → `ApiError extends Error` with `.status`), and all
existing call sites read only `error.message`, so no behavioural change is expected — but
`client.test.ts` and every hook test that asserts on thrown errors must be re-run.

## Open Questions

1. **Where are `legal_name` and `country` collected?** `POST /v1/lps` requires a non-empty
   `legal_name`; no shipped screen collects it, and the epic's screens were built from Figma
   node-by-node. Options: (a) the designer adds the fields to Create-account (#1265's screen),
   (b) a new "Company details" step before Company Docs, (c) `legal_name` is derived from the
   `contact_email` domain (poor). Until answered, `useKybFlow` takes them as inputs and `/test`
   supplies them from a dev-only form — production collects nothing. *(The user has already
   flagged this to the designer.)*
2. **How does the Owners step produce `doc_type` and `subject` per file?** The backend models
   one `UboId` + one `UboProofOfAddress` **per named subject**, and the unique index silently
   collapses same-key uploads (see Assumptions). The shipped screen is a flat multi-file drop
   zone by design. Does the designer add per-owner grouping (owner name + two labelled slots,
   the shape Company Docs already uses), or should the frontend synthesise a `subject`
   (e.g. `"owner-1"`) and guess `doc_type` from filename/order? The second is guessing at
   compliance data and is not proposed. Until answered, the Owners → API leg is **not** wired:
   `useUploadKybDocument` supports both fields, `useKybFlow` advances the step but posts nothing
   and surfaces an explicit reason. Related: TD-66 already flags the ≥1-file Submit threshold as
   undesigned.
3. **Should `docs/product-specs/lp-onboarding.md` be corrected?** Its line 7 still states
   "Lender onboarding does not require KYC, KYB, or accreditation declarations" — contradicted by
   epic #1247 and the landed `/v1/lps/*` group. Changing product intent is not a frontend
   planner's call; this plan proposes a one-line reconciliation pointer only if approved.

## Implementation Steps

Work on `feat/1254-kyb-data-wiring` (already cut from `main` with #1248–#1253 merged).

### 1. Session store — `packages/frontend/src/api/lpSession.ts` (new)

Module-level external store for the backend-issued JWT, persisted in **`sessionStorage`** under
`pipeline.lp.session` (must not outlive the tab; deliberately *not* a `pipeline.mock.*` key — it
holds a real credential, not a mock). Model on `packages/trustee/src/auth/sessionStore.ts` but
strip the status machine and routing — this store needs only:

- `interface StoredLpSession { token: string; expiresAt: number }`
- `getLpSessionToken(): string | undefined` — returns `undefined` when absent or expired
  (`Date.now() >= expiresAt`), clearing expired storage
- `setLpSession(token: string, expiresInSecs: number): void`, `clearLpSession(): void`
- `useLpSessionToken(): string | undefined` via `useSyncExternalStore`, so the `/test` harness
  re-renders on change
- All `sessionStorage` access wrapped in `try/catch` (private browsing), falling back to
  in-memory state — same treatment as the Trustee store.

### 2. `apiFetch` — `packages/frontend/src/api/client.ts` (edit)

Additive, in this order (mock layer must stay **first**, so tests and DevTools mocks keep working
with no token):

1. Keep the existing two-key mock lookup untouched.
2. Before the real `fetch`, build `const headers = new Headers(init?.headers)` and, when
   `getLpSessionToken()` returns a token, `headers.set("Authorization", \`Bearer ${token}\`)`.
   Pass `{ ...init, headers }` to `fetch`.
3. Port the typed errors from `packages/trustee/src/api/client.ts`: `ApiError extends Error` with
   a readonly numeric `status`, and `ApiUnauthorizedError extends ApiError` (status 401). Throw
   `ApiUnauthorizedError` on 401 and `ApiError(message, status)` otherwise, keeping the existing
   "JSON body `error` field, else `statusText`" message rule. Do **not** port the empty-2xx-body
   handling — every `/v1/lps/*` success returns a JSON body (verified against the handlers).
4. Export `ApiError` / `ApiUnauthorizedError` from `packages/frontend/src/api/index.ts`.

### 3. API hooks — `packages/frontend/src/api/` (new files, each with a co-located `.test.tsx`)

Follow the repo idiom exactly: React Query, `apiFetch`, one 2–3-line spec-pointer header per file
and **no other comments** (AGENTS.md hard rule), types co-located with the hook.

- **`useLp.ts`** — owns the shared response types, since it is the only reader:

  ```ts
  export type KybStatus =
    | "NotStarted" | "InProgress" | "UnderReview" | "Passed" | "Failed";
  export interface LpResponse {
    id: number;
    legal_name: string;
    country: string | null;
    contact_email: string;
    stellar_address: string | null;
    address_linked_at: string | null;
    kyb_status: KybStatus | (string & Record<never, never>);
    owner_chain_id: number;
    owner_address: string;
    created_at: string;
  }
  ```

  `useLp(lpId?: number)` → `useQuery` on `["lp", lpId]`, `enabled: lpId !== undefined`,
  `refetchInterval: 30_000` (the documented dashboard polling convention in `docs/FRONTEND.md`;
  `useLoanBook`/`useLoanSubmissions` set the precedent). Returns
  `{ data, isLoading, error, refetch }`. `kyb_status` is typed open (`string & Record<never, never>`
  union, the `SubmissionView.status` precedent) so an unknown backend value renders rather than
  crashing — display it verbatim, never derive.

- **`useRegisterLp.ts`** — `useMutation<{ id: number }, Error, RegisterLpInput>` where
  `RegisterLpInput = { legal_name: string; country?: string; contact_email: string }`.
  `POST /v1/lps` with `Content-Type: application/json`. On success invalidate `["lp"]`.

- **`useUploadKybDocument.ts`** —

  ```ts
  export type KybDocType =
    | "CertificateOfIncorporation" | "RegistryRecord" | "GoodStanding"
    | "LegalAddress" | "ShareholderRegister" | "UboId" | "UboProofOfAddress";
  export interface UploadKybDocumentInput {
    lpId: number;
    doc_type: KybDocType;
    subject?: string;
    file_ref: string;
  }
  ```

  (String values verified against `DocType::as_str` in `packages/shared/src/kyb_document_repo.rs`
  and the migration's CHECK constraint.) `useMutation` → `POST /v1/lps/{lpId}/documents`, omitting
  `subject` when undefined. On success invalidate `["lp", lpId]`.

- **`useLinkStellarAddress.ts`** — `useMutation<LpResponse, Error, { lpId: number; stellar_address: string }>`
  → `POST /v1/lps/{lpId}/link-address`. On success invalidate `["lp", lpId]`. The caller is
  responsible for only calling it when `kyb_status === "Passed"` (the backend's 409 is the
  backstop, not the gate).

- **`packages/frontend/src/api/index.ts`** — export all four hooks and their types.

### 4. Entity doc-type mapping — `packages/frontend/src/components/useCompanyDocsModal.ts` (edit)

The five slot ids map 1:1 to the five entity `doc_type`s. Add a single exported constant next to
`COMPANY_DOCUMENT_SLOTS` (keeping the existing slot ids and labels **unchanged** — they are
asserted by `CompanyDocsModal.test.tsx`):

```ts
export const COMPANY_DOCUMENT_SLOT_DOC_TYPES = {
  "certificate-of-incorporation": "CertificateOfIncorporation",
  "registry-of-legal-entities": "RegistryRecord",
  "certificate-of-good-standing": "GoodStanding",
  "legal-address": "LegalAddress",
  "shareholder-register": "ShareholderRegister",
} as const satisfies Record<CompanyDocumentSlotId, KybDocType>;
```

No other change to the modal or its hook — the `onSubmit(documents: Record<slotId, File>)` seam
already carries everything the flow needs.

### 5. Flow orchestration — `packages/frontend/src/components/useKybFlow.ts` (new)

```ts
export type KybFlowStep = "company-docs" | "owners" | "in-review" | "closed";

export interface UseKybFlowOptions {
  open: boolean;
  legalName: string;
  contactEmail: string;
  country?: string;
  /** #1267 seam: resolves an already-stored file reference for a picked File.
   *  Absent until the backend upload transport lands. */
  resolveFileRef?: (file: File) => Promise<string>;
  onClose?: () => void;
}
```

Behaviour:

- Holds `step`, `lpId`, and a `blockedReason: string | undefined`.
- On open with no `lpId`, calls `useRegisterLp` once (single-flight `useRef` guard, the
  `TrusteeSessionProvider.orchestratingRef` precedent) and stores the returned `id`. A failure
  sets `blockedReason` from `error.message` and leaves the step where it is.
- **Company Docs submit** — when `resolveFileRef` is absent, sets
  `blockedReason = "Document upload is not available yet (#1267)."`, advances the step **without**
  posting. When present, resolves each of the five files to a `file_ref` and posts five
  `useUploadKybDocument` mutations (sequential, so a mid-sequence failure reports which slot
  failed), then advances to `"owners"`.
- **Owners submit** — advances to `"in-review"` and sets
  `blockedReason = "Owner documents need a per-owner doc_type and subject (#1254 open question)."`
  No POST fires (see Open Question 2 and TD-72 — an unkeyed multi-file post would silently
  collapse to one row).
- **In-review** — subscribes to `useLp(lpId)` and exposes `kybStatus` **verbatim**. Maps to the
  screen: `Passed` enables the link-address action; every other value (including an unrecognised
  one) renders the plain Account-in-review state. Render `—` for a missing status; never compute
  a status client-side.
- **Link address** — exposes `linkAddress(stellarAddress)` calling `useLinkStellarAddress`, and a
  `canLinkAddress = kybStatus === "Passed" && !lp?.stellar_address` flag.
- Returns `{ step, lpId, kybStatus, lp, blockedReason, canLinkAddress, handleCompanyDocsSubmit,
  handleOwnersSubmit, handleGoToApp, linkAddress, isRegistering, isSubmitting }`.

### 6. Flow container — `packages/frontend/src/components/KybFlow.tsx` (new)

JSX-and-wiring only (FRONTEND rule 2). Renders **exactly one** modal at a time, selected by
`step` — never two mounted with `open` true. This is load-bearing: `AuthModalShell`'s
body-scroll-lock and capture-phase Escape are documented as **not stack-safe**, which is the
stated reason the `/test` triggers were kept independent in #1250–#1253.

- `step === "company-docs"` → `<CompanyDocsModal open onDismiss={close} onSubmit={handleCompanyDocsSubmit} />`
- `step === "owners"` → `<OwnersModal open onDismiss={close} onSubmit={handleOwnersSubmit} />`
- `step === "in-review"` → `<AccountInReviewModal open onDismiss={close} onGoToApp={handleGoToApp} />`
  (`onNotifyMe` stays at its no-op default — TD-70, no endpoint exists.)
- `blockedReason`, when set, renders in the flow container **outside** the modal shell (a
  `data-testid="kyb-flow-blocked"` line), so no shipped screen's DOM changes.

The `Back` text on `OwnersModal` stays inert — it ships with no handler and no `onBack` seam prop
(spec, #1252); giving it one is a component change with no Figma and belongs to whoever adds the
designed affordance.

### 7. Diagnostics harness — `packages/frontend/src/routes/test.tsx` (edit `AuthTab`)

Keep all six existing triggers and their stand-in confirmation lines **unchanged**. Add, below
them, a separate "Wired KYB flow (#1254)" block:

- A dev-only bearer-token field: `<TextField>` + "Set session token" / "Clear" buttons calling
  `setLpSession` / `clearLpSession`, plus a line showing whether a token is present. `/test` is
  already dev-gated (`beforeLoad` redirects when `!ENV.IS_DEV`), so this affordance cannot reach
  production. A short note points at the staging-JWT convention.
- Dev-only `legal_name` / `country` / `contact_email` inputs (Open Question 1's stand-in).
- An "Open wired KYB flow" trigger mounting `<KybFlow>` with a dev `resolveFileRef` —
  `async (file) => \`dev/${lpId}/${file.name}\`` — so the sequence and the four hooks are
  exercisable end-to-end locally. The resolver is supplied **by the harness, not by the flow**;
  `KybFlow` itself ships no default resolver, so no placeholder `file_ref` can ever reach staging
  from a production mount.
- A read-out line showing the live `kyb_status` from `useLp`, and a "Link Stellar address" button
  enabled only when `canLinkAddress`, taking the address from `useStellarWallet().address`.

### 8. Lint + verification

- `yarn lint` / `npx tsc --noEmit` in `packages/frontend`.
- `npx tsx scripts/lint-docs.ts` after the doc edits (required by AGENTS.md for any TS change).
- Confirm no new comments beyond one spec-pointer header per new file (the comment-minimal hard
  rule; TD-54 notes there is no lint guard, so this is a manual check).

## Test Strategy

All new tests are Vitest + `@testing-library/react`, following
`packages/frontend/src/api/useLoanBook.test.tsx`'s structure (mock `@/wallet` and `@/lib/env`,
wrap in a `QueryClientProvider`).

**`packages/frontend/src/api/lpSession.test.ts` (new)**
- `getLpSessionToken` returns `undefined` with nothing stored.
- Round-trips a token through `setLpSession` → `getLpSessionToken`.
- An expired `expiresAt` returns `undefined` **and** clears storage.
- A malformed / non-JSON stored value returns `undefined` rather than throwing.
- A throwing `sessionStorage` (private-browsing simulation) still works in memory.

**`packages/frontend/src/api/client.test.ts` (extend)**
- No token → **no** `Authorization` header on the outgoing request.
- Token present → `Authorization: Bearer <token>` exactly once, and caller-supplied headers
  (e.g. `Content-Type`) survive.
- The mock-key path short-circuits **before** any token read — a mocked call must not require a
  session (this is what keeps every existing hook test passing).
- 401 throws `ApiUnauthorizedError` with `status === 401`; 403/409 throw `ApiError` carrying the
  right `.status`; the JSON `error` field still wins over `statusText`.

**Per-hook tests** (`useRegisterLp`, `useUploadKybDocument`, `useLp`, `useLinkStellarAddress`)
- Mock-key path returns the fixture with no `fetch` call (`pipeline.mock.api.POST./v1/lps`,
  `…POST./v1/lps/7/documents`, `…GET./v1/lps/7`, `…POST./v1/lps/7/link-address`).
- Real path issues the right method, path, and JSON body — including that `subject` is **omitted**
  (not `null`) when undefined, and that `country` is omitted when undefined.
- `useLp` is disabled while `lpId` is `undefined` (no fetch fires) and enabled once set.
- Error path populates `error` with the backend's `error` message and preserves `.status`.

**`packages/frontend/src/components/useKybFlow.test.tsx` (new)** — the behavioural core:
- Opening registers exactly **once** even across re-renders (single-flight guard).
- A registration failure sets `blockedReason` and does not advance.
- **No `resolveFileRef`**: submitting Company Docs advances to `owners`, fires **zero** document
  POSTs, and sets the #1267 `blockedReason`. (Guards the honest-deferral decision against
  regression.)
- **With `resolveFileRef`**: submitting posts exactly five documents with the five expected
  `doc_type` values in slot order, each with the resolved `file_ref` and **no** `subject`.
- A mid-sequence document failure stops the run and reports the failing slot.
- Owners submit advances to `in-review` and fires **zero** POSTs (guards TD-72).
- `kyb_status` drives the in-review state: `NotStarted`/`InProgress`/`UnderReview`/`Failed` →
  `canLinkAddress === false`; `Passed` → `true`; `Passed` with a non-null `stellar_address` →
  `false`; an unrecognised status string renders without throwing.
- `linkAddress` posts the connected address and surfaces a 409 as an error message, not a crash.

**`packages/frontend/src/components/KybFlow.test.tsx` (new)**
- Exactly one modal is in the DOM per step (assert the other two `testId`s are absent) — the
  stack-safety invariant.
- `blockedReason` renders outside the modal shell.

**Regression guards (must stay green, unmodified):** `CompanyDocsModal.test.tsx`,
`OwnersModal.test.tsx`, `AccountInReviewModal.test.tsx`, `SignInModal.test.tsx`,
`CreateAccountModal.test.tsx`, `OtpModal.test.tsx`, `OtpInput.dom.test.tsx`. If any of these needs
an edit, the change has leaked into a shipped screen and must be reverted.

**`packages/frontend/src/routes/-test.test.tsx` (extend)** — the six original triggers and their
stand-in lines still render; the new wired-flow block renders alongside them; the route still
redirects when `!ENV.IS_DEV` (`-test-route-dev-only.test.tsx` unchanged).

**Figma verification.** This slice adds no new visual node — epic file `A43rjYYjSwdTmiwwf5cx5n`
has no frame for a wired flow, a session-token field, or a blocked-reason line (all of which live
in the dev-only `/test` harness, outside the modal shells). Verification is therefore a
**regression** check: the Company Docs (`6486-81679` / `6486-81817`), Owners (`6486-81710` /
`6486-81783`), and Account-in-review (`6486-81745` / `6486-81764`) frames must still match their
rendered screens pixel-for-pixel when reached through `KybFlow` rather than the standalone
trigger. Capture each via the local Dev Mode MCP (`127.0.0.1:3845`) and compare, per the epic's
established practice.

**Manual smoke** (local, with a staging bearer token pasted into `/test?tab=auth`): register →
observe the `201` and the returned `id` in the Network tab → `GET /v1/lps/{id}` returns
`kyb_status: "NotStarted"` → confirm the document POSTs carry the right `doc_type`s. Do **not**
expect `Passed` or a successful link-address — both are backend-blocked (TD-71). Per the
"verify real data" rule, check the Network tab, not the rendered text.

## Docs to Update

- **`packages/frontend/src/api/README.md`** — add `useRegisterLp` / `useUploadKybDocument` /
  `useLp` / `useLinkStellarAddress` to the public API list and type table; document the four new
  mock keys (`pipeline.mock.api.POST./v1/lps`, `…POST./v1/lps/<id>/documents`,
  `…GET./v1/lps/<id>`, `…POST./v1/lps/<id>/link-address`) with a DevTools snippet that seeds each
  `kyb_status` value; document the new `Authorization` injection and the `ApiError`/
  `ApiUnauthorizedError` contract, stating explicitly that the mock layer is consulted **before**
  the token so mocked calls need no session.
- **`docs/frontend/auth-components.md`** — new `### KybFlow` section (step machine, the
  one-modal-at-a-time stack-safety rule, the `resolveFileRef` seam and why no default resolver
  exists, the `kyb_status` → screen-state mapping, what is deliberately not posted and why);
  update the "Diagnostics preview seam" section for the seventh trigger; update the `onSubmit`
  seam notes on the Company Docs / Owners / Account-in-review sections from "#1254 seam" to
  "consumed by `KybFlow`". Update the `docs/frontend/index.md` blurb, which still describes the
  doc as sign-in/create-account/OTP only.
- **`docs/frontend/hooks.md`** — one row per new `@/api` hook (the file already catalogues
  `useLoanBook`, `useStatsYield`, etc.), each naming its endpoint, polling behaviour, and mock key.
- **`docs/user-stories/epic-1247/1254-kyb-data-wiring.md`** (new) + a row in
  `docs/user-stories/index.md` under Epic #1247. Stories must be executable from
  `/test?tab=auth` with a token and must state up front which outcomes are backend-blocked
  (TD-71/TD-72), so the QA agent does not file them as defects.
- **`docs/exec-plans/tech-debt-tracker.md`** — next free id is **TD-71**:
  - **TD-71**: `kyb_status` never leaves `NotStarted` — no repo/route writes it, so
    `link-address` (which requires `Passed`) is unreachable and the LP's review state cannot
    progress. Recommend a backend sub-issue of #1247.
  - **TD-72**: the Owners step cannot produce `doc_type`/`subject`, and
    `idx_kyb_documents_current` silently collapses same-key uploads to one current row — so the
    Owners → API leg ships unwired.
- **`docs/product-specs/lp-onboarding.md`** — only if Open Question 3 is answered yes.
- On completion the manager archives this plan to `docs/exec-plans/completed/`.
