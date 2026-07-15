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
 * actions.
 *
 * The copy below matches the Figma reference exactly (a design mock, so the
 * fabricated-detail rules that gate the live build do not apply here).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type TileTone = "muted" | "positive" | "attention";

/** One of the three summary tiles below the stepper. */
export interface SummaryTile {
  label: string;
  value: string;
  sub: string;
  /** Colour of the sub-line. */
  subTone: TileTone;
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

export interface LoanDetailMock {
  tiles: SummaryTile[];
  currentStage: CurrentStage;
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
