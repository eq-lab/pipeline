// spec: docs/product-specs/loan-security-state.md#mark-suggestions
use std::collections::{BTreeMap, HashMap};
use std::str::FromStr;

use anyhow::{anyhow, bail, Result};
use bigdecimal::num_bigint::{BigInt, Sign};
use bigdecimal::Signed;
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::collateral_valuation::{asset_for_metal, nsr_per_dmt, to_pct};
use crate::collateral_valuation_repo::{AssayRow, OfftakeTermsRow};
use crate::price_provider::is_known_provider;
use crate::security_state::{format_7dp_i128, UNIT};

pub const COMMODITIES_KEY: &str = "SECURITY_MARK_COMMODITIES";
pub const MAX_AGE_KEY: &str = "SECURITY_MARK_MAX_AGE_SECS";
pub const MOVE_BPS_KEY: &str = "SECURITY_MARK_MOVE_BPS";

pub const DEFAULT_MAX_AGE_SECS: u64 = 86_400;
pub const DEFAULT_MOVE_BPS: u32 = 200;

pub const MAX_COMMODITIES_BYTES: usize = 16 * 1024;
pub const MAX_COMMODITY_ENTRIES: usize = 64;
pub const MAX_KEY_BYTES: usize = 64;
pub const MAX_DEC_STR_BYTES: usize = 64;
pub const MAX_DEC_EXPONENT: i64 = 40;
pub const MAX_DEC_DIGITS: u64 = 60;
pub const MAX_DEC_SCALE: i64 = 200;
pub const MAX_DEC_TOTAL_DIGITS: u64 = 400;
pub const WORK_SCALE: i64 = 18;

const MAX_ASSET_BYTES: usize = 16;
const MAX_SYMBOL_BYTES: usize = 32;
pub const MAX_PAYABLE_TERMS: usize = 32;
const MAX_SCHEDULE_ENTRIES: usize = 64;

pub const TONNE_TROY_OZ: (u64, u64) = (10_000_000_000, 311_035);
pub const TONNE_LB: (u64, u64) = (100_000_000_000, 45_359_237);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum MarkMode {
    StandardGoods,
    MetalConcentrate,
}

impl MarkMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::StandardGoods => "StandardGoods",
            Self::MetalConcentrate => "MetalConcentrate",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum QuoteUnit {
    TroyOz,
    Mt,
    Lb,
    Bbl,
}

