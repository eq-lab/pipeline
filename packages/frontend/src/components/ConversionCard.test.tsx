/**
 * Unit tests for ConversionCard — focused on the swap button introduced in #359.
 *
 * Cases:
 *   1. Renders the swap button with the "Switch direction" accessible name.
 *   2. Click fires the onSwap callback.
 *   3. Button is disabled when `input.disabled` is true.
 *   4. Omitting `onSwap` disables the button.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversionCard } from "@pipeline/ui";

// ── Shared minimal props ──────────────────────────────────────────────────────

const inputProps = {
  token: "usdc" as const,
  tokenLabel: "USDC",
  balanceLabel: "1,000.00",
  placeholderValue: "0",
  value: "",
  onValueChange: vi.fn(),
  quickAmounts: [] as { label: string; disabled?: boolean }[],
};

const outputProps = {
  token: "plusd" as const,
  tokenLabel: "PLUSD",
  balanceLabel: "0.00",
  value: "0",
};

function renderCard(
  overrides: Partial<React.ComponentProps<typeof ConversionCard>> = {},
) {
  return render(
    <ConversionCard
      input={inputProps}
      output={outputProps}
      exchangeRate="1 USDC = 1 PLUSD"
      networkFee="—"
      {...overrides}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ConversionCard — swap button", () => {
  it("renders the swap button with the Switch direction accessible name", () => {
    const onSwap = vi.fn();
    renderCard({ onSwap });
    expect(
      screen.getByRole("button", { name: "Switch direction" }),
    ).toBeInTheDocument();
  });

  it("click fires onSwap", async () => {
    const user = userEvent.setup();
    const onSwap = vi.fn();
    renderCard({ onSwap });

    const btn = screen.getByRole("button", { name: "Switch direction" });
    await user.click(btn);

    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it("button is disabled when input disabled is true", async () => {
    const user = userEvent.setup();
    const onSwap = vi.fn();
    renderCard({ onSwap, input: { ...inputProps, disabled: true } });

    const btn = screen.getByRole("button", { name: "Switch direction" });
    expect(btn).toBeDisabled();

    await user.click(btn);
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("button is disabled when onSwap is omitted", () => {
    renderCard({}); // no onSwap
    const btn = screen.getByRole("button", { name: "Switch direction" });
    expect(btn).toBeDisabled();
  });
});
