/**
 * Render tests for the Loan detail route (`loans.$id.tsx`, issues #845 / #847).
 * The view-model hook `useLoanDetail` is mocked so the component is exercised as
 * a pure render function (FRONTEND.md rule 2); the presenter's own logic is
 * covered by `-useLoanDetail.test.ts`. `Link` and `Route.useParams` are patched
 * (no real router tree), mirroring `-origination-detail-page.test.tsx`.
 *
 * Asserts the live hero (identity + band chip), the live Price & collateral card
 * (provider note, two-tone spot, rows, `missing_inputs` note, plus its own
 * loading / error states), the static action sections, the back link, and the
 * top-level loading / error states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseLoanDetailResult } from "./-useLoanDetail";
import {
  CLOSED_OTHER_ACTIONS,
  MATURED_OTHER_ACTIONS,
  PERFORMING_OTHER_ACTIONS,
} from "./-loanDetailStatic";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => mockNavigate,
  };
});

const mockUseLoanDetail = vi.fn<() => UseLoanDetailResult>();
vi.mock("./-useLoanDetail", () => ({
  useLoanDetail: () => mockUseLoanDetail(),
}));

// The page calls `useCompleteDisbursement` (a mutation) unconditionally; mock it
// so the render tests need no QueryClientProvider. Mutable fields are set per test.
const { mockComplete } = vi.hoisted(() => ({
  mockComplete: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as Error | null,
  },
}));
vi.mock("@/api/useCompleteDisbursement", () => ({
  useCompleteDisbursement: () => mockComplete,
}));

// `useRollover` pulls in @pipeline/wallet-connect (freighter) — mock it so the
// render tests don't load the wallet chain and need no QueryClient.
const { mockRollover } = vi.hoisted(() => ({
  mockRollover: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve({ hash: "0xhash" })),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    stage: null,
  },
}));
vi.mock("@/api/useRollover", () => ({
  useRollover: () => mockRollover,
}));

// `useUpdateLifecycle` also pulls in @pipeline/wallet-connect — mock it too.
const { mockUpdateLifecycle } = vi.hoisted(() => ({
  mockUpdateLifecycle: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve({ hash: "0xhash" })),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    stage: null,
  },
}));
vi.mock("@/api/useUpdateLifecycle", () => ({
  useUpdateLifecycle: () => mockUpdateLifecycle,
}));

import { Route } from "./loans.$id";

// `Route.useParams` is the file-route-bound accessor the component calls; patch
// it directly since the route isn't mounted in a real router tree here.
(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "4488",
});

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

function makeResult(
  overrides: Partial<UseLoanDetailResult> = {},
): UseLoanDetailResult {
  return {
    state: "ready",
    errorMessage: null,
    errorDetails: null,
    variant: "performing",
    ccrTrend: null,
    rollover: null,
    maturityDate: "30 Jun 2026",
    documents: [],
    hero: {
      backLabel: "‹ Loans",
      title: "Helios Metals · Lithium",
      status: { label: "Active", band: "positive" },
      meta: "Loan #4488 · matures 30 Jun 2026",
    },
    lifecycle: [
      {
        label: "Origination",
        sub: "reviewed & approved",
        state: "done",
        index: 1,
      },
      {
        label: "Disbursing",
        sub: "drawned, not yet funded",
        state: "done",
        index: 2,
      },
      {
        label: "Active",
        sub: "deployed & current",
        state: "active",
        index: 3,
      },
      { label: "Closed", sub: "terminal", state: "pending", index: 4 },
    ],
    tiles: [
      {
        label: "Facility / disbursed",
        value: "$4.8M / $3.96M",
        sub: "funded",
        subTone: "positive",
      },
      {
        label: "Repaid to date",
        value: "$6.3M",
        sub: "offtaker received",
        subTone: "muted",
      },
      {
        label: "Interest to distribute",
        value: "$115.5K",
        sub: "not minted yield",
        subTone: "attention",
      },
    ],
    registry: {
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [
        {
          label: "Status / location",
          value: "Performing · Vessel MV Andes",
          tag: "chain",
        },
        {
          label: "Epochs",
          value: "1 · 10.0% · 18 Jun 2026 → 19 Aug 2029",
          tag: "chain",
        },
        {
          label: "Recorded counters",
          value:
            "offtaker $6.3M · principal $4.8M · interest $231K · fees $69K",
          tag: "chain",
        },
        { label: "Offtaker still owed", value: "$0 of $6.3M", tag: "computed" },
        { label: "Unminted yield", value: "$115.5K", tag: "computed" },
        { label: "Custodian co-sig on mint", value: "—", tag: "relayer" },
      ],
    },
    currentStage: null,
    otherActions: PERFORMING_OTHER_ACTIONS,
    priceCollateral: {
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      providerNote: "via coingecko",
      spot: { main: "$10,450", change: "−1.2% 7d", changeNegative: true },
      rows: [
        { label: "Quantity", value: "620 dmt" },
        { label: "Collateral value (after 10% haircut)", value: "$5,831,100" },
        { label: "Senior outstanding", value: "$4,950,000" },
        { label: "CCR", value: "117.80%" },
      ],
      missingNote: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockUseLoanDetail.mockReset();
  mockUseLoanDetail.mockReturnValue(makeResult());
  mockComplete.mutate = vi.fn();
  mockComplete.reset = vi.fn();
  mockComplete.isPending = false;
  mockComplete.error = null;
  mockRollover.mutateAsync = vi.fn(() => Promise.resolve({ hash: "0xhash" }));
  mockRollover.reset = vi.fn();
  mockRollover.isPending = false;
  mockRollover.error = null;
  mockUpdateLifecycle.mutateAsync = vi.fn(() =>
    Promise.resolve({ hash: "0xhash" }),
  );
  mockUpdateLifecycle.reset = vi.fn();
  mockUpdateLifecycle.isPending = false;
  mockUpdateLifecycle.error = null;
  mockNavigate.mockReset();
});

describe("Loan detail route — hero (live)", () => {
  it("renders the identity title, band chip, and meta", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Helios Metals · Lithium" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loan-detail-status-chip")).toHaveTextContent(
      "Active",
    );
    expect(screen.getByTestId("loan-detail-meta")).toHaveTextContent(
      "Loan #4488 · matures 30 Jun 2026",
    );
  });

  it("has a back link to /loans", () => {
    renderRoute();
    expect(screen.getByText("‹ Loans").closest("a")).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});

describe("Loan detail route — Price & collateral (live)", () => {
  it("renders the provider note, two-tone spot, and the four rows", () => {
    renderRoute();
    const pc = screen.getByTestId("loan-detail-price-collateral");
    expect(within(pc).getByText("via coingecko")).toBeInTheDocument();
    expect(within(pc).getByText("$10,450")).toBeInTheDocument();
    expect(within(pc).getByText("−1.2% 7d")).toBeInTheDocument();
    expect(within(pc).getByText("620 dmt")).toBeInTheDocument();
    expect(
      within(pc).getByText("Collateral value (after 10% haircut)"),
    ).toBeInTheDocument();
    expect(within(pc).getByText("$5,831,100")).toBeInTheDocument();
    expect(within(pc).getByText("117.80%")).toBeInTheDocument();
  });

  it("renders the missing-inputs note when the valuation is incomplete", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "ready",
          errorMessage: null,
          errorDetails: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [
            { label: "Quantity", value: "—" },
            { label: "Collateral value (after 10% haircut)", value: "—" },
            { label: "Senior outstanding", value: "—" },
            { label: "CCR", value: "—" },
          ],
          missingNote: "Awaiting: reference_price, quantity",
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-missing"),
    ).toHaveTextContent("Awaiting: reference_price, quantity");
  });

  it("renders the P&C loading skeleton while the valuation loads", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "loading",
          errorMessage: null,
          errorDetails: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [],
          missingNote: null,
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-loading"),
    ).toBeInTheDocument();
  });

  it("renders a neutral 'no valuation' note for a 404 (empty state)", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "empty",
          errorMessage: null,
          errorDetails: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [],
          missingNote: "No valuation on record for this loan.",
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-empty"),
    ).toHaveTextContent("No valuation on record for this loan.");
    // Not a red error alert.
    expect(
      screen.queryByTestId("loan-detail-price-collateral-error"),
    ).not.toBeInTheDocument();
  });

  it("renders the P&C error message when the valuation fails", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "error",
          errorMessage: "boom",
          errorDetails: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [],
          missingNote: null,
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-error"),
    ).toHaveTextContent("boom");
  });
});

describe("Loan detail route — Registry state & derived (live)", () => {
  it("renders the financials rows + source tags", () => {
    renderRoute();
    const reg = screen.getByTestId("loan-detail-registry");
    expect(within(reg).getByText("Status / location")).toBeInTheDocument();
    expect(
      within(reg).getByText("Performing · Vessel MV Andes"),
    ).toBeInTheDocument();
    expect(
      within(reg).getByText("1 · 10.0% · 18 Jun 2026 → 19 Aug 2029"),
    ).toBeInTheDocument();
    expect(
      within(reg).getByText(
        "offtaker $6.3M · principal $4.8M · interest $231K · fees $69K",
      ),
    ).toBeInTheDocument();
    expect(within(reg).getByText("$0 of $6.3M")).toBeInTheDocument();
    expect(within(reg).getByText("Unminted yield")).toBeInTheDocument();
    expect(
      within(reg).getByText("Custodian co-sig on mint"),
    ).toBeInTheDocument();
    expect(within(reg).getAllByText("relayer").length).toBeGreaterThan(0);
  });

  it("renders the loading skeleton while financials load", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        registry: {
          state: "loading",
          errorMessage: null,
          errorDetails: null,
          rows: [],
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-registry-loading"),
    ).toBeInTheDocument();
  });

  it("renders a neutral 'no financials' note for a 404 (empty state)", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        registry: {
          state: "empty",
          errorMessage: null,
          errorDetails: null,
          rows: [],
        },
      }),
    );
    renderRoute();
    expect(screen.getByTestId("loan-detail-registry-empty")).toHaveTextContent(
      "No financials on record for this loan.",
    );
  });

  it("renders the error message when financials fail", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        registry: {
          state: "error",
          errorMessage: "boom",
          errorDetails: null,
          rows: [],
        },
      }),
    );
    renderRoute();
    expect(screen.getByTestId("loan-detail-registry-error")).toHaveTextContent(
      "boom",
    );
  });
});

describe("Loan detail route — static action sections", () => {
  it("renders the 4-node spine and NOT risk states as steps (#854)", () => {
    renderRoute();
    const lifecycle = screen.getByTestId("loan-detail-lifecycle");
    for (const label of ["Origination", "Disbursing", "Active", "Closed"]) {
      expect(within(lifecycle).getByText(label)).toBeInTheDocument();
    }
    // Risk branch states are not sequential steps for a healthy Performing loan.
    expect(within(lifecycle).queryByText("Past Due")).not.toBeInTheDocument();
    expect(within(lifecycle).queryByText("Default")).not.toBeInTheDocument();
  });

  it("renders the three summary tiles", () => {
    renderRoute();
    const tiles = screen.getByTestId("loan-detail-tiles");
    expect(within(tiles).getByText("Facility / disbursed")).toBeInTheDocument();
    expect(within(tiles).getByText("Repaid to date")).toBeInTheDocument();
    expect(
      within(tiles).getByText("Interest to distribute"),
    ).toBeInTheDocument();
  });

  it("does NOT render a current-stage card on a performing loan (#876)", () => {
    renderRoute();
    // The old "on-ramp in transit" current-stage card was removed from the
    // Performing layout (#876); only the Watchlist variant renders one now.
    expect(
      screen.queryByTestId("loan-detail-current-stage"),
    ).not.toBeInTheDocument();
  });

  it("renders NO action buttons on a Closed loan — only the terminal note (#1092)", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({ otherActions: CLOSED_OTHER_ACTIONS }),
    );
    renderRoute();
    const actions = screen.getByTestId("loan-detail-other-actions");
    expect(within(actions).queryAllByRole("button")).toHaveLength(0);
    expect(
      within(actions).getByText(/This loan is closed — no further actions/),
    ).toBeInTheDocument();
  });

  it("renders the Other actions buttons + timelock note", () => {
    renderRoute();
    const actions = screen.getByTestId("loan-detail-other-actions");
    for (const label of PERFORMING_OTHER_ACTIONS.actions) {
      expect(
        within(actions).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    expect(
      within(actions).getByText(/Risk Council proposals under a 24h timelock/),
    ).toBeInTheDocument();
  });
});

describe("Loan detail route — Matured variant (#866)", () => {
  function maturedResult() {
    return makeResult({
      variant: "matured",
      maturityDate: "15 Jun 2026",
      hero: {
        backLabel: "‹ Loans",
        title: "Volta Cashew · Cashew",
        status: { label: "Matured", band: "attention" },
        meta: "Loan #4483 · 15 Jun 2026 — passed",
      },
      rollover: {
        tag: "rollover available",
        body: "now ≥ currentMaturityDate and status is not Default or Closed — the instant post-maturity rollover from your key is available.",
        actionLabel: "Roll over →",
      },
      otherActions: MATURED_OTHER_ACTIONS,
    });
  }

  it("renders the rollover card (title with maturity date, tag, action) — no stepper/Registry", () => {
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    const card = screen.getByTestId("loan-detail-rollover");
    expect(
      within(card).getByText("Matured 15 Jun 2026 without full repayment"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loan-detail-rollover-tag")).toHaveTextContent(
      "rollover available",
    );
    expect(screen.getByTestId("loan-detail-rollover-action")).toHaveTextContent(
      "Roll over",
    );
    // Matured has no lifecycle stepper and no Registry card.
    expect(
      screen.queryByTestId("loan-detail-lifecycle"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("loan-detail-registry"),
    ).not.toBeInTheDocument();
  });

  it("shows the Matured chip and '— passed' maturity in the hero", () => {
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    expect(screen.getByTestId("loan-detail-status-chip")).toHaveTextContent(
      "Matured",
    );
    expect(screen.getByTestId("loan-detail-meta")).toHaveTextContent(
      "Loan #4483 · 15 Jun 2026 — passed",
    );
  });

  it("opens the rollover modal from the Roll over action (#870)", () => {
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    expect(screen.queryByTestId("rollover-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("loan-detail-rollover-action"));
    const dialog = screen.getByTestId("rollover-dialog");
    expect(dialog).toBeInTheDocument();
  });

  it("opens the rollover modal from the 'Roll over' Other-actions button too — not only the rollover widget (#923)", () => {
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    expect(screen.queryByTestId("rollover-dialog")).not.toBeInTheDocument();
    // Click the "Roll over" entry in the Other actions card at the bottom of
    // the page (distinct from the rollover widget's "Roll over →" button).
    const actions = screen.getByTestId("loan-detail-other-actions");
    fireEvent.click(within(actions).getByRole("button", { name: "Roll over" }));
    expect(screen.getByTestId("rollover-dialog")).toBeInTheDocument();
    // Guard banner shows the matured date; submit is disabled until the form is filled.
    expect(screen.getByTestId("rollover-guard")).toHaveTextContent(
      "matured 15 Jun 2026",
    );
    expect(screen.getByTestId("rollover-submit")).toBeDisabled();
    expect(mockRollover.mutateAsync).not.toHaveBeenCalled();
  });

  it("submits the on-chain rollover with the entered rate + maturity", () => {
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-rollover-action"));
    fireEvent.change(screen.getByTestId("rollover-rate"), {
      target: { value: "1450" },
    });
    fireEvent.change(screen.getByTestId("rollover-maturity"), {
      target: { value: "2026-09-30" },
    });
    const submit = screen.getByTestId("rollover-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(mockRollover.mutateAsync).toHaveBeenCalledWith({
      loanId: 4488, // Route.useParams is patched to id "4488" in this suite.
      newRateBps: 1450,
      // 2026-09-30T00:00:00Z in Unix seconds.
      newMaturity: Math.floor(Date.parse("2026-09-30T00:00:00Z") / 1000),
    });
  });

  it("surfaces the friendly rollover mutation error inside the modal, raw text only in errorDetails (#1037)", async () => {
    const user = userEvent.setup();
    mockRollover.error = new Error("rollover simulation error: bad ledger");
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-rollover-action"));
    const alert = screen.getByTestId("rollover-error");
    expect(alert).toHaveTextContent(
      "Could not verify this action on-chain. No signature was requested — safe to retry.",
    );
    expect(alert).not.toHaveTextContent("bad ledger");

    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "rollover simulation error: bad ledger",
    );
  });

  it("surfaces the Past-Due attention notice with the record + escalate paths (#940)", () => {
    mockUseLoanDetail.mockReturnValue(maturedResult());
    renderRoute();
    const notice = screen.getByTestId("loan-detail-past-due-notice");
    expect(notice).toHaveTextContent("Past due");

    // "Record payment" → the existing full-page Record-coupon route.
    fireEvent.click(screen.getByTestId("loan-detail-past-due-record"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/loans/$id/record-coupon",
      params: { id: "4488" },
    });

    // "Escalate to default" → the existing Escalate-to-Default route.
    fireEvent.click(screen.getByTestId("loan-detail-past-due-escalate"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/risk-council/escalate/$id",
      params: { id: "4488" },
    });
  });
});

describe("Loan detail route — Disbursing variant (#862)", () => {
  function disbursingResult() {
    return makeResult({
      variant: "disbursing",
      hero: {
        backLabel: "‹ Loans",
        title: "Helios Metals · Lithium",
        status: { label: "Disbursing", band: "info" },
        meta: "Loan #4488 · matures 30 Jun 2026",
      },
    });
  }

  it("renders the 'Next Step' card instead of a current-stage card", () => {
    mockUseLoanDetail.mockReturnValue(disbursingResult());
    renderRoute();
    const card = screen.getByTestId("loan-detail-disbursement");
    expect(card).toBeInTheDocument();
    expect(within(card).getByText("Next Step")).toBeInTheDocument();
    // Description references the loan name and the Disbursing → Performing move.
    expect(card).toHaveTextContent(
      "Mark Helios Metals · Lithium USDC off-ramp complete — this will move the Disbursing status to Active.",
    );
    expect(
      screen.getByTestId("loan-detail-complete-disbursement"),
    ).toHaveTextContent("Complete off-ramp");
    expect(
      screen.queryByTestId("loan-detail-current-stage"),
    ).not.toBeInTheDocument();
  });

  it("opens a confirmation modal on click (no mutation yet)", () => {
    mockUseLoanDetail.mockReturnValue(disbursingResult());
    renderRoute();
    expect(
      screen.queryByTestId("disbursement-confirm-dialog"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("loan-detail-complete-disbursement"));
    expect(
      screen.getByTestId("disbursement-confirm-dialog"),
    ).toBeInTheDocument();
    expect(mockComplete.mutate).not.toHaveBeenCalled();
  });

  it("fires the mutation with the loan id when the modal is confirmed", () => {
    mockUseLoanDetail.mockReturnValue(disbursingResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-complete-disbursement"));
    fireEvent.click(screen.getByTestId("disbursement-confirm-submit"));
    expect(mockComplete.mutate).toHaveBeenCalledWith(
      { loanId: "4488" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("cancel closes the modal without mutating", () => {
    mockUseLoanDetail.mockReturnValue(disbursingResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-complete-disbursement"));
    fireEvent.click(screen.getByTestId("disbursement-confirm-cancel"));
    expect(
      screen.queryByTestId("disbursement-confirm-dialog"),
    ).not.toBeInTheDocument();
    expect(mockComplete.mutate).not.toHaveBeenCalled();
  });

  it("disables the confirm button and shows 'Completing…' while pending", () => {
    mockComplete.isPending = true;
    mockUseLoanDetail.mockReturnValue(disbursingResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-complete-disbursement"));
    const btn = screen.getByTestId("disbursement-confirm-submit");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Completing…");
  });

  it("surfaces the friendly mutation error inside the modal, raw text only in errorDetails (#1037)", async () => {
    const user = userEvent.setup();
    mockComplete.error = new Error("loan 4488 not indexed on chain 99000001");
    mockUseLoanDetail.mockReturnValue(disbursingResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-complete-disbursement"));
    const alert = screen.getByTestId("disbursement-confirm-error");
    expect(alert).toHaveTextContent("Failed to complete the off-ramp.");
    expect(alert).not.toHaveTextContent("not indexed");

    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "loan 4488 not indexed on chain 99000001",
    );
  });
});

describe("Loan detail route — Update lifecycle (#872)", () => {
  it("opens the update-lifecycle modal from the Update lifecycle action", () => {
    mockUseLoanDetail.mockReturnValue(makeResult());
    renderRoute();
    expect(
      screen.queryByTestId("update-lifecycle-dialog"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("loan-detail-action-Update lifecycle"));
    expect(screen.getByTestId("update-lifecycle-dialog")).toBeInTheDocument();
    // Submit is disabled until CCR + location are entered.
    expect(screen.getByTestId("update-lifecycle-submit")).toBeDisabled();
  });

  it("surfaces the friendly update-lifecycle mutation error inside the modal, raw text only in errorDetails (#1037)", async () => {
    const user = userEvent.setup();
    mockUpdateLifecycle.error = new Error("Stellar wallet not connected.");
    mockUseLoanDetail.mockReturnValue(makeResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-action-Update lifecycle"));
    const alert = screen.getByTestId("update-lifecycle-error");
    expect(alert).toHaveTextContent(
      "Connect your trustee wallet to approve on-chain.",
    );

    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "Stellar wallet not connected.",
    );
  });

  it("submits update_mutable with status + CCR% + location + metadataURI", () => {
    mockUseLoanDetail.mockReturnValue(makeResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-action-Update lifecycle"));
    fireEvent.change(screen.getByTestId("update-lifecycle-status"), {
      target: { value: "WatchList" },
    });
    fireEvent.change(screen.getByTestId("update-lifecycle-ccr"), {
      target: { value: "135" },
    });
    fireEvent.change(screen.getByTestId("update-lifecycle-location-type"), {
      target: { value: "Vessel" },
    });
    fireEvent.change(screen.getByTestId("update-lifecycle-location"), {
      target: { value: "MV Andes · IMO 9741205" },
    });
    fireEvent.change(screen.getByTestId("update-lifecycle-tracking"), {
      target: { value: "https://track.example/9741205" },
    });
    fireEvent.change(screen.getByTestId("update-lifecycle-metadata"), {
      target: { value: "ipfs://assay" },
    });
    fireEvent.click(screen.getByTestId("update-lifecycle-submit"));
    // Location is submitted as the on-chain `LocationUpdate` struct (not a bare
    // string — a string traps the contract; issue #872).
    expect(mockUpdateLifecycle.mutateAsync).toHaveBeenCalledWith({
      loanId: 4488,
      status: "WatchList",
      ccrPercent: 135,
      location: {
        location_type: "Vessel",
        location_identifier: "MV Andes · IMO 9741205",
        tracking_url: "https://track.example/9741205",
        updated_at: expect.any(Number),
      },
      metadataUri: "ipfs://assay",
    });
  });
});

describe("Loan detail route — Record coupon (#882)", () => {
  it("navigates to the full-page Record-coupon route from the Record coupon action", () => {
    mockUseLoanDetail.mockReturnValue(makeResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-action-Record coupon"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/loans/$id/record-coupon",
      params: { id: "4488" },
    });
    // Unlike Update lifecycle, this is a full-page destination — no modal opens.
    expect(
      screen.queryByTestId("update-lifecycle-dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Loan detail route — Close loan (#884)", () => {
  it("navigates to the full-page Record-repayment route from the Close loan action (does not close the loan directly)", () => {
    mockUseLoanDetail.mockReturnValue(makeResult());
    renderRoute();
    fireEvent.click(screen.getByTestId("loan-detail-action-Close loan"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/loans/$id/record-repayment",
      params: { id: "4488" },
    });
    // This is a full-page destination — no modal opens.
    expect(
      screen.queryByTestId("update-lifecycle-dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Loan detail route — Escalate to Risk Council (#782)", () => {
  it("navigates to the full-page Escalate-to-Default route from the Escalate to Risk Council action", () => {
    mockUseLoanDetail.mockReturnValue(makeResult());
    renderRoute();
    fireEvent.click(
      screen.getByTestId("loan-detail-action-Escalate to Risk Council"),
    );
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/risk-council/escalate/$id",
      params: { id: "4488" },
    });
    // Unlike Update lifecycle, this is a full-page destination — no modal opens.
    expect(
      screen.queryByTestId("update-lifecycle-dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Loan detail route — top-level states", () => {
  it("renders the loading skeleton", () => {
    mockUseLoanDetail.mockReturnValue(makeResult({ state: "loading" }));
    renderRoute();
    expect(screen.getByTestId("loan-detail-loading")).toBeInTheDocument();
  });

  it("renders the error alert with a back link", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({ state: "error", errorMessage: "kaboom" }),
    );
    renderRoute();
    expect(screen.getByTestId("loan-detail-error")).toHaveTextContent("kaboom");
    expect(screen.getByText("‹ Loans").closest("a")).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});

describe("Loan detail route — Documents (#1039)", () => {
  const DOCS = [
    { name: "Facility Agreement (extract)", uri: "ipfs://cid-facility" },
    { name: "Offtake Contract", uri: "ipfs://cid-offtake" },
  ];

  it.each([
    ["performing", makeResult({ variant: "performing", documents: DOCS })],
    [
      "watchlist",
      makeResult({
        variant: "watchlist",
        otherActions: { actions: [], note: "" },
        documents: DOCS,
      }),
    ],
    [
      "disbursing",
      makeResult({
        variant: "disbursing",
        hero: {
          backLabel: "‹ Loans",
          title: "Helios Metals · Lithium",
          status: { label: "Disbursing", band: "info" },
          meta: "Loan #4488 · matures 30 Jun 2026",
        },
        documents: DOCS,
      }),
    ],
    [
      "matured",
      makeResult({
        variant: "matured",
        maturityDate: "15 Jun 2026",
        rollover: {
          tag: "rollover available",
          body: "now ≥ currentMaturityDate and status is not Default or Closed.",
          actionLabel: "Roll over →",
        },
        documents: DOCS,
      }),
    ],
  ])("renders the Documents section in the %s variant", (_label, result) => {
    mockUseLoanDetail.mockReturnValue(result);
    renderRoute();
    expect(screen.getByTestId("loan-detail-documents")).toBeInTheDocument();
  });

  it("places the Documents card before the Other-actions card in DOM order (performing)", () => {
    mockUseLoanDetail.mockReturnValue(makeResult({ documents: DOCS }));
    renderRoute();
    const docs = screen.getByTestId("loan-detail-documents");
    const actions = screen.getByTestId("loan-detail-other-actions");
    const position = docs.compareDocumentPosition(actions);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("places the Documents card before the Other-actions card in DOM order (matured)", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        variant: "matured",
        maturityDate: "15 Jun 2026",
        rollover: {
          tag: "rollover available",
          body: "now ≥ currentMaturityDate and status is not Default or Closed.",
          actionLabel: "Roll over →",
        },
        documents: DOCS,
      }),
    );
    renderRoute();
    const docs = screen.getByTestId("loan-detail-documents");
    const actions = screen.getByTestId("loan-detail-other-actions");
    const position = docs.compareDocumentPosition(actions);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("renders two document anchors with the served name/href/target/rel", () => {
    mockUseLoanDetail.mockReturnValue(makeResult({ documents: DOCS }));
    renderRoute();
    const anchors = screen.getAllByTestId("loan-detail-document");
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toHaveTextContent("Facility Agreement (extract)");
    expect(anchors[0]).toHaveAttribute("href", "ipfs://cid-facility");
    expect(anchors[0]).toHaveAttribute("target", "_blank");
    expect(anchors[0]?.getAttribute("rel")).toContain("noopener");
    expect(anchors[0]?.getAttribute("rel")).toContain("noreferrer");
    expect(anchors[1]).toHaveTextContent("Offtake Contract");
    expect(anchors[1]).toHaveAttribute("href", "ipfs://cid-offtake");
  });

  it("renders the empty state and no document anchors when documents is []", () => {
    mockUseLoanDetail.mockReturnValue(makeResult({ documents: [] }));
    renderRoute();
    const card = screen.getByTestId("loan-detail-documents");
    expect(
      within(card).getByText("No documents provided."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("loan-detail-document"),
    ).not.toBeInTheDocument();
  });

  it("renders a document with an empty uri as inert (no href, aria-disabled)", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({ documents: [{ name: "Untitled scan", uri: "" }] }),
    );
    renderRoute();
    const anchor = screen.getByTestId("loan-detail-document");
    expect(anchor).not.toHaveAttribute("href");
    expect(anchor).toHaveAttribute("aria-disabled", "true");
  });

  it("omits the Documents card in the top-level loading/error states", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({ state: "loading", documents: DOCS }),
    );
    renderRoute();
    expect(
      screen.queryByTestId("loan-detail-documents"),
    ).not.toBeInTheDocument();

    mockUseLoanDetail.mockReturnValue(
      makeResult({
        state: "error",
        errorMessage: "kaboom",
        errorDetails: null,
        documents: DOCS,
      }),
    );
    renderRoute();
    expect(
      screen.queryByTestId("loan-detail-documents"),
    ).not.toBeInTheDocument();
  });
});

describe("Loan detail route — Watchlist variant (#859)", () => {
  function watchlistResult() {
    return makeResult({
      variant: "watchlist",
      hero: {
        backLabel: "‹ Loans",
        title: "Delta Commodities · Coffee",
        status: { label: "Watchlist", band: "attention" },
        meta: "Loan #4471 · matures 1 Aug 2026",
      },
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
      // Watchlist escalation current-stage card is hidden for now (#938).
      currentStage: null,
      otherActions: {
        actions: ["Update lifecycle", "Roll over", "Escalate to Risk Council"],
        note: "",
      },
      ccrTrend: {
        points: [146, 132, 121, 114],
        startLabel: "146% · 1 May 2026",
        currentLabel: "114%",
        thresholds: [
          { pct: 120, label: "120%" },
          { pct: 110, label: "110%" },
        ],
      },
    });
  }

  it("renders the CCR-trend chart and the Days-on-watchlist tile", () => {
    mockUseLoanDetail.mockReturnValue(watchlistResult());
    renderRoute();
    const chart = screen.getByTestId("loan-detail-ccr-trend");
    expect(chart).toBeInTheDocument();
    expect(within(chart).getByText("146% · 1 May 2026")).toBeInTheDocument();
    expect(within(chart).getByText("114%")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("loan-detail-tiles")).getByText(
        "Days on watchlist",
      ),
    ).toBeInTheDocument();
  });

  it("omits the lifecycle stepper and the Registry card", () => {
    mockUseLoanDetail.mockReturnValue(watchlistResult());
    renderRoute();
    expect(
      screen.queryByTestId("loan-detail-lifecycle"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("loan-detail-registry"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the escalation current-stage card — hidden until proposal-aware (#938)", () => {
    mockUseLoanDetail.mockReturnValue(watchlistResult());
    renderRoute();
    expect(
      screen.queryByTestId("loan-detail-current-stage"),
    ).not.toBeInTheDocument();
  });
});
