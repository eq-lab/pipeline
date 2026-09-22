import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApiError } from "@/api/client";
import type { LpsResponse } from "@/api/useLps";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/api/useLps", () => ({ useLps: vi.fn() }));
import { useLps } from "@/api/useLps";
import { Route } from "./lp-counterparties.index";
const mockUseLps = vi.mocked(useLps);

const RESPONSE: LpsResponse = {
  lps: [
    {
      id: 2,
      legal_name: "Second LP",
      country: null,
      contact_email: "b@example.com",
      stellar_address: "GSECOND",
      address_linked_at: null,
      kyb_status: "Failed",
      owner_chain_id: 99_000_001,
      owner_address: "GB",
      created_at: "2026-06-20T00:00:00Z",
    },
    {
      id: 1,
      legal_name: "First LP",
      country: "CH",
      contact_email: "a@example.com",
      stellar_address: null,
      address_linked_at: null,
      kyb_status: "NotStarted",
      owner_chain_id: 99_000_001,
      owner_address: "GA",
      created_at: "2026-06-18T00:00:00Z",
    },
  ],
};

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

function ready(data: LpsResponse) {
  mockUseLps.mockReturnValue({
    data,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

beforeEach(() => {
  mockUseLps.mockReset();
  mockNavigate.mockReset();
});

describe("LP Counterparties list route (ready)", () => {
  beforeEach(() => ready(RESPONSE));

  it("renders the LP Counterparties heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "LP Counterparties" }),
    ).toBeInTheDocument();
  });

  it("renders the six column headers and one row per LP, in served order", () => {
    renderRoute();
    for (const header of [
      "Legal Entity Name",
      "Jurisdiction",
      "First Registration Date",
      "Account Status",
      "Blockchain Address Available",
      "Bank Info Available",
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    const rows = screen.getAllByTestId("lp-counterparties-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Second LP");
    expect(rows[1]).toHaveTextContent("First LP");
  });

  it("renders Jurisdiction '—' for a null country, and verbatim for a real one", () => {
    renderRoute();
    const rows = screen.getAllByTestId("lp-counterparties-row");
    expect(rows[0]).toHaveTextContent("—");
    expect(rows[1]).toHaveTextContent("CH");
  });

  it("renders Blockchain Address Available Yes only for a linked stellar_address", () => {
    renderRoute();
    const rows = screen.getAllByTestId("lp-counterparties-row");
    expect(rows[0]).toHaveTextContent("Yes");
    expect(rows[1]).toHaveTextContent("No");
  });

  it("renders Bank Info Available as '—' for every row", () => {
    renderRoute();
    for (const row of screen.getAllByTestId("lp-counterparties-row")) {
      expect(row).toHaveTextContent("—");
    }
  });

  it("renders a Failed LP as 'Rejected' with a negative status band", () => {
    renderRoute();
    const statuses = screen.getAllByTestId("lp-counterparties-status");
    expect(statuses[0]).toHaveTextContent("Rejected");
    expect(statuses[0]).toHaveAttribute("data-band", "negative");
  });

  it("navigates to /lp-counterparties/<id> on row click", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("lp-counterparties-row")[0]!);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/lp-counterparties/$id",
      params: { id: "2" },
    });
  });

  it("navigates on keyboard activation (Enter)", () => {
    renderRoute();
    fireEvent.keyDown(screen.getAllByTestId("lp-counterparties-row")[0]!, {
      key: "Enter",
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/lp-counterparties/$id",
      params: { id: "2" },
    });
  });
});

describe("LP Counterparties list route (empty)", () => {
  it("renders the empty-state message and no rows", () => {
    ready({ lps: [] });
    renderRoute();
    expect(screen.getByTestId("lp-counterparties-empty")).toHaveTextContent(
      "No registered LP counterparties.",
    );
    expect(
      screen.queryByTestId("lp-counterparties-row"),
    ).not.toBeInTheDocument();
  });
});

describe("LP Counterparties list route (loading)", () => {
  it("renders the loading skeleton", () => {
    mockUseLps.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("lp-counterparties-loading")).toBeInTheDocument();
  });
});

describe("LP Counterparties list route (error)", () => {
  it("renders the generic fallback copy for a non-403 error", () => {
    mockUseLps.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("lp-counterparties-error")).toHaveTextContent(
      "Failed to load LP counterparties.",
    );
  });

  it("renders the page-specific authorization copy for a 403, not the shared review-page copy", () => {
    mockUseLps.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError("Forbidden", 403),
      refetch: () => {},
    });
    renderRoute();
    const alert = screen.getByTestId("lp-counterparties-error");
    expect(alert).toHaveTextContent(
      "Your trustee account is not authorized to view LP counterparties.",
    );
    expect(alert).not.toHaveTextContent(
      "You are not authorized to review submissions.",
    );
  });
});
