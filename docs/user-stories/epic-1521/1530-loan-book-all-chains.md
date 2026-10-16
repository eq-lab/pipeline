# User story: #1530 — LoanBook API: GET /v1/loan-book across all chains

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1530
**Status:** Initial

---

## Overview

Backend-only. `GET /v1/loan-book` takes an optional `chain_id`. Omitted, it returns the union over every configured chain. There is no Figma reference. The stories below are checked against the dev stack with `CHAINS` holding two chains that both have loans (loan id `1` exists on both).

---

## Story 1 — No chain_id returns loans from every configured chain

**Given** two configured chains each with an indexed loan `1`

**When** `GET /v1/loan-book` is called without `chain_id`

**Then:**

- `loans[]` contains both loans as separate rows, each with its own `chain_id`
- Each row shows its own chain's collateral, spot price, disbursed flag and days on watchlist
- Rows are ordered active first, then terminal, each by principal descending, then `chain_id` ascending, then `loan_id` ascending (numeric)

## Story 2 — A configured chain_id is unchanged

**Given** the same setup

**When** `GET /v1/loan-book?chain_id=<configured>` is called

**Then:**

- The response is identical to the response before this change for that chain

## Story 3 — An unconfigured chain_id returns an empty book

**When** `GET /v1/loan-book?chain_id=560048` is called and `560048` is not in `CHAINS`

**Then:**

- The response is 200 with `loans: []` and a zeroed `summary`

## Story 4 — A malformed chain_id is rejected

**When** `GET /v1/loan-book?chain_id=abc` or `?chain_id=1&chain_id=2` is called

**Then:**

- The response is 400 JSON `{"error":"invalid chain_id: abc"}` or `{"error":"invalid chain_id: must appear at most once"}`

## Story 5 — Summary cards are the union's figures

**When** `GET /v1/loan-book` is called without `chain_id`

**Then:**

- `summary.total_deployed`, `deployed_senior`, `total_collateral` and the at-risk figures equal the sums over the rows of both chains
- `weighted_rate` and `weighted_tenor_days` are weighted by principal across both chains
- `top_concentration` sums the same commodity across chains
