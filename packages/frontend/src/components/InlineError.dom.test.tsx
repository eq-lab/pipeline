/**
 * DOM tests for `InlineError` imported from @pipeline/ui (#1034).
 *
 * Same fallback path as `src/lib/toast/Toast.dom.test.tsx` — packages/ui has
 * no test runner, so shared-component DOM tests live in the frontend's
 * jsdom Vitest environment.
 *
 * Coverage:
 *   - `message` only → renders the line with role="alert", no "View details"
 *     trigger.
 *   - `message` + `details` → trigger present; click opens the dialog; the
 *     raw text is in the DOM only after opening.
 *   - Regression guard for issue #1034: the real reported `#3` fixture never
 *     renders inline before the trigger is clicked.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineError } from "@pipeline/ui";

const SOROBAN_ERROR_3_FIXTURE =
  'DepositManager.request_deposit simulation error: HostError: Error(Contract, #3) Event log (newest first): 0: [Diagnostic Event] contract:CB3CW55RXOQ5VUY7GJF5SOKSPFVHW7DZO3DE4664TGLBK25MZYEAANHG, topics:[error, Error(Contract, #3)], data:"escalating error to VM trap from failed host function call: fail_with_error" …';

describe("InlineError", () => {
  it("message only → renders the line with role=alert, no View details trigger", () => {
    render(<InlineError message="Something went wrong." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong.");
    expect(
      screen.queryByRole("button", { name: "View details" }),
    ).not.toBeInTheDocument();
  });

  it("message + details → trigger present; click opens the dialog; raw text appears only after opening", async () => {
    const user = userEvent.setup();
    render(
      <InlineError
        message="The transaction could not be completed."
        details="raw diagnostic text"
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("raw diagnostic text")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "View details" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("raw diagnostic text");
  });

  it("regression guard (#1034): the real #3 fixture is absent from the document before the trigger is clicked", () => {
    render(
      <InlineError
        message="Amount exceeds the deposit limit."
        details={SOROBAN_ERROR_3_FIXTURE}
      />,
    );

    expect(screen.queryByText(/Diagnostic Event/)).not.toBeInTheDocument();
    expect(screen.queryByText(/HostError/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Amount exceeds the deposit limit."),
    ).toBeInTheDocument();
  });

  it("empty-string details → treated as absent (no trigger)", () => {
    render(<InlineError message="Something went wrong." details="" />);
    expect(
      screen.queryByRole("button", { name: "View details" }),
    ).not.toBeInTheDocument();
  });
});
