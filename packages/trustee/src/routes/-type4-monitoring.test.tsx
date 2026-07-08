/**
 * Smoke test for the Type 4 (Decision monitoring) placeholder route.
 * No data, no wallet — just heading + description text (Issue #777 scaffold).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./type4-monitoring";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Type 4 — Decision monitoring route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Type 4 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Type 4 — Decision monitoring" }),
    ).toBeInTheDocument();
  });

  it("shows a one-line description", () => {
    renderRoute();
    expect(
      screen.getByText(/Read-only display and alerting surfaces/),
    ).toBeInTheDocument();
  });
});
