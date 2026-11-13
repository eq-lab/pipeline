// spec: docs/frontend/trustee-flows.md#amend-and-resubmit-originationidedit-1913
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/api/client";
import type { SubmissionView } from "@/api/useLoanSubmissions";

const { mockNavigate, mockResubmit, mockLocation } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockResubmit: {
    mutateAsync: vi.fn<(input: unknown) => Promise<{ id: number }>>(() =>
      Promise.resolve({ id: 7 }),
    ),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
  },
  mockLocation: { state: {} as { submission?: unknown } },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
    Link: ({
      children,
      to,
      params,
      ...rest
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
    } & Record<string, unknown>) => {
      const href = params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`$${k}`, v),
            to,
          )
        : to;
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    },
  };
});

vi.mock("@/api/useResubmitLoan", () => ({
  useResubmitLoan: () => mockResubmit,
}));

vi.mock("@/api/useLoanSubmissions", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/useLoanSubmissions")
  >("@/api/useLoanSubmissions");
  return { ...actual, useLoanSubmissions: vi.fn() };
});

import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import { Route } from "./origination.$id_.edit";

(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "7",
});

const LOAN_DATA = {
  metadata_uri: "ipfs://meta",
  data_room_id: "DR-9",
  originator: "Alan",
  borrower_id: "Open Mineral",
  commodity: "Copper",
  corridor: "PE-CN",
  governing_law: "English law",
  protection: "LC",
  documents: [{ name: "Agreement", uri: "https://example.com/a" }],
  economics: {
    original_facility_size: "1200000.5",
    original_senior_tranche: "1000000",
    original_equity_tranche: "200000.5",
    original_offtaker_price: "1250000",
    senior_interest_rate_bps: 1000,
    origination_date: 1781806657,
    original_maturity_date: 1881806657,
  },
  collateral_valuation: {
    valuation_mode: "StandardGoods",
    asset: "XAU",
    price_provider: "coingecko",
    haircut_pct: "0.15",
    quantity_dmt: "620",
  },
  fee_schedule: {
    mgmt_fee_rate_bps: 100,
    perf_fee_rate_bps: 2000,
    oet_alloc_rate_bps: 50,
  },
};

function row(
  overrides: Partial<SubmissionView> = {},
  loanData: unknown = LOAN_DATA,
): SubmissionView {
  return {
    id: 7,
    status: "ChangesRequested",
    reason: "Attach the amended agreement",
    originator: "GABC",
    target_chain_id: 99000001,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    documents: [],
    loan_data: loanData as SubmissionView["loan_data"],
    ...overrides,
  };
}

function mockList(data: SubmissionView[] | undefined, isLoading = false) {
  vi.mocked(useLoanSubmissions).mockReturnValue({
    data,
    isLoading,
    error: null,
    refetch: vi.fn(),
  });
}

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const field = (path: string) =>
  screen.getByTestId(`submit-loan-field-${path}`) as HTMLInputElement;

beforeEach(() => {
  mockNavigate.mockReset();
  mockResubmit.mutateAsync.mockReset();
  mockResubmit.mutateAsync.mockResolvedValue({ id: 7 });
  mockResubmit.reset.mockReset();
  mockResubmit.isPending = false;
  mockResubmit.isSuccess = false;
  mockResubmit.error = null;
  mockLocation.state = {};
  mockList([row()]);
});

