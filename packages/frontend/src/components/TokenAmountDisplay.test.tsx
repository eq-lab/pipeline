/**
 * Unit tests for TokenAmountDisplay — Issue #595 styling fixes.
 *
 * Asserts fix 6:
 *   - No horizontal padding class (px-2 removed)
 *   - pb-8 bottom spacing class present
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TokenAmountDisplay } from "@pipeline/ui";

const defaultProps = {
  token: "plusd" as const,
  tokenLabel: "PLUSD",
  balanceLabel: "0.00",
  value: "0",
};

describe("TokenAmountDisplay — padding (fix 6, Issue #595)", () => {
  it("does NOT have a horizontal padding class (px-2)", () => {
    const { getByTestId } = render(<TokenAmountDisplay {...defaultProps} />);
    const root = getByTestId("token-amount-display");
    expect(root.className).not.toContain("px-2");
  });

  it("has bottom spacing class pb-8", () => {
    const { getByTestId } = render(<TokenAmountDisplay {...defaultProps} />);
    const root = getByTestId("token-amount-display");
    expect(root.className).toContain("pb-8");
  });
});
