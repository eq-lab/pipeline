/**
 * Smoke test for the Audit Log placeholder route (#786 nav taxonomy).
 * No data, no wallet — just heading + description text.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./audit-log";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Audit Log route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Audit Log heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Audit Log" }),
    ).toBeInTheDocument();
  });
});
