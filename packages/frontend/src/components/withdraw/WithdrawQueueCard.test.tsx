// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { WithdrawQueueInfo } from "@/wallet";
import { WithdrawQueueCard } from "./WithdrawQueueCard";

const BASE: WithdrawQueueInfo = {
  requestAmount: 12_500_000_000n,
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
  it("renders two plain blocks with a 2px seam, info then position, with plain rows", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest />);
    const card = screen.getByTestId("withdraw-queue-card");
    expect(card).toHaveClass("flex", "flex-col", "gap-[2px]");
    const infoBlock = within(card).getByTestId("withdraw-queue-info-block");
    const positionBlock = within(card).getByTestId(
      "withdraw-queue-position-block",
    );
    expect(infoBlock).toHaveAttribute("data-variant", "plain");
    expect(positionBlock).toHaveAttribute("data-variant", "plain");
    expect(card.children).toHaveLength(2);
    expect(infoBlock).toContainElement(
      within(card).getByTestId("withdraw-queue-info"),
    );
    expect(positionBlock).toContainElement(
      within(card).getByTestId("withdraw-queue-position"),
    );
    expect(within(card).getByTestId("withdraw-queue-info")).toBeInTheDocument();
    expect(
      within(card).getByTestId("withdraw-queue-learn-more"),
    ).toBeInTheDocument();
    const row = within(card).getByTestId("withdraw-queue-request");
    expect(row).toHaveTextContent("Your request");
    expect(row).toHaveTextContent("Your request1,250.00 PLUSD");
    expect(row.querySelector("strong")).toBeNull();
    const position = within(card).getByTestId("withdraw-queue-position");
    expect(position).toHaveTextContent("Queue position2,500.00 PLUSD");
    expect(position.querySelector("strong")).toBeNull();
    expect(
      within(card).queryByTestId("withdraw-queue-status"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByTestId("withdraw-queue-request-status"),
    ).not.toBeInTheDocument();
    expect(row.compareDocumentPosition(position)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders — in both rows while the reads are unavailable", () => {
    render(<WithdrawQueueCard queue={undefined} hasRequest />);
    expect(screen.getByTestId("withdraw-queue-request")).toHaveTextContent(
      "Your request—",
    );
    expect(screen.getByTestId("withdraw-queue-position")).toHaveTextContent(
      "Queue position—",
    );
  });

  it("keeps one info block but renders no position block or rows without a request", () => {
    render(<WithdrawQueueCard queue={BASE} hasRequest={false} />);
    expect(screen.getByTestId("withdraw-queue-card").children).toHaveLength(1);
    expect(screen.getByTestId("withdraw-queue-info-block")).toHaveAttribute(
      "data-variant",
      "plain",
    );
    expect(
      screen.queryByTestId("withdraw-queue-position-block"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("withdraw-queue-info")).toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-request"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("withdraw-queue-position"),
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
