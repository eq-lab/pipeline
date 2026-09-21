import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountDocumentsCard } from "./AccountDocumentsCard";
import { ACCOUNT_STATE_PREVIEWS } from "./accountPageState";

function baseProps(
  overrides: Partial<React.ComponentProps<typeof AccountDocumentsCard>> = {},
) {
  return {
    state: "verify" as const,
    documents: [],
    stagedFiles: [],
    rejected: false,
    onAddFiles: vi.fn(),
    onRemoveStagedFile: vi.fn(),
    canSave: false,
    onSave: vi.fn(),
    ...overrides,
  };
}

describe("AccountDocumentsCard — verify state", () => {
  it("renders the warning banner, upload row, requirements list, and a disabled Save", () => {
    render(<AccountDocumentsCard {...baseProps({ state: "verify" })} />);
    expect(screen.getByText("Verify your account")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Upload your company documents to unlock bank transfers.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("account-upload-row")).toBeInTheDocument();
    expect(screen.getByTestId("account-requirements-list")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveClass(
      "bg-[color:var(--color-pipeline-promo)]",
    );
    expect(screen.getByTestId("account-documents-card")).toHaveClass("py-4");
    const uploadButton = screen.getByRole("button", { name: "Upload" });
    expect(uploadButton).toHaveClass(
      "border",
      "border-[color:var(--color-pipeline-line)]",
    );
    expect(uploadButton.parentElement).toHaveClass("p-1");
  });
});

describe("AccountDocumentsCard — staged state", () => {
  const files = [new File([], "certificate-of-incorporation.pdf")];

  it("renders the identity banner, staged rows with remove buttons, and an enabled Save", () => {
    render(
      <AccountDocumentsCard
        {...baseProps({ state: "staged", stagedFiles: files, canSave: true })}
      />,
    );
    expect(screen.getByText("Verify your identity")).toBeInTheDocument();
    expect(screen.getByTestId("account-upload-row")).toBeInTheDocument();
    expect(screen.getByTestId("account-requirements-list")).toBeInTheDocument();
    expect(
      screen.getByText("certificate-of-incorporation.pdf"),
    ).toBeInTheDocument();
    const removeButton = screen.getByRole("button", {
      name: "Remove certificate-of-incorporation.pdf",
    });
    expect(removeButton).toBeInTheDocument();
    expect(removeButton).toHaveClass("size-8");
    expect(removeButton.parentElement).toHaveClass("size-10", "p-1");
    expect(removeButton.closest("li")).toHaveClass("p-2");
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveClass(
      "h-12",
      "bg-[var(--color-pipeline-cta)]",
      "text-[color:var(--color-pipeline-on-dark)]",
    );
    expect(screen.getByTestId("account-documents-card")).toHaveClass("py-4");
  });
});

describe("AccountDocumentsCard — under-review state", () => {
  it("renders the verifying banner and Provided rows with no remove control, no upload row, no Save", () => {
    render(
      <AccountDocumentsCard
        {...baseProps({
          state: "under-review",
          documents: ACCOUNT_STATE_PREVIEWS["under-review"].documents,
        })}
      />,
    );
    expect(screen.getByText("Verifying account")).toBeInTheDocument();
    expect(
      screen.getByText("We are reviewing your documents."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Uploaded").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("account-upload-row")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AccountDocumentsCard — missing state", () => {
  it("renders the negative banner with an inline Upload action and 6 Verified rows", () => {
    const preview = ACCOUNT_STATE_PREVIEWS.missing;
    render(
      <AccountDocumentsCard
        {...baseProps({
          state: "missing",
          documents: preview.documents,
          missingDocumentName: preview.missingDocumentName,
        })}
      />,
    );
    expect(
      screen.getByText("Certificate of Incorporation"),
    ).toBeInTheDocument();
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByText("Please upload the document.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    expect(screen.getAllByText("Verified")).toHaveLength(6);
    expect(screen.queryByTestId("account-upload-row")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass(
      "bg-[color:var(--color-pipeline-negative-secondary)]",
    );
  });
});

describe("AccountDocumentsCard — invalid state", () => {
  it("renders the negative banner with no button, 1 Invalid document row with Re-upload, and 6 Verified rows", () => {
    const preview = ACCOUNT_STATE_PREVIEWS.invalid;
    render(
      <AccountDocumentsCard
        {...baseProps({ state: "invalid", documents: preview.documents })}
      />,
    );
    expect(screen.getByText("Re-upload your document")).toBeInTheDocument();
    expect(
      screen.getByText("Some information may be missing or incorrect"),
    ).toBeInTheDocument();
    expect(screen.getByText("Invalid document")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Re-upload" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Verified")).toHaveLength(6);
    expect(screen.queryByTestId("account-upload-row")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });
});

describe("AccountDocumentsCard — verified state", () => {
  it("renders no banner, 7 Verified rows with decorative chevrons, no upload row, no Save", () => {
    const preview = ACCOUNT_STATE_PREVIEWS.verified;
    render(
      <AccountDocumentsCard
        {...baseProps({ state: "verified", documents: preview.documents })}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByText("Verified")).toHaveLength(7);
    expect(screen.queryByTestId("account-upload-row")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("account-requirements-list"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Re-upload" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveClass("gap-2");
  });
});
