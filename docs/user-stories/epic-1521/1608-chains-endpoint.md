# User story: #1608 — API: GET /v1/chains — expose the configured chains and their kind

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1608
**Status:** Initial

---

## Overview

`GET /v1/chains` is a public, unauthenticated endpoint that lists the chains the API serves: every id in `CHAINS`, in `CHAINS` order, each with its kind from `CHAIN_<id>_TYPE`. The response is `{"chains":[{"chain_id":<id>,"kind":"evm"|"stellar"}]}`. It takes no parameters, makes no database call, and exposes no addresses or secrets.

Optional-chain endpoints answer a well-formed but unconfigured `chain_id` with `200` and an empty or zeroed body. This endpoint lets a client tell that case apart from a configured chain with no data, so it can show "not available on this network" (#1605) or hide chains the API does not serve. Backend-only; no Figma reference. No frontend caller yet.

Automated coverage is in `packages/api/tests/chains.rs` (response shape and order, unauthenticated `200` through the router, OpenAPI path and schemas).

---

## Story 1 — A client lists the chains the API serves

**Given** the API is configured with `CHAINS=99000001,1`, where `CHAIN_99000001_TYPE=stellar` and chain 1 has no `CHAIN_1_TYPE`

**When** `GET /v1/chains` is called with no `Authorization` header

**Then:**

- The response is 200 `{"chains":[{"chain_id":99000001,"kind":"stellar"},{"chain_id":1,"kind":"evm"}]}`
- The order follows `CHAINS`, not the numeric chain id
- A chain without `CHAIN_<id>_TYPE` is reported as `evm`
- No database access happens

## Story 2 — A client detects a chain the API does not serve

**Given** the API is configured with `CHAINS=99000002`, and the LP app's EVM view uses chain 1

**When** the LP app reads `GET /v1/chains`

**Then:**

- Chain 1 is absent from `chains`, so the client knows the `200` empty answers from optional-chain endpoints such as `GET /v1/stats?chain_id=1` mean "not served", not "no data"
- Chain 99000002 is listed with `"kind":"stellar"` when `CHAIN_99000002_TYPE=stellar`
