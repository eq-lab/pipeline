# Build stage — compiles the entire Rust workspace
FROM rust:1.88-slim AS build
WORKDIR /sln

# Install system deps needed by sqlx (OpenSSL, pkg-config)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for layer caching
COPY Cargo.toml Cargo.lock ./
COPY packages/api/Cargo.toml packages/api/Cargo.toml
COPY packages/worker/Cargo.toml packages/worker/Cargo.toml
COPY packages/shared/Cargo.toml packages/shared/Cargo.toml

# Create dummy source files so cargo can resolve the workspace and cache deps
RUN mkdir -p packages/api/src packages/worker/src packages/shared/src \
    && echo "fn main() {}" > packages/api/src/main.rs \
    && echo "" > packages/api/src/lib.rs \
    && echo "fn main() {}" > packages/worker/src/main.rs \
    && echo "" > packages/worker/src/lib.rs \
    && echo "" > packages/shared/src/lib.rs

# Set sqlx to offline mode (no DB needed at build time)
ENV SQLX_OFFLINE=true

# Cache dependency build
RUN cargo build --release --bin pipeline-api --bin pipeline-worker 2>/dev/null || true

# Copy actual source code
COPY packages/ packages/

# Touch source files to invalidate the dummy build cache
RUN touch packages/api/src/main.rs packages/api/src/lib.rs \
    packages/worker/src/main.rs packages/worker/src/lib.rs \
    packages/shared/src/lib.rs

# Build the real binaries
RUN cargo build --release --bin pipeline-api --bin pipeline-worker

# Worker image
FROM debian:bookworm-slim AS worker
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /sln/target/release/pipeline-worker ./worker

ENV RUST_LOG=info
ENTRYPOINT ["./worker"]

# API image
FROM debian:bookworm-slim AS api
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /sln/target/release/pipeline-api ./api

ENV RUST_LOG=info
EXPOSE 8080

ENTRYPOINT ["./api"]

# Frontend build image
FROM node:22-slim AS frontend-build
WORKDIR /sln

# Copy workspace manifests first for stable dependency layers.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases/yarn-4.13.0.cjs .yarn/releases/yarn-4.13.0.cjs
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN corepack enable && yarn install --immutable

# @pipeline/frontend imports the source-only @pipeline/ui workspace package.
COPY packages/frontend/ packages/frontend/
COPY packages/ui/ packages/ui/

RUN yarn workspace @pipeline/frontend build

# Frontend runtime image
FROM nginx:1.27-alpine AS frontend
WORKDIR /usr/share/nginx/html

RUN apk add --no-cache jq

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/frontend/entrypoint.sh /docker-entrypoint.d/40-write-runtime-env.sh
RUN chmod +x /docker-entrypoint.d/40-write-runtime-env.sh
COPY --from=frontend-build /sln/packages/frontend/dist/ /usr/share/nginx/html/

EXPOSE 80
