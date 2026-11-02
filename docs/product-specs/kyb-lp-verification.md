# KYB: LP Entity Verification

## Overview

Pipeline verifies the **legal entity** an LP acts for through its own KYB service: the LP registers the entity, attaches supporting documents, and a Trustee reviews them and reaches a verdict. This is entirely separate from the address-level KYT screening in `lp-onboarding.md`, which decides whether an *address* may hold PLUSD; the two systems do not reference each other. It is equally separate from the individual KYC path (Sumsub) keyed on wallet identity.

Account credentials, sessions, and the endpoints that issue them are specified in `api-authorization.md` and `api-authorization-email.md`. This document starts from a verified account.

---

## Behavior

### LP Entity Registration and KYB Documents

Once an account is verified it registers the legal entity it acts for and attaches the documents supporting it. One account owns at most one LP, so the account itself identifies the record — the LP-facing endpoints are keyed on the caller's session, never on an id the client must carry. Registering the entity and attaching documents are separate requests. The entity is an upsert, so the same call registers it and later corrects a typo in it, and it is a **full replace** — an omitted country clears it. Documents are **additive**: each upload appends to the set and never replaces it. They are deliberately not one request, because a full-replace profile riding along with every upload meant each attached file also rewrote the entity from whatever the client happened to be holding, quietly reverting edits made elsewhere.

Documents are untyped: Pipeline does not model them as a fixed checklist of document kinds, and nothing distinguishes a certificate of incorporation from a shareholder register except the filename it was uploaded under. Whether a submission is sufficient is a reviewer's judgement, not a computed condition. There is likewise no replace operation — correcting a document means deleting it and uploading the correction, which is also the only way to withdraw something submitted in error, a case re-upload cannot address since a second file simply sits beside the first. Uploaded bytes live in a private S3-compatible bucket, never in Postgres and never publicly readable; a document reaches a reader only through a short-lived presigned URL issued with the record. A maximum size per file and a maximum number of documents per LP bound what may be stored, both deployment configuration.

An LP may change its record — profile and documents alike — while KYB is `NotStarted` or `ChangesRequested` (and `InProgress`, which is unreachable — see below), and may not while `UnderReview`, `Passed`, or `Failed`. The freeze exists so a decision always refers to what was decided on: could an LP swap files during review, a reviewer might approve a set that had changed since they read it; could it rename the entity after approval, the approval would attach to a company that no longer matched. `ChangesRequested` is what reopens a record — a trustee returning it for correction is the only thing that unfreezes one, and `Failed` is terminal rather than the reopening state it once was. An individually verified document is frozen on its own terms even while the LP is otherwise open, which is what makes a correction cycle workable: the LP reopens with some documents approved and only the rejected ones needing replacement. Two things sit outside the freeze entirely, because neither is evidence any decision was made about: the review-notification preference and the settlement address, both below.

After email sign-in or passcode verification, and when restoring an authenticated session, the LP app reads `GET /v1/lps/me` before deciding whether to offer account setup. A missing LP or a returned LP with no persisted documents opens the dismissible “Finish account setup” modal; a returned LP with documents does not. Request failures do not imply an empty account. Closing the modal keeps the session active and dismisses the offer for that stored session, including across page reloads — restoring a session the LP already dismissed never reopens it. Signing out clears the dismissal, so the next sign-in or passcode verification offers it again if the server still has no documents. The home screen’s “Start Verification” card and the Account page reopen it on request at any time.
The modal collects the legal name and optional country (picked from a public country list and stored as its English name; free text if the list is unavailable) alongside raw supporting files. Saving first upserts the complete profile as JSON, retaining the existing contact email and country unless edited; for a new LP, the contact email is the authenticated email. When files are staged, it then sends them through the separate multipart upload endpoint; an existing LP may also save changed profile fields without staging a file. A new LP still attaches at least one file before submitting account setup. Persisted filenames come from the server response, and each removable document is deleted by its server id. Files that fail in a partial upload stay staged for retry while successful files become persisted rows. The API also returns ordered per-file errors with HTTP 400 when every file is rejected; the modal shows those reasons and keeps the files staged. The form respects the LP response's `writable` flag and the individual freeze on verified documents. Uploading alone does not change KYB status. After all account-setup files upload successfully, Submit calls `POST /v1/lps/me/submit` without a body. The modal opens “Your account is under review” only when the server response or a reconciliation read confirms `UnderReview`. Failed or partial uploads remain in setup. Saved files are retained if submission fails, and Submit for review retries submission without uploading again. Eligible persisted documents can be submitted without staging another file. Submission requires `NotStarted` or `ChangesRequested`, at least one document, and no rejected documents or unresolved uploads. A lost submission response is reconciled with `GET /v1/lps/me`; unknown status blocks writes until Check submission status succeeds. A newer trustee verdict is adopted without showing an inaccurate review confirmation. Notify me saves the review-notification preference by resending the stored profile with `notify_on_review: true` to `POST /v1/lps/me`; the button holds a pending state, confirms only after the server accepts, and shows an error and stays retryable on failure. The modal opens already confirmed when the LP's `notify_on_review` is set. Go to app and dismissal preserve the session; modal state resets with the session. The authenticated Account page uses the same `GET /v1/lps/me` record to show Name, Country, corporate email, persisted document filenames, and review statuses; it distinguishes loading, 404, and request failure. Its profile card saves the full profile with `POST /v1/lps/me` independently of document uploads, retaining stored email and country and preserving unsaved drafts across document updates. New LP creation requires an authenticated email. The page uploads files through multipart `POST /v1/lps/me/documents` and deletes persisted files by id, retaining failures for retry and offering delete-then-upload correction for rejected files. After every staged upload succeeds, the Account page submits the eligible LP for review and adopts the returned frozen state. It also offers Submit for review for already-uploaded eligible documents. Unsaved profile drafts must be saved before uploading or submitting; profile-only Save remains independent. Partial or uncertain uploads never auto-submit. Submission-only retries and status checks preserve uploaded files. It respects both LP and verified-document freezes, and its development previews remain separate from API state.

