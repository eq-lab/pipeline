/**
 * Smoke test for the Type 3 (RISK_COUNCIL proposals) placeholder route.
 * No data, no wallet — just heading + description text (Issue #777 scaffold).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./type3-council";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Type 3 — RISK_COUNCIL proposals route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Type 3 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Type 3 — RISK_COUNCIL proposals",
      }),
    ).toBeInTheDocument();
  });

  it("shows a one-line description", () => {
    renderRoute();
    expect(
      screen.getByText(/Proposal builder plus timelock tracker/),
    ).toBeInTheDocument();
  });
});
