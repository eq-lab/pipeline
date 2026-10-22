# Issue #1625: Trustee: rollover rate parsed with parseInt (14.5 → 14 bps)

Source: https://github.com/eq-lab/pipeline/issues/1625 — medium (wrong rate on-chain), found in the
2026-10-22 calculations review. Branch: `fix/1625-rollover-rate-units`.

Status: Completed 2026-10-22 — PR #1644.

## Root cause

`RolloverDialog` in `routes/loans.$id.tsx` labelled the field "New rate (bps)" but parsed it with
`Number.parseInt`, so a trustee typing a percent (`14.5`) silently sent 14 bps (0.14%).

## Decision

- The field is a **percent p.a.** text input (`inputMode="decimal"`), 0.01–100 with at most 2
  decimals (1 bp = 0.01%), converted exactly to integer bps by the new `percentToBps`
  (`@/utils/rateUnits`); the dialog echoes `= N bps` live and shows an inline error otherwise.
- `useRollover` keeps taking bps; the Stellar encoder keeps scaling ×100 — the unit chain is now
  percent (UI) → bps (hook) → bps×100 (chain), each boundary explicit.

## Open Questions

_None._
