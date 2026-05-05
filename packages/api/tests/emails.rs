use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use std::sync::Arc;
use tower::ServiceExt;

async fn test_app() -> (Router, sqlx::PgPool) {
    dotenvy::dotenv().ok();
    let db_url = std::env::var("POSTGRES_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("POSTGRES_URL or DATABASE_URL must be set for tests");

    let pool = sqlx::PgPool::connect(&db_url).await.unwrap();
    sqlx::migrate!("../shared/migrations")
        .run(&pool)
        .await
        .unwrap();

    // Clean up test data
    sqlx::query("DELETE FROM emails WHERE email LIKE '%@test-pipeline.example'")
        .execute(&pool)
        .await
        .unwrap();

    let sumsub_settings = shared::sumsub::config::SumsubSettings {
        app_token: "test".into(),
        secret_key: "test".into(),
        base_url: "http://localhost".into(),
        verification_level: "test".into(),
        webhook_secret_key: "test".into(),
        sandbox: true,
        token_ttl_secs: 600,
    };
    let sumsub_client = shared::sumsub::client::SumsubClient::new(sumsub_settings.clone());
    let kyc_repo = shared::kyc_repo::KycRepo::new(pool.clone());

    let state = Arc::new(pipeline_api::AppState {
        pool: pool.clone(),
        kyc_repo,
        sumsub_client,
        sumsub_settings,
    });

    let app = Router::new()
        .nest("/v1/emails", pipeline_api::routes::emails::router())
        .with_state(state);

    (app, pool)
}

#[tokio::test]
async fn valid_email_returns_201() {
    let (app, _pool) = test_app().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/emails")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"valid@test-pipeline.example"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn duplicate_email_still_returns_201() {
    let (app, _pool) = test_app().await;

    let make_req = || {
        Request::builder()
            .method("POST")
            .uri("/v1/emails")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"email":"dupe@test-pipeline.example"}"#))
            .unwrap()
    };

    let resp1 = app.clone().oneshot(make_req()).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);

    let resp2 = app.oneshot(make_req()).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn invalid_email_returns_400() {
    let (app, _pool) = test_app().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/emails")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"not-an-email"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn empty_email_returns_400() {
    let (app, _pool) = test_app().await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/emails")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":""}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
