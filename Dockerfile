# Build stage — compiles the entire Rust workspace
FROM rust:1.87-slim AS build
WORKDIR /sln

# Install system deps needed by sqlx (OpenSSL, pkg-config)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
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

ENTRYPOINT ["./worker"]

# API image
FROM debian:bookworm-slim AS api
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /sln/target/release/pipeline-api ./api

EXPOSE 8080

ENTRYPOINT ["./api"]
