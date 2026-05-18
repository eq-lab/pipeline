/**
 * DOM tests for the Toast primitive imported from @pipeline/ui.
 *
 * These tests run in the frontend's Vitest environment (jsdom) rather than
 * adding a separate test runner to @pipeline/ui, keeping the infrastructure
 * delta minimal (plan § Test Strategy, fallback path).
 *
 * Coverage:
 *   - Renders title text.
 *   - Each tone renders the expected role / aria-live combination.
 *   - `action` prop renders a <button> with the action label; clicking invokes onClick.
 *   - `icon` prop overrides the default per-tone icon.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toast } from "@pipeline/ui";

describe("Toast primitive", () => {
  it("renders title text", () => {
    render(<Toast title="Deposit confirmed" />);
    expect(screen.getByText("Deposit confirmed")).toBeInTheDocument();
  });

  describe("a11y roles and aria-live", () => {
    it("neutral tone → role=status, aria-live=polite", () => {
      render(<Toast tone="neutral" title="ok" />);
      const el = screen.getByRole("status");
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("aria-live", "polite");
    });

    it("success tone → role=status, aria-live=polite", () => {
      render(<Toast tone="success" title="ok" />);
      const el = screen.getByRole("status");
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("aria-live", "polite");
    });

    it("danger tone → role=alert, aria-live=assertive", () => {
      render(<Toast tone="danger" title="oh no" />);
      const el = screen.getByRole("alert");
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("aria-live", "assertive");
    });

    it("pending tone → role=status, aria-live=polite", () => {
      render(<Toast tone="pending" title="Sending…" />);
      const el = screen.getByRole("status");
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("action button", () => {
    it("renders a <button> with the action label", () => {
      render(
        <Toast
          tone="success"
          title="+1,000 PLUSD"
          action={{ label: "Stake", onClick: vi.fn() }}
        />,
      );
      expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument();
    });

    it("clicking the action button calls onClick", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();
      render(
        <Toast
          tone="success"
          title="+1,000 PLUSD"
          action={{ label: "Stake", onClick: handleClick }}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Stake" }));
      expect(handleClick).toHaveBeenCalledOnce();
    });

    it("does not render an action button when action prop is omitted", () => {
      render(<Toast tone="success" title="Deposit confirmed" />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("icon override", () => {
    it("renders the custom icon node when `icon` prop is provided", () => {
      render(
        <Toast
          tone="success"
          title="ok"
          icon={<span data-testid="custom-icon">★</span>}
        />,
      );
      expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    });
  });
});
