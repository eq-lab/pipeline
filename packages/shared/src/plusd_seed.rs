// spec: docs/references/backend.md#plusd-balance-seed
use crate::contract_logs_repo::PlusdStepRow;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PlusdSeedRow {
    pub as_of_ledger: i64,
    pub as_of_timestamp: i64,
    pub balance: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlusdSeed {
    pub as_of_ledger: i64,
    pub as_of_timestamp: i64,
    pub balance: i128,
    pub reanchor: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::FromRow)]
pub struct PlusdCoverage {
    pub block_number: i64,
    pub block_timestamp: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backfill {
    Covered,
    Inconsistent,
    NoCoverage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeededPlusd {
    pub from: i64,
    pub steps: Vec<(i64, i128)>,
    pub blank_total_before: bool,
    pub backfill: Backfill,
}

pub fn parse_seed(row: &PlusdSeedRow) -> Option<PlusdSeed> {
    let text = row.balance.as_deref()?;
    if text.is_empty() || text.len() > 39 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let reanchor = match row.kind.as_str() {
        "initial" => false,
        "reanchor" => true,
        _ => return None,
    };
    Some(PlusdSeed {
        as_of_ledger: row.as_of_ledger,
        as_of_timestamp: row.as_of_timestamp,
        balance: text.parse().ok()?,
        reanchor,
    })
}

pub fn plusd_delta(row: &PlusdStepRow) -> Option<i128> {
    let amount: i128 = row.amount.as_deref()?.parse().ok()?;
    let credit = if row.incoming { amount } else { 0 };
    let debit = if row.outgoing { amount } else { 0 };
    credit.checked_sub(debit)
}

fn back_computed_start(balance: i128, pre: &[(i64, i128)]) -> Option<i128> {
    let (mut sum, mut min, mut max) = (0i128, 0i128, 0i128);
    for &(_, delta) in pre {
        sum = sum.checked_add(delta)?;
        min = min.min(sum);
        max = max.max(sum);
    }
    let start = balance.checked_sub(sum)?;
    start.checked_add(max)?;
    (start.checked_add(min)? >= 0).then_some(start)
}

pub fn seeded_plusd(
    seed: &PlusdSeed,
    rows: &[PlusdStepRow],
    coverage: Option<PlusdCoverage>,
) -> Option<SeededPlusd> {
    let mut pre: Option<Vec<(i64, i128)>> = Some(Vec::new());
    let mut post: Vec<(i64, i128)> = Vec::new();
    for row in rows {
        let step = plusd_delta(row).map(|d| (row.block_timestamp, d));
        if row.block_number <= seed.as_of_ledger {
            pre = pre.zip(step).map(|(mut v, s)| {
                v.push(s);
                v
            });
        } else {
            post.push(step?);
        }
    }

    let covered = coverage.filter(|c| !seed.reanchor && c.block_number <= seed.as_of_ledger);
    let back = covered.and_then(|c| {
        let start = back_computed_start(seed.balance, pre.as_deref()?)?;
        Some((c, start))
    });
    let backfill = match (seed.reanchor, covered, back) {
        (true, _, _) | (false, Some(_), None) => Backfill::Inconsistent,
        (false, Some(_), Some(_)) => Backfill::Covered,
        (false, None, _) => Backfill::NoCoverage,
    };

    if let (Some((c, start)), Some(pre)) = (back, pre) {
        let mut steps = Vec::with_capacity(pre.len() + post.len() + 1);
        if start != 0 {
            steps.push((c.block_timestamp, start));
        }
        steps.extend(pre);
        steps.extend(post);
        return Some(SeededPlusd {
            from: c.block_timestamp,
            steps,
            blank_total_before: start != 0,
            backfill,
        });
    }

    let seed_from = post.first().map_or(seed.as_of_timestamp, |&(at, _)| {
        seed.as_of_timestamp.min(at)
    });
    let mut steps = Vec::with_capacity(post.len() + 1);
    if seed.balance != 0 {
        steps.push((seed_from, seed.balance));
    }
    steps.extend(post);
    Some(SeededPlusd {
        from: seed_from,
        steps,
        blank_total_before: backfill == Backfill::Inconsistent || seed.balance != 0,
        backfill,
    })
}

pub fn balance_at(seed: &PlusdSeed, rows: &[PlusdStepRow], ledger: i64) -> Option<i128> {
    let mut balance = seed.balance;
    for row in rows {
        if row.block_number > seed.as_of_ledger && row.block_number <= ledger {
            balance = balance.checked_add(plusd_delta(row)?)?;
        }
    }
    Some(balance)
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct PlusdWindowSums {
    pub credit: String,
    pub debit: String,
    pub malformed: i64,
}

fn parse_sum(text: &str) -> Option<i128> {
    if text.is_empty() || text.len() > 39 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

pub fn balance_from_sums(seed_balance: i128, sums: &PlusdWindowSums) -> Option<i128> {
    if sums.malformed != 0 {
        return None;
    }
    seed_balance
        .checked_add(parse_sum(&sums.credit)?)?
        .checked_sub(parse_sum(&sums.debit)?)
}
