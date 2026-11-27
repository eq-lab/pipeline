// KYT provider seam shared by Crystal (EVM) and Elliptic (Stellar).
// spec: docs/superpowers/specs/2026-07-06-elliptic-stellar-kyt-design.md
use async_trait::async_trait;

pub type KytVerdict = (f32, serde_json::Value, bool);

#[async_trait]
pub trait KytProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn address_verdict(&self, address: &str) -> anyhow::Result<KytVerdict>;
    async fn deposit_verdict(&self, tx_hash: &str, sender: &str) -> anyhow::Result<KytVerdict>;
    fn profile_address(&self, sender: &str) -> String;
}
