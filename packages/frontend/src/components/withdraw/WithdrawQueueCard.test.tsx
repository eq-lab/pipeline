// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WithdrawQueueInfo } from "@/wallet";
import { WithdrawQueueCard } from "./WithdrawQueueCard";

const BASE: WithdrawQueueInfo = {
  position: 25_000_000_000n,
  payableNow: true,
  totalQueued: 100_000_000_000n,
  totalClaimed: 40_000_000_000n,
  rateRaw: 1_000_000n,
  rateDecimals: 6,
  recoveryActive: false,
  payout: undefined,
  plusdDecimals: 7,
  usdcDecimals: 7,
};

describe("WithdrawQueueCard", () => {
  it("renders the formatted contract values and the Paid in order copy", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest />);
    expect(screen.getByTestId("withdraw-queue-position")).toHaveTextContent(
      "2,500.00 PLUSD",
    );
    expect(screen.getByTestId("withdraw-queue-payable")).toHaveTextContent(
      "Yes",
    );
    expect(screen.getByTestId("withdraw-queue-total-queued")).toHaveTextContent(
      "10,000.00 PLUSD",
    );
    expect(
      screen.getByTestId("withdraw-queue-total-claimed"),
    ).toHaveTextContent("4,000.00 PLUSD");
    expect(screen.getByTestId("withdraw-queue-copy")).toHaveTextContent(
      "Paid in order. Requests are paid first in, first out.",
    );
  });

  it("keeps the details collapsed by default and toggles them on click", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest />);
    const button = screen.getByTestId("withdraw-queue-learn-more");
    const details = screen.getByTestId("withdraw-queue-details");
    expect(button).toHaveTextContent("Learn more");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", details.id);
    expect(details).not.toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveTextContent("Show less");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(details).toBeVisible();
    expect(details).toHaveTextContent(
      "A request can be claimed once the withdrawal custody account holds enough USDC to cover it and every earlier unclaimed request. Until then the claim is refused as too early. Your PLUSD stays in the queue. Nothing is lost.",
    );

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(details).not.toBeVisible();
  });

  it("renders Not yet when the contract says not payable", () => {
    render(
      <WithdrawQueueCard queue={{ ...BASE, payableNow: false }} hasRequest />,
    );
    expect(screen.getByTestId("withdraw-queue-payable")).toHaveTextContent(
      "Not yet",
    );
  });

  it("renders — for every unavailable value", () => {
    render(<WithdrawQueueCard queue={undefined} hasRequest />);
    expect(screen.getByTestId("withdraw-queue-position")).toHaveTextContent(
      "—",
    );
    expect(screen.getByTestId("withdraw-queue-payable")).toHaveTextContent("—");
    expect(screen.getByTestId("withdraw-queue-total-queued")).toHaveTextContent(
      "—",
    );
    expect(
      screen.getByTestId("withdraw-queue-total-claimed"),
    ).toHaveTextContent("—");
  });

  it("hides the position row without a request", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest={false} />);
    expect(
      screen.queryByTestId("withdraw-queue-position"),
    ).not.toBeInTheDocument();
  });

  it("shows the recovery notice only when the rate is below 1", () => {
    const { rerender } = render(<WithdrawQueueCard queue={BASE} hasRequest />);
    expect(
      screen.queryByTestId("withdraw-recovery-rate-notice"),
    ).not.toBeInTheDocument();

    rerender(
      <WithdrawQueueCard
        queue={{ ...BASE, rateRaw: 950_000n, recoveryActive: true }}
        hasRequest
      />,
    );
    expect(
      screen.getByTestId("withdraw-recovery-rate-notice"),
    ).toHaveTextContent(
      "Recovery rate 0.95. Every claim pays USDC equal to the PLUSD burned times this rate.",
    );
  });
});
