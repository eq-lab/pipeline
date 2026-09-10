import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskBanner, RISK_BANNER_TEXT } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#riskbanner (#1231).

describe("RiskBanner", () => {
  it("renders the exact risk-disclosure copy", () => {
    render(<RiskBanner />);
    expect(screen.getByTestId("risk-banner")).toHaveTextContent(
      "You are using an unaudited version of smart contracts and should acknowledge related risks",
    );
    expect(RISK_BANNER_TEXT).toBe(
      "You are using an unaudited version of smart contracts and should acknowledge related risks",
    );
  });

  it("is a plain note with no dismiss affordance", () => {
    render(<RiskBanner />);
    const banner = screen.getByRole("note");
    expect(banner).toBe(screen.getByTestId("risk-banner"));
    expect(banner.querySelector("button")).toBeNull();
  });
});
