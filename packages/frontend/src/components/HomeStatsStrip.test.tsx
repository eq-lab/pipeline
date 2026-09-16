/**
 * Unit tests for HomeStatsStrip (Issue #716).
 *
 * The data hooks (`useStakedPlusdConvertToAssets`, `useStats`) are mocked so
 * the component renders without wagmi/AppKit/network. The TanStack Router
 * `Link` is mocked to a plain anchor that surfaces its `to` target as `href`,
 * so we can assert the "Current APY" external-link button navigates to
 * `/dashboard` — the Protocol Dashboard entry point (Figma node `1497:94564`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { HomeStatsStrip } from "./HomeStatsStrip";

// ── Mainnet gate mock (Issue #1243) ──────────────────────────────────────────

const { mockIsMainnet } = vi.hoisted(() => ({
  mockIsMainnet: { value: false },
}));

vi.mock("@/wallet/networkSwitcher", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/wallet/networkSwitcher")>();
  return {
    ...original,
    isMainnetDeployment: () => mockIsMainnet.value,
  };
});

afterEach(() => {
  mockIsMainnet.value = false;
});

vi.mock("@/wallet/evm/useStakedPlusd", () => ({
  useStakedPlusdConvertToAssets: () => ({ data: undefined }),
}));

const { summaryState } = vi.hoisted(() => ({
  summaryState: { data: undefined as { tvl: string } | undefined },
}));

vi.mock("@/api", () => ({
  useStats: () => ({ data: undefined }),
  formatApy: () => "8.42%",
  useDashboardSummary: () => ({ data: summaryState.data }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children: React.ReactNode;
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

describe("HomeStatsStrip", () => {
  it("renders the Current APY external-link as a /dashboard navigation", () => {
    render(<HomeStatsStrip />);
    const link = screen.getByRole("link", { name: "View Protocol Dashboard" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("renders the three stat cells", () => {
    render(<HomeStatsStrip />);
    expect(screen.getByText("Exchange rate")).toBeInTheDocument();
    expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
    expect(screen.getByText("Current APY")).toBeInTheDocument();
  });

  it("renders the served summary.tvl compact-formatted (#1241)", () => {
    summaryState.data = { tvl: "19002000.000000" };
    render(<HomeStatsStrip />);
    expect(screen.getByText("$19.0M")).toBeInTheDocument();
    summaryState.data = undefined;
  });

  it("renders — for TVL while summary is loading/missing (#1241)", () => {
    summaryState.data = undefined;
    render(<HomeStatsStrip />);
    const tvlLabel = screen.getByText("Total Value Locked");
    expect(tvlLabel.parentElement).toHaveTextContent("—");
  });
});

// ── Tests: mainnet dashboard gate (Issue #1243) ──────────────────────────────

describe("HomeStatsStrip — mainnet dashboard gate (#1243)", () => {
  it("hides TVL, Current APY, and the dashboard link on mainnet, keeping Exchange rate", () => {
    mockIsMainnet.value = true;
    render(<HomeStatsStrip />);

    expect(screen.getByText("Exchange rate")).toBeInTheDocument();
    expect(screen.queryByText("Total Value Locked")).not.toBeInTheDocument();
    expect(screen.queryByText("Current APY")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "View Protocol Dashboard" }),
    ).not.toBeInTheDocument();

    expect(screen.getByTestId("home-stats-strip").children).toHaveLength(1);
  });

  it("shows all three stat cells and the dashboard link on testnet", () => {
    render(<HomeStatsStrip />);

    expect(screen.getByText("Exchange rate")).toBeInTheDocument();
    expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
    expect(screen.getByText("Current APY")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View Protocol Dashboard" }),
    ).toBeInTheDocument();
  });
});
