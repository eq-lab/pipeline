# Issue #1390: tech-debt-tracker.md — reconcile two diverged `## Post-MVP` sections and end the numbering collisions

Source: https://github.com/eq-lab/pipeline/issues/1390

Branch: `docs/1390-tech-debt-tracker-merge` (off `main`) · Draft PR #1406 · No epic parent.

**Read the Issue's correcting comment, not its body.** The body says the two `## Post-MVP` blocks
hold byte-identical entries and that the first is a stale merge artifact to delete. Both halves are
false. The authoritative account is the Issue comment and `### BUG-24` in
`docs/exec-plans/known-bugs.md` (corrected 2026-10-01).

---

## Scope

One file is the subject: `docs/exec-plans/tech-debt-tracker.md` (1651 lines, 115 `### TD-` entries
over 99 distinct numbers). Three changes:

1. **Merge the two `## Post-MVP` sections into one**, entry by entry, with every contested claim
   re-verified against the code. The blocks have *diverged*, not duplicated — each holds content the
   other lacks and **neither supersedes the other wholesale**.
2. **End the numbering collisions.** `## Known Gaps` and the Post-MVP blocks run independent
   sequences over the same integer range, so 13 numbers each name two or three unrelated entries.
3. **Sweep inbound references** so each one points at the entry its author meant. They live in
   **code** as well as docs.

Out of scope: fixing any of the debts themselves; splitting the tracker into multiple files (argued
below — not necessary, and the linter does not force it); touching `known-bugs.md` beyond BUG-24
(see Open Questions for BUG-21).

### Baseline, measured on `44da5f0`

| Measure | Command | Value |
| --- | --- | --- |
| `## Post-MVP` headings | `grep -c '^## Post-MVP' docs/exec-plans/tech-debt-tracker.md` | 2 |
| `### TD-` lines (incl. the `### TD-<N>` template inside the `## Format` fence) | `grep -c '^### TD-' …` | 116 |
| real numbered entries | `grep -coE '^### TD-[0-9]+' …` | 115 |
| distinct numbers | `grep -oE '^### TD-[0-9]+' … \| grep -oE '[0-9]+' \| sort -nu \| wc -l` | 99 (TD-1…TD-99, no gaps) |
| colliding numbers | `grep -oE '^### TD-[0-9]+' … \| sort \| uniq -d \| wc -l` | 13 |
| file lines | `wc -l < …` | 1651 |
| `npx tsx scripts/lint-docs.ts` | — | **0 errors, 42 warnings** |

