/**
 * Unit tests for HomeStatsStrip (Issue #716).
 *
 * The data hooks (`useStakedPlusdConvertToAssets`, `useStats`) are mocked so
 * the component renders without wagmi/AppKit/network. The TanStack Router
 * `Link` is mocked to a plain anchor that surfaces its `to` target as `href`,
 * so we can assert the "Current APY" external-link button navigates to
 * `/dashboard` — the Protocol Dashboard entry point (Figma node `1497:94564`).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { HomeStatsStrip } from "./HomeStatsStrip";

vi.mock("@/wallet/evm/useStakedPlusd", () => ({
  useStakedPlusdConvertToAssets: () => ({ data: undefined }),
}));

vi.mock("@/api", () => ({
  useStats: () => ({ data: undefined }),
  formatApy: () => "8.42%",
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
});
