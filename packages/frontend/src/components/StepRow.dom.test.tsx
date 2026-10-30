/**
 * DOM tests for `StepRow` imported from @pipeline/ui (#1034).
 *
 * `packages/ui` had zero `StepRow`/`StepsCard` tests before this issue
 * (`grep step-row-.*-error` across both packages returned nothing) — same
 * jsdom fallback path as `src/lib/toast/Toast.dom.test.tsx`.
 *
 * Coverage:
 *   - state="error" + errorMessage only → red line, action button still
 *     present (the #1024 invariant), no "View details" trigger.
 *   - state="error" + errorMessage + errorDetails → trigger present, dialog
 *     opens with the raw text.
 *   - state="success" → green pill, no error line (guards the success branch).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepRow } from "@pipeline/ui";

describe("StepRow", () => {
  it('state="error" + errorMessage only → red line + action button present, no View details trigger', () => {
    render(
      <StepRow
        step={2}
        label="Confirm USDC transfer"
        actionLabel="Confirm"
        state="error"
        errorMessage="The transaction could not be completed."
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The transaction could not be completed.",
    );
    // The #1024 invariant: the action button stays present for retry.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View details" }),
    ).not.toBeInTheDocument();
  });

  it('state="error" + errorMessage + errorDetails → trigger present, dialog opens with the raw text', async () => {
    const user = userEvent.setup();
    render(
      <StepRow
        step={2}
        label="Confirm USDC transfer"
        actionLabel="Confirm"
        state="error"
        errorMessage="Amount exceeds the deposit limit."
        errorDetails="Error(Contract, #3) full diagnostic payload"
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("Error(Contract, #3) full diagnostic payload"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View details" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Error(Contract, #3) full diagnostic payload",
    );
  });

  it('state="success" → green pill, no error line', () => {
    render(
      <StepRow
        step={2}
        label="Confirm USDC transfer"
        actionLabel="Confirm"
        state="success"
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Confirm complete")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm" }),
    ).not.toBeInTheDocument();
  });

  it("hint renders a muted caption under the label", () => {
    render(
      <StepRow
        step={3}
        label="Claim your USDC"
        actionLabel="Claim"
        hint="No voucher yet."
      />,
    );

    const hint = screen.getByTestId("step-row-3-hint");
    expect(hint).toHaveTextContent("No voucher yet.");
    expect(hint.className).toContain("--color-pipeline-ink-muted");
  });

  it('hint is hidden while state="error"', () => {
    render(
      <StepRow
        step={3}
        label="Claim your USDC"
        actionLabel="Claim"
        state="error"
        errorMessage="The transaction could not be completed."
        hint="No voucher yet."
      />,
    );

    expect(screen.queryByTestId("step-row-3-hint")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("no hint element when the prop is absent", () => {
    render(<StepRow step={3} label="Claim" actionLabel="Claim" />);
    expect(screen.queryByTestId("step-row-3-hint")).not.toBeInTheDocument();
  });
  it("disabled → badge and action dim, row root and hint stay at full opacity", () => {
    render(
      <StepRow
        step={1}
        label="Claim"
        actionLabel="Claim"
        disabled
        hint="Waiting for liquidity"
      />,
    );

    expect(screen.getByTestId("step-row-1")).not.toHaveClass("opacity-30");
    expect(screen.getByTestId("step-row-1-badge")).toHaveClass("opacity-30");
    expect(screen.getByTestId("step-row-1-action")).toHaveClass("opacity-30");
    expect(screen.getByTestId("step-row-1-hint")).toBeVisible();
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
  });
});
