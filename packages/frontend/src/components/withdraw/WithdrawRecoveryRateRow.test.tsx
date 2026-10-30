// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WithdrawRecoveryRateRow } from "./WithdrawRecoveryRateRow";
import { formatRecoveryRate } from "./recoveryRate";

const COPY =
  "The protocol administrator can set a recovery rate below 1 on the withdrawal queue, once. After that, every claim pays USDC equal to the PLUSD burned times that rate. The rate applies to every claim made after it is set, whatever the request date. It cannot be changed afterwards.";

describe("WithdrawRecoveryRateRow", () => {
  it("renders the rate verbatim with a warning icon button", () => {
    render(<WithdrawRecoveryRateRow rate="0.85" />);
    const row = screen.getByTestId("withdraw-recovery-rate");
    expect(row).toHaveTextContent("Recovery rate");
    expect(row).toHaveTextContent("0.85");
    const button = screen.getByTestId("withdraw-recovery-rate-info");
    expect(button).toBe(
      screen.getByRole("button", { name: "About the recovery rate" }),
    );
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveClass("text-[color:var(--color-pipeline-warning)]");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.queryByTestId("withdraw-recovery-rate-modal"),
    ).not.toBeInTheDocument();
  });

  it("opens the modal with the verbatim copy, closes on Escape and restores focus", () => {
    render(<WithdrawRecoveryRateRow rate="0.85" />);
    const button = screen.getByTestId("withdraw-recovery-rate-info");
    button.focus();
    fireEvent.click(button);
    const modal = screen.getByTestId("withdraw-recovery-rate-modal");
    expect(modal).toHaveAttribute("role", "dialog");
    expect(modal).toHaveTextContent("Recovery rate");
    expect(modal).toHaveTextContent(COPY);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByTestId("withdraw-recovery-rate-modal"),
    ).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});

describe("formatRecoveryRate", () => {
  const base = {
    rateRaw: 850_000n,
    rateDecimals: 6,
    recoveryActive: true,
    plusdDecimals: 6,
    usdcDecimals: 6,
    position: undefined,
    payableNow: undefined,
    payout: undefined,
  };
  it("formats the rate only when recovery is active and the rate is known", () => {
    expect(formatRecoveryRate(base)).toBe("0.85");
    expect(
      formatRecoveryRate({ ...base, recoveryActive: false }),
    ).toBeUndefined();
    expect(formatRecoveryRate({ ...base, rateRaw: undefined })).toBeUndefined();
    expect(formatRecoveryRate(undefined)).toBeUndefined();
  });
});
