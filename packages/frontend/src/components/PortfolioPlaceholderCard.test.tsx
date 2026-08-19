/** Tests for PortfolioPlaceholderCard — header states + the honest empty chart region (#1114). */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { PortfolioPlaceholderCard } from "./PortfolioPlaceholderCard";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

function renderCard() {
  return render(<PortfolioPlaceholderCard />);
}

describe("PortfolioPlaceholderCard — header", () => {
  it("renders without throwing", () => {
    expect(() => renderCard()).not.toThrow();
  });

  it("shows 'Total Balance' eyebrow label", () => {
    renderCard();
    expect(screen.getByText("Total Balance")).toBeInTheDocument();
  });

  it("shows '$0.00' balance and labels the card region with it", () => {
    renderCard();
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });

  it("shows 'Get PLUSD to start' link pointing to /deposit", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "Get PLUSD to start" });
    expect(link).toHaveAttribute("href", "/deposit");
  });

  it("shows '$0.00 unrealized' caption by default", () => {
    renderCard();
    expect(screen.getByTestId("earning-caption")).toHaveTextContent(
      "$0.00 unrealized",
    );
  });

  it("renders provided sPLUSD balance as the main heading and no duplicate sublabel", () => {
    render(
      <PortfolioPlaceholderCard
        balanceLabel="1,000.00 sPLUSD"
        unrealizedPnlLabel="+$42.80 unrealized"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "1,000.00 sPLUSD" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("splusd-balance-caption"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("earning-caption")).toHaveTextContent(
      "+$42.80 unrealized",
    );
  });

  it("shows the stake CTA for the plusd state and none for splusd", () => {
    const { rerender } = render(
      <PortfolioPlaceholderCard mobileHomeState="plusd" />,
    );
    expect(
      screen.getByRole("link", { name: "Stake PLUSD to start earning" }),
    ).toHaveAttribute("href", "/stake");
    rerender(<PortfolioPlaceholderCard mobileHomeState="splusd" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("PortfolioPlaceholderCard — chart region (#1114 honest empty state)", () => {
  it("renders the empty-state note instead of any chart", () => {
    renderCard();
    expect(screen.getByTestId("balance-history-empty")).toHaveTextContent(
      "Balance history will appear here once it's tracked.",
    );
    const { container } = renderCard();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("[data-bar-slot]")).toBeNull();
  });

  it("renders no period tabs and no tooltip", () => {
    renderCard();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart-tooltip")).not.toBeInTheDocument();
  });
});

describe("PortfolioPlaceholderCard — responsive header layout", () => {
  it("header wrapper has mobile-stacked and md-row responsive classes", () => {
    const { container } = renderCard();
    const wrapper = container.querySelector(
      "[data-node-id='1497:95048'] > div:first-child",
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain("flex-col");
    expect(wrapper.className).toContain("items-start");
    expect(wrapper.className).toContain("md:flex-row");
    expect(wrapper.className).toContain("md:justify-between");
  });
});
