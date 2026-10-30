// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WithdrawQueueInfo } from "@/wallet";
import { WithdrawQueueCard } from "./WithdrawQueueCard";

const BASE: WithdrawQueueInfo = {
  position: 25_000_000_000n,
  payableNow: true,
  rateRaw: 1_000_000n,
  rateDecimals: 6,
  recoveryActive: false,
  payout: undefined,
  plusdDecimals: 7,
  usdcDecimals: 7,
};

describe("WithdrawQueueCard", () => {
  it("renders the green payable tone as one row with a bold position", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest />);
    const card = screen.getByTestId("withdraw-queue-card");
    expect(card).toHaveAttribute("data-tone", "payable");
    expect(card).toHaveAttribute("data-variant", "positive");
    expect(screen.getByTestId("withdraw-queue-payable")).toHaveTextContent(
      "Payable now",
    );
    expect(screen.getByTestId("withdraw-queue-position")).toHaveTextContent(
      "2,500.00 PLUSD",
    );
    expect(card).toHaveTextContent("Payable now");
    expect(card).toHaveTextContent("Your position");
    expect(screen.getByTestId("withdraw-queue-position").tagName).toBe(
      "STRONG",
    );
    expect(screen.queryByText(/Paid in order/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-learn-more"),
    ).not.toBeInTheDocument();
  });

  it("renders the yellow waiting tone when the contract says not payable", () => {
    render(
      <WithdrawQueueCard queue={{ ...BASE, payableNow: false }} hasRequest />,
    );
    const card = screen.getByTestId("withdraw-queue-card");
    expect(card).toHaveAttribute("data-tone", "waiting");
    expect(card).toHaveAttribute("data-variant", "yellow");
    expect(screen.getByTestId("withdraw-queue-payable")).toHaveTextContent(
      "Not payable yet",
    );
  });

  it("renders the white unknown tone with — while the reads are unavailable", () => {
    render(<WithdrawQueueCard queue={undefined} hasRequest />);
    const card = screen.getByTestId("withdraw-queue-card");
    expect(card).toHaveAttribute("data-tone", "unknown");
    expect(card).toHaveAttribute("data-variant", "white");
    expect(screen.getByTestId("withdraw-queue-payable")).toHaveTextContent("—");
    expect(screen.getByTestId("withdraw-queue-position")).toHaveTextContent(
      "—",
    );
  });

  it("renders nothing without a request and never shows the queue totals", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest={false} />);
    expect(screen.queryByTestId("withdraw-queue-card")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-total-queued"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-total-claimed"),
    ).not.toBeInTheDocument();
  });

  it("shows the recovery notice without a request when the rate is below 1", () => {
    render(
      <WithdrawQueueCard
        queue={{ ...BASE, rateRaw: 950_000n, recoveryActive: true }}
        hasRequest={false}
      />,
    );
    expect(
      screen.getByTestId("withdraw-recovery-rate-notice"),
    ).toBeInTheDocument();
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
