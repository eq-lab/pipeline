pub struct KycOutboxJobSettings {
    pub name: String,
    pub interval_secs: u64,
    pub batch_size: i64,
}

impl KycOutboxJobSettings {
    pub fn from_env(name: &str) -> Self {
        let prefix = format!("JOB_{}_", name.to_uppercase());
        let interval_secs: u64 = std::env::var(format!("{prefix}INTERVAL_SECS"))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let batch_size: i64 = std::env::var(format!("{prefix}BATCH_SIZE"))
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);
        Self {
            name: name.to_owned(),
            interval_secs,
            batch_size,
        }
    }
}
