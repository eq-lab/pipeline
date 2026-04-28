pub struct KycOutboxJobSettings {
    pub interval_secs: u64,
    pub batch_size: i64,
}

impl KycOutboxJobSettings {
    pub fn from_env() -> Self {
        let interval_secs: u64 = std::env::var("JOB_KYC_OUTBOX_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let batch_size: i64 = std::env::var("JOB_KYC_OUTBOX_BATCH_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);
        Self {
            interval_secs,
            batch_size,
        }
    }
}
