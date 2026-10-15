# Issue #1499: LP settlement address per chain: accept an EVM address on link-address, expose it in LP responses, Trustee counterparties and the spec

Source: https://github.com/eq-lab/pipeline/issues/1499 (sub-issue of epic #1494)

## Scope

In scope:
- Spec: `docs/product-specs/kyb-lp-verification.md` § Settlement Address models one settlement address **per chain kind** (`evm`, `stellar`). An LP may hold both. Freeze/fixing rules (`Failed` closes, `Passed` fixes an address already held, an LP that passed without one may name it once) apply **per kind, independently**. Uniqueness is per kind across all LPs.
- DB: new migration in `packages/shared/migrations/` adding `lps.evm_address TEXT UNIQUE` (nullable, stored lowercased) and `lps.evm_address_linked_at TIMESTAMPTZ`. Existing `stellar_address` / `address_linked_at` stay as-is (`address_linked_at` keeps meaning "Stellar linked at").
- Shared repo (`packages/shared/src/lp_repo.rs`): row struct + `COLUMNS` gain the two fields; `link_address` becomes kind-aware (`link_address(id, ChainKind, &str)`), each kind's SQL guard checks its own column (`kyb_status <> 'Failed' AND (<col> IS NULL OR kyb_status <> 'Passed')`). `allows_address_write(has_address)` unchanged; the caller passes the per-kind `is_some()`.
- Shared validation (`packages/shared/src/chains.rs`): add `validate_evm_address(key, raw) -> Result<String>` (`0x` + 40 hex, returns lowercase), next to `validate_stellar_address`.
- API (`packages/api/src/routes/lps.rs`): `LinkAddressRequest` becomes `{ chain_id: i64, address: String }`; resolve `parse_chain_type(chain_id)` → `ChainKind` and dispatch to the matching validator. Error messages name the kind (`evm_address ... already linked to another LP`). `LpResponse` and the summary/list response (line ~192) add `evm_address` and `evm_address_linked_at`; keep `stellar_address` and `address_linked_at` unchanged. Update utoipa docs (request schema, 400/409 descriptions).
- Trustee app: `packages/trustee/src/api/useLps.ts` types add `evm_address`, `evm_address_linked_at`; `-useLpCounterpartiesTable.ts` "Blockchain address" = "Yes" when either address is set; `lp-counterparties.$id.tsx` detail shows both addresses (Stellar and EVM rows, each with the existing copy/"—" pattern); `-useLpBankDeposits.ts` `wireInReceiver` takes the chain kind being minted on and reads the matching address + linked_at (callers keep passing `"stellar"` today; EVM minting itself is #1501).
- LP app: `packages/frontend/src/api/lps.ts` `Lp` type adds `evm_address`, `evm_address_linked_at`; any link-address request helper (if present) uses the new body. No UI (#1254, blocked).

Out of scope: proof of key ownership (TD-57, note it covers EVM too); EVM wire-in matching (#1500) and Trustee EVM mint (#1501); deployment config (#1503, human, argocd); LP Account link-address UI (#1254).

## Assumptions and Risks

- The actual table is `lps` (issue text says `lp_profiles`); plan uses `lps`.
- The old `lps_stellar_address_passed_ck` CHECK was dropped by `20260929000003`; do not reintroduce an equivalent for `evm_address`.
- `parse_chain_type` defaults unknown/unset chain ids to `Evm`. So a `chain_id` the API is not configured for is treated as EVM. Acceptable for validation purposes (address shape still checked), but means `chain_id` is only a kind selector, not a validated configured chain. See Open Questions.
- Breaking request-body change: any existing caller sending `{ stellar_address }` breaks. Grep shows no frontend caller today (UI is #1254), but staging scripts/tests may use it.
- EVM addresses stored lowercased; the uniqueness check is therefore case-insensitive by construction. Responses return lowercase (not checksummed).
- #1501 depends on `wireInReceiver` being kind-aware; keep the signature simple.

## Open Questions

- Should `link-address` keep accepting the legacy `{ "stellar_address": "G..." }` body for one release (untagged serde enum), or switch hard to `{ chain_id, address }`? Plan default: hard switch, since no in-repo caller exists.
- Should `chain_id` be required to be one of the API's configured `CHAINS` (reject unknown ids with 400), rather than relying on `parse_chain_type`'s default-to-EVM? Plan default: accept any id and rely on address-shape validation.
- Confirm the spec decision that an LP may hold both an EVM and a Stellar address simultaneously, with Passed fixing each one independently (plan default: yes).

## Implementation Steps

1. Spec: rewrite `docs/product-specs/kyb-lp-verification.md` § Settlement Address (lines ~65-73): per-kind addresses, both allowed, per-kind freeze/fixing and uniqueness, request shape `{ chain_id, address }`, EVM lowercased; update the Security Considerations TD-57 bullet to say "Stellar or EVM address". Update any API spec doc that documents `link-address` (grep `link-address` in `docs/`).
2. Migration `packages/shared/migrations/<next-timestamp>_lps_evm_address.sql`: `ALTER TABLE lps ADD COLUMN evm_address TEXT UNIQUE, ADD COLUMN evm_address_linked_at TIMESTAMPTZ;` plus a CHECK `evm_address IS NULL OR evm_address = lower(evm_address)` (2-3 line header comment only).
3. `packages/shared/src/chains.rs`: add `validate_evm_address` + unit tests (valid mixed-case → lowercase, missing 0x, wrong length, non-hex).
4. `packages/shared/src/lp_repo.rs`: add fields to the row struct and `COLUMNS`; change `link_address` to take `ChainKind`, choosing column pair (`stellar_address`/`address_linked_at` vs `evm_address`/`evm_address_linked_at`) via a match on static SQL strings (no string interpolation of user data). Update the doc comment on the guard.
5. `packages/api/src/routes/lps.rs`: new `LinkAddressRequest { chain_id, address }`; in `link_address` handler: `parse_chain_type` (map error → 400), validate per kind, compute `has_address` from the matching column, call repo with kind, kind-specific conflict messages. Add `evm_address` / `evm_address_linked_at` to `LpResponse` and the list summary struct + `From` impls. Update utoipa annotations; regenerate OpenAPI if the repo has a generated artifact (check `docs/generated/`).
6. Trustee: update `useLps.ts` types; `-useLpCounterpartiesTable.ts` either-address rule; `lp-counterparties.$id.tsx` add an "EVM address" row beside the Stellar one; `-useLpBankDeposits.ts` `wireInReceiver(lp, kind: "stellar" | "evm", capitalWalletId)` reading the matching pair, existing call site passes `"stellar"`.
7. LP app: `packages/frontend/src/api/lps.ts` type fields; update test fixtures that build full `Lp` objects (`CompanyDocsModal.test.tsx`, `useAccountPage.test.tsx`, `-account.test.tsx`) to include the new nulls.

## Test Strategy

- Rust unit: `validate_evm_address` cases; `allows_address_write` unchanged.
- API integration tests (existing `lps` route tests): link EVM address at NotStarted → 200, response has lowercased `evm_address` and `evm_address_linked_at`, `stellar_address` untouched; link both kinds on one LP; EVM address already linked to another LP (different case) → 409; Passed with EVM set → 409 on EVM but Stellar still writable once if unset; Failed → 409 for both; invalid address for kind (G… with EVM chain id, 0x with Stellar chain id) → 400; Stellar path regression with new body.
- Migration applies cleanly (`sqlx` test DB), lowercase CHECK rejects mixed case.
- Trustee vitest: `mapLpToRow` Yes for EVM-only/Stellar-only/both, No for neither; detail page renders both rows and "—" when absent; `wireInReceiver` per kind (linked → LP address, unlinked → capital wallet).
- Frontend fixtures compile (`tsc`), run `/test-fast`.

## Docs to Update

- `docs/product-specs/kyb-lp-verification.md` (§ Settlement Address, Security Considerations).
- Any `docs/` page describing `POST /v1/lps/me/link-address` or `LpResponse`; generated OpenAPI if checked in.
- `docs/exec-plans/tech-debt-tracker.md` TD-57: note it now covers the EVM address too (wording only).
