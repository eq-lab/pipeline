use pipeline_worker::evm_http::evm_rpc_client;

#[test]
fn local_urls_keep_the_fast_poll_interval() {
    let local = evm_rpc_client("http://127.0.0.1:8545".parse().unwrap());
    let remote = evm_rpc_client("https://rpc.example.org".parse().unwrap());
    assert!(local.is_local());
    assert!(!remote.is_local());
}
