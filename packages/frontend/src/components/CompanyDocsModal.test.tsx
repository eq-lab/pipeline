import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompanyDocsModal } from "./CompanyDocsModal";

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
  return new File(["x".repeat(sizeBytes)], name, { type });
}

function input(): HTMLInputElement {
  return screen.getByTestId("account-upload-input") as HTMLInputElement;
}

function upload(files: File[]) {
  fireEvent.change(input(), { target: { files } });
}

describe("CompanyDocsModal — empty state", () => {
  it("renders the heading, description, upload row, and full requirements list", () => {
    renderModal();
    expect(
      screen.getByRole("heading", { name: "Finish account setup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Upload your company documents and personal KYC for each shareholder so we can verify your account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Upload documents")).toBeInTheDocument();
    expect(
      screen.getByText("pdf, jpg, png files up to 10MB"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getByText("Requirement documents:")).toBeInTheDocument();
    for (const item of [
      "Certificate of Incorporation",
      "Registry of Legal Entities",
      "Certificate of Good Standing",
      "Legal Address",
      "Shareholder Register",
      "Personal KYC for each shareholder / UBO:",
    ]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(screen.getByText("Government-issued ID.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Proof of Address (bill, bank or credit card statements)",
      ),
    ).toBeInTheDocument();
  });

  it("renders no staged-file list and a disabled Submit", () => {
    renderModal();
    expect(
      document.querySelector('[data-node-id="6701:96893"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Remove/ })).toHaveLength(
      0,
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — shell composition", () => {
  it("no image panel, close button present, no step badge, no back button", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Finish account setup" });
    expect(dialog.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Step 1/)).not.toBeInTheDocument();
    expect(screen.queryByText("/2")).not.toBeInTheDocument();
  });
});

describe("CompanyDocsModal — staging a file", () => {
  it("shows the file name, Uploaded caption, a Remove button, and enables Submit", () => {
    renderModal();
    upload([makeFile("doc.pdf", "application/pdf")]);

    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove doc.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("appends several files picked at once, in order", () => {
    renderModal();
    upload([
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.pdf", "application/pdf"),
      makeFile("c.pdf", "application/pdf"),
    ]);

    const stagedList = document.querySelector('[data-node-id="6701:96893"]');
    const rows = stagedList ? Array.from(stagedList.children) : [];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("a.pdf"),
      expect.stringContaining("b.pdf"),
      expect.stringContaining("c.pdf"),
    ]);
  });
});

describe("CompanyDocsModal — removing a file", () => {
  it("empties the list and re-disables Submit when the last file is removed", () => {
    renderModal();
    upload([makeFile("doc.pdf", "application/pdf")]);
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove doc.pdf" }));

    expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — Submit", () => {
  it("calls onSubmit once with the staged files in order", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    const files = [
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.pdf", "application/pdf"),
    ];
    upload(files);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(files);
  });

  it("does not call onSubmit while disabled", () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("CompanyDocsModal — rejection: oversize", () => {
  it("leaves the list empty and shows a role=alert caption", () => {
    renderModal();
    upload([makeFile("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1)]);

    expect(screen.queryByText("big.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "pdf, jpg, png files up to 10MB",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("CompanyDocsModal — rejection: wrong type", () => {
  it("rejects text/plain, and a subsequent valid file clears the alert", () => {
    renderModal();
    upload([makeFile("notes.txt", "text/plain")]);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    upload([makeFile("doc.pdf", "application/pdf")]);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });
});

describe("CompanyDocsModal — close keeps staged files", () => {
  it("keeps staged rows and an enabled Submit across a close/reopen rerender", () => {
    const { rerender } = renderModal({ open: true });
    upload([makeFile("doc.pdf", "application/pdf")]);
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();

    rerender(<CompanyDocsModal open={false} onDismiss={vi.fn()} />);
    rerender(<CompanyDocsModal open onDismiss={vi.fn()} />);

    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});

describe("CompanyDocsModal — image preview", () => {
  it("renders an <img> for image/png, keeps the glyph tile for application/pdf", () => {
    renderModal();
    upload([
      makeFile("photo.png", "image/png"),
      makeFile("doc.pdf", "application/pdf"),
    ]);

    expect(document.querySelectorAll("img")).toHaveLength(1);
  });
});
