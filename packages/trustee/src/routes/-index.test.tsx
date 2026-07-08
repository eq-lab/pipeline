/**
 * Smoke test for the Trustee Overview route (/).
 *
 * #786 replaced the #777 scaffold's "pick a flow type" launcher page (which
 * linked out to every flow type) with a genuine Overview nav destination —
 * this suite now just asserts the placeholder heading/body render.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./index";

function renderIndex() {
  const IndexPage = Route.options.component as React.ComponentType;
  return render(<IndexPage />);
}

describe("Trustee Overview route", () => {
  it("renders without throwing", () => {
    expect(() => renderIndex()).not.toThrow();
  });

  it("shows the Overview heading", () => {
    renderIndex();
    expect(
      screen.getByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
  });
});
