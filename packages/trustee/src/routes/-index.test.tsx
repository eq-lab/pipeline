/**
 * Smoke test for the Trustee Overview route (/), issue #797.
 *
 * #786 shipped a placeholder body; #797 replaces it with the real Overview
 * page (header + Capital Allocation card). Since the route now mounts a
 * component that issues a query, this wraps the render in a
 * `QueryClientProvider` and mocks `apiFetch` so the smoke test stays
 * deterministic and never hits the network.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "./index";

vi.mock("@/api/client", () => ({
  apiFetch: vi.fn().mockResolvedValue({
    total: "115190000.000000",
    buckets: {
      capital_wallet: "8400000.000000",
      in_transit: "4950000.000000",
      trust_account: "1200000.000000",
      deployed: "96000000.000000",
      tbills: "4640000.000000",
    },
  }),
}));

function renderIndex() {
  const IndexPage = Route.options.component as React.ComponentType;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IndexPage />
    </QueryClientProvider>,
  );
}

describe("Trustee Overview route", () => {
  it("renders without throwing", () => {
    expect(() => renderIndex()).not.toThrow();
  });

  it("shows the Overview heading", () => {
    renderIndex();
    expect(
      screen.getByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
  });

  it("mounts the Capital Allocation card", () => {
    renderIndex();
    expect(screen.getByTestId("capital-allocation-card")).toBeInTheDocument();
  });

  it("does not render Cash-in-Transit, Active Deal, or Needs Attention", () => {
    renderIndex();
    expect(screen.queryByText("Cash in Transit")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Deal")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs Attention")).not.toBeInTheDocument();
  });
});
