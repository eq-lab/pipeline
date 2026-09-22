import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompanyDocsModal } from "./CompanyDocsModal";
import { COMPANY_DOCUMENT_SLOTS } from "./useCompanyDocsModal";

function renderModal(
  props: Partial<React.ComponentProps<typeof CompanyDocsModal>> = {},
) {
  const onDismiss = props.onDismiss ?? vi.fn();
  return {
    onDismiss,
    ...render(
      <CompanyDocsModal
        open={props.open ?? true}
        onDismiss={onDismiss}
        {...props}
      />,
    ),
  };
}

function makeFile(name: string, type: string, sizeBytes = 1024): File {
  const file = new File(["x".repeat(sizeBytes)], name, { type });
  return file;
}

function inputFor(slotId: string): HTMLInputElement {
  return screen.getByTestId(`${slotId}-file-input`) as HTMLInputElement;
}

function upload(slotId: string, file: File) {
  fireEvent.change(inputFor(slotId), { target: { files: [file] } });
}

describe("CompanyDocsModal — empty state", () => {
  it("renders five rows in frame order with exact labels and captions", () => {
    renderModal();
    for (const slot of COMPANY_DOCUMENT_SLOTS) {
      expect(screen.getByText(slot.label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("pdf, jpg, png files up to 10MB")).toHaveLength(
      5,
    );
    expect(screen.getAllByRole("button", { name: /^Upload / })).toHaveLength(5);
  });

  it("Continue is disabled", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — shell composition", () => {
  it("no image panel, close button present, no back button, step badge shows Step 1/2", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("/2")).toBeInTheDocument();
  });
});

describe("CompanyDocsModal — accepting a file", () => {
  it("shows the file name, Uploaded caption, and a Remove button; Continue stays disabled", () => {
    renderModal();
    const slotId = COMPANY_DOCUMENT_SLOTS[0]!.id;
    const file = makeFile("doc.pdf", "application/pdf");
    upload(slotId, file);

    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    const removeButton = screen.getByRole("button", { name: "Remove doc.pdf" });
    expect(removeButton).toBeInTheDocument();
    expect(removeButton).toHaveClass("size-8");
    expect(removeButton.parentElement).toHaveClass("size-10", "p-1");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — completing all five", () => {
  it("enables Continue and calls onSubmit with all five files", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    const files = COMPANY_DOCUMENT_SLOTS.map((_slot, i) =>
      makeFile(`file-${i}.pdf`, "application/pdf"),
    );
    COMPANY_DOCUMENT_SLOTS.forEach((slot, i) => {
      upload(slot.id, files[i]!);
    });

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeEnabled();

    fireEvent.click(continueBtn);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const documents = onSubmit.mock.calls[0]![0];
    COMPANY_DOCUMENT_SLOTS.forEach((slot, i) => {
      expect(documents[slot.id]).toBe(files[i]);
    });
  });
});

describe("CompanyDocsModal — removing a file", () => {
  it("reverts the row to empty and re-disables Continue", () => {
    renderModal();
    COMPANY_DOCUMENT_SLOTS.forEach((slot, i) => {
      upload(slot.id, makeFile(`file-${i}.pdf`, "application/pdf"));
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    const firstFileName = "file-0.pdf";
    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${firstFileName}` }),
    );

    expect(
      screen.getByText(COMPANY_DOCUMENT_SLOTS[0]!.label),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — rejection: oversize", () => {
  it("leaves the slot empty, shows a role=alert caption, keeps Continue disabled", () => {
    renderModal();
    const slotId = COMPANY_DOCUMENT_SLOTS[0]!.id;
    const oversized = makeFile(
      "big.pdf",
      "application/pdf",
      10 * 1024 * 1024 + 1,
    );
    upload(slotId, oversized);

    expect(screen.queryByText("big.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "pdf, jpg, png files up to 10MB",
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — rejection: wrong type", () => {
  it("rejects text/plain, and a subsequent valid file clears the alert", () => {
    renderModal();
    const slotId = COMPANY_DOCUMENT_SLOTS[0]!.id;
    upload(slotId, makeFile("notes.txt", "text/plain"));

    expect(screen.getByRole("alert")).toBeInTheDocument();

    upload(slotId, makeFile("doc.pdf", "application/pdf"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });
});

describe("CompanyDocsModal — re-picking the identical file", () => {
  it("registers again after a removal (input value reset)", () => {
    renderModal();
    const slotId = COMPANY_DOCUMENT_SLOTS[0]!.id;
    const file = makeFile("doc.pdf", "application/pdf");
    upload(slotId, file);
    fireEvent.click(screen.getByRole("button", { name: "Remove doc.pdf" }));
    upload(slotId, file);

    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });
});

describe("CompanyDocsModal — reopen resets everything", () => {
  it("fills a slot, closes and reopens, and gets an empty state with Continue disabled", () => {
    const { rerender } = renderModal({ open: true });
    const slotId = COMPANY_DOCUMENT_SLOTS[0]!.id;
    upload(slotId, makeFile("doc.pdf", "application/pdf"));
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();

    rerender(<CompanyDocsModal open={false} onDismiss={vi.fn()} />);
    rerender(<CompanyDocsModal open onDismiss={vi.fn()} />);

    expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
    expect(
      screen.getByText(COMPANY_DOCUMENT_SLOTS[0]!.label),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — image preview", () => {
  it("renders an <img> for image/png, keeps the glyph tile for application/pdf", () => {
    renderModal();
    const [imgSlot, pdfSlot] = COMPANY_DOCUMENT_SLOTS;
    upload(imgSlot!.id, makeFile("photo.png", "image/png"));
    upload(pdfSlot!.id, makeFile("doc.pdf", "application/pdf"));

    expect(document.querySelectorAll("img")).toHaveLength(1);
  });
});
