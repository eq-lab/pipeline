/**
 * Smoke test for the Risk Council index/placeholder route (#786 nav taxonomy,
 * moved to `risk-council.index.tsx` by issue #782's routing restructure).
 * No data, no wallet — just heading + description text.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./risk-council.index";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Risk Council index route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Risk Council heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Risk Council" }),
    ).toBeInTheDocument();
  });
});
