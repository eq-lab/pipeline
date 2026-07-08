/**
 * Smoke test for the Trustee landing route (/).
 *
 * Verifies the page renders the heading and a link to every Trustee flow
 * type without throwing, and without any wallet/router provider wiring
 * beyond a real TanStack router (Issue #777 scaffold — no data, no wallet).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./index";
import { TRUSTEE_FLOW_TYPES } from "@/lib/flowTypes";

function renderIndex() {
  const IndexPage = Route.options.component as React.ComponentType;
  return render(<IndexPage />);
}

describe("Trustee index route", () => {
  it("renders without throwing", () => {
    expect(() => renderIndex()).not.toThrow();
  });

  it("shows the Trustee Admin heading", () => {
    renderIndex();
    expect(
      screen.getByRole("heading", { name: "Trustee Admin" }),
    ).toBeInTheDocument();
  });

  it("renders a link for every Trustee flow type", () => {
    renderIndex();
    for (const type of TRUSTEE_FLOW_TYPES) {
      const link = screen.getByRole("link", { name: type.heading });
      expect(link).toHaveAttribute("href", type.path);
    }
  });
});
