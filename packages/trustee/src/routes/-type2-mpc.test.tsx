/**
 * Smoke test for the Type 2 (Capital Wallet MPC co-signature) placeholder
 * route. No data, no wallet — just heading + description text (Issue #777
 * scaffold).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./type2-mpc";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Type 2 — Capital Wallet MPC co-signature route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Type 2 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Type 2 — Capital Wallet MPC co-signature",
      }),
    ).toBeInTheDocument();
  });

  it("shows a one-line description", () => {
    renderRoute();
    expect(
      screen.getByText(/Assemble the request, Trustee co-signs/),
    ).toBeInTheDocument();
  });
});