The 13 colliding numbers, with multiplicity: TD-80 ×3, TD-81 ×3, TD-82 ×3, and TD-7, TD-73, TD-83,
TD-84, TD-85, TD-86, TD-87, TD-88, TD-92, TD-93 each ×2. Note this is **13 numbers, not the 5 the
Issue comment and BUG-24 name** — they missed TD-7, TD-73 (BUG-21's pair) and TD-83…TD-88.

---

## Verified findings — the per-entry table

Line numbers are from `44da5f0`. "Block A" = the first `## Post-MVP` (heading at line 1471);
"Block B" = the second (heading at 1508). The two blocks' six roadmap preamble bullets
(1472–1479 / 1509–1516) are **byte-identical** — verified by `diff`.

### Entries that differ between the two Post-MVP blocks

| # | Block A (1471–) | Block B (1508–) | Accurate | Deciding code |
| --- | --- | --- | --- | --- |
| **TD-80** | "Email/password sessions cannot be revoked" — "`AuthClaims` never reads the account row", so suspension "takes up to 24h to bite" | Same title. Records **"Closed by #1380"**: `AuthClaims` reads `accounts.status` every request via `account_status::gate_request`, and both mint paths refuse a suspended account via `gate_token_issue` | **Block B** | `packages/api/src/auth.rs:27` (`use crate::account_status::gate_request`), `:216` (`gate_request(status.as_deref())` inside the `AuthClaims` extractor, after `account_repo.find_status`); `packages/api/src/account_status.rs:21` (`gate_token_issue`), `:31` (`gate_request`); callers at `packages/api/src/routes/auth/password.rs:269` and `:406` |
| **TD-81** | "No rate limiting on signup / resend-otp" — `POST /v1/auth/login` "is **now bounded** (3 attempts per 60s per address and per client, `login_attempts`)" | "No rate limiting on the unauthenticated auth endpoints" — "`login` has neither captcha nor cooldown" / "Credential stuffing against `login` is **unthrottled**" | **Block A.** Block B's central claim is **false** | `packages/api/src/routes/auth/password.rs:140` `MAX_LOGIN_ATTEMPTS: i32 = 3`, `:143` `LOGIN_ATTEMPT_WINDOW_SECS: i32 = 60`, `:148` the `attempts_including_this <= MAX_LOGIN_ATTEMPTS` test, `:359–367` `login_attempt_repo.record(AttemptScope::Email …)` + `(AttemptScope::Ip …)` and `:413–417` the clear-on-success, all inside `pub async fn login` (`:344`); `packages/shared/src/login_attempt_repo.rs`; migration `packages/shared/migrations/20260922000002_login_attempts.sql`. Block A's "per address and per client" = `AttemptScope::Email` / `AttemptScope::Ip` |
| **TD-82** | "No mobile frames for the Account page" — a **frontend** entry, **byte-identical** to the `## Known Gaps` TD-82 at 1299–1307 (verified by `diff`) | "`lps.owner_chain_id` / `owner_address` are dead authorization columns" — an unrelated **backend** entry | **Both, of different things.** Block A's copy is a stray duplicate of the Known Gaps entry; Block B's is the real Post-MVP TD-82 | Frontend: `packages/frontend/src/components/account/AccountPage.tsx`. Backend: `packages/shared/src/lp_repo.rs:11–16` (module comment: "they are history, not authorization (TD-82)"), `:253–259` (`owner_account_id` / `owner_chain_id` / `owner_address` fields), `:326–356` `upsert_by_owner_account_id` (writes the pair on insert only), `:368` `find_by_owner_account_id`; exposure at `packages/api/src/routes/lps.rs:145–146`, `:169–170`; `lp_owner_guard` itself is gone — `packages/api/src/routes/lps.rs:1338` says "Replaces the old `lp_owner_guard`" |

**So the direction of staleness is not uniform.** Block B is newer for TD-80; Block A is newer for
TD-81; for TD-82 the two blocks are not even about the same thing. Any plan that picks a winning
block wholesale — as three epic #1376 plans and this Issue's own body did — gets at least one entry
backwards.

### Block-B-only entries re-verified (the manager's "assume there are others")

| # | Claim checked | Verdict | Deciding code |
| --- | --- | --- | --- |
| TD-83 | "`attempts` is per code, not per account"; budget is "one guess per code"; "`claim_attempt` spends the attempt and checks the ceiling in one statement" | **Accurate** | `packages/api/src/otp.rs:27` `MAX_OTP_ATTEMPTS: i32 = 1`; `packages/api/src/routes/auth/password.rs:259` `claim_attempt(account.id, MAX_OTP_ATTEMPTS)`; `packages/shared/src/otp_repo.rs:159–178` — single `UPDATE otp_codes SET attempts = attempts + 1 … AND attempts < $3` |
| TD-84 | "`roles` still lives on `auth_users`"; wallet login issues `user.roles`, email login issues an empty vec | **Accurate as far as checked** | `packages/api/src/routes/auth/wallet.rs:208` `issue_wallet_token(…, user.roles)`; `packages/api/src/routes/auth/password.rs:494` `roles: Vec<String>` / `:501` `issue_email_token(account_id, roles)`; `packages/shared/src/account_repo.rs:52` `COLUMNS` has **no** `roles`; `packages/shared/migrations/20260922000001_accounts_email_password_auth.sql:44` keeps `roles` on `auth_users`. *Coder to confirm the `roles` argument reaching `:501` on the email path is unconditionally empty.* |
| **TD-85** | "`AccountRepo::set_password_hash` has exactly one caller — signup's re-issue path" | **The cited mechanism is false.** `set_password_hash` **does not exist anywhere in the workspace** (`grep -rn set_password_hash packages/` → no hits). The password now rides on the passcode and is installed by `AccountRepo::verify_email_consuming_code`. The entry's *conclusion* — a verified account's password can never be changed — **still holds** | `packages/shared/src/account_repo.rs:82–90` `insert_unverified_account` ("Create an unverified email account with **no password**. The submitted password rides on the passcode"), `:128–156` `verify_email_consuming_code` with `password_hash = COALESCE($2, password_hash)`. No `forgot-password` / `reset-password` / change-password route exists: `grep -rn "forgot-password\|reset-password\|forgot_password\|reset_password" packages/api/src/` → no hits |
| TD-86 | "`login_attempts` rows are never collected" — keyed not appended, cleared only on a later success | **Accurate** | `packages/shared/src/login_attempt_repo.rs:48–58` (the keyed upsert), `:72` `DELETE FROM login_attempts WHERE scope = $1 AND key = $2` — the only delete, called from the success path (`password.rs:413–417`). No `login_attempts` reference anywhere under `packages/worker/src/` |
| TD-87 | A passcode allows one guess, lives 60s, and cannot be re-sent for 60s | **Accurate** | `packages/api/src/otp.rs:27` `MAX_OTP_ATTEMPTS = 1`, plus `OTP_TTL_SECS` / `OTP_RESEND_COOLDOWN_SECS` imported at `password.rs:36` |
| TD-92 / TD-93 (backend) | `DELETE /v1/lps/me/documents/{doc}` is a hard delete, so a `Rejected` row's `reject_reason` / `reviewed_by` / `reviewed_at` go with it; a `Verified` document cannot be deleted | **Accurate** | `packages/shared/src/kyb_document_repo.rs:192–194` `DELETE FROM kyb_documents WHERE id = $1 AND status <> 'Verified'`; the review columns are written at `:218–229`; handler `packages/api/src/routes/lps.rs:863` `delete_my_document` |

### Known Gaps entries re-verified (the frontend side of the collisions)

| # | Claim checked | Verdict | Notes |
| --- | --- | --- | --- |
| TD-93 (frontend, 1455) | "`AccountDropdown` … nothing imports them outside their own test file any more" | **Accurate** | `grep -rln AccountDropdown packages/frontend/src/` hits 7 files, but 4 are *prose mentions in comments* — `utils/truncateAddress.ts:4`, `wallet/networkSwitcher.ts:24`, `components/ErrorDetailsDialog.dom.test.tsx:108`, `components/TopBar.test.tsx:45` — and the rest are the component, its own test, and the `useAccountDropdown` hook it consumes. *Coder: confirm nothing outside `AccountDropdown.tsx` imports `useAccountDropdown` before restating the claim.* |

**Where a claim cannot be settled from the code, keep the more conservative wording and say so in
the entry.** Do not pick a winner on plausibility. The one place this bites in practice is TD-84's
email-path `roles` argument; if the coder cannot settle it, leave Block B's wording untouched and
note the unverified half.

---

## Numbering decision, argued

### How it happened

`docs/exec-plans/completed/issue-1284-lp-account-page.md:286–287` and `:439–441` record it: #1284
appended frontend entries "TD-74 through TD-82 … **renumbered from TD-73 due to a pre-existing
duplicate TD-73**". That one-slot shift walked the frontend sequence into the TD-80…TD-82 range
#1266 had already used in Post-MVP, and later frontend work (#1283, #1362) continued TD-83…TD-93
straight through the backend's TD-83…TD-88, TD-92, TD-93.

### Option A — one sequence, renumber only what collides (**recommended**)

Move the **frontend / Known Gaps** member of each collision, and the **later-dated** member of each
intra-section duplicate, into a fresh TD-100+ block; every number keeps exactly one holder.

| Old | Entry (line on `44da5f0`) | New |
| --- | --- | --- |
| TD-7 | Same-tab mock bridge not testable in jsdom (76) — dated 2026-05-14, the later of the pair | **TD-100** |
| TD-73 | Create-account password policy is derived from Figma copy only (1190) — 2026-09-21, later of the pair | **TD-101** |
| TD-80 | Wallet-namespace labels diverge three ways across the app (1277) | **TD-102** |
| TD-81 | Account-page wallet row ships a generic glyph (1288) | **TD-103** |
| TD-82 | No mobile frames for the Account page (1299) | **TD-104** |
| TD-83 | Submit/Save enables at ≥ 1 file on both KYB upload surfaces (1309) | **TD-105** |
| TD-84 | Shared KYB upload primitives live under `components/account/` (1323) | **TD-106** |
| TD-85 | `CompanyDocsModal`'s "closing keeps progress" is local state (1338) | **TD-107** |
| TD-86 | Trustee `toUserError`'s 403 copy is hardcoded (1352) | **TD-108** |
| TD-87 | `navigator.clipboard` + 1500 ms "Copied" reset duplicated six ways (1368) | **TD-109** |
| TD-88 | No backend source for LP trust-account wire details (1386) | **TD-110** |
| TD-92 | No UI control to disconnect a wallet after #1362 (1436) | **TD-111** |
| TD-93 | `AccountDropdown` is orphaned dead code after #1362 (1455) | **TD-112** |

TD-7 keeps its line-60 holder (tsbuildinfo, 2026-05-12); TD-73 keeps its line-1173 holder
(unidentified-wire matching queue, 2026-09-18). TD-89, TD-90, TD-91 are already unique and **do not
move** — renumbering them would be churn that invalidates archived references for no gain. The
section's numbering is already non-monotonic throughout (TD-7 before TD-6, TD-22 before TD-21,
TD-26 before TD-25, TD-88 before TD-87 inside Post-MVP), so leaving a gap is not a new defect.

