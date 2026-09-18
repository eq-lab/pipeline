import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OwnersModal } from "./OwnersModal";

function renderModal(
  props: Partial<React.ComponentProps<typeof OwnersModal>> = {},
) {
  const onDismiss = props.onDismiss ?? vi.fn();
  return {
    onDismiss,
    ...render(
      <OwnersModal
        open={props.open ?? true}
        onDismiss={onDismiss}
        {...props}
      />,
    ),
  };
}

function makeFile(name: string, type: string, sizeBytes = 1024): File {
  return new File(["x".repeat(sizeBytes)], name, { type });
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function pick(files: File[]) {
  fireEvent.change(fileInput(), { target: { files } });
}

function drop(files: File[]) {
  const textWrapper = screen.getByText(
    "Drag and drop your files",
  ).parentElement!;
  const zone = textWrapper.parentElement!;
  fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } });
}

describe("OwnersModal — default state", () => {
  it("renders heading, no description, banner copy, drop zone, no rows, Submit disabled", () => {
    renderModal();
    expect(
      screen.getByRole("heading", { name: "Add company owners" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Upload ID and proof of address documents for each owner",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Drag and drop your files")).toBeInTheDocument();
    expect(
      screen.getByText("pdf, jpg, png files up to 10MB"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select files" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("OwnersModal — shell composition", () => {
  it("no image panel, close button present, no back button, step badge shows Step 2/2", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("/2")).toBeInTheDocument();
  });
});

describe("OwnersModal — picking files", () => {
  it("adds a row and enables Submit for a single file", () => {
    renderModal();
    pick([makeFile("id.pdf", "application/pdf")]);

    expect(screen.getByText("id.pdf")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("adds two rows in order from one multi-file change", () => {
    renderModal();
    pick([
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.png", "image/png"),
    ]);

    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("a.pdf")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("b.png")).toBeInTheDocument();
  });
});

describe("OwnersModal — dropping files", () => {
  it("adds a row via drop", () => {
    renderModal();
    drop([makeFile("id.pdf", "application/pdf")]);

    expect(screen.getByText("id.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});

describe("OwnersModal — same-name files", () => {
  it("both render and remove independently", () => {
    renderModal();
    pick([
      makeFile("doc.pdf", "application/pdf"),
      makeFile("doc.pdf", "application/pdf"),
    ]);

    expect(screen.getAllByText("doc.pdf")).toHaveLength(2);
    const removeButtons = screen.getAllByRole("button", {
      name: "Remove doc.pdf",
    });
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]!);
    expect(screen.getAllByText("doc.pdf")).toHaveLength(1);
  });
});

describe("OwnersModal — removing the only file", () => {
  it("clears the list and re-disables Submit", () => {
    renderModal();
    pick([makeFile("id.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Remove id.pdf" }));

    expect(screen.queryByText("id.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("OwnersModal — rejection: oversize", () => {
  it("adds no row, shows role=alert on the subtitle, leaves Submit disabled", () => {
    renderModal();
    pick([makeFile("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1)]);

    expect(screen.queryByText("big.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "pdf, jpg, png files up to 10MB",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("OwnersModal — rejection: wrong type", () => {
  it("a mixed drop adds the valid file and shows the alert; a valid pick clears it", () => {
    renderModal();
    drop([
      makeFile("notes.txt", "text/plain"),
      makeFile("doc.pdf", "application/pdf"),
    ]);

    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    pick([makeFile("clean.pdf", "application/pdf")]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("OwnersModal — submitting", () => {
  it("calls onSubmit once with File[] in row order", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    const files = [
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.pdf", "application/pdf"),
    ];
    pick(files);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(files);
  });
});

describe("OwnersModal — reopen resets everything", () => {
  it("clears files and re-disables Submit", () => {
    const { rerender } = renderModal({ open: true });
    pick([makeFile("id.pdf", "application/pdf")]);
    expect(screen.getByText("id.pdf")).toBeInTheDocument();

    rerender(<OwnersModal open={false} onDismiss={vi.fn()} />);
    rerender(<OwnersModal open onDismiss={vi.fn()} />);

    expect(screen.queryByText("id.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("OwnersModal — tooltip", () => {
  it("shows on hover/focus, hides on leave/blur, and is aria-describedby linked", () => {
    renderModal();
    const hint = screen.getByRole("button", { name: "More information" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(hint);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(
      "You could upload a passport, ID card, or driver’s licence, plus a recent (no older than 90 days) utility bill or bank statement as proof of address.",
    );
    expect(hint).toHaveAttribute("aria-describedby", tooltip.id);

    fireEvent.mouseLeave(hint);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(hint);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(hint);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("OwnersModal — image preview", () => {
  it("renders an <img> for image/png, keeps the glyph tile for application/pdf", () => {
    renderModal();
    pick([
      makeFile("photo.png", "image/png"),
      makeFile("doc.pdf", "application/pdf"),
    ]);

    expect(document.querySelectorAll("img")).toHaveLength(1);
  });
});
