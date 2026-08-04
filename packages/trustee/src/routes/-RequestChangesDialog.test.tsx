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
 *   - Displays a passed `errorMessage`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RequestChangesDialog } from "./-RequestChangesDialog";

const ORIGINATOR = "Auric Andes S.A.C.";

function renderDialog(overrides?: {
  open?: boolean;
  originator?: string;
  onCancel?: () => void;
  onSubmit?: (reason: string) => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
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
});
