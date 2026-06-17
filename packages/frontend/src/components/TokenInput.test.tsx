/**
 * Unit tests for TokenInput — Issue #595 styling fixes.
 *
 * Covers:
 *   1. Click-to-focus (fix 3b): clicking token-input-row focuses the inner input.
 *   2. Click-to-focus disabled guard: clicking when disabled does not focus.
 *   3. Sign prefix absent when value="0".
 *   4. Sign prefix present for non-zero negative value.
 *   5. No sign prefix at all when signPrefix prop is omitted.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TokenInput } from "@pipeline/ui";

const defaultProps = {
  token: "usdc" as const,
  tokenLabel: "USDC",
  balanceLabel: "5,000.00",
  placeholderValue: "0",
  quickAmounts: [] as { label: string }[],
  inputTestId: "usdc-input",
};

describe("TokenInput — click-to-focus (fix 3b, Issue #595)", () => {
  it("clicking token-input-row focuses the inner input", async () => {
    const user = userEvent.setup();
    render(<TokenInput {...defaultProps} value="" onValueChange={vi.fn()} />);

    const row = screen.getByTestId("token-input-row");
    const input = screen.getByTestId("usdc-input") as HTMLInputElement;

    // Click the row itself (not the input)
    await user.click(row);

    expect(document.activeElement).toBe(input);
  });

  it("clicking when disabled does NOT focus the input", async () => {
    const user = userEvent.setup();
    render(
      <TokenInput
        {...defaultProps}
        value="100"
        onValueChange={vi.fn()}
        disabled
      />,
    );

    const row = screen.getByTestId("token-input-row");
    const input = screen.getByTestId("usdc-input") as HTMLInputElement;

    await user.click(row);

    // Document focus should not be on the disabled input
    expect(document.activeElement).not.toBe(input);
  });
});

describe("TokenInput — sign prefix visibility (fix 3a, Issue #595)", () => {
  it("sign prefix is absent when value='0'", () => {
    render(
      <TokenInput
        {...defaultProps}
        value="0"
        signPrefix="−"
        onValueChange={vi.fn()}
      />,
    );

    // The sign prefix span is aria-hidden, query by text content
    const row = screen.getByTestId("token-input-row");
    expect(row.textContent).not.toContain("−");
  });

  it("sign prefix is absent when value is empty string", () => {
    render(
      <TokenInput
        {...defaultProps}
        value=""
        signPrefix="−"
        onValueChange={vi.fn()}
      />,
    );

    const row = screen.getByTestId("token-input-row");
    expect(row.textContent).not.toContain("−");
  });

  it("sign prefix IS present for a non-zero value", () => {
    render(
      <TokenInput
        {...defaultProps}
        value="500"
        signPrefix="−"
        onValueChange={vi.fn()}
      />,
    );

    const row = screen.getByTestId("token-input-row");
    expect(row.textContent).toContain("−");
  });

  it("no sign prefix rendered when signPrefix prop is omitted entirely", () => {
    render(
      <TokenInput {...defaultProps} value="500" onValueChange={vi.fn()} />,
    );

    const row = screen.getByTestId("token-input-row");
    expect(row.textContent).not.toContain("−");
  });
});
