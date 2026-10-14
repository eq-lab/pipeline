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
  chainState.value = { kind: "stellar", chainId: 99_000_001 };
  rateState.evm = undefined;
  rateState.stellar = undefined;
  statsSpy.mockClear();
  summarySpy.mockClear();
});

const { chainState, rateState, summaryState, statsSpy, summarySpy } =
  vi.hoisted(() => ({
    chainState: {
      value: { kind: "stellar", chainId: 99_000_001 } as {
        kind: "evm" | "stellar";
        chainId: number;
      },
    },
    rateState: {
      evm: undefined as bigint | undefined,
      stellar: undefined as bigint | undefined,
    },
    summaryState: { data: undefined as { tvl: string } | undefined },
    statsSpy: vi.fn(),
    summarySpy: vi.fn(),
  }));

vi.mock("@/wallet/useActiveChain", () => ({
  useActiveChain: () => chainState.value,
}));

vi.mock("@/wallet/evm/useStakedPlusd", () => ({
  useStakedPlusdConvertToAssets: () => ({ data: rateState.evm }),
}));

vi.mock("@/wallet/stellar/useStellarStakedPlusd", () => ({
  useStellarUnstakeConvertToAssets: () => ({ data: rateState.stellar }),
}));

vi.mock("@/api", () => ({
  useStats: (args: unknown) => {
    statsSpy(args);
    return { data: undefined };
  },
  formatApy: () => "8.42%",
  useDashboardSummary: (args: unknown) => {
    summarySpy(args);
    return { data: summaryState.data };
  },
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

describe("HomeStatsStrip — active chain", () => {
  it("formats the EVM rate at 18 dp", () => {
    chainState.value = { kind: "evm", chainId: 560048 };
    rateState.evm = 1042100000000000000n;
    render(<HomeStatsStrip />);
    expect(screen.getByText("1 sPLUSD = 1.0421 PLUSD")).toBeInTheDocument();
  });

  it("formats the Stellar rate at 7 dp", () => {
    rateState.stellar = 10400000n;
    render(<HomeStatsStrip />);
    expect(screen.getByText("1 sPLUSD = 1.0400 PLUSD")).toBeInTheDocument();
  });

  it("truncates instead of rounding", () => {
    chainState.value = { kind: "evm", chainId: 560048 };
    rateState.evm = 1042199999999999999n;
    render(<HomeStatsStrip />);
    expect(screen.getByText("1 sPLUSD = 1.0421 PLUSD")).toBeInTheDocument();
  });

  it("ignores the other chain's rate", () => {
    rateState.evm = 1042100000000000000n;
    render(<HomeStatsStrip />);
    const label = screen.getByText("Exchange rate");
    expect(label.parentElement).toHaveTextContent("—");
  });

  it("passes the active chainId to useStats and useDashboardSummary", () => {
    chainState.value = { kind: "evm", chainId: 560048 };
    render(<HomeStatsStrip />);
    expect(statsSpy).toHaveBeenCalledWith({ chainId: 560048 });
    expect(summarySpy).toHaveBeenCalledWith({ chainId: 560048 });
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
