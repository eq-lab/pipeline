// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  it("renders one white block with the info row and, with a request, a position row and a payable chip", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest />);
    const card = screen.getByTestId("withdraw-queue-card");
    expect(card).toHaveAttribute("data-variant", "white");
    expect(within(card).getByTestId("withdraw-queue-info")).toBeInTheDocument();
    expect(
      within(card).getByTestId("withdraw-queue-learn-more"),
    ).toBeInTheDocument();
    const row = within(card).getByTestId("withdraw-queue-position");
    expect(row).toHaveTextContent("Your position");
    const amount = within(row).getByText("2,500.00 PLUSD");
    expect(amount.tagName).toBe("STRONG");
    expect(amount).toHaveClass("font-[var(--font-weight-emphasized)]");
    const chip = within(row).getByTestId("withdraw-queue-status");
    expect(chip).toHaveAttribute("data-tone", "positive");
    expect(chip).toHaveTextContent("Payable now");
    expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the pending chip when the contract says not payable", () => {
    render(
      <WithdrawQueueCard queue={{ ...BASE, payableNow: false }} hasRequest />,
    );
    const chip = screen.getByTestId("withdraw-queue-status");
    expect(chip).toHaveAttribute("data-tone", "pending");
    expect(chip).toHaveTextContent("Not payable yet");
  });

  it("renders the neutral chip and — while the reads are unavailable", () => {
    render(<WithdrawQueueCard queue={undefined} hasRequest />);
    const chip = screen.getByTestId("withdraw-queue-status");
    expect(chip).toHaveAttribute("data-tone", "neutral");
    expect(chip).toHaveTextContent("—");
    expect(screen.getByTestId("withdraw-queue-position")).toHaveTextContent(
      "Your position—",
    );
  });

  it("keeps the info row but renders no position row or chip without a request", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest={false} />);
    expect(screen.getByTestId("withdraw-queue-card")).toBeInTheDocument();
    expect(screen.getByTestId("withdraw-queue-info")).toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-position"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-status"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-total-queued"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-total-claimed"),
    ).not.toBeInTheDocument();
  });

  it("renders no recovery notice, even when the rate is below 1", () => {
    render(
      <WithdrawQueueCard
        queue={{ ...BASE, rateRaw: 950_000n, recoveryActive: true }}
        hasRequest
      />,
    );
    expect(
      screen.queryByTestId("withdraw-recovery-rate-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-recovery-rate"),
    ).not.toBeInTheDocument();
  });
});
