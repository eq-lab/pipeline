-- Migration: `lp_bank_deposits` gains the minter's wire reference key (#1413,
-- epic #1269 point 3) — a follow-up to 20261002000001, which had already been
-- applied, so the shape change lands as an ALTER rather than an edit there.
--
-- `payment_reference` becomes mandatory and unique. It was nullable because the
-- original column set treated it as a nice-to-have memo; it is in fact the only
-- thing identifying a wire, and the Stellar minter needs one per deposit (below).
-- Uniqueness also restores the double-submit guard the agreed column set had
-- dropped with `idempotency_key` — a repeat `POST /v1/lps/{id}/bank-deposits`
-- now answers `409` instead of recording the same wire twice (TD-113).
--
-- `ref_hash` is `sha256(payment_reference)` over the stored reference's UTF-8
-- bytes, computed by the API at insert time. It is the `ref_hash: BytesN<32>`
-- that `MinterContract::record_wire_in` takes and that `event::WireIn` carries
-- (pipeline-stellar-contracts `contracts/minter/src/lib.rs`): to the contract an
-- opaque 32-byte key, refused when zero (`MissingRef`) and refused when already
-- spent (`RefHashSeen`, via `store::mark_ref`). Storing it rather than deriving
-- it on read keeps the on-chain key stable if the derivation ever changes, and
-- lets the mint leg match an event back to its row by equality. `BYTEA` with a
-- length CHECK, not `TEXT`, so a row cannot hold something the contract's type
-- cannot: unique for the same reason the reference is.
--
-- `is_minted` tracks whether the deposit's PLUSD leg has been minted on Stellar.
-- Nothing writes `true` yet — the mint call is a later issue (#11); every row
-- this endpoint records starts `false`.
--
-- The table is empty in every environment (it was created three days ago and
-- only `POST /v1/lps/{id}/bank-deposits` writes it), so `SET NOT NULL` needs no
-- backfill. If a dev database does hold rows, drop them before migrating — a
-- deposit predating this migration has no reference to hash.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   ALTER TABLE lp_bank_deposits
--       DROP CONSTRAINT lp_bank_deposits_ref_hash_key,
--       DROP CONSTRAINT lp_bank_deposits_payment_reference_key,
--       DROP CONSTRAINT lp_bank_deposits_ref_hash_len,
--       DROP COLUMN is_minted,
--       DROP COLUMN ref_hash,
--       ALTER COLUMN payment_reference DROP NOT NULL;

ALTER TABLE lp_bank_deposits
    ADD COLUMN ref_hash  BYTEA,
    ADD COLUMN is_minted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE lp_bank_deposits
    ALTER COLUMN payment_reference SET NOT NULL,
    ALTER COLUMN ref_hash          SET NOT NULL,
    ADD CONSTRAINT lp_bank_deposits_ref_hash_len CHECK (octet_length(ref_hash) = 32),
    ADD CONSTRAINT lp_bank_deposits_payment_reference_key UNIQUE (payment_reference),
    ADD CONSTRAINT lp_bank_deposits_ref_hash_key UNIQUE (ref_hash);
