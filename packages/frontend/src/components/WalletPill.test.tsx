/**
 * WalletPill — LP review #39 (#1185): 4px corner radius, no border.
 * spec: docs/frontend/ui-components.md#walletpill
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletPill } from "@pipeline/ui";

describe("WalletPill chrome (#1185)", () => {
  it("uses the 4px card radius, not the pill radius", () => {
    render(<WalletPill token="usdc" balance="$10,000.00" data-testid="wp" />);
    const el = screen.getByTestId("wp");
    expect(el.className).toContain("rounded-[var(--radius-pipeline-card)]");
    expect(el.className).not.toContain("rounded-[var(--radius-pipeline-pill)]");
  });

  it("renders without a border", () => {
    render(<WalletPill token="usdc" balance="$10,000.00" data-testid="wp" />);
    const el = screen.getByTestId("wp");
    expect(el.className).not.toMatch(/(^|\s)border(\s|$)|border-\[/);
  });
});
