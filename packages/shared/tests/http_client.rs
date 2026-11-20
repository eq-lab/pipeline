use std::time::Duration;

use shared::http_client::{http_client, http_client_with};
use tokio::net::TcpListener;

#[tokio::test]
async fn request_to_a_silent_server_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let _accept = tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((sock, _)) = listener.accept().await {
            held.push(sock);
        }
    });

    let client = http_client_with(Duration::from_millis(200));
    let res = tokio::time::timeout(
        Duration::from_secs(5),
        client.get(format!("http://{addr}/")).send(),
    )
    .await
    .expect("client timeout fires before the guard");
    assert!(res.expect_err("must time out").is_timeout());
}

#[test]
fn default_client_builds() {
    let _ = http_client();
}
