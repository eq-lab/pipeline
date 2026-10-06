//! Wire-in matching phase (#1416).
//!
//! Joins indexed minter events to `lp_bank_deposits` by `ref_hash` —
//! `sha256(payment_reference)`, written by `POST /v1/lps/{id}/bank-deposits`
//! and carried by the contract's `WireIn` — and flips `is_minted` on the
//! deposits whose PLUSD has reached an LP.
//!
//! Two rules, because a wire reaches an LP two ways. Rule A: a `WireIn` whose
//! receiver is not the minter itself was staked into the vault on the spot.
//! Rule B: a `WireIn` received into escrow (receiver = the minter) reaches its
//! LP only when `assign_wire_in` fires, and that event carries no reference of
//! its own, so the hash comes from its matching `WireIn` by wire id.
//!
//! No outbox: nothing is submitted, so there is no in-flight state to survive.
//! Both statements skip deposits already marked, which makes every repeat a
//! no-op and the order of the two irrelevant.

use anyhow::{Context, Result};

use shared::lp_bank_deposit_repo::WireInMatcher;

/// What one tick did, for the log line and for tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WireInMatchSummary {
    /// Deposits flipped by Rule A.
    pub direct: u64,
    /// Deposits flipped by Rule B.
    pub assigned: u64,
    /// Indexed `WireIn` events whose `ref_hash` matches no deposit row at all —
    /// a wire minted outside this flow, or against a reference we never
    /// recorded. NOT escrowed wires: those have a deposit row (it is where the
    /// reference came from), so they never appear here. Nothing reports them —
    /// see TD-118.
    pub unmatched: i64,
}

pub async fn phase_match_wire_ins(
    matcher: &dyn WireInMatcher,
    chain_id: i64,
    minter_id: &str,
) -> Result<WireInMatchSummary> {
    let direct = matcher
        .mark_minted_direct(chain_id, minter_id)
        .await
        .context("marking directly staked wire-ins minted")?;
    let assigned = matcher
        .mark_minted_assigned(chain_id, minter_id)
        .await
        .context("marking assigned escrow wire-ins minted")?;
    let unmatched = matcher
        .count_unmatched_wire_ins(chain_id, minter_id)
        .await
        .context("counting unmatched wire-ins")?;

    let summary = WireInMatchSummary {
        direct,
        assigned,
        unmatched,
    };

    // One line per tick, and only when there is something to say. The unmatched
    // count is steady-state, not a fault — an escrowed wire waiting a week for
    // assignment would otherwise warn every cycle forever — so it rides along at
    // info with the rest.
    if direct + assigned == 0 && unmatched == 0 {
        // Without this, a phase wired to the wrong contract id looks exactly
        // like one with nothing to do — see TD-118. At debug, so it costs
        // nothing at the default level but is one toggle away.
        tracing::debug!(chain_id, "wire-in matching: nothing to do this tick");
    }
    if direct + assigned > 0 || unmatched > 0 {
        tracing::info!(
            chain_id,
            matched_direct = direct,
            matched_assigned = assigned,
            unmatched,
            "wire-in matching (unmatched = WireIn events with no deposit row at \
             all, i.e. minted outside this flow; escrowed wires are not counted here)"
        );
    }

    Ok(summary)
}
