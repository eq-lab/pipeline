/**
 * Static UI configuration for the Trustee loan-detail page.
 *
 * These constants are product copy and route/action availability rules. Values
 * that describe a particular loan (amounts, rates, dates, status, security) are built from API responses in `-useLoanDetail.ts`.
 */

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
  /** Right-aligned tag, e.g. `"Risk Council · 24h timelock"`. */
  tag: string;
  /** `"risk"` renders the tag as a red-bordered pill; default muted text. */
  tagTone?: StageTagTone;
  body: string;
  actionLabel: string;
}

export interface OtherActions {
  actions: string[];
  /** Timelock note; empty string when the variant has none. */
  note: string;
}

export interface RolloverCard {
  /** Olive "available" pill, e.g. `"rollover available"`. */
  tag: string;
  body: string;
  actionLabel: string;
}

export const PERFORMING_OTHER_ACTIONS: OtherActions = {
  actions: [
    "Update lifecycle",
    "Record coupon",
    "Close loan",
    "Escalate to Risk Council",
  ],
  note: "Declaring default, cure, write-down and amendments belong to the Risk Council.",
};

export const DISBURSING_OTHER_ACTIONS: OtherActions = {
  actions: ["Update lifecycle", "Escalate to Risk Council"],
  note: "Declaring default, cure, write-down and amendments belong to the Risk Council.",
};

/** A closed loan is terminal — no lifecycle or cash actions remain (#1092). */
export const CLOSED_OTHER_ACTIONS: OtherActions = {
  actions: [],
  note: "This loan is closed — no further actions are available.",
};

export const WATCHLIST_CURRENT_STAGE: CurrentStage = {
  title: "Current stage — escalation decision pending",
  tag: "Risk Council · 24h timelock",
  tagTone: "risk",
  body: "A margin call is open or the LTV is above the margin-call ratio. If the loan is past recovery on the active path, escalate it to the Risk Council.",
  actionLabel: "Open escalation →",
};

export const WATCHLIST_OTHER_ACTIONS: OtherActions = {
  actions: ["Update lifecycle", "Record coupon", "Escalate to Risk Council"],
  note: "",
};

export const MATURED_ROLLOVER_CARD: RolloverCard = {
  tag: "rollover available",
  body: "now ≥ currentMaturityDate and status is not Default or Closed — the instant post-maturity rollover from your key is available. A penalty re-term outside this fast-path would be a Risk Council amendEconomics.",
  actionLabel: "Roll over →",
};

export const MATURED_OTHER_ACTIONS: OtherActions = {
  actions: [
    "Update lifecycle",
    "Record coupon",
    "Roll over",
    "Escalate to Risk Council",
  ],
  note: "Declaring default, cure, write-down and amendments belong to the Risk Council.",
};
