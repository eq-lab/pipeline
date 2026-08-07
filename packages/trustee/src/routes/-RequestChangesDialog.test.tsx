/**
 * Tests for `RequestChangesDialog` (#1017). Real `useRejectReasonDialog`
 * validation hook is exercised (not mocked) — cheap and gives real
 * validation coverage. Mirrors `-RejectReasonDialog.test.tsx` with the
 * #1017 deltas: the copy, and the reason field being a multi-line
 * `<textarea>` rather than the #838 single-line input.
 *
 * Covers:
 *   - Renders nothing when `open` is false.
 *   - Renders the dialog when `open` is true.
 *   - The title interpolates the `originator` prop; the subtitle renders.
 *   - The reason field is a `<textarea>` (per the issue), not an input.
 *   - The primary button reads "Send to originator".
 *   - Cancel fires `onCancel` without calling `onSubmit`.
 *   - Escape fires `onCancel` without calling `onSubmit`.
 *   - Clicking the backdrop fires `onCancel`; clicking inside the dialog does not.
 *   - Submit is disabled while the reason is under 5 trimmed chars.
 *   - Submit is disabled while `isSubmitting` is true.
 *   - A valid reason enables Submit, and clicking it calls `onSubmit` with the
 *     trimmed value.
 *   - Displays a passed `errorMessage` via `InlineError`; with `errorDetails`
 *     set, "View details" opens `ErrorDetailsDialog`, and Escape/backdrop
 *     click on that nested dialog leave this parent dialog open (#1037 D4).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestChangesDialog } from "./-RequestChangesDialog";

const ORIGINATOR = "Auric Andes S.A.C.";

function renderDialog(overrides?: {
  open?: boolean;
  originator?: string;
  onCancel?: () => void;
  onSubmit?: (reason: string) => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  errorDetails?: string | null;
}) {
  const onCancel = overrides?.onCancel ?? vi.fn();
  const onSubmit = overrides?.onSubmit ?? vi.fn();
  const utils = render(
    <RequestChangesDialog
      open={overrides?.open ?? true}
      originator={overrides?.originator ?? ORIGINATOR}
      onCancel={onCancel}
      onSubmit={onSubmit}
      isSubmitting={overrides?.isSubmitting ?? false}
      errorMessage={overrides?.errorMessage ?? null}
      errorDetails={overrides?.errorDetails ?? null}
    />,
  );
  return { ...utils, onCancel, onSubmit };
}

describe("RequestChangesDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(
      screen.queryByTestId("request-changes-dialog"),
    ).not.toBeInTheDocument();
  });

  it("renders the dialog with an accessible role when open", () => {
    renderDialog();
    const dialog = screen.getByTestId("request-changes-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("interpolates the originator into the title and renders the subtitle", () => {
    renderDialog({ originator: "Auric Andes S.A.C." });
    expect(
      screen.getByRole("heading", {
        name: "Request changes — Auric Andes S.A.C.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The request returns to the originator with your reason; they can amend and resubmit.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a multi-line textarea as the reason field (#1017)", () => {
    renderDialog();
    const field = screen.getByTestId("request-changes-input");
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("the primary button reads 'Send to originator'", () => {
    renderDialog();
    expect(screen.getByTestId("request-changes-submit")).toHaveTextContent(
      "Send to originator",
    );
  });

  it("Cancel fires onCancel without submitting", () => {
    const { onCancel, onSubmit } = renderDialog();
    fireEvent.click(screen.getByTestId("request-changes-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Escape fires onCancel without submitting", () => {
    const { onCancel, onSubmit } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("backdrop click fires onCancel; a click inside the dialog does not", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId("request-changes-dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("request-changes-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Submit until the reason has 5 trimmed characters, with an inline error", () => {
    const { onSubmit } = renderDialog();
    const field = screen.getByTestId("request-changes-input");
    const submit = screen.getByTestId("request-changes-submit");

    fireEvent.change(field, { target: { value: "  ab  " } });
    expect(submit).toBeDisabled();
    expect(
      screen.getByTestId("request-changes-validation-error"),
    ).toHaveTextContent("Reason must be at least 5 characters.");

    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the trimmed reason once valid", () => {
    const { onSubmit } = renderDialog();
    const field = screen.getByTestId("request-changes-input");

    fireEvent.change(field, {
      target: { value: "  Assay certificate incomplete  " },
    });
    const submit = screen.getByTestId("request-changes-submit");
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("Assay certificate incomplete");
  });

  it("disables Submit and the textarea while submitting", () => {
    renderDialog({ isSubmitting: true });
    expect(screen.getByTestId("request-changes-submit")).toBeDisabled();
    expect(screen.getByTestId("request-changes-submit")).toHaveTextContent(
      "Submitting…",
    );
    expect(screen.getByTestId("request-changes-input")).toBeDisabled();
  });

  it("displays a passed errorMessage", () => {
    renderDialog({ errorMessage: "Something went wrong. Please try again." });
    expect(screen.getByTestId("request-changes-error")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
  });

  it("with errorDetails null renders no View details trigger", () => {
    renderDialog({ errorMessage: "Something went wrong. Please try again." });
    expect(
      screen.queryByTestId("inline-error-view-details"),
    ).not.toBeInTheDocument();
  });

  it("with errorDetails set, View details opens ErrorDetailsDialog with the raw text (#1037)", async () => {
    const user = userEvent.setup();
    renderDialog({
      errorMessage: "Something went wrong. Please try again.",
      errorDetails: "raw backend diagnostic text",
    });
    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "raw backend diagnostic text",
    );
  });

  it("Escape closes only the nested ErrorDetailsDialog — the parent request-changes dialog stays open (#1037 D4 regression)", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog({
      errorMessage: "Something went wrong. Please try again.",
      errorDetails: "raw backend diagnostic text",
    });
    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByTestId("error-details-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("request-changes-dialog")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("backdrop click on the nested ErrorDetailsDialog leaves the parent request-changes dialog open (#1037 D4)", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog({
      errorMessage: "Something went wrong. Please try again.",
      errorDetails: "raw backend diagnostic text",
    });
    await user.click(screen.getByTestId("inline-error-view-details"));
    await user.click(screen.getByTestId("error-details-backdrop"));

    expect(
      screen.queryByTestId("error-details-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("request-changes-dialog")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
