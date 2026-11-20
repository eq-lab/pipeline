# User story: #1786 — Retire CCR figures on all chains (Phase 1: loan-book SecurityRegistry fields)

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1786
**Status:** Initial

---

## Overview

Phase 1 adds three nullable keys to every `GET /v1/loan-book` `loans[]` entry: `ltv_bps`, `margin_call_open` and `price_stale`. They come from the SecurityRegistry projection tables and equal the values of `GET /v1/loan-book/{loan_id}/security`. Nothing is removed in this phase. Spec: `docs/product-specs/loan-security-state.md#loan-book-fields`. Stories 1 and 2 need a testnet Stellar chain with `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` set and an indexed loan; they run in the epic QA pass #1777. Phase 2 stories (removals) are added with that PR.

---

## Story 1 — A Stellar loan with a snapshot

**Given** a Stellar chain with the API SecurityRegistry key and a loan with terms and a valuation snapshot

**When** a client reads `GET /v1/loan-book`

**Then:**

- the loan's entry has `ltv_bps`, `margin_call_open` and `price_stale` equal to `valuation.ltv_bps`, `margin_call.open` and `valuation.price_stale` of `/v1/loan-book/{loan_id}/security?chain_id=<id>`
- `ltv_bps` of `4294967295` is served as is
- the legacy `ltv`, `ccr_bps` and every other key are unchanged

---

## Story 2 — A Stellar loan without terms or without a snapshot

**Given** a Stellar loan with a valuation snapshot but no terms row, and another with terms but no snapshot

**When** a client reads `GET /v1/loan-book`

**Then:**

- the first has `margin_call_open: null` and its `ltv_bps` and `price_stale` set
- the second has `ltv_bps: null` and `price_stale: null` and a boolean `margin_call_open`

---

## Story 3 — EVM and unconfigured chains

**Given** an EVM chain, or a Stellar chain without the API SecurityRegistry key

**When** a client reads `GET /v1/loan-book`

**Then:**

- every entry on that chain has the three keys present and `null`
- no new env key is needed and the response is otherwise identical to before