### KYB Review Lifecycle

`kyb_status` moves only when one of the two parties deliberately acts. Reviewing an individual document does not change it, and neither does uploading one: a document review records a fact about that file, while the verdict on the LP is a separate decision a trustee takes on its own.

Review runs only while the LP is `UnderReview`. Submitting is what says the set is ready to be judged, so judging one before that has no meaning — and it does real harm: a `Verified` document can never be deleted, so verifying a file early would permanently pin it into a record its owner is still assembling, closing the only correction path there is (delete and re-upload).

| From | To | Who |
|---|---|---|
| `NotStarted`, `ChangesRequested` | `UnderReview` | LP owner submits for review |
| `UnderReview` | `Passed` | Trustee decides |
| `UnderReview` | `ChangesRequested` | Trustee decides |
| `UnderReview` | `Failed` | Trustee decides |

Every other transition is refused. `InProgress` remains a legal value of the column and is treated as writable, like `NotStarted`, but nothing produces it and nothing transitions out of it — it is unreachable. It is kept because removing a value from a `CHECK` constraint is a migration that buys nothing; it is **not** kept for backward compatibility, since no row has ever held it. Until this model, `kyb_status` was never written at all: the column only ever took its `NotStarted` default.

Submitting is refused unless the LP holds at least one document and none of its documents is `Rejected`, and the refusal names the offending ids. The second condition is what makes a correction cycle converge: a rejected file must be deleted and replaced before the LP can ask for another look, so a trustee never reopens a record to find the same refused document still sitting in it.

`Passed` is refused unless every document is `Verified`. Whether the set is *sufficient* is the trustee's judgement — documents are untyped, so nothing else could decide it — but the server does hold the invariant that the trustee went through all of them before approving. Every decision carries an optional free-text reason, recorded with the deciding operator and the decision time. Optional deliberately, and the looser choice: a `ChangesRequested` with neither a reason nor a single rejected document is therefore accepted, and the LP may resubmit the identical set, so the cycle can turn without either side learning anything. Telling a trustee what a useful refusal looks like is left to the review UI rather than enforced by the endpoint.

Only the latest decision is retained on the LP; there is no review history. Nor is one kept anywhere else: no audit record of the verdict is written, so a second decision overwrites the first — its reason, its time, and the operator who made it — leaving nothing behind to reconstruct what was decided before. That is a deliberate choice rather than a gap to be filled later.

`ChangesRequested` hands the record back: the profile and the unverified documents unfreeze, the LP corrects what the reason and the per-document rejections point at, and submits again. The cycle may repeat without limit.

The latest decision, its reason, and its time are returned with the LP record, so an owner reading `GET /v1/lps/me` can always see why its record reopened. Notifications are an additional channel, never the only one — they are off by default and their delivery is best-effort, so a record that unfroze with no explanation anywhere would otherwise be the default outcome rather than an edge case.

`Failed` is terminal. The LP freezes permanently, and since one account owns at most one LP, the account cannot start over with a fresh record — so the decision suspends the account as well. Nothing in the API reverses a terminal refusal; reversing one is a deliberate manual intervention.

