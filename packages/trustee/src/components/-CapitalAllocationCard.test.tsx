/**
 * Tests for `CapitalAllocationCard` (issue #797).
 *
 * The `useCapitalAllocationCard` hook is mocked so these are pure render
 * tests with no network / QueryClient involved.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CapitalAllocationCard } from "./CapitalAllocationCard";
import * as hookModule from "./useCapitalAllocationCard";
import type { UseCapitalAllocationCardResult } from "./useCapitalAllocationCard";

function mockHook(overrides: Partial<UseCapitalAllocationCardResult>) {
  const base: UseCapitalAllocationCardResult = {
    isLoading: false,
    isError: false,
    errorMessage: null,
    totalDisplay: "—",
    legend: [
      {
        key: "capital_wallet",
        label: "Capital Wallet",
        value: "—",
        color: "var(--color-pipeline-brand)",
      },
      { key: "in_transit", label: "In transit", value: "—", color: "#c9a200" },
      {
        key: "trust_account",
        label: "Trust account",
        value: "—",
        color: "rgba(56, 55, 53, 0.35)",
      },
      {
        key: "deployed",
        label: "Deployed",
        value: "—",
        color: "var(--color-pipeline-positive-primary)",
      },
      { key: "tbills", label: "T-Bills (USYC)", value: "—", color: "#6666b3" },
    ],
  };
  vi.spyOn(hookModule, "useCapitalAllocationCard").mockReturnValue({
    ...base,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CapitalAllocationCard", () => {
  it("renders the formatted total and all five legend values with full data", () => {
    mockHook({
      totalDisplay: "$115,190,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "$8.4M",
          color: "var(--color-pipeline-brand)",
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "$4.95M",
          color: "#c9a200",
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "$1.2M",
          color: "rgba(56, 55, 53, 0.35)",
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "$4.64M",
          color: "#6666b3",
        },
      ],
    });

    render(<CapitalAllocationCard />);

    expect(screen.getByText("$115,190,000")).toBeInTheDocument();
    expect(screen.getByText("Capital Wallet $8.4M")).toBeInTheDocument();
    expect(screen.getByText("In transit $4.95M")).toBeInTheDocument();
    expect(screen.getByText("Trust account $1.2M")).toBeInTheDocument();
    expect(screen.getByText("Deployed $96M")).toBeInTheDocument();
    expect(screen.getByText("T-Bills (USYC) $4.64M")).toBeInTheDocument();
  });

  it("renders em-dash for null buckets (partial/deployed-only data)", () => {
    mockHook({
      totalDisplay: "$96,000,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "—",
          color: "var(--color-pipeline-brand)",
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "—",
          color: "#c9a200",
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "—",
          color: "rgba(56, 55, 53, 0.35)",
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "—",
          color: "#6666b3",
        },
      ],
    });

    render(<CapitalAllocationCard />);

    expect(screen.getByText("Capital Wallet —")).toBeInTheDocument();
    expect(screen.getByText("In transit —")).toBeInTheDocument();
    expect(screen.getByText("Trust account —")).toBeInTheDocument();
    expect(screen.getByText("Deployed $96M")).toBeInTheDocument();
    expect(screen.getByText("T-Bills (USYC) —")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    mockHook({ isLoading: true });

    render(<CapitalAllocationCard />);

    expect(
      screen.getByTestId("capital-allocation-skeleton"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Capital Wallet")).not.toBeInTheDocument();
  });

  it("shows an inline error surface on error", () => {
    mockHook({ isError: true, errorMessage: "Network error" });

    render(<CapitalAllocationCard />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("does not render any percentage labels", () => {
    mockHook({
      totalDisplay: "$115,190,000",
      legend: [
        {
          key: "capital_wallet",
          label: "Capital Wallet",
          value: "$8.4M",
          color: "var(--color-pipeline-brand)",
        },
        {
          key: "in_transit",
          label: "In transit",
          value: "$4.95M",
          color: "#c9a200",
        },
        {
          key: "trust_account",
          label: "Trust account",
          value: "$1.2M",
          color: "rgba(56, 55, 53, 0.35)",
        },
        {
          key: "deployed",
          label: "Deployed",
          value: "$96M",
          color: "var(--color-pipeline-positive-primary)",
        },
        {
          key: "tbills",
          label: "T-Bills (USYC)",
          value: "$4.64M",
          color: "#6666b3",
        },
      ],
    });

    const { container } = render(<CapitalAllocationCard />);

    expect(container.textContent).not.toMatch(/%/);
  });
});
