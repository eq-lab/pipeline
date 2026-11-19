// spec: docs/frontend/dashboard-components.md#renderbanktransferrow
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { WireInItem, WireOutItem } from "@/api";
import { renderActivityRow, renderWireInRow } from "./renderBankTransferRow";
import { renderWireOutItemRow } from "./renderWireOutRow";

const wireIn = (over: Partial<WireInItem> = {}): WireInItem => ({
  chain_id: 1,
  id: 1,
  status: "Direct",
  amount: "1234.5",
  value_date: "2026-05-01",
  ref_hash: "0x",
  recorded_at: "2026-05-14T12:00:00Z",
  ...over,
});

const wireOut = (over: Partial<WireOutItem> = {}): WireOutItem => ({
  chain_id: 1,
  id: 1,
  status: "Pending",
  amount: "986.301369",
  requested_at: "2026-05-14T12:00:00Z",
  ...over,
});

const TIME = /[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/;

describe("renderWireInRow", () => {
  it("renders the Add funds copy with a USD amount", () => {
    const { container } = render(<>{renderWireInRow(wireIn(), "row")}</>);
    expect(container.textContent).toContain("Add funds");
    expect(container.textContent).toContain("+1,234.50 USD");
    expect(container.textContent).toContain("Bank transfer · Direct");
    expect(container.textContent).toMatch(TIME);
  });

  it.each(["Direct", "Assigned"])(
    "renders the served %s status verbatim",
    (status) => {
      const { container } = render(<>{renderWireInRow(wireIn({ status }))}</>);
      expect(container.textContent).toContain(`Bank transfer · ${status}`);
    },
  );

  it("renders an unknown status verbatim and an empty one as an em dash", () => {
    const unknown = render(
      <>{renderWireInRow(wireIn({ status: "Escalated" }))}</>,
    );
    expect(unknown.container.textContent).toContain(
      "Bank transfer · Escalated",
    );
    const empty = render(<>{renderWireInRow(wireIn({ status: "" }))}</>);
    expect(empty.container.textContent).toContain("Bank transfer · —");
  });

  it("renders em dashes for a missing or non-numeric amount", () => {
    const { container } = render(
      <>{renderWireInRow(wireIn({ amount: "abc" }))}</>,
    );
    expect(container.textContent).toContain("+— USD");
  });

  it("uses assigned_at for the row time when present", () => {
    const { container } = render(
      <>{renderWireInRow(wireIn({ assigned_at: "2026-06-01T12:00:00Z" }))}</>,
    );
    expect(container.textContent).toContain("Jun 1");
  });
});

describe("renderWireOutItemRow", () => {
  it("renders the Withdraw funds copy with a PLUSD amount", () => {
    const { container } = render(<>{renderWireOutItemRow(wireOut())}</>);
    expect(container.textContent).toContain("Withdraw funds");
    expect(container.textContent).toContain("−986.30 PLUSD");
    expect(container.textContent).toContain("Bank transfer · Pending");
    expect(container.textContent).toMatch(TIME);
  });

  it.each(["Pending", "Settled", "Cancelled"])(
    "renders the served %s status verbatim",
    (status) => {
      const { container } = render(
        <>{renderWireOutItemRow(wireOut({ status }))}</>,
      );
      expect(container.textContent).toContain(`Bank transfer · ${status}`);
    },
  );

  it("renders em dashes for a missing status, amount and time", () => {
    const { container } = render(
      <>
        {renderWireOutItemRow(
          wireOut({ status: "", amount: "", requested_at: "" }),
        )}
      </>,
    );
    expect(container.textContent).toContain("−— PLUSD");
    expect(container.textContent).toContain("Bank transfer · —");
  });
});

describe("renderActivityRow", () => {
  it("dispatches each feed kind to its row", () => {
    const a = render(
      <>{renderActivityRow({ kind: "wireIn", item: wireIn() }, "stellar")}</>,
    );
    expect(a.container.textContent).toContain("Add funds");
    const b = render(
      <>{renderActivityRow({ kind: "wireOut", item: wireOut() }, "stellar")}</>,
    );
    expect(b.container.textContent).toContain("Withdraw funds");
  });
});