impl QuoteUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TroyOz => "TroyOz",
            Self::Mt => "Mt",
            Self::Lb => "Lb",
            Self::Bbl => "Bbl",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommodityMapping {
    pub commodity: String,
    pub mode: MarkMode,
    pub asset: String,
    pub price_provider: String,
    pub quote_unit: Option<QuoteUnit>,
    pub benchmark: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommodityMap {
    entries: BTreeMap<String, CommodityMapping>,
}

impl CommodityMap {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn get(&self, raw_commodity: &str) -> Option<&CommodityMapping> {
        self.entries.get(&normalize_commodity(raw_commodity)?)
    }

    pub fn providers(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for m in self.entries.values() {
            if !out.contains(&m.price_provider) {
                out.push(m.price_provider.clone());
            }
        }
        out
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarkPolicy {
    pub max_age: u64,
    pub move_bps: u32,
}

impl Default for MarkPolicy {
    fn default() -> Self {
        Self {
            max_age: DEFAULT_MAX_AGE_SECS,
            move_bps: DEFAULT_MOVE_BPS,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MarkSettings {
    pub map: CommodityMap,
    pub policy: MarkPolicy,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawMapping {
    commodity: String,
    mode: MarkMode,
    asset: String,
    price_provider: String,
    #[serde(default)]
    quote_unit: Option<QuoteUnit>,
    #[serde(default)]
    benchmark: Option<String>,
}

fn non_blank(v: Option<&str>) -> Option<&str> {
    v.map(str::trim).filter(|s| !s.is_empty())
}

fn valid_asset(s: &str) -> bool {
    (1..=MAX_ASSET_BYTES).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

fn valid_symbol(s: &str) -> bool {
    (1..=MAX_SYMBOL_BYTES).contains(&s.len())
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn parse_mapping(index: usize, raw: RawMapping) -> Result<CommodityMapping> {
    let at = |msg: &str| anyhow!("{COMMODITIES_KEY}: entry {index}: {msg}");
    let commodity = normalize_commodity(&raw.commodity)
        .ok_or_else(|| at("`commodity` must be 1-64 ASCII bytes after normalization"))?;
    if !valid_asset(&raw.asset) {
        return Err(at("`asset` must match [A-Z0-9_-]{1,16}"));
    }
    if !is_known_provider(&raw.price_provider) {
        return Err(at("`price_provider` is not a known provider"));
    }
    match (raw.mode, raw.quote_unit) {
        (MarkMode::StandardGoods, None) => {
            return Err(at("`quote_unit` is required for StandardGoods"))
        }
        (MarkMode::MetalConcentrate, Some(q)) if q != QuoteUnit::TroyOz => {
            return Err(at(
                "`quote_unit` must be absent or TroyOz for MetalConcentrate",
            ))
        }
        _ => {}
    }
    let benchmark = raw.benchmark.unwrap_or_else(|| raw.asset.clone());
    if !valid_symbol(&benchmark) {
        return Err(at("`benchmark` must match [A-Za-z0-9_]{1,32}"));
    }
    let quote_unit = match raw.mode {
        MarkMode::StandardGoods => raw.quote_unit,
        MarkMode::MetalConcentrate => None,
    };
    Ok(CommodityMapping {
        commodity,
        mode: raw.mode,
        asset: raw.asset,
        price_provider: raw.price_provider,
        quote_unit,
        benchmark,
    })
}

impl CommodityMap {
    pub fn parse_optional(raw: Option<&str>) -> Result<Self> {
        match non_blank(raw) {
            Some(raw) => Self::parse(raw),
            None => Ok(Self::default()),
        }
    }

    pub fn from_env() -> Result<Self> {
        Self::parse_optional(std::env::var(COMMODITIES_KEY).ok().as_deref())
    }

    pub fn parse(raw: &str) -> Result<Self> {
        if raw.len() > MAX_COMMODITIES_BYTES {
            bail!("{COMMODITIES_KEY} exceeds {MAX_COMMODITIES_BYTES} bytes");
        }
        let items: Vec<RawMapping> = serde_json::from_str(raw)
            .map_err(|e| anyhow!("{COMMODITIES_KEY} is not a valid mapping array: {e}"))?;
        if items.len() > MAX_COMMODITY_ENTRIES {
            bail!("{COMMODITIES_KEY} has more than {MAX_COMMODITY_ENTRIES} entries");
        }
        let mut entries = BTreeMap::new();
        for (index, item) in items.into_iter().enumerate() {
            let mapping = parse_mapping(index, item)?;
            if entries.contains_key(&mapping.commodity) {
                bail!(
                    "{COMMODITIES_KEY}: duplicate commodity `{}`",
                    mapping.commodity
                );
            }
            entries.insert(mapping.commodity.clone(), mapping);
        }
        Ok(Self { entries })
    }
}

impl MarkSettings {
    pub fn parse(
        commodities: Option<&str>,
        max_age: Option<&str>,
        move_bps: Option<&str>,
    ) -> Result<Self> {
        let map = CommodityMap::parse_optional(commodities)?;
        let max_age = match non_blank(max_age) {
            Some(s) => s
                .parse::<u64>()
                .map_err(|_| anyhow!("{MAX_AGE_KEY} must be a non-negative integer"))?,
            None => DEFAULT_MAX_AGE_SECS,
        };
        let move_bps = match non_blank(move_bps) {
            Some(s) => s
                .parse::<u32>()
                .map_err(|_| anyhow!("{MOVE_BPS_KEY} must be a non-negative integer"))?,
            None => DEFAULT_MOVE_BPS,
        };
        Ok(Self {
            map,
            policy: MarkPolicy { max_age, move_bps },
        })
    }

    pub fn from_env() -> Result<Self> {
        let get = |k: &str| std::env::var(k).ok();
        Self::parse(
            get(COMMODITIES_KEY).as_deref(),
            get(MAX_AGE_KEY).as_deref(),
            get(MOVE_BPS_KEY).as_deref(),
        )
    }
}

pub fn mark_pairs<'a, I>(items: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (&'a CommodityMapping, Vec<&'a str>)>,
{
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |asset: &str, provider: &str| {
        let pair = (asset.to_owned(), provider.to_owned());
        if !out.contains(&pair) {
            out.push(pair);
        }
    };
    for (mapping, metals) in items {
        push(&mapping.asset, &mapping.price_provider);
        if mapping.mode != MarkMode::MetalConcentrate {
            continue;
        }
        for metal in metals.into_iter().take(MAX_PAYABLE_TERMS) {
            if let Some(asset) = asset_for_metal(metal) {
                push(asset, &mapping.price_provider);
            }
        }
    }
    out
}

pub fn normalize_commodity(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if !trimmed.is_ascii() {
        return None;
    }
    let mut out = String::with_capacity(trimmed.len().min(MAX_KEY_BYTES + 1));
    let mut in_separator = false;
    for c in trimmed.chars() {
        if c.is_ascii_whitespace() || c == '-' || c == '_' {
            if !in_separator {
                out.push('_');
                in_separator = true;
            }
            continue;
        }
        if !c.is_ascii_graphic() {
            return None;
        }
        in_separator = false;
        out.push(c.to_ascii_lowercase());
        if out.len() > MAX_KEY_BYTES {
            return None;
        }
    }
    if out.is_empty() || out.len() > MAX_KEY_BYTES {
        return None;
    }
    Some(out)
}

pub fn quote_factor(record_unit: &str, quote: QuoteUnit) -> Option<(u64, u64)> {
    match (record_unit, quote) {
        ("Mt" | "Dmt", QuoteUnit::TroyOz) => Some(TONNE_TROY_OZ),
        ("Mt" | "Dmt", QuoteUnit::Mt) | ("Bbl", QuoteUnit::Bbl) => Some((1, 1)),
        ("Mt" | "Dmt", QuoteUnit::Lb) => Some(TONNE_LB),
        _ => None,
    }
}

pub fn bounded_dec(d: &BigDecimal) -> Option<BigDecimal> {
    let (_, scale) = d.as_bigint_and_exponent();
    let digits = d.digits();
    if !(-MAX_DEC_EXPONENT..=MAX_DEC_SCALE).contains(&scale) || digits > MAX_DEC_TOTAL_DIGITS {
        return None;
    }
    let integer_digits = i64::try_from(digits).ok()? - scale;
    if integer_digits > i64::try_from(MAX_DEC_DIGITS).ok()? {
        return None;
    }
    if scale < 0 {
        Some(d.with_scale(0))
    } else if scale > WORK_SCALE {
        Some(d.with_scale_round(WORK_SCALE, RoundingMode::Down))
    } else {
        Some(d.clone())
    }
}

pub fn bounded_dec_str(s: &str) -> Option<BigDecimal> {
    if s.len() > MAX_DEC_STR_BYTES {
        return None;
    }
    bounded_dec(&BigDecimal::from_str(s).ok()?)
}

pub fn plain(d: &BigDecimal) -> String {
    d.normalized().to_plain_string()
}

fn pow10(exp: i64) -> BigInt {
    BigInt::from(10u8).pow(u32::try_from(exp).unwrap_or(0))
}

pub fn standard_vpu_raw(price: &BigDecimal, (num, den): (u64, u64)) -> Option<i128> {
    let price = bounded_dec(price)?;
    let (int, scale) = price.as_bigint_and_exponent();
    if den == 0 {
        return None;
    }
    let numer = int * BigInt::from(num) * pow10(7);
    let denom = BigInt::from(den) * pow10(scale);
    if numer.sign() == Sign::Minus {
        return Some(0);
    }
    i128::try_from(numer / denom).ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionStatus {
    Ok,
    Unmapped,
    UnsupportedUnit,
    NoPrice,
    InputsMissing,
    Unreadable,
}

impl SuggestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Unmapped => "unmapped",
            Self::UnsupportedUnit => "unsupported_unit",
            Self::NoPrice => "no_price",
            Self::InputsMissing => "inputs_missing",
            Self::Unreadable => "unreadable",
        }
    }
}

fn bounded_all<'a>(values: impl IntoIterator<Item = &'a str>) -> Option<()> {
    for v in values {
        bounded_dec_str(v)?;
    }
    Some(())
}

fn validate_concentrate_inputs(
    assay: &AssayRow,
    offtake: &OfftakeTermsRow,
) -> Result<(), SuggestionStatus> {
    let unreadable = SuggestionStatus::Unreadable;
    let terms = &offtake.payable_terms.0;
    let refining = &offtake.refining_charges.0;
    let schedule = &offtake.penalty_schedule.0;
    let metals = &assay.assays.0;
    let deleterious = &assay.deleterious.0;
    if terms.len() > MAX_PAYABLE_TERMS
        || refining.len() > MAX_SCHEDULE_ENTRIES
        || schedule.len() > MAX_SCHEDULE_ENTRIES
        || metals.len() > MAX_SCHEDULE_ENTRIES
        || deleterious.len() > MAX_SCHEDULE_ENTRIES
    {
        return Err(unreadable);
    }
    bounded_dec(&offtake.treatment_charge_per_dmt).ok_or(unreadable)?;
    bounded_all(
        terms
            .iter()
            .flat_map(|t| [t.payable_pct.as_str(), t.min_deduction_g_per_t.as_str()])
            .chain(refining.iter().map(|r| r.rc_per_oz.as_str()))
            .chain(metals.iter().map(|m| m.grade_g_per_t.as_str()))
            .chain(deleterious.iter().map(|d| d.level.as_str()))
            .chain(schedule.iter().flat_map(|s| {
                [
                    s.threshold.as_str(),
                    s.step.as_str(),
                    s.rate_per_dmt.as_str(),
                ]
            })),
    )
    .ok_or(unreadable)?;
    for tier in schedule {
        let step = bounded_dec_str(&tier.step).ok_or(unreadable)?;
        if to_pct(step, &tier.unit) <= BigDecimal::zero() {
            return Err(unreadable);
        }
    }
    Ok(())
}

pub fn concentrate_vpu_raw<S: std::hash::BuildHasher>(
    assay: &AssayRow,
    offtake: &OfftakeTermsRow,
    prices: &HashMap<String, BigDecimal, S>,
) -> Result<i128, SuggestionStatus> {
    validate_concentrate_inputs(assay, offtake)?;
    let terms = &offtake.payable_terms.0;
    if terms.is_empty() {
        return Err(SuggestionStatus::InputsMissing);
    }
    let mut assets = Vec::with_capacity(terms.len());
    for t in terms {
        assets.push(asset_for_metal(&t.metal).ok_or(SuggestionStatus::InputsMissing)?);
    }
    let mut bounded_prices = HashMap::with_capacity(assets.len());
    for asset in assets {
        let price = prices.get(asset).ok_or(SuggestionStatus::NoPrice)?;
        let price = bounded_dec(price).ok_or(SuggestionStatus::Unreadable)?;
        bounded_prices.insert(asset.to_owned(), price);
    }
    let nsr = nsr_per_dmt(assay, offtake, &bounded_prices)
        .map_err(|_| SuggestionStatus::Unreadable)?
        .ok_or(SuggestionStatus::NoPrice)?;
    let nsr = nsr.max(BigDecimal::zero());
    let scaled = (nsr * BigDecimal::from(UNIT)).with_scale_round(0, RoundingMode::Down);
    i128::try_from(scaled.as_bigint_and_exponent().0).map_err(|_| SuggestionStatus::Unreadable)
}

pub type PriceMap = HashMap<(String, String), (BigDecimal, DateTime<Utc>)>;

#[derive(Debug, Clone)]
pub struct Suggestion {
    pub value_per_unit: i128,
    pub benchmark: String,
    pub source_price: String,
    pub source_at: i64,
    pub asset: String,
    pub price_provider: String,
    pub quote_unit: Option<String>,
    pub mode: MarkMode,
    pub assay_id: Option<String>,
    pub offtake_id: Option<String>,
    pub report: String,
    pub report_hash: String,
}

pub struct SuggestCtx<'a> {
    pub chain_id: i64,
    pub security_registry: &'a str,
    pub record_id: u32,
    pub map: &'a CommodityMap,
    pub prices: &'a PriceMap,
    pub concentrate: Option<(&'a AssayRow, &'a OfftakeTermsRow)>,
}

struct ConcentrateReport {
    assay_id: String,
    offtake_id: String,
    metals: Vec<(String, String, i64)>,
}

struct ReportFields<'a> {
    ctx: &'a SuggestCtx<'a>,
    mapping: &'a CommodityMapping,
    unit: &'a str,
    price: &'a str,
    price_at: i64,
    value_per_unit: i128,
    inputs: Option<ConcentrateReport>,
}

fn report_text(f: &ReportFields<'_>) -> String {
    let mut lines = vec![
        "pipeline-mark/v1".to_owned(),
        format!("chain_id={}", f.ctx.chain_id),
        format!("security_registry={}", f.ctx.security_registry),
        format!("record_id={}", f.ctx.record_id),
        format!("commodity={}", f.mapping.commodity),
        format!("unit={}", f.unit),
        format!("mode={}", f.mapping.mode.as_str()),
        format!("asset={}", f.mapping.asset),
        format!("price_provider={}", f.mapping.price_provider),
        format!("price={}", f.price),
        format!("price_at={}", f.price_at),
        format!(
            "quote_unit={}",
            f.mapping.quote_unit.map_or("-", QuoteUnit::as_str)
        ),
        format!("value_per_unit={}", format_7dp_i128(f.value_per_unit)),
        format!("benchmark={}", f.mapping.benchmark),
    ];
    if let Some(inputs) = &f.inputs {
        lines.push(format!("assay_id={}", inputs.assay_id));
        lines.push(format!("offtake_id={}", inputs.offtake_id));
        for (asset, price, at) in &inputs.metals {
            lines.push(format!("metal.{asset}={price}@{at}"));
        }
    }
    lines.join("\n")
}

pub fn report_hash(report: &str) -> String {
    hex::encode(Sha256::digest(report.as_bytes()))
}

fn priced(
    ctx: &SuggestCtx<'_>,
    asset: &str,
    provider: &str,
) -> Result<(BigDecimal, DateTime<Utc>), SuggestionStatus> {
    let (price, at) = ctx
        .prices
        .get(&(asset.to_owned(), provider.to_owned()))
        .ok_or(SuggestionStatus::NoPrice)?;
    let price = bounded_dec(price).ok_or_else(|| {
        tracing::warn!(asset, provider, "mark source price out of bounds");
        SuggestionStatus::Unreadable
    })?;
    Ok((price, *at))
}

struct Computed {
    value_per_unit: i128,
    head_price: BigDecimal,
    head_at: DateTime<Utc>,
    source_at: DateTime<Utc>,
    inputs: Option<ConcentrateReport>,
}

fn compute_standard(
    ctx: &SuggestCtx<'_>,
    mapping: &CommodityMapping,
    record_unit: &str,
) -> Result<Computed, SuggestionStatus> {
    let quote = mapping.quote_unit.ok_or(SuggestionStatus::Unreadable)?;
    let factor = quote_factor(record_unit, quote).ok_or(SuggestionStatus::UnsupportedUnit)?;
    let (head_price, head_at) = priced(ctx, &mapping.asset, &mapping.price_provider)?;
    let value_per_unit =
        standard_vpu_raw(&head_price, factor).ok_or(SuggestionStatus::Unreadable)?;
    Ok(Computed {
        value_per_unit,
        head_price,
        head_at,
        source_at: head_at,
        inputs: None,
    })
}

fn compute_concentrate(
    ctx: &SuggestCtx<'_>,
    mapping: &CommodityMapping,
    record_unit: &str,
) -> Result<Computed, SuggestionStatus> {
    if record_unit != "Dmt" {
        return Err(SuggestionStatus::UnsupportedUnit);
    }
    let (assay, offtake) = ctx.concentrate.ok_or(SuggestionStatus::InputsMissing)?;
    let (head_price, head_at) = priced(ctx, &mapping.asset, &mapping.price_provider)?;
    let mut source_at = head_at;
    let mut by_asset: HashMap<String, BigDecimal> = HashMap::new();
    let mut lines: BTreeMap<String, (String, i64)> = BTreeMap::new();
    for t in offtake.payable_terms.0.iter().take(MAX_PAYABLE_TERMS) {
        let Some(asset) = asset_for_metal(&t.metal) else {
            continue;
        };
        match priced(ctx, asset, &mapping.price_provider) {
            Ok((price, at)) => {
                source_at = source_at.min(at);
                lines.insert(asset.to_owned(), (plain(&price), at.timestamp()));
                by_asset.insert(asset.to_owned(), price);
            }
            Err(SuggestionStatus::NoPrice) => {}
            Err(other) => return Err(other),
        }
    }
    let value_per_unit = concentrate_vpu_raw(assay, offtake, &by_asset)?;
    Ok(Computed {
        value_per_unit,
        head_price,
        head_at,
        source_at,
        inputs: Some(ConcentrateReport {
            assay_id: assay.id.to_string(),
            offtake_id: offtake.id.to_string(),
            metals: lines.into_iter().map(|(a, (p, t))| (a, p, t)).collect(),
        }),
    })
}

pub fn suggest(
    ctx: &SuggestCtx<'_>,
    record_commodity: &str,
    record_unit: &str,
) -> Result<Suggestion, SuggestionStatus> {
    let mapping = ctx
        .map
        .get(record_commodity)
        .ok_or(SuggestionStatus::Unmapped)?;
    suggest_with(ctx, mapping, record_unit)
}

pub fn suggest_with(
    ctx: &SuggestCtx<'_>,
    mapping: &CommodityMapping,
    record_unit: &str,
) -> Result<Suggestion, SuggestionStatus> {
    let c = match mapping.mode {
        MarkMode::StandardGoods => compute_standard(ctx, mapping, record_unit)?,
        MarkMode::MetalConcentrate => compute_concentrate(ctx, mapping, record_unit)?,
    };
    let source_price = plain(&c.head_price);
    let assay_id = c.inputs.as_ref().map(|i| i.assay_id.clone());
    let offtake_id = c.inputs.as_ref().map(|i| i.offtake_id.clone());
    let report = report_text(&ReportFields {
        ctx,
        mapping,
        unit: record_unit,
        price: &source_price,
        price_at: c.head_at.timestamp(),
        value_per_unit: c.value_per_unit,
        inputs: c.inputs,
    });
    Ok(Suggestion {
        value_per_unit: c.value_per_unit,
        benchmark: mapping.benchmark.clone(),
        source_price,
        source_at: c.source_at.timestamp(),
        asset: mapping.asset.clone(),
        price_provider: mapping.price_provider.clone(),
        quote_unit: mapping.quote_unit.map(|q| q.as_str().to_owned()),
        mode: mapping.mode,
        assay_id,
        offtake_id,
        report_hash: report_hash(&report),
        report,
    })
}

pub fn effective_max_age(max_age: u64, price_stale_after: u64) -> u64 {
    match (max_age, price_stale_after) {
        (0, psa) => psa,
        (m, 0) => m,
        (m, psa) => m.min(psa),
    }
}

pub fn move_bps(mark: i128, suggested: i128) -> Option<i32> {
    if mark < 0 {
        return None;
    }
    if mark == 0 {
        return (suggested == 0).then_some(0);
    }
    let bps =
        (BigInt::from(suggested) - BigInt::from(mark)) * BigInt::from(10_000) / BigInt::from(mark);
    Some(
        i32::try_from(bps.clone()).unwrap_or(if bps.sign() == Sign::Minus {
            i32::MIN
        } else {
            i32::MAX
        }),
    )
}

pub fn moved(mark: i128, suggested: i128, threshold_bps: u32) -> bool {
    if threshold_bps == 0 || mark < 0 {
        return false;
    }
    let diff = (BigInt::from(suggested) - BigInt::from(mark)).abs();
    diff * BigInt::from(10_000) > BigInt::from(threshold_bps) * BigInt::from(mark)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkDue {
    pub due: bool,
    pub reasons: Vec<&'static str>,
    pub due_at: Option<u64>,
}

pub fn mark_due(
    now: u64,
    mark: Option<(i128, u64)>,
    suggested: Option<i128>,
    price_stale_after: u64,
    policy: &MarkPolicy,
) -> MarkDue {
    let max_age = effective_max_age(policy.max_age, price_stale_after);
    let mut reasons = Vec::new();
    let Some((value, at)) = mark else {
        return MarkDue {
            due: true,
            reasons: vec!["missing"],
            due_at: None,
        };
    };
    if max_age > 0 && now.saturating_sub(at) > max_age {
        reasons.push("age");
    }
    if suggested.is_some_and(|s| moved(value, s, policy.move_bps)) {
        reasons.push("moved");
    }
    MarkDue {
        due: !reasons.is_empty(),
        reasons,
        due_at: (max_age > 0).then(|| at.checked_add(max_age)).flatten(),
    }
}
