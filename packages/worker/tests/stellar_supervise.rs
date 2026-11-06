// spec: docs/references/security-registry-events.md#sync-loop
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use pipeline_worker::indexer::stellar::supervise::{
    backoff_delay, restart_delay, spawn_supervised, KeyedBackoff,
};

#[test]
fn restart_schedule_doubles_from_thirty_seconds_to_ten_minutes() {
    let secs: Vec<u64> = (1..=7).map(|n| restart_delay(n).as_secs()).collect();
    assert_eq!(secs, vec![30, 60, 120, 240, 480, 600, 600]);
    assert_eq!(restart_delay(0).as_secs(), 30);
    assert_eq!(restart_delay(u32::MAX).as_secs(), 600);
}

#[test]
fn read_backoff_schedule_is_unchanged() {
    assert_eq!(backoff_delay(1), Duration::from_mins(1));
    assert_eq!(backoff_delay(7), Duration::from_hours(1));
}

#[test]
fn keyed_backoff_works_for_any_key_and_warns_once_per_channel() {
    let mut by_id: KeyedBackoff<u32> = KeyedBackoff::default();
    let mut by_pair: KeyedBackoff<(u8, u32)> = KeyedBackoff::default();
    let now = Instant::now();
    assert!(by_id.is_due(1, now));
    assert_eq!(by_id.record_failure(1, now), 1);
    assert!(!by_id.is_due(1, now));
    assert!(by_id.is_due(1, now + Duration::from_secs(61)));
    assert_eq!(by_id.record_failure(1, now), 2);
    by_id.clear(1);
    assert_eq!(by_id.failures(1), 0);
    assert!(by_pair.first_warning((1, 2)));
    assert!(!by_pair.first_warning((1, 2)));
    assert!(by_pair.first_warning((2, 2)));
    assert!(by_pair.first_warning_on((1, 2), 1));
    assert!(!by_pair.first_warning_on((1, 2), 1));
}

#[tokio::test(start_paused = true)]
async fn a_panicking_or_failing_task_is_restarted_after_the_backoff() {
    let attempts = Arc::new(AtomicU32::new(0));
    let counter = attempts.clone();
    let guard = spawn_supervised("test", 1, move || {
        let n = counter.fetch_add(1, Ordering::SeqCst) + 1;
        async move {
            match n {
                1 => panic!("boom"),
                2 => Err(anyhow::anyhow!("failed")),
                _ => Ok(()),
            }
        }
    });
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    tokio::time::sleep(Duration::from_secs(58)).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(attempts.load(Ordering::SeqCst), 3);
    drop(guard);
    let seen = attempts.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_hours(1)).await;
    assert_eq!(attempts.load(Ordering::SeqCst), seen);
}

#[tokio::test(start_paused = true)]
async fn dropping_the_guard_aborts_a_running_task() {
    let alive = Arc::new(AtomicU32::new(0));
    let flag = alive.clone();
    let guard = spawn_supervised("test", 1, move || {
        let flag = flag.clone();
        async move {
            loop {
                flag.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    });
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert!(alive.load(Ordering::SeqCst) >= 3);
    drop(guard);
    tokio::time::sleep(Duration::from_millis(1)).await;
    let ticks = alive.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(alive.load(Ordering::SeqCst), ticks);
}
