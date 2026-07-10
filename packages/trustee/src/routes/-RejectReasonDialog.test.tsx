/**
 * Tests for `RejectReasonDialog` (issue #829, re-skinned to Figma
 * `4116:14123` by issue #838). Real `useRejectReasonDialog` hook is
 * exercised (not mocked) — cheap and gives real validation coverage.
 *
 * Covers:
 *   - Renders nothing when `open` is false.
 *   - Renders the dialog when `open` is true.
 *   - The title interpolates the `originator` prop; the subtitle renders.
 *   - The reason field is a single-line input carrying the Figma placeholder.
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
import { RejectReasonDialog } from "./-RejectReasonDialog";

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
    <RejectReasonDialog
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

describe("RejectReasonDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(
      screen.queryByTestId("reject-reason-dialog"),
    ).not.toBeInTheDocument();
  });

  it("renders the dialog with an accessible role when open", () => {
    renderDialog();
    const dialog = screen.getByTestId("reject-reason-dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("interpolates the originator into the title and renders the subtitle", () => {
    renderDialog({ originator: "Auric Andes S.A.C." });
    expect(
      screen.getByRole("heading", {
        name: "Reject request — Auric Andes S.A.C.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The request closes and the originator sees your reason.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a single-line input with the Figma placeholder", () => {
    renderDialog();
    const input = screen.getByTestId("reject-reason-input");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute(
      "placeholder",
      "e.g. offtaker price below facility covenant",
    );
  });

  it("primary button reads 'Send to originator'", () => {
    renderDialog();
    expect(screen.getByTestId("reject-reason-submit")).toHaveTextContent(
      "Send to originator",
    );
  });

  it("Cancel fires onCancel without submitting", () => {
    const { onCancel, onSubmit } = renderDialog();
    fireEvent.click(screen.getByTestId("reject-reason-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Escape fires onCancel without submitting", () => {
    const { onCancel, onSubmit } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clicking the backdrop fires onCancel; clicking inside the dialog does not", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId("reject-reason-dialog"));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("reject-reason-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Submit is disabled while the reason is under 5 trimmed chars", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("reject-reason-input"), {
      target: { value: "Hi" },
    });
    expect(screen.getByTestId("reject-reason-submit")).toBeDisabled();
    expect(
      screen.getByTestId("reject-reason-validation-error"),
    ).toBeInTheDocument();
  });

  it("Submit is disabled while isSubmitting is true, even with a valid reason", () => {
    renderDialog({ isSubmitting: true });
    fireEvent.change(screen.getByTestId("reject-reason-input"), {
      target: { value: "Missing export permit" },
    });
    expect(screen.getByTestId("reject-reason-submit")).toBeDisabled();
  });

  it("a valid reason enables Submit; clicking it calls onSubmit with the trimmed value", () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByTestId("reject-reason-input"), {
      target: { value: "  Missing export permit  " },
    });
    const submit = screen.getByTestId("reject-reason-submit");
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("Missing export permit");
  });

  it("displays a passed errorMessage", () => {
    renderDialog({
      errorMessage: "This submission has already been reviewed.",
    });
    expect(screen.getByTestId("reject-reason-error")).toHaveTextContent(
      "This submission has already been reviewed.",
    );
  });
});