The trustee detail page displays the LP profile, latest verdict reason, and a flat list of documents with review metadata and presigned downloads. It offers review only for Provided documents while the LP is UnderReview, requiring a reason for document rejection. LP verdict confirmations accept optional reasons; approval is available only after every document is Verified, and terminal refusal explains account suspension before confirmation. Successful decisions refresh the detail and listing; conflicts refresh stale review state. The trustee reads every LP with its current status, submission time, and decision time. There is no separate "ready for review" queue: the queue is exactly the LPs sitting at `UnderReview`, and the listing already carries what distinguishes them.

### Review Notifications

An LP carries a notification preference, **off by default**, which its owner may switch at any point — including while the record is frozen. Freezing it would be perverse: it would leave an LP unable to opt in during the very review it wants to hear the outcome of.

That exemption decides the contract of the profile endpoint, which carries the preference. The freeze there is on a profile *change*, not on the request: when the LP is frozen, a request whose profile fields match what is stored is accepted and writes the preference alone, while a request that would alter any profile field is refused and writes nothing — the preference included. Rejecting the whole request would make the toggle unreachable exactly when it matters; accepting the profile fields silently would edit a frozen record.

When it is on, each trustee decision — `Passed`, `ChangesRequested`, or `Failed` — sends one email to the **verified address of the owning account**, falling back to the LP's contact address when that account has none (a wallet-registered account may never have set an email). The contact address on the LP is owner-supplied and nobody verifies it, while a decision message carries the trustee's reasons for refusing a legal entity — that is not content to deliver to an address chosen by whoever last saved the profile. A `ChangesRequested` message carries the decision's reason together with the rejected documents and their individual reasons, so the LP can act on the email alone.

Nothing else notifies. Individual document reviews deliberately do not: a trustee working through a set produces a decision per file within minutes, and the LP can act on none of them until the record reopens.

Delivery is best-effort. The decision is recorded first and a delivery failure is logged rather than propagated, because a trustee's verdict must not depend on an email provider being reachable. A lost message consequently has no automatic retry.

### Settlement Address

An LP settles to blockchain addresses held on the LP record, a separate identity from whatever credential its owner signs in with. It holds **one settlement address per chain kind**, and each is linked on its own:

- **Stellar:** an account `G…` or a contract `C…` Strkey with a valid checksum, in `lps.stellar_address` (`address_linked_at`, `stellar_signer_address`).
- **EVM:** `0x` plus 40 hex digits, in `lps.evm_address` (`evm_address_linked_at`, `evm_signer_address`). Mixed-case input must be a valid EIP-55 checksum; all-lowercase and all-uppercase are accepted. It is stored lowercase.

