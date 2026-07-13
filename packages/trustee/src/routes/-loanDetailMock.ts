/**
 * Static mock fixture for the Trustee **Loan detail** page (issue #847, Figma
 * node `4116:10549`). The page renders this fixture verbatim — no live API
 * calls, no localStorage, no fake network.
 *
 * ⚠️ MOCK DATA. Per the trustee data-sourcing convention, a static Figma mock
 * is acceptable **only until the real endpoint lands**. Each section migrates
 * to its live source as it becomes available:
 *   - Price & collateral → `GET /v1/loan-book/{loan_id}/valuations` (issue #845,
 *     currently blocked).
 *   - Hero identity → the loan-book row (issue #845).
 *   - Deal journey / summary tiles / registry state / current stage → no backend
 *     source yet (future backend work).
 * When a section goes live, delete its slice here and swap the presenter.
 *
 * The copy below matches the Figma reference exactly (a design mock, so the
 * fabricated-detail rules that gate the live build do not apply here).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type StepState = "done" | "active" | "pending";

/** One node of the deal-journey stepper. */
export interface JourneyStage {
  label: string;
  /** Sub-label under the node, e.g. `"5 Jan · batch #B-102"`. */
  sub: string;
  state: StepState;
  /** Step number shown inside active/pending nodes (done nodes show a check). */
  index: number;
}

export type TileTone = "muted" | "positive" | "attention";

/** One of the three summary tiles below the stepper. */
export interface SummaryTile {
  label: string;
  value: string;
  sub: string;
  /** Colour of the sub-line. */
  subTone: TileTone;
}

/** The commodity spot row (two-tone value: neutral price + coloured change). */
export interface SpotRow {
  label: string;
  /** e.g. `"Li₂CO₃ $10,450/t"`. */
  main: string;
  /** e.g. `"−1.2% 7d"`. */
  change: string;
  changeNegative: boolean;
}

/** A plain `label: value` row. */
export interface LabelValueRow {
  label: string;
  value: string;
}

export interface PriceCollateral {
  /** Freshness sub-header, e.g. `"feed 2h old · recalcs every 60 min"`. */
  feedNote: string;
  spot: SpotRow;
  rows: LabelValueRow[];
  /** The on-chain-write footnote. */
  footnote: string;
}

export type RegistryTag = "chain" | "computed" | "relayer";

/** One row of the "Registry state & derived" card, with its source tag. */
export interface RegistryRow {
  label: string;
  value: string;
  tag: RegistryTag;
}

export interface CurrentStage {
  title: string;
  /** Right-aligned tag, e.g. `"Relayer + custodian mint · monitor only"`. */
  tag: string;
  body: string;
  actionLabel: string;
}

export interface OtherActions {
  actions: string[];
  note: string;
}

export interface Hero {
  backLabel: string;
  title: string;
  status: {
    label: string;
    band: "positive" | "attention" | "negative" | "neutral";
  };
  meta: string;
}

export interface LoanDetailMock {
  hero: Hero;
  journey: JourneyStage[];
  tiles: SummaryTile[];
  priceCollateral: PriceCollateral;
  registry: RegistryRow[];
  currentStage: CurrentStage;
  otherActions: OtherActions;
}

// ── Fixture ─────────────────────────────────────────────────────────────────

export const LOAN_DETAIL_MOCK: LoanDetailMock = {
  hero: {
    backLabel: "‹ Loans",
    title: "Helios Metals · Lithium",
    status: { label: "Performing", band: "positive" },
    meta: "Loan #4488 · Chile → Korea · matures 30 Jun 2026 · 9 days left",
  },
  journey: [
    { label: "Origination", sub: "2 Jan", state: "done", index: 1 },
    { label: "Funding", sub: "5 Jan · batch #B-102", state: "done", index: 2 },
    {
      label: "Coupon · interest",
      sub: "31 Mar · minted",
      state: "done",
      index: 3,
    },
    {
      label: "Repayment · principal",
      sub: "24 Jun · recorded",
      state: "done",
      index: 4,
    },
    { label: "On-ramp", sub: "in transit", state: "active", index: 5 },
    {
      label: "Interest distribution",
      sub: "mint pending",
      state: "pending",
      index: 6,
    },
  ],
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
  priceCollateral: {
    feedNote: "feed 2h old · recalcs every 60 min",
    spot: {
      label: "Spot (off-chain API)",
      main: "Li₂CO₃ $10,450/t",
      change: "−1.2% 7d",
      changeNegative: true,
    },
    rows: [
      { label: "Quantity (trustee feed)", value: "620 t" },
      { label: "Collateral value (after 10% haircut)", value: "$5,831,100" },
      { label: "Senior outstanding", value: "$0 — principal repaid 24 Jun" },
      { label: "CCR", value: "n/a — price risk closed" },
    ],
    footnote:
      "Last on-chain write: CCR 135% · 12 May (130% threshold crossing).",
  },
  registry: [
    {
      label: "Status / location",
      value: "Performing · MV Andes, IMO 9741205",
      tag: "chain",
    },
    { label: "Epochs", value: "1 · 13.0% · 2 Jan → 30 Jun", tag: "chain" },
    {
      label: "Recorded counters",
      value: "offtaker $6.30M · principal $4.8M · interest $231K · fees $69K",
      tag: "chain",
    },
    { label: "Offtaker still owed", value: "$0 of $6.30M", tag: "computed" },
    {
      label: "Unminted — vault / treasury",
      value: "$115.5K / $34.5K",
      tag: "computed",
    },
    {
      label: "Custodian co-sig on mint",
      value: "awaiting USDC",
      tag: "relayer",
    },
  ],
  currentStage: {
    title: "Current stage — on-ramp in transit",
    tag: "Relayer + custodian mint · monitor only",
    body: "The senior portion ($4,950,000) is converting back to USDC at the on-ramp provider. Once it lands in the Capital Wallet, the Relayer and custodian mint the $115.5K final coupon into the sPLUSD vault and $34.5K fees to Treasury.",
    actionLabel: "Open on-ramp & mint →",
  },
  otherActions: {
    actions: [
      "Update lifecycle",
      "Roll over",
      "Close loan",
      "Escalate to Risk Council",
    ],
    note: "Default, off-cycle re-term, and write-down close are not available from your key — they are Risk Council proposals under a 24h timelock.",
  },
};

/**
 * Thin accessor so the `.tsx` route stays render-only (FRONTEND.md rule 2) and
 * there is a clean seam to swap the static mock for live hooks per section
 * later. Loan-agnostic for now — the mock is the same for every loan (the
 * `/loans/$id` route param is cosmetic until the live sources land).
 */
export function useLoanDetailMock(): LoanDetailMock {
  return LOAN_DETAIL_MOCK;
}
