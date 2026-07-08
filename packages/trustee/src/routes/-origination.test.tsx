/**
 * Smoke test for the Origination placeholder route (#786 nav taxonomy).
 * No data, no wallet — just heading + description text.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./origination";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Origination route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Origination heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Origination" }),
    ).toBeInTheDocument();
  });
});
