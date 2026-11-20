// spec: docs/frontend/dashboard-components.md#loanbooktable
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoanBookTable } from "./LoanBookTable";

describe("LoanBookTable column widths (#2148)", () => {
  it("gives the LTV column room for the longest value", () => {
    render(
      <LoanBookTable
        rows={[
          {
            commodity: "Gold",
            principal: "$5.0M",
            ltv: "No security value",
            duration: "90d",
            rate: "12.0%",
            protection: "LC at sight",
          },
        ]}
      />,
    );
    const table = screen.getByTestId("loan-book-table-desktop");
    const widths = Array.from(table.querySelectorAll("col")).map(
      (col) => col.style.width,
    );
    expect(widths).toEqual(["", "112px", "176px", "96px", "96px", "128px"]);
    expect(screen.getByText("No security value")).toBeInTheDocument();
  });
});