describe("origination.$id_.edit (#1913)", () => {
  it("prefills the form from the served loan_data verbatim", () => {
    renderRoute();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Amend and resubmit",
    );
    expect(field("metadata_uri").value).toBe("ipfs://meta");
    expect(field("economics.original_facility_size").value).toBe("1200000.5");
    expect(field("economics.senior_interest_rate_bps").value).toBe("1000");
    expect(field("fee_schedule.perf_fee_rate_bps").value).toBe("2000");
    expect(
      (screen.getByTestId("submit-loan-document-name-0") as HTMLInputElement)
        .value,
    ).toBe("Agreement");
    expect(
      screen.queryByTestId("origination-edit-prefill-warning"),
    ).not.toBeInTheDocument();
  });

  it("shows the trustee reason and the metadata URI banner", () => {
    renderRoute();
    expect(screen.getByTestId("origination-edit-reason")).toHaveTextContent(
      "Attach the amended agreement",
    );
    expect(screen.getByTestId("origination-edit-uri-banner")).toHaveTextContent(
      "You can keep this submission's metadata_uri",
    );
  });

  it("fixes the target chain: disabled, single option, hint", () => {
    renderRoute();
    const select = screen.getByTestId(
      "submit-loan-field-target_chain_id",
    ) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(select.options).toHaveLength(1);
    expect(select.value).toBe("99000001");
    expect(
      screen.getByTestId("submit-loan-field-hint-target_chain_id"),
    ).toHaveTextContent("Fixed at submission");
  });

  it("warns about required fields missing from a legacy row", () => {
    const legacy: Record<string, unknown> = { ...LOAN_DATA };
    delete legacy.data_room_id;
    delete legacy.collateral_valuation;
    delete legacy.fee_schedule;
    mockList([row({}, legacy)]);
    renderRoute();
    const warning = screen.getByTestId("origination-edit-prefill-warning");
    expect(warning).toHaveTextContent("data_room_id");
    expect(warning).toHaveTextContent("collateral_valuation.asset");
  });

  it("blocks submit on a cleared required field", () => {
    renderRoute();
    fireEvent.change(field("originator"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("submit-loan-submit"));
    expect(
      screen.getByTestId("submit-loan-field-error-originator"),
    ).toHaveTextContent("Required.");
    expect(mockResubmit.mutateAsync).not.toHaveBeenCalled();
  });

  it("submits the edited value and navigates to the detail on success", async () => {
    renderRoute();
    fireEvent.change(field("commodity"), { target: { value: "Zinc" } });
    fireEvent.click(screen.getByTestId("submit-loan-submit"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const call = mockResubmit.mutateAsync.mock.calls[0]![0] as {
      id: number;
      input: { commodity: string; metadata_uri: string };
    };
    expect(call.id).toBe(7);
    expect(call.input.commodity).toBe("Zinc");
    expect(call.input.metadata_uri).toBe("ipfs://meta");
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/origination/$id",
      params: { id: "7" },
    });
  });

  it("does not navigate when the API rejects", async () => {
    mockResubmit.mutateAsync.mockRejectedValueOnce(new ApiError("nope", 403));
    renderRoute();
    fireEvent.click(screen.getByTestId("submit-loan-submit"));
    await waitFor(() => expect(mockResubmit.mutateAsync).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(field("commodity").value).toBe("Copper");
  });

  it.each([
    [400, "metadata_uri did not resolve", "metadata_uri did not resolve"],
    [403, "forbidden", "Only the originator can resubmit this loan."],
    [
      404,
      "not found",
      "Only the originator who submitted this loan can resubmit it.",
    ],
    [
      409,
      "metadata_uri `x` is already used by another undrawn submission",
      "This metadata URI is already used by another open submission. Use a unique one.",
    ],
    [
      409,
      "submission 7 is not in ChangesRequested",
      "This submission is no longer awaiting changes. Refresh to see its latest status.",
    ],
  ])("renders the mapped copy inline for %s", (status, served, copy) => {
    mockResubmit.error = new ApiError(served, status);
    renderRoute();
    expect(screen.getByTestId("submit-loan-error")).toHaveTextContent(copy);
  });

  it("keeps user edits when the list refreshes", () => {
    const Page = Route.options.component as React.ComponentType;
    const view = render(<Page />);
    fireEvent.change(field("commodity"), { target: { value: "Zinc" } });
    mockList([row({ updated_at: "2026-01-03T00:00:00Z" })]);
    view.rerender(<Page />);
    expect(field("commodity").value).toBe("Zinc");
  });

  it("shows the not-editable panel for an InReview row", () => {
    mockList([row({ status: "InReview", reason: null })]);
    renderRoute();
    expect(
      screen.getByTestId("origination-edit-not-editable"),
    ).toHaveTextContent("This submission isn't awaiting changes.");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/origination/7");
    expect(screen.queryByTestId("submit-loan-submit")).not.toBeInTheDocument();
  });

  it("shows not-found and loading states", () => {
    mockList([row({ id: 8 })]);
    const first = renderRoute();
    expect(screen.getByTestId("origination-edit-not-found")).toBeVisible();
    first.unmount();
    mockList(undefined, true);
    renderRoute();
    expect(screen.getByTestId("origination-edit-loading")).toBeVisible();
  });
});
