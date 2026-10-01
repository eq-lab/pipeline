# Epic #1376 — verification runbook

One pass over the whole KYB review lifecycle against a real Postgres. It replaces the per-issue manual checklists of [#1377](https://github.com/eq-lab/pipeline/pull/1384) and [#1378](https://github.com/eq-lab/pipeline/pull/1385) and covers the SQL in [#1274](https://github.com/eq-lab/pipeline/issues/1274) and [#1379](https://github.com/eq-lab/pipeline/issues/1379) that no test reaches.

**Why it exists.** Every policy in this epic is stated twice — once as a pure Rust function, once as a SQL predicate — because tests may not touch a database (`AGENTS.md`). The Rust half has 938 passing tests. The SQL half has none, which is what TD-98 records. Three of the mistakes it could hide ship silently: steps **5**, **7** and **22** are the ones that catch them, and each fails under exactly one wrong spelling and nowhere else.

## Setup

Run from `feat/1378-kyb-decision-emails` — it is stacked on `feat/1377-notify-on-review`, so it is the only branch carrying all five issues at once.

```bash
git checkout feat/1378-kyb-decision-emails
export DATABASE_URL=postgres://…          # your local pipeline DB
unset TURNSTILE_SECRET_KEY                 # disables the captcha gate
unset SENDGRID_API_KEY                     # falls back to the logging sender
cargo run -p pipeline-api 2>&1 | tee /tmp/api.log
```

`SPACES_*` (all four) and `JWT_ES256_*` must be set or the API refuses to start / disables auth. `psql "$DATABASE_URL"` in a second shell; `API=http://localhost:8080/v1`.

**The trustee is added by hand** — there is no admin endpoint. Use a wallet you control:

```sql
WITH a AS (INSERT INTO accounts (id) VALUES (gen_random_uuid()) RETURNING id)
INSERT INTO auth_users (chain_id, address, roles, account_id)
SELECT 1, lower('0xYOUR_ADDRESS'), '{trustee}', id FROM a;
```

EVM addresses are stored lowercase; Stellar `G…` keys verbatim. Sign in through the trustee dashboard, or `GET $API/auth/challenge?address=…` then `POST $API/auth/verify` with the signature. Call the result `$TRUSTEE`.

## LP session

**1.** `POST $API/auth/signup` `{"email":"lp@example.test","password":"Passw0rd!","captcha_token":"x"}` → `202`.
**2.** Read the six-digit code from `/tmp/api.log`, then `POST $API/auth/verify-otp` `{"email":…,"code":…}` → `200`. Keep the token as `$LP`.

## Profile, the preference, and the narrowed freeze

**3.** `POST $API/lps/me` `{"legal_name":"Acme","contact_email":"ops@acme.test"}` → `201`. Note the `id` as `$LP_ID`.
`SELECT notify_on_review FROM lps WHERE id=$LP_ID;` → **`false`**. *(Opt-in default.)*

**4.** Repeat **3** with `"notify_on_review": true` → `200`, column `true`.

**5. The `EXCLUDED` trap.** `POST $API/lps/me` `{"legal_name":"Acme Trading","contact_email":"ops@acme.test"}` — note **no** `notify_on_review` → `200`, and the column is **still `true`**.
*Fails only if the update path used `EXCLUDED.notify_on_review` instead of `COALESCE($8, lps.notify_on_review)`, which would silently opt the LP out on every unrelated profile edit.*

## Documents and submit

**6.** `POST $API/lps/me/documents` as `multipart/form-data`, field `files`, a real PDF/JPEG/PNG — content is sniffed, the declared type is ignored → `201`. Note the document id as `$DOC`.
Upload a `.txt` renamed to `.pdf` → rejected in `files[]`.

**7. The `IS NOT DISTINCT FROM` trap.** This LP has **no country** (never sent), so it exercises the NULL comparison. First freeze it: `POST $API/lps/me/submit` → `200`, `kyb_status = 'UnderReview'`, `writable: false`.
Now `POST $API/lps/me` with the profile **exactly as stored** — `legal_name` is `Acme Trading` after step **5**, no `country`, same `contact_email` — plus `"notify_on_review": false` → **`200`**, and the column flips to `false`.
*Fails with `409` only if `country` was compared with `=` rather than `IS NOT DISTINCT FROM` — `NULL = NULL` is NULL, the conjunction collapses, and every frozen LP without a country is refused for toggling nothing.*

**8.** Same, but change one character of `legal_name` → **`409`**, and `SELECT legal_name, notify_on_review` shows **neither** changed.

**9.** `POST $API/lps/me/documents` while frozen → `409`. *(The narrowing must not have leaked past the profile upsert.)*

**10.** `POST $API/lps/me/submit` again → `409` (already `UnderReview`).

## Trustee review

**11.** `GET $API/lps` as `$TRUSTEE` → the LP appears with `kyb_status`, `kyb_submitted_at`. As `$LP` → `403` naming the `trustee` role.

**12.** `POST $API/lps/$LP_ID/kyb` `{"decision":"Passed"}` → **`409`**: documents are still `Provided`.

**13.** `POST $API/lps/$LP_ID/documents/$DOC/review` `{"decision":"Rejected","reason":"illegible"}` → `200`.

**14.** `POST $API/lps/$LP_ID/kyb` `{"decision":"ChangesRequested","reason":"replace the certificate"}` → `200`.
`GET $API/lps/me` as `$LP` → `kyb_status: "ChangesRequested"`, `writable: true`, `kyb_decision_reason` present, **no `kyb_decided_by`** in the body.
With `notify_on_review` still `false` from step **7**, `/tmp/api.log` shows **no** send.

**15.** `POST $API/lps/me/submit` → **`409`** naming `$DOC`: a `Rejected` document blocks resubmission. Delete it, upload a replacement, submit → `200`.

## Settlement address

**16. The three-clause predicate.** With the LP at `UnderReview` (frozen), `POST $API/lps/me/link-address` `{"stellar_address":"GA…"}` → **`200`**. The address is outside the write freeze.
*A `guard_writable` call here would refuse it.*

**17.** Repeat with a different `G…` → `200`, replaced. `SELECT address_linked_at` moves.

## Verdict, notification, suspension

**18.** Turn the preference back on (step **4**), then review every document `Verified` and `POST $API/lps/$LP_ID/kyb` `{"decision":"Passed","reason":"all in order"}` → `200`.
`/tmp/api.log` shows **one** email, to the account's verified address — **not** `lps.contact_email` if they differ — and the body **carries the reason**.

**19.** `POST $API/lps/me/link-address` with a new address → **`409`**: fixed once `Passed`.

**20. Best-effort delivery.** Set `SENDGRID_BASE_URL` to a closed port, restart, and drive a second LP to a verdict → the endpoint still answers **`200`** and logs a warning.
*A propagating send answers `500` after the verdict is already committed.*

**21. Terminal refusal.** Register a third LP, upload a document, submit, and `POST …/kyb` `{"decision":"Failed","reason":"sanctions"}` → `200`. This LP must **never have linked an address** — that is what step **22** needs.
`SELECT status FROM accounts WHERE id = (SELECT owner_account_id FROM lps WHERE id=…);` → `Suspended`.
Any request with that LP's token → **`403`**, worded distinguishably from a role refusal. Logging in again → refused at token issue.
Then `UPDATE accounts SET status='Active'` → the **same token** works again, proving the check is per request and not per token.

**22. The `Failed` exclusion, outside the NULL disjunct.** Run this only **after** reactivating the account in step **21** — while suspended the request stops at authorization with `403` and never reaches the predicate.
`POST $API/lps/me/link-address` `{"stellar_address":"GB…"}` as that LP → **`409`**, even though it holds **no** address.
*This is the only case that catches the obvious-but-wrong spelling `stellar_address IS NULL OR kyb_status NOT IN ('Passed','Failed')`: the first disjunct short-circuits and lets a refused LP through. A `Failed`-with-address check passes either way.*

## If a step fails

Record which, with the request and the SQL state. Steps 5, 7, 16 and 22 each point at one specific predicate; the rest are behaviour.