**Cost.** 8 live inbound references change (sweep table below). Archived plans keep citing the old
numbers and are not rewritten, so for those 13 entries an archived `TD-8x` now resolves to a
*different* live entry than its author meant — the same hazard that exists today, reduced from 13
numbers to 13 archived-only numbers.

**Why the frontend side moves rather than the backend side.** The backend side carries **11** live
inbound references (three product specs, `lp_repo.rs` ×2, `error.rs`, `login_attempts.sql`), the
frontend side **8**. Product specs are living documents read far more often than frontend
component docs. Both sides are equally cited by archived plans, so that consideration is a wash.
Flipping the recommendation is cheap if a human prefers it: the mapping table is the only thing
that changes.

**Option A is not sufficient on its own.** Post-MVP's highest number is TD-99, so the next appender
takes TD-100 — colliding with the new frontend block immediately. The renumber **must** be paired
with a single authority for the next free number. So Option A as recommended is: the mapping above,
plus a `Next free number: TD-113` line in the `## Format` block and one sentence stating that the
whole file is one sequence and a new entry takes the next free number *regardless of which section
it lands in*.

### Option B — separate prefixes (`TD-F<N>` / `TD-B<N>`)

**Benefit.** Ends the class of bug structurally: a frontend and a backend entry can never share an
identifier again, and an archived `TD-42` is visibly from the old scheme rather than silently
resolving to the wrong live entry.

