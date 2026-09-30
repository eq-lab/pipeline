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

After email sign-in or passcode verification, and when restoring an authenticated session, the LP app reads `GET /v1/lps/me` before deciding whether to offer account setup. A missing LP or a returned LP with no persisted documents opens the dismissible “Finish account setup” modal; a returned LP with documents does not. Request failures do not imply an empty account. Closing the modal keeps the session active and does not immediately reopen it. The next sign-in or session restoration may offer it again if the server still has no documents.
The modal collects the legal name and optional country alongside raw supporting files. Saving first upserts the complete profile as JSON, retaining the existing contact email and country unless edited; for a new LP, the contact email is the authenticated email. When files are staged, it then sends them through the separate multipart upload endpoint; an existing LP may also save changed profile fields without staging a file. A new LP still attaches at least one file before submitting account setup. Persisted filenames come from the server response, and each removable document is deleted by its server id. Files that fail in a partial upload stay staged for retry while successful files become persisted rows. The API also returns ordered per-file errors with HTTP 400 when every file is rejected; the modal shows those reasons and keeps the files staged. The form respects the LP response's `writable` flag and the individual freeze on verified documents. Uploading or saving does not itself request review or change KYB to `UnderReview`. The authenticated Account page uses the same `GET /v1/lps/me` record to show Name, Country, corporate email, persisted document filenames, and review statuses; it distinguishes loading, 404, and request failure. Its profile card saves the full profile with `POST /v1/lps/me` independently of document uploads, retaining stored email and country and preserving unsaved drafts across document updates. New LP creation requires an authenticated email. The page uploads files through multipart `POST /v1/lps/me/documents` and deletes persisted files by id, retaining failures for retry and offering delete-then-upload correction for rejected files. It respects both LP and verified-document freezes, and its development previews remain separate from API state.

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

Only the latest decision is retained on the LP; there is no review history. That is about the record, not about the audit trail — a trustee's verdict on a legal entity is an operator action in the Operations Console and is written to the append-only audit store like any other (`audit-logging.md`).

`ChangesRequested` hands the record back: the profile and the unverified documents unfreeze, the LP corrects what the reason and the per-document rejections point at, and submits again. The cycle may repeat without limit.

The latest decision, its reason, and its time are returned with the LP record, so an owner reading `GET /v1/lps/me` can always see why its record reopened. Notifications are an additional channel, never the only one — they are off by default and their delivery is best-effort, so a record that unfroze with no explanation anywhere would otherwise be the default outcome rather than an edge case.

`Failed` is terminal. The LP freezes permanently, and since one account owns at most one LP, the account cannot start over with a fresh record — so the decision suspends the account as well. Nothing in the API reverses a terminal refusal; reversing one is a deliberate manual intervention.

The trustee reads every LP with its current status, submission time, and decision time. There is no separate "ready for review" queue: the queue is exactly the LPs sitting at `UnderReview`, and the listing already carries what distinguishes them.

### Review Notifications

An LP carries a notification preference, **off by default**, which its owner may switch at any point — including while the record is frozen. Freezing it would be perverse: it would leave an LP unable to opt in during the very review it wants to hear the outcome of.

That exemption decides the contract of the profile endpoint, which carries the preference. The freeze there is on a profile *change*, not on the request: when the LP is frozen, a request whose profile fields match what is stored is accepted and writes the preference alone, while a request that would alter any profile field is refused and writes nothing — the preference included. Rejecting the whole request would make the toggle unreachable exactly when it matters; accepting the profile fields silently would edit a frozen record.

When it is on, each trustee decision — `Passed`, `ChangesRequested`, or `Failed` — sends one email to the **verified address of the owning account**, falling back to the LP's contact address when that account has none (a wallet-registered account may never have set an email). The contact address on the LP is owner-supplied and nobody verifies it, while a decision message carries the trustee's reasons for refusing a legal entity — that is not content to deliver to an address chosen by whoever last saved the profile. A `ChangesRequested` message carries the decision's reason together with the rejected documents and their individual reasons, so the LP can act on the email alone.

Nothing else notifies. Individual document reviews deliberately do not: a trustee working through a set produces a decision per file within minutes, and the LP can act on none of them until the record reopens.

Delivery is best-effort. The decision is recorded first and a delivery failure is logged rather than propagated, because a trustee's verdict must not depend on an email provider being reachable. A lost message consequently has no automatic retry.

### Settlement Address

An LP settles to a blockchain address held on the LP record — a separate identity from whatever credential its owner signs in with. The owner sets it through its own endpoint rather than through the profile upsert. It may be set at any KYB status short of a terminal verdict, and replaced freely until the decision is final. `Passed` fixes the address already held, because from that point downstream systems treat it as the account money moves to — an LP that passed before naming one may still name it, once. `Failed` closes the endpoint outright, whether or not an address is stored: addresses are unique across all LPs, so an applicant who could keep rewriting the field after a terminal refusal could burn one real LP's address after another purely by naming them, and a refused LP will never settle, so permitting even a first write buys nothing against that.

The exemption from the freeze is never an exemption from the account gate. `Failed` also suspends the account, and a suspended account is refused at authorization before any of this is reached — so the address endpoint is closed to it along with everything else. The fixing rule above is deliberately not left to depend on that: it holds on its own, whether or not suspension is being enforced.

Authorization is the only control. The endpoint is keyed on the caller's session, so only the account owning an LP can set that LP's address. Pipeline does not require the LP to prove it controls the address it names — an open gap, because a wrong or hostile entry both misdirects settlement and, through the uniqueness constraint, permanently denies that address to the LP that really holds it.

Only a Stellar address is modelled. An LP has no EVM settlement address.

---

## Security Considerations

- **The LP settlement address is unverified.** An LP names its own Stellar address and Pipeline accepts it on the owner's authority alone, with no signature proving control of that key. A wrong entry misdirects settlement; a hostile one also burns the address for its real holder, since the column is unique across LPs. Tracked as TD-57.

- **The LP contact address is unverified, and decision emails avoid it.** `lps.contact_email` is a required field of the owner-controlled full-replace profile endpoint; nothing proves the owner holds it. Decision messages therefore go to the account's verified address, and fall back to the contact address only for an account that has none. Because delivery failures are logged rather than propagated, a misdirected message would otherwise leave no trace.

- **A terminal KYB refusal suspends the account, and suspension must actually bite.** `Failed` is irreversible through the API and an account owns at most one LP, so the refusal is final for that applicant. It sets `accounts.status = 'Suspended'`, which today means nothing: no request authorization reads that column, and neither does the wallet sign-in path, so a suspended owner can still mint fresh tokens indefinitely rather than merely outliving an issued one. The password sign-in path does refuse. See TD-80 ("Email/password sessions cannot be revoked" — the tracker holds a second, unrelated TD-80).
