/** Render tests for origination.new.tsx (#1100). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockNavigate, mockSubmit } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSubmit: {
    mutate: vi.fn(),
    mutateAsync: vi.fn((_input: unknown) => Promise.resolve({ id: 42 })),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({
      children,
      to,
      ...rest
    }: { children: React.ReactNode; to: string } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/api/useSubmitLoan", async () => {
  const actual = await vi.importActual<typeof import("@/api/useSubmitLoan")>(
    "@/api/useSubmitLoan",
  );
  return { ...actual, useSubmitLoan: () => mockSubmit };
});

import { Route } from "./origination.new";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const EXAMPLE_JSON = JSON.stringify({
  to: "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
  metadata_uri: "https://example.com/ipfs/QmeaPY",
  originator: "Alan Walkovitz",
  borrower_id: "Open Mineral",
  commodity: "Jet fuel JET A-1",
  corridor: "South Korea → Mongolia",
  governing_law: "English law, LCIA London",
  protection: "LC at sight",
  documents: [{ name: "Agreement", uri: "https://example.com/ipfs/QmPm7z" }],
  economics: {
    original_facility_size: "1200000.000000",
    original_senior_tranche: "1000000.000000",
    original_equity_tranche: "200000.000000",
    original_offtaker_price: "1200000.000000",
    senior_interest_rate_bps: 1000,
    origination_date: 1781806657,
    original_maturity_date: 1881806657,
  },
  initial_ccr: 1500000,
  initial_location: {
    location_type: "Vessel",
    location_identifier: "IMO 9834521",
    tracking_url: "https://track.example.com/IMO9834521",
    updated_at: 1781806657,
  },
});

function importJson(text: string) {
  fireEvent.click(screen.getByTestId("submit-loan-import-open"));
  fireEvent.change(screen.getByTestId("import-json-input"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId("import-json-submit"));
}

function fillMissingBlocks() {
  const remaining: Record<string, string> = {
    "collateral_valuation.valuation_mode": "MetalConcentrate",
    "collateral_valuation.asset": "XAU",
    "collateral_valuation.price_provider": "coingecko",
    "collateral_valuation.haircut_pct": "0.15",
    "collateral_valuation.quantity_dmt": "620",
    "fee_schedule.mgmt_fee_rate_bps": "100",
    "fee_schedule.perf_fee_rate_bps": "2000",
    "fee_schedule.oet_alloc_rate_bps": "50",
  };
  for (const [path, value] of Object.entries(remaining)) {
    fireEvent.change(screen.getByTestId(`submit-loan-field-${path}`), {
      target: { value },
    });
  }
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockSubmit.mutateAsync = vi.fn((_input: unknown) =>
    Promise.resolve({ id: 42 }),
  );
  mockSubmit.reset = vi.fn();
  mockSubmit.isPending = false;
  mockSubmit.error = null;
});

describe("Submit a loan page — shell", () => {
  it("renders the heading, back link, unique-URI banner, all sections, and the actions", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Submit a loan" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "‹ Origination" })).toHaveAttribute(
      "href",
      "/origination",
    );
    expect(screen.getByTestId("submit-loan-uri-banner")).toHaveTextContent(
      "unique",
    );
    for (const section of [
      "Loan & metadata",
      "Economics",
      "Collateral",
      "Collateral valuation",
      "Fee schedule",
      "Documents",
    ]) {
      expect(
        screen.getByTestId(`submit-loan-section-${section}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId("submit-loan-import-open")).toBeInTheDocument();
    expect(screen.getByTestId("submit-loan-submit")).toBeEnabled();
  });
});

describe("Submit a loan page — Import from JSON", () => {
  it("autofills matching fields, closes the dialog, and warns about the missing required blocks", () => {
    renderRoute();
    importJson(EXAMPLE_JSON);

    expect(screen.queryByTestId("import-json-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("submit-loan-field-to")).toHaveValue(
      "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
    );
    expect(
      screen.getByTestId("submit-loan-field-economics.original_facility_size"),
    ).toHaveValue("1200000.000000");
    expect(screen.getByTestId("submit-loan-document-name-0")).toHaveValue(
      "Agreement",
    );

    const warning = screen.getByTestId("submit-loan-import-warning");
    expect(warning).toHaveTextContent("collateral_valuation.valuation_mode");
    expect(warning).toHaveTextContent("fee_schedule.oet_alloc_rate_bps");
  });

  it("REPLACES previously filled fields — a field missing from the new payload is cleared, matching the warning", () => {
    renderRoute();
    fireEvent.change(
      screen.getByTestId("submit-loan-field-collateral_valuation.asset"),
      { target: { value: "XAU" } },
    );
    fireEvent.change(screen.getByTestId("submit-loan-field-commodity"), {
      target: { value: "Old commodity" },
    });
    fireEvent.click(screen.getByTestId("submit-loan-document-add"));

    importJson(EXAMPLE_JSON);

    expect(
      screen.getByTestId("submit-loan-field-collateral_valuation.asset"),
    ).toHaveValue("");
    expect(screen.getByTestId("submit-loan-field-commodity")).toHaveValue(
      "Jet fuel JET A-1",
    );
    expect(screen.getByTestId("submit-loan-document-name-0")).toHaveValue(
      "Agreement",
    );
    expect(
      screen.queryByTestId("submit-loan-document-name-1"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("submit-loan-import-warning")).toHaveTextContent(
      "collateral_valuation.asset",
    );
  });

  it("keeps the dialog open with a parse error on malformed JSON and touches nothing", () => {
    renderRoute();
    importJson("{ nope");

    expect(screen.getByTestId("import-json-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("import-json-error")).toHaveTextContent(
      "Not valid JSON",
    );
    expect(screen.getByTestId("submit-loan-field-to")).toHaveValue("");
    expect(
      screen.queryByTestId("submit-loan-import-warning"),
    ).not.toBeInTheDocument();
  });

  it("shows no warning when the payload is complete", () => {
    renderRoute();
    const complete = JSON.parse(EXAMPLE_JSON) as Record<string, unknown>;
    complete.collateral_valuation = {
      valuation_mode: "MetalConcentrate",
      asset: "XAU",
      price_provider: "coingecko",
      haircut_pct: "0.15",
      quantity_dmt: "620",
    };
    complete.fee_schedule = {
      mgmt_fee_rate_bps: 100,
      perf_fee_rate_bps: 2000,
      oet_alloc_rate_bps: 50,
    };
    importJson(JSON.stringify(complete));
    expect(
      screen.queryByTestId("submit-loan-import-warning"),
    ).not.toBeInTheDocument();
  });
});

describe("Submit a loan page — validation + submit", () => {
  it("blocks submit on an empty form with field errors and no API call", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("submit-loan-submit"));

    expect(mockSubmit.mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("submit-loan-validation-summary"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("submit-loan-field-error-to")).toHaveTextContent(
      "Required.",
    );
  });

  it("submits the built payload and navigates back to /origination on success", async () => {
    renderRoute();
    importJson(EXAMPLE_JSON);
    fillMissingBlocks();
    fireEvent.click(screen.getByTestId("submit-loan-submit"));

    expect(mockSubmit.mutateAsync).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(mockSubmit.mutateAsync).mock.calls[0]![0];
    expect(payload).toMatchObject({
      to: "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
      protection: "LC at sight",
      initial_ccr: 1500000,
      economics: {
        original_facility_size: "1200000.000000",
        senior_interest_rate_bps: 1000,
      },
      collateral_valuation: { haircut_pct: "0.15", quantity_dmt: "620" },
      fee_schedule: { mgmt_fee_rate_bps: 100, oet_alloc_rate_bps: 50 },
      documents: [
        { name: "Agreement", uri: "https://example.com/ipfs/QmPm7z" },
      ],
    });

    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/origination" }),
    );
  });

  it("surfaces the API rejection via InlineError and stays on the page", async () => {
    mockSubmit.mutateAsync = vi.fn((_input: unknown) =>
      Promise.reject(new Error("duplicate metadata_uri")),
    );
    mockSubmit.error = new Error("duplicate metadata_uri");
    renderRoute();
    importJson(EXAMPLE_JSON);
    fillMissingBlocks();
    fireEvent.click(screen.getByTestId("submit-loan-submit"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("submit-loan-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("submit-loan-error")).toHaveTextContent(
      "Failed to submit the loan.",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Submit a loan page — documents", () => {
  it("adds and removes document rows", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("submit-loan-document-add"));
    fireEvent.change(screen.getByTestId("submit-loan-document-name-0"), {
      target: { value: "Agreement" },
    });
    expect(screen.getByTestId("submit-loan-document-name-0")).toHaveValue(
      "Agreement",
    );
    fireEvent.click(screen.getByTestId("submit-loan-document-remove-0"));
    expect(
      screen.queryByTestId("submit-loan-document-name-0"),
    ).not.toBeInTheDocument();
  });
});
