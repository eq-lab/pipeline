/**
 * Static mock fixture for the still-un-sourced sections of the Trustee **Loan
 * detail** page (issue #847, Figma node `4116:10549`). No live API calls, no
 * localStorage, no fake network.
 *
 * ⚠️ MOCK DATA. Per the trustee data-sourcing convention, a static Figma mock
 * is acceptable **only until the real endpoint lands**, at which point the
 * section migrates to its live source (delete its slice here, wire the
 * presenter — see `-useLoanDetail.ts`). Three sections have already migrated and
 * are **no longer in this fixture**:
 *   - **Hero identity** → the `/v1/loan-book` row (keyed by `loan_id`).
 *   - **Price & collateral** → `GET /v1/loan-book/{loan_id}/valuations`.
 *   - **Loan-lifecycle stepper** → derived from the on-chain status
 *     (`buildLifecycle` in `-useLoanDetail.ts`, design assignment §3.2).
 *   - **Registry state & derived** → `GET /v1/loan-book/{loan_id}/financials`
 *     (`useLoanFinancials` + `buildFinancials`, issue #852).
 * Still mock (no backend source yet): summary tiles · current stage · other
 * actions. The **Watchlist variant** (issue #859, Figma node `4116:10803`) adds
 * its own mock slice (`LOAN_DETAIL_WATCHLIST_MOCK`) plus the CCR-trend chart
 * series — no backend source for the trend history / days-on-watchlist /
 * coupon-missed / escalation copy yet, so they are mock until an endpoint lands.
 *
 * The copy below matches the Figma reference exactly (a design mock, so the
 * fabricated-detail rules that gate the live build do not apply here).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type TileTone = "muted" | "positive" | "attention" | "negative";

/** One of the three summary tiles below the stepper. */
export interface SummaryTile {
  label: string;
  value: string;
  sub: string;
  /** Colour of the sub-line. */
  subTone: TileTone;
}

/** Colour treatment of the current-stage right-aligned tag. */
export type StageTagTone = "muted" | "risk";

export interface CurrentStage {
  title: string;
  /** Right-aligned tag, e.g. `"Relayer + custodian mint · monitor only"`. */
  tag: string;
  /** `"risk"` renders the tag as a red-bordered pill (escalation); default muted text. */
  tagTone?: StageTagTone;
  body: string;
  actionLabel: string;
}

export interface OtherActions {
  actions: string[];
  /** Timelock note; empty string when the variant has none (e.g. Watchlist). */
  note: string;
}

export interface LoanDetailMock {
  tiles: SummaryTile[];
  /** Escalation/stage card. Only the Watchlist variant renders one now — the
   *  Performing "on-ramp in transit" card was removed (#876), so this is
   *  optional. */
  currentStage?: CurrentStage;
  otherActions: OtherActions;
}

// ── Fixture ─────────────────────────────────────────────────────────────────

export const LOAN_DETAIL_MOCK: LoanDetailMock = {
  tiles: [
    {
      label: "Facility / disbursed",
      value: "$4.8M / $4.8M",
      sub: "funded from batch #B-102",
      subTone: "positive",
    },
    {
      label: "Repaid to date",
      value: "$6.30M",
      sub: "$150K coupon · 31 Mar + $6.15M final · 24 Jun",
      subTone: "muted",
    },
    {
      label: "Interest to distribute",
      value: "$115.5K",
      sub: "final coupon · mint pending",
      subTone: "attention",
    },
  ],
  otherActions: {
    // Record coupon is available in any post-Disbursing status (#867); Roll over
    // is matured-only (gated to the Matured variant), so it is NOT listed here.
    actions: [
      "Update lifecycle",
      "Record coupon",
      "Close loan",
      "Escalate to Risk Council",
    ],
    note: "Default, off-cycle re-term, and write-down close are not available from your key — they are Risk Council proposals under a 24h timelock.",
  },
};

/**
 * Disbursing other-actions (#867): still pre-funding, so **no Record coupon**
 * (coupon recording is post-Disbursing) and **no Roll over** (matured-only).
 */
export const LOAN_DETAIL_DISBURSING_OTHER_ACTIONS: OtherActions = {
  actions: ["Update lifecycle", "Escalate to Risk Council"],
  note: "Default, off-cycle re-term, and write-down close are not available from your key — they are Risk Council proposals under a 24h timelock.",
};

// ── Watchlist variant (issue #859, Figma node 4116:10803) ─────────────────────

/** The still-mock sections of the Watchlist loan-detail layout. */
export const LOAN_DETAIL_WATCHLIST_MOCK: LoanDetailMock = {
  tiles: [
    {
      label: "Facility / disbursed",
      value: "$1.84M / $1.84M",
      sub: "funded from batch #B-097 · 12 Feb",
      subTone: "muted",
    },
    {
      label: "Repaid to date",
      value: "$0",
      sub: "coupon missed · 15 Jun",
      subTone: "negative",
    },
    {
      label: "Days on watchlist",
      value: "18",
      sub: "since 3 Jun",
      subTone: "muted",
    },
  ],
  currentStage: {
    title: "Current stage — escalation decision pending",
    tag: "Risk Council · 24h timelock",
    tagTone: "risk",
    body: "Coffee is down 18% in 30 days: CCR crossed the 120% threshold on 20 Jun and sits at 114%. The 15 Jun coupon was missed. If the loan is past recovery on the performing path, draft a setDefault proposal.",
    actionLabel: "Open escalation →",
  },
  otherActions: {
    // Record coupon available (post-Disbursing, #867); Roll over is matured-only.
    actions: ["Update lifecycle", "Record coupon", "Escalate to Risk Council"],
    note: "",
  },
};

// ── Matured variant (issue #866, Figma node 4116:10969) ───────────────────────

/**
 * The Matured "rollover" card (right column of the Matured variant). Mock — no
 * rollover (S9) backend flow yet, so the button is inert. The card title
 * interpolates the loan's live maturity date in the view.
 */
export interface RolloverCard {
  /** Olive "available" pill, e.g. `"rollover available"`. */
  tag: string;
  body: string;
  actionLabel: string;
}

/** The still-mock sections of the Matured loan-detail layout. */
export interface MaturedMock {
  tiles: SummaryTile[];
  rollover: RolloverCard;
  otherActions: OtherActions;
}

export const LOAN_DETAIL_MATURED_MOCK: MaturedMock = {
  tiles: [
    {
      label: "Facility / senior",
      value: "$1,125,000 / $900,000",
      sub: "funded from batch #B-097 · 12 Feb",
      subTone: "muted",
    },
    {
      label: "Repaid to date",
      value: "$0",
      sub: "full repayment expected mid-Jul",
      subTone: "muted",
    },
    {
      label: "Rate · epochs",
      value: "12.5% p.a.",
      sub: "epoch 1",
      subTone: "muted",
    },
  ],
  rollover: {
    tag: "rollover available",
    body: "now ≥ currentMaturityDate and status is not Default or Closed — the instant post-maturity rollover from your key is available. A penalty re-term outside this fast-path would be a Risk Council amendEconomics.",
    actionLabel: "Roll over →",
  },
  otherActions: {
    // Matured is the only variant that lists Roll over (the matured-only
    // fast-path, #867); Record coupon is also available (post-Disbursing).
    actions: [
      "Update lifecycle",
      "Record coupon",
      "Roll over",
      "Escalate to Risk Council",
    ],
    note: "Default, off-cycle re-term, and write-down close are not available from your key — they are Risk Council proposals under a 24h timelock.",
  },
};
