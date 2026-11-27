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

fn parse_flag(raw: Option<&str>, default: bool) -> bool {
    raw.map_or(default, |v| {
        matches!(v.to_lowercase().as_str(), "1" | "true" | "yes")
    })
}

pub fn crystal_enabled() -> bool {
    parse_flag(std::env::var("CRYSTAL_ENABLED").ok().as_deref(), true)
}

pub fn elliptic_enabled() -> bool {
    parse_flag(std::env::var("ELLIPTIC_ENABLED").ok().as_deref(), false)
}

#[cfg(test)]
mod tests {
    use super::parse_flag;

    #[test]
    fn defaults_and_truthy_values() {
        assert!(parse_flag(None, true));
        assert!(!parse_flag(None, false));
        for v in ["1", "true", "TRUE", "Yes"] {
            assert!(parse_flag(Some(v), false), "{v}");
        }
        for v in ["0", "false", "no", "", "garbage"] {
            assert!(!parse_flag(Some(v), true), "{v}");
        }
    }
}
