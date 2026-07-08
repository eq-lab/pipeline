/**
 * Smoke test for the Cash Management placeholder route (#786 nav taxonomy).
 * No data, no wallet — just heading + description text.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./cash-management";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Cash Management route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Cash Management heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Cash Management" }),
    ).toBeInTheDocument();
  });
});
