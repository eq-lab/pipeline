// spec: docs/references/backend.md#http-client-timeouts
use alloy::rpc::client::RpcClient;
use alloy::transports::http::Http;

pub fn evm_rpc_client(url: reqwest::Url) -> RpcClient<Http<reqwest::Client>> {
    let http = Http::with_client(shared::http_client::http_client(), url);
    let local = http.guess_local();
    RpcClient::new(http, local)
}
