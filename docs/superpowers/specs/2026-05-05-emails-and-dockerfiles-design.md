# Email Endpoint + Dockerfiles Design

**Date:** 2026-05-05
**Issues:** #19 (email endpoint), #20 (Dockerfiles)
**Status:** Approved

## Email Endpoint

### Purpose

Public waitlist/newsletter signup endpoint. No authentication required.

### Database

New migration adds an `emails` table:

```sql
CREATE TABLE emails (
    email TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### API

**`POST /v1/emails`**

- Request body: `{ "email": "user@example.com" }`
- Validates email format (contains `@`, has domain part with `.`)
- Inserts with `ON CONFLICT DO NOTHING` — returns 201 whether new or duplicate (no information leakage)
- Returns 400 on invalid format

**Code placement:**
- Migration: new file in `packages/shared/migrations/`
- Route + model: `packages/api/src/routes/emails.rs`
- Inline sqlx query — single query, no separate repo

## Dockerfile

Single `Dockerfile` at repo root with multi-stage `--target` builds, following the pattern from hypercroc-backend.

### Stage 1 — `build`

- Base: `rust:1.87-slim`
- Copies workspace `Cargo.toml`, `Cargo.lock`, then source
- Builds both binaries: `cargo build --release --bin api --bin worker`

### Stage 2 — `api`

- Base: `debian:bookworm-slim`
- Copies `api` binary from build stage
- Installs `ca-certificates` (HTTPS to Sumsub)
- `EXPOSE 8080`
- `ENTRYPOINT ["./api"]`

### Stage 3 — `worker`

- Base: `debian:bookworm-slim`
- Copies `worker` binary from build stage
- Installs `ca-certificates` (HTTPS to RPC/Sumsub)
- `ENTRYPOINT ["./worker"]`

### Build commands

```sh
docker build --target api -t pipeline-api .
docker build --target worker -t pipeline-worker .
```

## Decisions

- No rate limiting on email endpoint — can be added later if needed
- No `cargo-chef` in Dockerfile — keep simple, add if build times become an issue
- No separate email repo in shared crate — single inline query is sufficient
- 201 for both new and duplicate emails — prevents enumeration