**Cost.** Invalidates **every** inbound reference, not just the colliding ones: ~37 in code and ~90
in live docs (`grep -rnoE "TD-[0-9]+"` over `packages/` and `docs/`, excluding the tracker and
`docs/exec-plans/completed/`). That is a far larger mechanical diff across far more files, each one
a chance to point a reference at the wrong entry — in a change whose whole purpose is reference
integrity. It also forces a frontend/backend classification onto every one of the 112 entries,
several of which are neither (TD-1, TD-2, TD-11, TD-32). Rejected on cost and on the classification
problem, not on principle.

### Option C — renumber and add a linter guard

Option A plus a new check in `scripts/lint-docs.ts` that **errors** on a duplicate
`^### TD-[0-9]+` heading in `docs/exec-plans/tech-debt-tracker.md`. This is the cheapest thing that
actually ends the class of bug: the failure was *nobody noticed the duplicate for months*, not
*numbers are ambiguous in principle*, and a lint error would have caught every one of the 13 on the
commit that introduced it. It must land **after** the renumber or it fails the gate immediately.

**Recommendation: Option A, and Option C's guard if the manager wants it in this Issue.** See Open
Questions — adding a new error class to `scripts/lint-docs.ts` is a behavior change to the shared
docs gate, and that is a call for a human, not for me.

---

## Inbound-reference sweep

Each reference below was read in context, so the entry its author meant is known. **The number alone
is not enough** — `bank-transfers.md:214` and `auth-components.md:286` both say "TD-73" and mean the
two *different* TD-73 entries.

### Code (existing spec-pointer comments — adjust the number in place, add no prose; `AGENTS.md` "Comment-less code")

| Reference | Cites | Means | Action |
| --- | --- | --- | --- |
| `packages/shared/src/lp_repo.rs:16` | TD-82 | backend — dead authorization columns ("they are history, not authorization (TD-82)") | **no change** (backend keeps TD-82) |
| `packages/shared/src/lp_repo.rs:296` | TD-82 | backend — same, inside `upsert_by_owner_account_id`'s doc comment | **no change**. *Note: the Issue and the manager's brief both say `:292`; on `44da5f0` it is `:296`. Re-grep rather than trusting the line number.* |
| `packages/api/src/error.rs:42` | TD-81 | backend — "Reserved for the per-IP limiting in TD-81" | **no change** (backend keeps TD-81) |
| `packages/shared/migrations/20260922000002_login_attempts.sql:20` | TD-86 | backend — "stale keys are never collected. See TD-86" | **no change** (backend keeps TD-86). **Not in the Issue's or the manager's list — found by this sweep.** |
| `packages/frontend/src/components/AccountDropdown.test.tsx:20` | TD-93 | frontend — "no longer composed by `TopBar` as of issue #1362 … TD-93" | **TD-93 → TD-112** |

Every other `TD-<N>` in code cites a non-colliding number (TD-8, TD-9, TD-18, TD-19, TD-26, TD-33,
TD-41, TD-42, TD-45, TD-57) — leave them all alone. Full list:
`grep -rnoE "TD-[0-9]+" --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.sql" . | grep -v node_modules | grep -v "/target/" | sort -u`

### Live docs

| Reference | Cites | Means | Action |
| --- | --- | --- | --- |
| `docs/product-specs/api-authorization.md:75` | TD-80 | backend — "Tokens still cannot be revoked individually (TD-80)" | no change |
| `docs/product-specs/api-authorization.md:117` | TD-82 | backend — "`owner_chain_id`/`owner_address` are history only … read by nothing (TD-82)" | no change |
| `docs/product-specs/api-authorization.md:199` | TD-80 | backend — "*suspension*, read fresh each request, bites immediately (TD-80)" | no change. **Not in the manager's list — found by this sweep.** |
| `docs/product-specs/api-authorization-email.md:110` | TD-81 | backend — "Per-IP and global rate limiting is not yet implemented — see TD-81" | no change |
| `docs/product-specs/api-authorization-email.md:137` | TD-87 | backend — the fumbled-digit dead end | no change. **Not in the manager's list.** |
| `docs/product-specs/kyb-lp-verification.md:83` | TD-80 | backend — already disambiguates in prose: "the tracker holds a second, unrelated TD-80" | number unchanged; **delete the parenthetical disambiguation**, which is obsolete once TD-80 is unique |
| `docs/product-specs/lp-onboarding.md:187` | TD-80 | backend — "Email sessions cannot currently be revoked … Tracked as TD-80" | no change. **Not in the manager's list.** |
| `docs/frontend/bank-transfers.md:214` | TD-73 | frontend/backend gap — "no unidentified-wire matching queue (TD-73)" = the line-1173 holder, which **keeps** TD-73 | no change |
| `docs/frontend/bank-transfers.md:252` | TD-82 | frontend — "No mobile frames … (same call as TD-82)" | **TD-82 → TD-104** |
| `docs/frontend/auth-components.md:286` | TD-73 | frontend — the create-account password policy, the line-1190 holder | **TD-73 → TD-101** |
| `docs/frontend/auth-components.md:513` | TD-83 | frontend — "Submit enables at ≥ 1 file (TD-83)" | **TD-83 → TD-105**. **Not in the manager's list.** |
| `docs/user-stories/epic-1247/1278-kyb-company-docs-v1.md:19` | TD-83 | frontend — Submit enables at ≥ 1 file | **TD-83 → TD-105** |
| `docs/user-stories/epic-1247/1278-kyb-company-docs-v1.md:21`, `:166` | TD-85 | frontend — "closing keeps progress is local React state" | **TD-85 → TD-107** |
| `docs/exec-plans/known-bugs.md:23`, `:25` | TD-80/81/82/92/93 | BUG-24's own text | rewritten by Step 8 |
| `docs/exec-plans/known-bugs.md:44`, `:49`, `:51`, `:56` | TD-73 | BUG-21's text, about the TD-73 collision this Issue resolves | **see Open Questions** |
| `docs/exec-plans/known-bugs.md:55` | TD-87 | backend — the fumbled-digit entry, inside BUG-21 | no change |

