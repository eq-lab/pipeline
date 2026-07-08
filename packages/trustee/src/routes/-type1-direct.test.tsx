/**
 * Smoke test for the Type 1 (Direct Trustee-key writes) placeholder route.
 * No data, no wallet — just heading + description text (Issue #777 scaffold).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./type1-direct";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Type 1 — Direct Trustee-key writes route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Type 1 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Type 1 — Direct Trustee-key writes",
      }),
    ).toBeInTheDocument();
  });

  it("shows a one-line description", () => {
    renderRoute();
    expect(
      screen.getByText(/One-click broadcast after decoded-calldata review/),
    ).toBeInTheDocument();
  });
});
