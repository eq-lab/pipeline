// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WithdrawQueueInfoCard } from "./WithdrawQueueInfoCard";

const COPY =
  "Paid in order. Requests are paid first in, first out. A request can be claimed once the withdrawal custody account holds enough USDC to cover it and every earlier unclaimed request. Until then the claim is refused as too early. Your PLUSD stays in the queue. Nothing is lost.";

describe("WithdrawQueueInfoCard", () => {
  it("always renders the line with a bold lead and a Learn more link button", () => {
    render(<WithdrawQueueInfoCard />);
    const card = screen.getByTestId("withdraw-queue-info");
    expect(card).toHaveTextContent(
      "Paid in order. Requests are paid first in, first out.",
    );
    expect(screen.getByText("Paid in order.").tagName).toBe("STRONG");
    const link = screen.getByRole("button", { name: "Learn more" });
    expect(link).toBe(screen.getByTestId("withdraw-queue-learn-more"));
    expect(link).toHaveAttribute("aria-haspopup", "dialog");
    expect(link).not.toHaveAttribute("aria-expanded");
    expect(link).toHaveClass("underline");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(link).not.toHaveTextContent("→");
    expect(
      screen.queryByTestId("withdraw-queue-modal"),
    ).not.toBeInTheDocument();
  });

  it("opens the modal with the verbatim copy, closes on Escape and restores focus", () => {
    render(<WithdrawQueueInfoCard />);
    const button = screen.getByTestId("withdraw-queue-learn-more");
    button.focus();
    fireEvent.click(button);
    const modal = screen.getByTestId("withdraw-queue-modal");
    expect(modal).toHaveAttribute("role", "dialog");
    expect(modal).toHaveTextContent("Withdrawal queue");
    expect(modal).toHaveTextContent(COPY);
    expect(screen.getByTestId("withdraw-queue-modal-close")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByTestId("withdraw-queue-modal"),
    ).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes from the Close button and the backdrop", () => {
    render(<WithdrawQueueInfoCard />);
    const button = screen.getByTestId("withdraw-queue-learn-more");
    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("withdraw-queue-modal-close"));
    expect(
      screen.queryByTestId("withdraw-queue-modal"),
    ).not.toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("withdraw-queue-modal-backdrop"));
    expect(
      screen.queryByTestId("withdraw-queue-modal"),
    ).not.toBeInTheDocument();
  });
});
