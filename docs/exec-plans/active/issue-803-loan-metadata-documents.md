# Issue #803: Loan metadata: add `documents` array (name + uri) through indexer and API response

Source: https://github.com/eq-lab/pipeline/issues/803

## Scope

The off-chain loan-metadata IPFS document gains a new field — `documents`, an array of `{ name, uri }` objects — alongside the existing fields (`originator`, `borrowerId`, `commodity`, `corridor`, `governingLaw`, `protection`, `metadataURI`).

This field must flow end-to-end:

1. **Indexer** — `LoanMetadataJson` (worker) deserializes it from IPFS, and it is composed into the `LoanSnapshot` (shared) that is persisted in the `contract_logs.params` JSONB blob, on both the `LoanDrawn` and lifecycle-event paths.
2. **API response** — `GET /v1/loan-book` surfaces `documents` per loan via `LoanBookEntry`.
3. **Submission write path** (for round-trip consistency) — `POST /v1/loan-book/loan` accepts `documents` on `SubmitLoanRequest` so an originator submission carries the same shape it will later present on IPFS.

**Critical driver:** `LoanMetadataJson` is `#[serde(deny_unknown_fields)]`. The moment a live IPFS document carries `documents`, every indexer fetch of that document will **fail to deserialize** unless the field is added. This is a required change, not cosmetic.

**Out of scope:**
- No DB migration — `LoanSnapshot` is serialized into the existing `contract_logs.params` JSONB column; new sub-fields are absorbed transparently. `contract_logs_repo.rs` needs no change (serde deserializes the new field, defaulting to empty when absent).
- No frontend rendering of the documents list (separate frontend issue if/when the UI needs it).
- No IPFS-pinning / document-upload mechanics — we only read what is present and echo submissions verbatim.

## Assumptions and Risks

- **Assumption:** each `documents` entry is exactly `{ name: String, uri: String }`. Extra keys inside a document object should NOT break indexing, so the per-document struct will **not** use `deny_unknown_fields` (unlike the top-level DTO/snapshot which keep it).
- **Assumption:** `documents` is optional/back-compatible. Existing IPFS documents and existing JSONB snapshot rows omit it, so both `LoanMetadataJson.documents` and `LoanSnapshot.documents` use `#[serde(default)]` → empty `Vec` when absent. This mirrors exactly how `protection` was introduced (commit `85bfda5`).
- **Risk (low):** `utoipa::ToSchema` cannot be derived on the `shared` crate struct unless `shared` depends on `utoipa` (it does not). Mitigation: keep the API response/request document type as a separate API-crate DTO deriving `ToSchema`, mirroring how `LocationUpdateSnapshot` (shared) is distinct from `LocationInput`/OpenAPI DTOs (api). See step 4.
- **Risk (low):** the shared `LoanSnapshot` document type is reused by the worker's `LoanMetadataJson`, so the mapper carries it through by direct move (no per-field mapping) — verify field/type names line up so `compose_drawn_snapshot`/`compose_lifecycle_snapshot` compile.

## Open Questions

_None._

## Implementation Steps

