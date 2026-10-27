// spec: docs/product-specs/loan-status-timeline.md
use crate::contract_logs_repo::{LifecycleRow, LoanSnapshotRow};

pub const EVENT_STATUS_UPDATED: &str = "LoanStatusUpdated";
pub const EVENT_DEFAULTED: &str = "LoanDefaulted";
pub const EVENT_CLOSED: &str = "LoanClosed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoanStatus {
    Approved,
    Performing,
    WatchList,
    Default,
    Closed,
}

impl LoanStatus {
    /// Parses the `LoanStatusUpdated` `params.event.status` / snapshot `status` string
    /// (identical on both arms); unrecognised values return `None`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "Approved" => Some(Self::Approved),
            "Performing" => Some(Self::Performing),
            "WatchList" => Some(Self::WatchList),
            "Default" => Some(Self::Default),
            "Closed" => Some(Self::Closed),
            _ => None,
        }
    }

    /// Earning: Approved / Performing / WatchList.
    pub fn is_active(self) -> bool {
        matches!(self, Self::Approved | Self::Performing | Self::WatchList)
    }

    pub fn is_at_risk(self) -> bool {
        matches!(self, Self::WatchList | Self::Default)
    }
}

/// Status history of one loan: ordered `(timestamp, new status)` transitions plus the
/// origination date that bounds the earning window from below.
#[derive(Debug, Clone)]
pub struct LoanTimeline {
    origination: i64,
    initial: LoanStatus,
    transitions: Vec<(i64, LoanStatus)>,
}

impl LoanTimeline {
    /// Builds the timeline from the loan's own events (`chain_id` + `loan_id` match).
    /// `LoanStatusUpdated` rows and legacy `LoanDefaulted` / `LoanClosed` rows are merged;
    /// a loan with no usable event keeps its snapshot status.
    pub fn for_loan(loan: &LoanSnapshotRow, events: &[LifecycleRow]) -> Self {
        let mine = || {
            events
                .iter()
                .filter(|e| e.chain_id == loan.chain_id && e.loan_id == loan.loan_id)
        };
        // One pass in the readers' `(block_timestamp, log_index)` order, so events in the
        // same second keep their on-chain order (e.g. a default and a cure in one ledger).
        let mut transitions: Vec<(i64, LoanStatus)> = mine()
            .filter_map(|e| match e.event_name.as_str() {
                EVENT_STATUS_UPDATED => {
                    LoanStatus::parse(e.status.as_deref()?).map(|st| (e.block_timestamp, st))
                }
                EVENT_DEFAULTED => Some((e.block_timestamp, LoanStatus::Default)),
                EVENT_CLOSED => Some((e.block_timestamp, LoanStatus::Closed)),
                _ => None,
            })
            .collect();
        // Callers pass events in reader order; a stable sort only repairs out-of-order input.
        transitions.sort_by_key(|(ts, _)| *ts);
        if let Some(i) = transitions
            .iter()
            .position(|(_, st)| *st == LoanStatus::Closed)
        {
            transitions.truncate(i + 1);
        }

        let initial = if transitions.is_empty() {
            LoanStatus::parse(&loan.snapshot.status).unwrap_or(LoanStatus::Performing)
        } else {
            LoanStatus::Approved
        };
        Self {
            origination: loan.snapshot.origination_date,
            initial,
            transitions,
        }
    }

    pub fn origination(&self) -> i64 {
        self.origination
    }

    pub fn status_at(&self, t: i64) -> LoanStatus {
        self.transitions
            .iter()
            .take_while(|(ts, _)| *ts <= t)
            .last()
            .map_or(self.initial, |(_, st)| *st)
    }

    /// True when the loan has originated by `t` and its status at `t` is earning.
    pub fn is_active_at(&self, t: i64) -> bool {
        self.origination <= t && self.status_at(t).is_active()
    }

    /// True when the loan has originated by `t` and sits in WatchList or Default at `t`.
    pub fn is_at_risk_at(&self, t: i64) -> bool {
        self.origination <= t && self.status_at(t).is_at_risk()
    }

    /// True when the loan has originated by `t` and is Default or Closed at `t`.
    pub fn is_terminal_at(&self, t: i64) -> bool {
        self.origination <= t && !self.status_at(t).is_active()
    }

    /// Disjoint, ordered `[from, until)` intervals within `[origination, to)` during
    /// which the loan is active; adjacent intervals are merged.
    pub fn active_intervals(&self, to: i64) -> Vec<(i64, i64)> {
        let mut out: Vec<(i64, i64)> = Vec::new();
        if self.origination >= to {
            return out;
        }
        let mut push = |from: i64, until: i64| {
            if until <= from {
                return;
            }
            match out.last_mut() {
                Some(last) if last.1 == from => last.1 = until,
                _ => out.push((from, until)),
            }
        };
        let mut seg_start = self.origination;
        let mut status = self.status_at(self.origination);
        for (ts, st) in self
            .transitions
            .iter()
            .filter(|(ts, _)| *ts > self.origination)
        {
            if *ts >= to {
                break;
            }
            if status.is_active() {
                push(seg_start, *ts);
            }
            seg_start = *ts;
            status = *st;
        }
        if status.is_active() {
            push(seg_start, to);
        }
        out
    }

    /// Seconds spent active in `[origination, to)`.
    pub fn active_secs_until(&self, to: i64) -> i64 {
        self.active_intervals(to).iter().map(|(a, b)| b - a).sum()
    }
}

/// Status of `loan` at `t` per its event timeline (see [`LoanTimeline::for_loan`]).
pub fn status_at(loan: &LoanSnapshotRow, events: &[LifecycleRow], t: i64) -> LoanStatus {
    LoanTimeline::for_loan(loan, events).status_at(t)
}

/// True when `loan` is earning at `t` (originated and Approved / Performing / WatchList).
pub fn is_active_at(loan: &LoanSnapshotRow, events: &[LifecycleRow], t: i64) -> bool {
    LoanTimeline::for_loan(loan, events).is_active_at(t)
}

/// Active `[from, until)` intervals of `loan` up to `to`.
pub fn active_intervals(
    loan: &LoanSnapshotRow,
    events: &[LifecycleRow],
    to: i64,
) -> Vec<(i64, i64)> {
    LoanTimeline::for_loan(loan, events).active_intervals(to)
}

/// True when `loan` is WatchList or Default at `t` (and originated).
pub fn is_at_risk_at(loan: &LoanSnapshotRow, events: &[LifecycleRow], t: i64) -> bool {
    LoanTimeline::for_loan(loan, events).is_at_risk_at(t)
}