No plan under `docs/exec-plans/active/` cites a colliding number — verified. `docs/FRONTEND.md`,
`docs/frontend/account-page.md`, `dashboard-components.md`, `error-handling.md`, `trustee-flows.md`,
`ui-components.md` and the other `docs/user-stories/` files cite only non-colliding numbers.

### What not to touch

- **Everything under `docs/exec-plans/completed/`** — archived exec plans. They cite the old numbers (~15 files,
  heavily: `issue-1274`, `issue-1283`, `issue-1284`, `issue-1362`, `issue-1368`, `issue-1378`,
  `issue-1379`, `issue-1380` among them). They are a historical record of what was true when they
  were written and **must not be rewritten.** A coder who "helpfully" fixes them destroys the
  provenance that made this bug diagnosable in the first place — `issue-1284-lp-account-page.md:286`
  is the only surviving evidence of how the collision was introduced.
- **`docs/initial_spec.md`** — same reasoning: a historical document. (It happens to contain no
  `TD-` references at all, so there is nothing to do; the rule is stated so nobody goes looking.)
- Any `TD-<N>` citing a number not in the 13-number collision set.

---

## Assumptions and Risks

- **Assumption:** #1384 and #1385 have merged. The Issue deferred this work until they did, because
  both carried tracker edits (#1385 appended TD-99, which is present on `44da5f0`). Confirm with
  `gh pr view 1384 --json state` / `1385` before starting; if either is still open, stop — a
  renumber under an in-flight branch is exactly the conflict the deferral exists to avoid.
- **Risk — inverting a claim.** This is the realized failure mode, twice over (Block B's TD-81, and
  TD-85's `set_password_hash`). Mitigation: the verification table above, and the rule that an
  unsettleable claim keeps its more conservative wording.
- **Risk — a renumber that silently mis-points a reference.** Mitigation: every live reference was
  read in context, and the target recorded, before any edit. Do **not** `sed` the renumber across
  files; each of the 8 live reference edits is individually targeted.
- **Risk — anchoring an edit on `### TD-<N>` alone.** While the duplicates still exist a string edit
  anchored on the heading text is ambiguous and will either fail or hit the wrong entry (BUG-24's
  documented workaround; two epic #1376 plans had to route around it). Anchor on heading **plus**
  the subtitle, or on the entry's unique `- **Location:**` line, until Step 4 has made numbers
  unique.
- **Risk — the file's size.** 1651 lines. Confirmed **not** a linter problem: `checkSpecSize` in
  `scripts/lint-docs.ts:275–292` reads only `docs/product-specs/` (warn >150, error >200) and the
  tracker is not under it. No check in `scripts/lint-docs.ts` caps any other file's length, so no
  hard cap can be tripped by a restructure. **Splitting the tracker is therefore not forced and is
  out of scope.** A split would additionally have to satisfy `checkReachability`
  (`scripts/lint-docs.ts:62–131`: every `docs/**/*.md` must be reachable from `AGENTS.md`), making
  it a strictly larger change than this Issue.
- **Risk — markdown formatting regressions.** `checkMarkdownFormatting` errors on unclosed fences
  and warns on trailing whitespace and a missing trailing newline. The tracker's `## Format` section
  contains a fence; a restructure that touches the top of the file must leave it closed.
- Note the tracker mixes line-wrapped entries (the older frontend ones, wrapped ~100 cols) with
  unwrapped ones (the Post-MVP backend ones, one long line per bullet). Preserve each entry's
  existing wrapping when moving it; do not reflow, which would bury the real diff.

---

## Open Questions

1. **Does the `scripts/lint-docs.ts` duplicate-heading guard (Option C) land in this Issue or as a
   follow-up?** It is the only change that ends the class of bug rather than clearing the current
   instance, and it is ~15 lines. But it adds a new **error** class to the shared docs gate that
   every future branch must satisfy, which is a project-wide decision rather than a docs fix. My
   recommendation is to include it; I am not willing to add an error class to a shared gate on my
   own judgment.
2. **Does `### BUG-21` get closed too?** The manager scoped `known-bugs.md` to "closing out BUG-24",
   but BUG-21 is precisely the TD-73 duplicate that Step 4 resolves, and its "Workaround" ("New
   entries from #1283 onward start at TD-87, skipping the ambiguous range") becomes misleading once
   the file has a single next-free-number authority. Leaving it open records a bug that no longer
   exists; closing it is a second `known-bugs.md` edit the brief did not authorize.
3. **After the merge, is the `## Known Gaps` / `## Post-MVP` split still meaningful, and should the
   backend auth/KYB entries (TD-83…TD-99) stay under `## Post-MVP`?** The section opens with six
   roadmap bullets ("Automated bank integration", "GenTwo MTN issuance") that are not tech debt at
   all, and several entries under it (TD-96, TD-97, TD-99) describe live defects rather than
   post-MVP ambitions. I have deliberately **not** moved any entry between sections — that is a
   taxonomy decision for whoever owns the tracker, and doing it in the same change as the renumber
   would make the diff unreviewable.
4. **Are `docs/user-stories/epic-1247/*` docs live or historical for the purposes of the sweep?** I
   have treated them as **live** and included `1278-kyb-company-docs-v1.md` in the renumber, on the
   grounds that the QA agent executes user-stories docs. If they are meant to be frozen alongside
   the archived exec plans, drop those three edits.

---

## Implementation Steps

Work strictly in this order. Steps 1–3 leave the numbers still colliding, so Step 4 must come after
the merge, and Step 5 after Step 4.

### 1. Confirm the preconditions

```bash
git -C /Users/aabliazimov/Documents/work/pipeline rev-parse --abbrev-ref HEAD   # docs/1390-tech-debt-tracker-merge
gh pr view 1384 --json number,state,title
gh pr view 1385 --json number,state,title
```

Both must be `MERGED`. Record the baseline table from **Scope → Baseline** by running each command;
a coder who skips this has no way to prove the after-state.

### 2. Merge Block A's TD-80 and TD-81 into Block B; delete Block A

Target file: `docs/exec-plans/tech-debt-tracker.md`.

- **TD-80** — keep **Block B's** entry verbatim (lines 1517–1523). It records #1380's
  `account_status` gating, which the code confirms. Block A's version is pre-#1380 and wrong. Block
  A's only unique content is a pointer to "the operator suspension flow in `lp-onboarding.md`";
  Block B already covers it as "from a terminal KYB refusal or an operator action", so nothing is
  lost. No edit to Block B needed.
- **TD-81** — this is a genuine field-by-field merge, not a pick:
  - **Title:** take **Block A's** — "No rate limiting on signup / resend-otp". Block B's "…on the
    unauthenticated auth endpoints" is now inaccurate, since `login` *is* limited.
  - **Date:** `2026-09-22` (unchanged in both).
  - **Location:** identical in both; unchanged.
  - **Gap:** take **Block A's** — it already states that `login` is bounded and names
    `login_attempts`.
  - **Impact:** take **Block A's**. Block B's "Credential stuffing against `login` is unthrottled"
    is the verified-false sentence and must not survive.
  - **Suggested fix:** take **Block A's** ("Reuse `LoginAttemptRepo` … the same
    `X-Forwarded-For` dependency"), then append Block B's rejected-alternative sentence, which Block
    A lacks and which is still true: *"An in-process `governor` limiter is one line but is
    per-replica, so it bounds nothing if the API runs more than one instance; a Postgres- or
    Redis-backed counter is the version that actually holds."* Keeping it loses nothing and
    preserves the reasoning.
- **TD-82** — Block A's copy is byte-identical to the `## Known Gaps` TD-82 at 1299–1307
  (re-verify with `diff` before deleting). Delete Block A's copy; the Known Gaps copy is the one
  that survives. Block B's backend TD-82 is untouched.
- **Delete the whole of Block A** — its `---` separator, its `## Post-MVP` heading (1471), its six
  roadmap bullets (identical to Block B's — re-verify with `diff`), and its three entries — once
  TD-81's merged text has been written into Block B.

Anchor every edit on the heading **plus** the following `- **Date:**`/`- **Location:**` lines, never
on `### TD-8x` alone.

### 3. Correct TD-85's stale mechanism (Post-MVP, line 1557)

Its **Gap** cites `AccountRepo::set_password_hash`, which no longer exists. Replace that sentence
with the real mechanism — the submitted password rides on the passcode and is installed by
`AccountRepo::verify_email_consuming_code` (`packages/shared/src/account_repo.rs:128–156`,
`password_hash = COALESCE($2, password_hash)`), so after verification the stored hash has no writer
at all. Leave the **Impact** and **Suggested fix** as they are: both still hold, and both are
consistent with the corrected mechanism (re-running signup re-issues a passcode carrying a new
password, which is the overwrite path the Impact describes). Do not expand the entry's scope.

### 4. Apply the renumber

Edit the 13 `### TD-<N>:` headings per the **Option A** mapping table, bottom-up (TD-93 → TD-112
first, TD-7 → TD-100 last) so earlier line numbers stay valid as you go. Change **only** the number
in the heading; leave each entry's body, wrapping and position in the file exactly as they are.

Then fix the two intra-tracker cross-references that point at renumbered entries:

- the Known Gaps TD-93 entry (now TD-112) body references "TD-92" twice (its `- **Gap:**` and
  `- **Suggested fix:**`) meaning the frontend TD-92 → becomes **TD-111**;
- re-grep for any other `TD-<N>` inside the tracker body text that names a renumbered entry:
  `grep -nE "TD-(7|73|8[0-8]|9[23])\b" docs/exec-plans/tech-debt-tracker.md` and resolve each hit by
  reading its context. Hits inside the 13 renumbered entries' own bodies, and inside the backend
  entries that legitimately cite backend numbers (TD-96/TD-97 cite "TD-81/TD-86"; TD-83 cites
  "TD-81"; TD-99 cites "TD-96 and TD-97"), are correct as-is.

### 5. Add the next-free-number authority

In the `## Format` block near the top of `docs/exec-plans/tech-debt-tracker.md`, add immediately
after the fenced template:

- a `**Next free number: TD-113.**` line, and
- one sentence: the whole file is a single `TD-<N>` sequence — a new entry takes the next free
  number and bumps this line, regardless of which section it lands in.

Without this, the next appender takes TD-100 from Post-MVP's TD-99 and re-collides with the new
frontend block on day one.

### 6. Sweep the five code references

Only one changes. `AGENTS.md` comment-less-code rule: these are existing spec-pointer comments —
**adjust the number in place and add no prose.**

- `packages/frontend/src/components/AccountDropdown.test.tsx:20` — `TD-93` → `TD-112`.
- `packages/shared/src/lp_repo.rs:16` and `:296` (TD-82), `packages/api/src/error.rs:42` (TD-81),
  `packages/shared/migrations/20260922000002_login_attempts.sql:20` (TD-86) — **verify and leave
  unchanged**; all four mean backend entries that keep their numbers.

No Rust file changes, so `cargo clippy` is not strictly required — but run it anyway if any `.rs`
file ends up touched.

### 7. Sweep the live docs references

Per the sweep table:

- `docs/frontend/bank-transfers.md:252` — `TD-82` → `TD-104`. Leave `:214` (TD-73) alone.
- `docs/frontend/auth-components.md:286` — `TD-73` → `TD-101`; `:513` — `TD-83` → `TD-105`.
- `docs/user-stories/epic-1247/1278-kyb-company-docs-v1.md:19` — `TD-83` → `TD-105`; `:21` and
  `:166` — `TD-85` → `TD-107`.
- `docs/product-specs/kyb-lp-verification.md:83` — keep `TD-80`, but delete the now-obsolete
  parenthetical "— the tracker holds a second, unrelated TD-80".
- `docs/product-specs/api-authorization.md:75,117,199`,
  `docs/product-specs/api-authorization-email.md:110,137`, `docs/product-specs/lp-onboarding.md:187`
  — verify and leave unchanged.

Touch nothing under `docs/exec-plans/completed/`.

### 8. Close out BUG-24

In `docs/exec-plans/known-bugs.md`, mark `### BUG-24` resolved in place in the house style (the
file's own precedent for a resolved entry, e.g. the `[RESOLVED …]` convention the tracker uses for
TD-16/TD-33/TD-34/TD-51), citing this Issue and the PR. Keep the correction paragraph — it is the
record of why the first diagnosis was wrong, and it is the reason the two mis-stated claims were
found. Do **not** rewrite its history; append the resolution.

BUG-21 is governed by Open Question 2 — do not touch it without an answer.

### 9. Verify

Run the full after-state check in **Test Strategy**, and paste the before/after numbers into the PR
description so a reviewer can see the deltas without re-deriving them.

---

## Test Strategy

**There is no automated test for any of this, and there cannot usefully be one.** Correctness rests
on two things and the plan says so plainly: (a) the per-entry verification above, each claim tied to
a named file and symbol; and (b) `grep` counts taken before and after. A reviewer should check the
claims against the cited code, not trust the diff.

### Gate

```bash
cd /Users/aabliazimov/Documents/work/pipeline
npx tsx scripts/lint-docs.ts
```

Must end `=== Results: 0 errors, N warnings ===` with **N ≤ 42** (the measured baseline on
`44da5f0`). A new warning means a markdown-formatting regression — most likely trailing whitespace
or a lost trailing newline — and must be fixed, not accepted.

### Structural assertions

```bash
cd /Users/aabliazimov/Documents/work/pipeline
f=docs/exec-plans/tech-debt-tracker.md

grep -c '^## Post-MVP' $f
# before: 2   after: 1

grep -coE '^### TD-[0-9]+' $f
# before: 115   after: 112   (3 entries removed: Block A's TD-80, TD-81, TD-82)

grep -oE '^### TD-[0-9]+' $f | sort | uniq -d
# before: 13 lines   after: EMPTY — this is the assertion that matters

grep -oE '^### TD-[0-9]+' $f | grep -oE '[0-9]+' | sort -nu | wc -l
# before: 99   after: 112

grep -oE '^### TD-[0-9]+' $f | grep -oE '[0-9]+' | sort -n | tail -1
# before: 99   after: 112   (and `Next free number: TD-113` must match)

for i in $(seq 1 112); do grep -qx "$i" <(grep -oE '^### TD-[0-9]+' $f | grep -oE '[0-9]+' | sort -nu) || echo "missing TD-$i"; done
# after: no output — TD-1..TD-112 all present, exactly once each
```

### No-content-loss assertion

The merge removes three entries; nothing else may disappear. Check that every subtitle present
before is present after:

```bash
cd /Users/aabliazimov/Documents/work/pipeline
git show 44da5f0:docs/exec-plans/tech-debt-tracker.md \
  | sed -E 's/^### TD-[0-9]+: //' | grep -E '^(Wallet-namespace|Email/password|No rate limiting|No mobile frames|lps\.owner_chain_id)' | sort -u > /tmp/td_before.txt
sed -E 's/^### TD-[0-9]+: //' docs/exec-plans/tech-debt-tracker.md \
  | grep -E '^(Wallet-namespace|Email/password|No rate limiting|No mobile frames|lps\.owner_chain_id)' | sort -u > /tmp/td_after.txt
diff /tmp/td_before.txt /tmp/td_after.txt
```

Expect exactly one difference: the TD-81 title, which the merge changes from Block B's wording to
Block A's. Everything else must match — in particular "No mobile frames for the Account page" must
still be present once, and "`lps.owner_chain_id` / `owner_address` are dead authorization columns"
must survive.

Then confirm the deleted content really was redundant:

```bash
git diff 44da5f0 -- docs/exec-plans/tech-debt-tracker.md | grep '^-' | grep -v '^---' | wc -l
```

Read the deletions. Every deleted line must be either (a) Block A's duplicated roadmap bullets and
heading, (b) Block A's TD-80 (superseded by Block B), (c) Block A's TD-82 (byte-identical to the
Known Gaps copy), or (d) a Block B TD-81 line replaced by Block A's merged wording. Any other
deletion is a content loss and the change is wrong.

### Reference-integrity assertions

```bash
cd /Users/aabliazimov/Documents/work/pipeline

# No live reference may still cite a renumbered frontend entry's old number.
grep -rnoE "TD-(7|73|8[0-8]|9[23])\b" \
  --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md" . \
  | grep -v node_modules | grep -v "/target/" \
  | grep -v "docs/exec-plans/completed/" \
  | grep -v "docs/exec-plans/tech-debt-tracker.md" \
  | sort -u
```

Every surviving hit must be justifiable as a **backend** entry that kept its number: TD-73
(`bank-transfers.md:214`, the wire-matching queue), TD-80 / TD-81 / TD-82 / TD-86 / TD-87 in the
product specs, `lp_repo.rs`, `error.rs`, `login_attempts.sql`, and BUG-21/BUG-24's own text in
`known-bugs.md`. A hit in `docs/frontend/`, `docs/user-stories/` or
`packages/frontend/src/components/AccountDropdown.test.tsx` means the sweep is incomplete.

```bash
# Every new number must be referenced from somewhere live, or from nowhere — never dangling.
grep -rnoE "TD-1(0[0-9]|1[0-2])\b" --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.md" . \
  | grep -v node_modules | grep -v "/target/" | sort -u
```

Expect exactly: `AccountDropdown.test.tsx` (TD-112), `bank-transfers.md` (TD-104),
`auth-components.md` (TD-101, TD-105), `1278-kyb-company-docs-v1.md` (TD-105, TD-107), the tracker's
own 13 headings, and this plan.

```bash
# Archived plans must be byte-identical.
git diff --stat 44da5f0 -- docs/exec-plans/completed/ docs/initial_spec.md
```

Must be empty.

### Manual verification

Open each of the 8 changed references and read the surrounding sentence against the entry its new
number now names. The number is right only if the prose still describes that entry. This is the step
that catches a mis-pointed reference, and no grep substitutes for it.

---

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` — the subject of the change (merge, renumber, next-free
  marker).
- `docs/exec-plans/known-bugs.md` — `### BUG-24` closed out (Step 8). `### BUG-21` pending Open
  Question 2.
- `docs/product-specs/kyb-lp-verification.md` — drop the obsolete "second, unrelated TD-80"
  parenthetical at `:83`.
- `docs/frontend/bank-transfers.md`, `docs/frontend/auth-components.md`,
  `docs/user-stories/epic-1247/1278-kyb-company-docs-v1.md` — renumbered citations.
- `scripts/lint-docs.ts` — only if Open Question 1 resolves in favour of the duplicate-heading
  guard.

**No product-spec behavior change.** Nothing user- or agent-facing changes; the only product-spec
edit is deleting a disambiguation sentence that the fix makes untrue. The exec plan alone is
sufficient per the planner contract's step 3.