1. **Shared snapshot type — `packages/shared/src/loan_snapshot.rs`**
   - Add a new public struct:
     ```rust
     #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
     pub struct LoanDocument {
         pub name: String,
         pub uri: String,
     }
     ```
     (Deliberately **no** `deny_unknown_fields` so extra per-document keys are tolerated.)
   - Add to `LoanSnapshot` (after `metadata_uri`, keeping IPFS-sourced fields grouped):
     ```rust
     /// Documents referenced in the loan metadata (Agreement, License, T&Cs, …).
     /// `#[serde(default)]` is required: `LoanSnapshot` is `deny_unknown_fields` and is
     /// deserialized from existing `contract_logs.params.snapshot` JSONB rows that predate
     /// this field — empty vec when absent.
     #[serde(default)]
     pub documents: Vec<LoanDocument>,
     ```

2. **Indexer DTO — `packages/worker/src/indexer/loan_metadata.rs`**
   - Import the shared type: `use shared::loan_snapshot::LoanDocument;`
   - Add to `LoanMetadataJson` (after `metadata_uri`):
     ```rust
     /// Documents referenced in the metadata document. `#[serde(default)]` keeps
     /// back-compat with legacy IPFS documents that omit the key (the struct is
     /// `deny_unknown_fields`) — empty vec when absent.
     #[serde(default)]
     pub documents: Vec<LoanDocument>,
     ```
   - Reusing the shared `LoanDocument` (worker already depends on `shared`) means the mapper carries the field by direct move — no per-field conversion needed.

3. **Mapper — `packages/worker/src/indexer/loan_mapper.rs`**
   - In `compose_drawn_snapshot` (IPFS fields block, ~line 108): add `documents: json.documents,`.
   - In `compose_lifecycle_snapshot`: extend the destructuring tuple and both match arms to carry `documents` (from `json.documents` on the refreshed branch, `prior.documents` on the carry-forward branch), then set `documents,` in the returned `LoanSnapshot` (~line 191).

4. **API DTO + mapping — `packages/api/src/routes/loan_book.rs`**
   - Add an API-crate DTO (separate from the shared type because it needs `ToSchema`, and it is used on both the response and the request so it needs `Deserialize` too):
     ```rust
     /// A single document reference (name + URI) from the loan metadata.
     #[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
     pub struct LoanDocumentDto {
         pub name: String,
         pub uri: String,
     }
     ```
   - `LoanBookEntry`: add
     ```rust
     /// Documents referenced in the loan metadata (Agreement, License, T&Cs, …).
     /// Empty when the loan's metadata records none.
     pub documents: Vec<LoanDocumentDto>,
     ```
   - `SubmitLoanRequest`: add (keeps the submission payload shape aligned with the IPFS document)
     ```rust
     /// Documents referenced in the metadata document.
     #[serde(default)]
     pub documents: Vec<LoanDocumentDto>,
     ```
   - In `compute_loan_book` (the `entries.push(LoanBookEntry { … })` block, ~line 680): map
     ```rust
     documents: s.documents.iter()
         .map(|d| LoanDocumentDto { name: d.name.clone(), uri: d.uri.clone() })
         .collect(),
     ```
   - Register the new schema in the `#[openapi(components(schemas( … )))]` list on `LoanBookDoc` (~line 252): add `LoanDocumentDto,`.

5. **Lint/build gate** — run `cargo clippy --all -- -D warnings` and `cargo build` (per `AGENTS.md`). No TypeScript touched, so `lint-docs` only if docs change (step in Docs section).

## Test Strategy

Per repo convention, Rust tests live in external files (`packages/<pkg>/tests/<topic>.rs`), never inline `#[cfg(test)] mod tests` in `src/`, and must be pure unit tests with no `DATABASE_URL`/Postgres access.

- **Mapper tests** (`packages/worker/tests/` — extend the existing loan-mapper test file, or add one):
  - `compose_drawn_snapshot` carries a populated `documents` vec through to the snapshot.
  - `compose_lifecycle_snapshot` **carry-forward** branch (`refreshed_json = None`) preserves `prior.documents`.
  - `compose_lifecycle_snapshot` **refreshed** branch (`refreshed_json = Some`) replaces with the new document set.
- **Deserialization / back-compat** (extend existing `LoanMetadataJson` / `LoanSnapshot` tests, mirroring the `protection` present/absent tests):
  - `LoanMetadataJson` deserializes the full sample JSON from the issue (3 documents) correctly, including the renamed `borrowerId`/`governingLaw`/`metadataURI` keys.
  - `LoanMetadataJson` with `documents` **absent** deserializes to an empty vec (no error despite `deny_unknown_fields`).
  - A per-document object with an **extra unknown key** still deserializes (confirms `LoanDocument` is not `deny_unknown_fields`).
  - `LoanSnapshot` round-trips (`serde_json` to_value → from_value) with documents present, and a legacy JSONB value **without** `documents` deserializes to an empty vec.
- **API DTO** (optional, if a loan_book route test file exists): assert `LoanBookEntry` serializes `documents` as a JSON array of `{name, uri}`.

## Docs to Update

- `docs/product-specs/loans.md` — the section describing the IPFS metadata pointer already notes it holds "additional documents"; add `documents[]` (`{ name, uri }`) to the documented off-chain metadata document shape.
- `docs/product-specs/api-authorization.md` — the `POST /v1/ln/loan` payload listing enumerates the off-chain metadata fields (`governing_law`, `secondary_metadata_uri`, …); add `documents` to that list.
- Run `npx tsx scripts/lint-docs.ts` after editing docs (per `AGENTS.md`). No generated OpenAPI docs to regenerate beyond the in-code `utoipa` annotations added in step 4.
