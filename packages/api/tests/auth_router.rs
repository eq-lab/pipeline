//! Construction-time sanity checks for the split auth route module.
//!
//! Lives under `packages/api/tests/` per the project convention (all tests in
//! `tests/`, feature-named, no inline `#[cfg(test)]` in `src/`). Pure unit tests —
//! no `DATABASE_URL` / Postgres connection, no network, no server bound.
//!
//! `routes::auth::router` merges two sub-routers since the module was split into
//! `wallet` + `password`. axum panics on a path collision at merge time and
//! utoipa on a duplicate operation, so both failures surface only when the
//! objects are actually built — never from the handler unit tests.

use utoipa::OpenApi;

use pipeline_api::routes::auth::{router, AuthDoc};

#[test]
fn the_merged_auth_router_builds_without_a_path_collision() {
    let _ = router();
}

#[test]
fn the_auth_openapi_bundle_builds_and_documents_every_route() {
    let doc = AuthDoc::openapi();
    let documented: Vec<&str> = doc.paths.paths.keys().map(String::as_str).collect();

    for expected in [
        "/v1/auth/challenge",
        "/v1/auth/verify",
        "/v1/auth/signup",
        "/v1/auth/verify-otp",
        "/v1/auth/resend-otp",
        "/v1/auth/login",
    ] {
        assert!(
            documented.contains(&expected),
            "{expected} is missing from the auth OpenAPI bundle; documented: {documented:?}"
        );
    }
}
