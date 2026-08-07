/**
 * Tests for `ApproveMintDialog` (issue #838, Figma `4116:13943`).
 *
 * Covers:
 *   - Renders nothing when `open` is false.
 *   - Renders the title/subtitle/preview and Cancel/Mint loan when open.
 *   - Cancel fires `onCancel`; backdrop click and Escape do too — UNLESS
 *     `isSubmitting`, in which case all three are locked (see the module
 *     docblock — this dialog cannot be dismissed mid-mint).
 *   - Clicking inside the dialog does not fire `onCancel`.
 *   - "Mint loan" calls `onConfirm`.
 *   - The "Mint loan" label swaps to `mintingLabel` and the buttons disable
 *     while `isSubmitting`.
 *   - `errorMessage` renders inside the dialog via `InlineError`; with
 *     `errorDetails` set, "View details" opens `ErrorDetailsDialog` with the
 *     raw text; Escape/backdrop-click on that nested dialog leave this
 *     parent dialog open (#1037 D4 — the capture-phase Escape fix).
 *   - The green mint-invariant checklist strings are NOT present (no
 *     backing data — issue #838 explicitly omits them).
 *   - Accessibility attributes are present.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApproveMintDialog } from "./-ApproveMintDialog";
import type { TransactionPreviewDisplay } from "./-origination-detail";

const PREVIEW: TransactionPreviewDisplay = {
  keyword: "LoanRegistry.mintLoan",
  rows: [
    { label: "originator", value: "Auric Andes S.A.C." },
    {
      label: "economics",
      value:
        "{ facility $3,500,000 · senior $2,800,000 · equity $700,000 · offtaker $3,750,000 · 14.0% · 10 Jul 2026 → 15 Dec 2026 }",
    },
    { label: "metadataURI", value: "ipfs://auric-assay-offtake-hash" },
    { label: "initialLocation", value: "MV Example" },
  ],
};

function renderDialog(overrides?: {
  open?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
  isSubmitting?: boolean;
  mintingLabel?: string | null;
  errorMessage?: string | null;
  errorDetails?: string | null;
  preview?: TransactionPreviewDisplay;
}) {
  const onCancel = overrides?.onCancel ?? vi.fn();
  const onConfirm = overrides?.onConfirm ?? vi.fn();
  const utils = render(
    <ApproveMintDialog
      open={overrides?.open ?? true}
      onCancel={onCancel}
      onConfirm={onConfirm}
      isSubmitting={overrides?.isSubmitting ?? false}
      mintingLabel={overrides?.mintingLabel ?? null}
      errorMessage={overrides?.errorMessage ?? null}
      errorDetails={overrides?.errorDetails ?? null}
      preview={overrides?.preview ?? PREVIEW}
    />,
  );
  return { ...utils, onCancel, onConfirm };
}

describe("ApproveMintDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("approve-mint-dialog")).not.toBeInTheDocument();
  });

  it("renders the title, subtitle, and preview when open", () => {
    renderDialog();
    expect(
      screen.getByRole("heading", { name: "Approve & draw loan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Transaction preview — sent from your Trustee key."),
    ).toBeInTheDocument();
    const preview = screen.getByTestId("approve-mint-preview");
    expect(preview).toHaveTextContent("LoanRegistry.mintLoan");
    expect(preview).toHaveTextContent("Auric Andes S.A.C.");
    expect(preview).toHaveTextContent("ipfs://auric-assay-offtake-hash");
    expect(preview).toHaveTextContent("MV Example");
  });

  it("renders an accessible role/aria-modal/aria-labelledby", () => {
    renderDialog();
    const dialog = screen.getByTestId("approve-mint-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "approve-mint-title");
  });

  it("does NOT render the green mint-invariant checklist rows (no backing data)", () => {
    renderDialog();
    expect(
      screen.queryByText("senior + equity == facility size"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("offtaker price ≥ facility size"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/maturity > origination/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("assay + offtake excerpt hashed into metadataURI"),
    ).not.toBeInTheDocument();
  });

  it("Cancel fires onCancel", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("approve-mint-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Escape fires onCancel", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop fires onCancel; clicking inside the dialog does not", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId("approve-mint-dialog"));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("approve-mint-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Mint loan calls onConfirm", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("approve-mint-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("swaps the Mint loan label to mintingLabel and disables both buttons while isSubmitting", () => {
    renderDialog({
      isSubmitting: true,
      mintingLabel: "Waiting for wallet signature…",
    });
    const confirm = screen.getByTestId("approve-mint-confirm");
    expect(confirm).toHaveTextContent("Waiting for wallet signature…");
    expect(confirm).toBeDisabled();
    expect(screen.getByTestId("approve-mint-cancel")).toBeDisabled();
  });

  it("locks Cancel/Escape/backdrop while isSubmitting (cannot dismiss mid-mint)", () => {
    const { onCancel } = renderDialog({
      isSubmitting: true,
      mintingLabel: "Submitting on-chain…",
    });

    fireEvent.click(screen.getByTestId("approve-mint-cancel"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("approve-mint-backdrop"));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders errorMessage inside the dialog", () => {
    renderDialog({
      errorMessage: "Signature cancelled. Click Approve again to retry.",
    });
    expect(screen.getByTestId("approve-mint-error")).toHaveTextContent(
      "Signature cancelled. Click Approve again to retry.",
    );
  });

  it("with errorDetails null renders no View details trigger", () => {
    renderDialog({ errorMessage: "Signature cancelled." });
    expect(
      screen.queryByTestId("inline-error-view-details"),
    ).not.toBeInTheDocument();
  });

  it("with errorDetails set, View details opens ErrorDetailsDialog with the raw text (#1037)", async () => {
    const user = userEvent.setup();
    renderDialog({
      errorMessage: "The on-chain transaction failed. Please try again.",
      errorDetails: "HostError: Error(Contract, #7) raw diagnostic dump",
    });
    await user.click(screen.getByTestId("inline-error-view-details"));
    const dialog = await screen.findByTestId("error-details-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "HostError: Error(Contract, #7) raw diagnostic dump",
    );
  });

  it("Escape closes only the nested ErrorDetailsDialog — the parent approve-mint dialog stays open (#1037 D4 regression)", async () => {
    const user = userEvent.setup();
    renderDialog({
      errorMessage: "The on-chain transaction failed. Please try again.",
      errorDetails: "raw diagnostic dump",
    });
    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(
      await screen.findByTestId("error-details-dialog"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByTestId("error-details-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("approve-mint-dialog")).toBeInTheDocument();
  });

  it("backdrop click on the nested ErrorDetailsDialog leaves the parent approve-mint dialog open (#1037 D4)", async () => {
    const user = userEvent.setup();
    renderDialog({
      errorMessage: "The on-chain transaction failed. Please try again.",
      errorDetails: "raw diagnostic dump",
    });
    await user.click(screen.getByTestId("inline-error-view-details"));
    await user.click(await screen.findByTestId("error-details-backdrop"));

    expect(
      screen.queryByTestId("error-details-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("approve-mint-dialog")).toBeInTheDocument();
  });

  it("defaults the confirm label to 'Draw loan' when mintingLabel is null", () => {
    renderDialog();
    expect(screen.getByTestId("approve-mint-confirm")).toHaveTextContent(
      "Draw loan",
    );
  });
});
