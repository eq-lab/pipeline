# User story: #1763 — Trustee resolves escrowed incoming wires

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1763
**Status:** Initial

---

## Overview

A wire booked with `receiver` = the minter is held in escrow. The Trustee console lists these on Cash Management → Escrowed wires and resolves each one: assign it to a lender (`assign_wire_in`) or return it (`return_wire_in`). Stellar only. Spec: `docs/product-specs/deposits.md#escrowed-wires` and `docs/frontend/trustee-flows.md#cash-management--escrowed-wires`. The Mint-PLUSD capital-wallet fallback is unchanged (decision 2026-11-02).

All checks use the real API on staging (Stellar testnet), no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- An escrowed wire is created by `record_wire_in` with `receiver` = the minter. None exists on testnet today, and BUG-32 (logged with #1762) blocks creating one: the testnet minter lacks the PLUSD `MINTER` role. Until ops grants it, stories 4–8 can only be exercised against a `Direct` wire (the app refuses before signing) and by the unit tests.
- `return_wire_in` burns PLUSD, and the testnet minter may lack the PLUSD burn role (`ADMIN`). Story 6 may fail at the burn step once an escrowed wire exists; if it does, log it in `docs/exec-plans/known-bugs.md`.
- The staging API needs `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` set, otherwise the cash book answers `404 minter_not_configured` (an ops env change).

---

## Story 1 — List on a Stellar session

**Given** a Trustee is signed in on the Stellar network

**When** they open Cash Management and the Escrowed wires tab

**Then:**

- Network shows `GET /v1/cash-book?chain_id=<Stellar id>` answering 200 (or `404 minter_not_configured`, in which case the tab says "The cash book is not configured for Stellar on this server.")
- The chain chip reads Stellar
- Only `wire_ins` with `status = Escrowed` are listed, with wire id, the full 6-decimal amount, value date, reference hash (full value in the tooltip), recorded at and an on-chain status of "Escrowed (confirmed on-chain)"
- With no escrowed wire the tab reads "No incoming wires are in escrow."

---

## Story 2 — EVM session shows the reason

**Given** a Trustee is signed in on an EVM network

**When** they open the Escrowed wires tab

**Then:**

- The tab reads "Escrowed wires on {chain} are not available in the Trustee app yet." with the chain chip
- Network shows no `GET /v1/cash-book` request

---

## Story 3 — A wallet without the Trustee role

**Given** a connected wallet that does not hold the `TRUSTEE` role (or holds it with a delay) and an escrowed wire is listed

**When** the Trustee looks at the row

**Then:**

- Assign to lender and Return are disabled
- The reason line reads "Only the Trustee role can assign escrowed wires." (or the delay wording)
- With no wallet connected the reason is "Connect your trustee wallet to act on escrowed wires."

---

## Story 4 — Assign to an authorised lender

**Given** an escrowed wire is listed and the wallet holds `TRUSTEE` with no delay

**When** the Trustee clicks Assign to lender, picks a lender that has a linked Stellar settlement address and confirms

**Then:**

- The select lists only lenders with a linked Stellar address; the full receiver address and "authorised to hold PLUSD" show once picked
- The wallet is asked to sign one `AccessManager.execute(minter, assign_wire_in, [id, receiver])`
- The success notice reads "Wire #{id} assigned on-chain to {lender} ({receiver}). Status Assigned. Transaction {hash}. It leaves this list once indexed."
- The row shows "Assigned on-chain — waiting for the indexer" with both actions disabled, then leaves the list

---

## Story 5 — Assign blocked for an unauthorised lender

**Given** the dialog is open

**When** the Trustee picks a lender whose address is not PLUSD-authorised or has no PLUSD trustline

**Then:**

- The dialog says "This lender's address is not authorised to hold PLUSD. It cannot receive this wire." or "This lender's address has no PLUSD trustline."
- The confirm button stays disabled and no signature is requested
- If the lender's settlement address changes before confirming, the dialog returns to the select with a notice and signs nothing

---

## Story 6 — Return with a fresh reference

**Given** an escrowed wire is listed and the wallet holds `TRUSTEE` with no delay

**When** the Trustee clicks Return, enters the outgoing wire's bank reference and confirms

**Then:**

- The computed `ref_hash` is shown, and `ref_hash_seen` is read before signing
- The wallet is asked to sign `AccessManager.execute(minter, return_wire_in, [id, ref_hash])`
- The notice reads "Wire #{id} returned on-chain. Status Returned, return reference {hash}. Transaction {hash}. It leaves this list once indexed."

---

## Story 7 — Return blocked by a reused reference

**Given** the Return dialog is open

**When** the Trustee enters a reference whose hash was already used on-chain and confirms

**Then:**

- The dialog says "This bank reference is already recorded on-chain. Use the outgoing wire's own reference."
- No signature is requested

---

## Story 8 — A stale row shows "waiting for the indexer"

**Given** a wire the cash book still serves as `Escrowed` was already assigned or returned on-chain

**When** the Trustee opens the tab

**Then:**

- The on-chain status reads "Assigned on-chain — waiting for the indexer" (or "Returned on-chain — …")
- Both actions are disabled with a reason
- If the on-chain status is `Direct`, the row reads "On-chain status Direct differs from the cash book" and the actions stay disabled