The rules below apply to each kind independently. An address of each kind may be linked and relinked at any KYB status except `Failed`, including `Passed` (user decision 2026-11-02, #1831), with no limit on relinks. Each link or relink needs its own signed challenge and nothing else: no signature by the old address and no Trustee approval (TD-163). A relink replaces the address, the signer and `*_linked_at`. The previous address is released, and another LP may then link it. `Failed` closes linking outright, whether or not an address is stored: addresses are unique across all LPs within a kind, so a refused applicant who could keep naming addresses could burn one real LP's address after another, and a refused LP will never settle.

The exemption from the freeze is never an exemption from the account gate. `Failed` also suspends the account, and a suspended account is refused at authorization before any of this is reached. The `Failed` refusal above does not depend on that.

#### Proof of control

An address is linked only through a signed challenge, in two calls (`routes::lp_settlement_address`). Both are LP-authenticated and keyed on the caller's session, and `chain_id` is required, its kind picking the Stellar or EVM slot and the verifier.

1. `GET /v1/lps/me/link-address/challenge?chain_id&address&signer_address` validates the inputs and the LP's eligibility, then issues a single-use nonce bound to `(lp_id, chain_id, address, signer_address)` and returns `{ message, nonce }`.
2. `POST /v1/lps/me/link-address/verify` with `{ chain_id, address, signer_address?, signature }` verifies the signature over the message rebuilt from the **stored** challenge, consumes it, re-checks eligibility, and links the address and signer. It answers `200` with the refreshed `LpResponse`.

`signer_address` is the wallet that signs. It defaults to the settlement address for a Stellar `G…` and for an EVM `0x…`, and is **required** for a Stellar `C…`, which cannot sign for itself. A Stellar signer must be a `G…` account and an EVM signer a `0x…` EOA, so a `G…` or `0x…` settlement address may name a different signer. The signer is stored next to the address it proved.

The message is distinct from the sign-in message, so neither signature can be replayed as the other:

```
{domain} wants you to link a settlement address to your Pipeline LP account.

Settlement address: {address}
Signed by: {signer_address}

Sign this message to prove you control this wallet. This request will not trigger a blockchain transaction or cost any gas.

LP ID: {lp_id}
Chain ID: {chain_id}
Nonce: {nonce}
Issued At: {issued_at}
Expiration Time: {expires_at}
```

Eligibility is checked at challenge time and again at verify time, after the challenge is consumed. A valid signature followed by a refused link therefore spends the challenge, and the LP requests a new one. A bad signature does not spend it. An LP that is `Failed`, or whose address is held by another LP in that kind, gets `409`.

A failed proof is `422 Unprocessable Entity` with the single body `settlement address proof failed`, never `401`. The cases are a bad signature, no live challenge (never issued, expired, or already consumed), and an address or signer that does not match the challenge. One body means a caller cannot tell them apart. `401` is kept for a missing or invalid token, because the LP app ends the session on any authenticated `401`.

The earlier unsigned `POST /v1/lps/me/link-address` is deleted and answers `404`. Challenge storage, TTL and reuse rules are in [api-authorization.md](./api-authorization.md) § Settlement-address proof.

#### Existing unsigned addresses

Stellar addresses linked before the signed flow (through the unsigned endpoint or the automatic link of #1813) are kept, with `stellar_signer_address = NULL`. A `NULL` signer next to a non-null address means the address is **unproven**. The Trustee view (#1826) shows such addresses as unproven. An unproven address still serves payment details. The LP proves it by relinking the **same** address through the signed flow, at any status except `Failed`, including `Passed`; the signer then becomes non-null. This supersedes #1829.

#### Link history

`lp_settlement_address_history` is append-only. Columns: `id`, `lp_id`, `chain_kind` (`stellar` | `evm`), `chain_id`, `address`, `signer_address`, `previous_address`, `previous_signer_address`, `linked_by_account_id` (the authenticated account that verified the link), `created_at`.

- **One row per successful link or relink**, written in the same SQL statement as the guarded update of `lps`, with `created_at` equal to `*_linked_at`. A refusal (`Failed`, an address held by another LP) or a failed proof writes nothing.
- **Re-verifying the same address and signer is allowed.** It is a fresh proof event: it adds a history row (with `previous_*` equal to the current values) and moves `*_linked_at` forward. Timestamps use `clock_timestamp()` and rows are listed by `id DESC`, which is the true apply order because the insert runs under the `FOR UPDATE` lock on the LP row.
- **Backfill:** the migration wrote one row per address set at that time, with `chain_id`, `linked_by_account_id` and `previous_*` NULL, and the signer NULL for legacy unproven links. A backfilled row is recognised by `chain_id IS NULL`. Every new row carries `chain_id`, `signer_address` and `linked_by_account_id`.
- There is no read endpoint yet. The Trustee view, investigations and wire matching are later consumers.

#### Known limit

When `signer_address` differs from the settlement address (always for a Stellar `C…`, and optionally for a `G…` or `0x…`, e.g. a Stellar multisig account or an EVM Safe), the signature proves control of `signer_address` only, not that the signer controls the settlement address. There is no on-chain check (TD-162). Ownership of the settlement address itself is proven only when `signer_address` equals it.

---

## Security Considerations

- **The LP settlement address is proven by a signature.** Linking needs a signed single-use challenge bound to the LP, chain, address and signer, so an address cannot be named without the signer's key. When the signer is the address itself, this proves ownership of the address. When a separate signer is named (required for `C…`, allowed for `G…`/`0x…`), the proof covers the signer only (TD-162). Addresses linked before this are kept and shown as unproven (`NULL` signer). The unsigned-address gap TD-57 is resolved (#1824).

- **The settlement address can be changed at any time with a valid signed challenge.** A hijacked LP session can therefore redirect future mints to an address it controls (TD-163). `lp_settlement_address_history` records every change: who, when, old to new.

- **The LP contact address is unverified, and decision emails avoid it.** `lps.contact_email` is a required field of the owner-controlled full-replace profile endpoint; nothing proves the owner holds it. Decision messages therefore go to the account's verified address, and fall back to the contact address only for an account that has none. Because delivery failures are logged rather than propagated, a misdirected message would otherwise leave no trace.

- **A terminal KYB refusal suspends the account, and suspension actually bites.** `Failed` is irreversible through the API and an account owns at most one LP, so the refusal is final for that applicant. It sets `accounts.status = 'Suspended'`, which request authorization now reads on every bearer-authenticated request (both the wallet and the email/password sign-in paths refuse a suspended account at mint time too) — see `api-authorization.md`. A `Failed` verdict therefore ends the applicant's API access from its very next call: no re-login, no waiting out the token's 24-hour life. See TD-80 ("Email/password sessions cannot be revoked") for the session-revocation half that remains open.
