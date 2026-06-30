//! Unit tests for `StaticPriceProvider` — pure, no DB.

use bigdecimal::BigDecimal;
use chrono::{TimeZone, Utc};
use shared::price_provider::{
    price_provider_for, PriceProvider, StaticPriceProvider, STATIC_CURRENT_PRICE,
    STATIC_PROVIDER_KEY,
};
use std::str::FromStr;

#[tokio::test]
async fn current_price_is_fixed_constant() {
    let provider = StaticPriceProvider;
    let price = provider.current_price("ANY").await.unwrap();
    assert_eq!(price, BigDecimal::from_str("1.2345").unwrap());
    assert_eq!(price, STATIC_CURRENT_PRICE.parse::<BigDecimal>().unwrap());
}

#[tokio::test]
async fn historical_price_is_in_range_one_to_two() {
    let provider = StaticPriceProvider;
    let one = BigDecimal::from(1);
    let two = BigDecimal::from(2);

    // Sample a spread of timestamps; every result must land in [1, 2).
    for secs in [0_i64, 1, 42, 999, 1000, 86_400, 1_700_000_000, -5] {
        let at = Utc.timestamp_opt(secs, 0).single().unwrap();
        let price = provider.historical_price("ANY", at).await.unwrap();
        assert!(price >= one, "price {price} below 1 for secs={secs}");
        assert!(price < two, "price {price} not below 2 for secs={secs}");
    }
}

#[tokio::test]
async fn historical_price_is_deterministic_for_same_timestamp() {
    let provider = StaticPriceProvider;
    let at = Utc.timestamp_opt(1_700_000_123, 0).single().unwrap();

    let a = provider.historical_price("ANY", at).await.unwrap();
    let b = provider.historical_price("ANY", at).await.unwrap();
    assert_eq!(a, b, "repeated calls for the same instant must match");

    // The pure helper must agree with the async path.
    let c = StaticPriceProvider::deterministic_historical_price(at);
    assert_eq!(a, c);
}

#[tokio::test]
async fn historical_price_varies_across_timestamps() {
    let provider = StaticPriceProvider;
    let t1 = Utc.timestamp_opt(1_700_000_000, 0).single().unwrap();
    let t2 = Utc.timestamp_opt(1_700_000_500, 0).single().unwrap();
    let a = provider.historical_price("ANY", t1).await.unwrap();
    let b = provider.historical_price("ANY", t2).await.unwrap();
    assert_ne!(a, b, "different instants should generally differ");
}

#[tokio::test]
async fn registry_resolves_static_key() {
    let provider = price_provider_for(STATIC_PROVIDER_KEY).unwrap();
    let price = provider.current_price("ANY").await.unwrap();
    assert_eq!(price, BigDecimal::from_str("1.2345").unwrap());
}

#[test]
fn registry_rejects_unknown_key() {
    assert!(price_provider_for("nope").is_err());
}
