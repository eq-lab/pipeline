import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanyDocsModal } from "./CompanyDocsModal";
import { ApiError } from "@/api";
import type { LpResponse } from "@/api";
import { saveSession, clearSession } from "@/auth/session";
import {
  CountriesWrapper,
  settleCountryRetries,
  stubCountriesFetch,
} from "@/test-support/countries";

const mockUpsert = vi.fn();
const mockUpload = vi.fn();
const mockSubmit = vi.fn();
const mockDelete = vi.fn();
const mockGet = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    upsertMyLp: (...args: unknown[]) => mockUpsert(...args),
    uploadMyDocuments: (...args: unknown[]) => mockUpload(...args),
    submitMyLp: (...args: unknown[]) => mockSubmit(...args),
    deleteMyDocument: (...args: unknown[]) => mockDelete(...args),
    getMyLp: (...args: unknown[]) => mockGet(...args),
  };
});

beforeEach(() => {
  mockUpsert.mockReset();
  mockUpload.mockReset();
  mockSubmit.mockReset().mockImplementation(async () => {
    const uploaded = await mockUpload.mock.results.at(-1)?.value;
    const saved = uploaded?.lp ?? (await mockUpsert.mock.results.at(-1)?.value);
    return { ...saved, kyb_status: "UnderReview", writable: false };
  });
  mockDelete.mockReset();
  mockGet.mockReset();
  clearSession();
  stubCountriesFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderModal(
  props: Partial<React.ComponentProps<typeof CompanyDocsModal>> = {},
) {
  const onDismiss = props.onDismiss ?? vi.fn();
  const rendered = render(
    <CompanyDocsModal
      open={props.open ?? true}
      onDismiss={onDismiss}
      {...props}
    />,
    { wrapper: CountriesWrapper },
  );
  if (props.lp === undefined) {
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Preview Corp" },
    });
  }
  return {
    onDismiss,
    ...rendered,
  };
}

async function countryBox(): Promise<HTMLInputElement> {
  const box = (await screen.findByRole("combobox", {
    name: "Country",
  })) as HTMLInputElement;
  await waitFor(() => expect(box).toBeEnabled());
  return box;
}

async function pickCountry(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  option: string,
) {
  const box = await countryBox();
  await user.clear(box);
  await user.type(box, query);
  await user.click(screen.getByRole("option", { name: option }));
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

  it("requires a nonblank name as well as a staged file", () => {
    renderModal();
    upload([makeFile("doc.pdf", "application/pdf")]);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "   " },
    });
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
    expect(screen.getByText("Ready to upload")).toBeInTheDocument();
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

function lp(
  documents: LpResponse["documents"] = [],
  overrides: Partial<LpResponse> = {},
): LpResponse {
  return {
    id: 7,
    legal_name: "Existing Name",
    country: "NL",
    contact_email: "existing@example.com",
    stellar_address: null,
    address_linked_at: null,
    kyb_status: "NotStarted",
    writable: true,
    notify_on_review: false,
    owner_account_id: "owner",
    owner_chain_id: null,
    owner_address: null,
    created_at: "2026-09-29T00:00:00Z",
    documents,
    ...overrides,
  };
}

function makeDocument(
  id: number,
  status: "Provided" | "Verified" = "Provided",
): LpResponse["documents"][number] {
  return {
    id,
    lp_id: 7,
    original_filename: "saved.pdf",
    size_bytes: 1,
    content_type: "application/pdf",
    status,
    reject_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-09-29T00:00:00Z",
    download_url: null,
  };
}

describe("CompanyDocsModal — production requests", () => {
  beforeEach(() => {
    saveSession({ token: "jwt", expires_in: 3600 });
  });
  it("saves changed profile fields and submits existing documents without uploading files", async () => {
    const existing = lp([makeDocument(5)]);
    const saved = {
      ...existing,
      legal_name: "Changed Name",
      country: "United States",
    };
    mockUpsert.mockResolvedValueOnce(saved);
    renderModal({ lp: existing });
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Changed Name" },
    });
    await pickCountry(userEvent.setup(), "us", "United States");
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith({
        legal_name: "Changed Name",
        country: "United States",
        contact_email: "existing@example.com",
      }),
    );
    expect(mockUpload).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled(),
    );
  });

  it("prefills profile and sends full replace before upload", async () => {
    const saved = lp();
    mockUpsert.mockResolvedValueOnce(saved);
    mockUpload.mockResolvedValueOnce({
      lp: lp([makeDocument(2)]),
      files: [{ filename: "doc.pdf", status: 201, id: 2, error: null }],
    });
    renderModal({ lp: saved });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Existing Name",
    );
    expect(await countryBox()).toHaveValue("NL");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Changed" },
    });
    upload([makeFile("doc.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledOnce());
    expect(mockUpsert).toHaveBeenCalledWith({
      legal_name: "Changed",
      country: "NL",
      contact_email: "existing@example.com",
    });
    expect(mockUpsert.mock.invocationCallOrder[0]!).toBeLessThan(
      mockUpload.mock.invocationCallOrder[0]!,
    );
    await waitFor(() =>
      expect(screen.getByText("saved.pdf")).toBeInTheDocument(),
    );
    expect(screen.queryByText("doc.pdf")).not.toBeInTheDocument();
  });

  it("keeps only failed duplicate-name files after a partial upload", async () => {
    const saved = lp();
    mockUpsert.mockResolvedValue(saved);
    mockUpload.mockResolvedValueOnce({
      lp: lp([makeDocument(3)]),
      files: [
        { filename: "same.pdf", status: 201, id: 3, error: null },
        { filename: "same.pdf", status: 400, id: null, error: "invalid bytes" },
      ],
    });
    renderModal({ lp: saved });
    upload([
      makeFile("same.pdf", "application/pdf"),
      makeFile("same.pdf", "application/pdf"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("invalid bytes"),
    );
    expect(screen.getAllByText("same.pdf")).toHaveLength(1);
    expect(mockUpload.mock.calls[0]?.[0]).toHaveLength(2);
    mockUpload.mockResolvedValueOnce({
      lp: lp([makeDocument(3), makeDocument(4)]),
      files: [{ filename: "same.pdf", status: 201, id: 4, error: null }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    expect(mockUpload.mock.calls[1]?.[0]).toHaveLength(1);
  });

  it("shows ordered file errors from an all-rejected HTTP 400 upload", async () => {
    const existing = lp();
    mockUpsert.mockResolvedValueOnce(existing);
    mockUpload.mockRejectedValueOnce(
      new ApiError(400, "Bad Request", {
        lp: existing,
        files: [
          {
            filename: "same.pdf",
            status: 400,
            id: null,
            error: "invalid PDF bytes",
          },
          {
            filename: "same.pdf",
            status: 400,
            id: null,
            error: "unsupported image data",
          },
        ],
      }),
    );
    renderModal({ lp: existing });
    upload([
      makeFile("same.pdf", "application/pdf"),
      makeFile("same.pdf", "application/pdf"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "same.pdf: invalid PDF bytes; same.pdf: unsupported image data",
      ),
    );
    expect(screen.getAllByText("same.pdf")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("keeps unsaved Name and Country drafts through deletion and same-LP prop refresh", async () => {
    const existing = lp([makeDocument(9)]);
    const onLpChange = vi.fn();
    const onDismiss = vi.fn();
    mockDelete.mockResolvedValueOnce(undefined);
    const { rerender } = renderModal({ lp: existing, onLpChange, onDismiss });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Draft Name" },
    });
    await pickCountry(userEvent.setup(), "fra", "France");
    fireEvent.click(screen.getByRole("button", { name: "Remove saved.pdf" }));
    await waitFor(() => expect(onLpChange).toHaveBeenCalledOnce());
    rerender(
      <CompanyDocsModal
        open
        onDismiss={onDismiss}
        lp={onLpChange.mock.calls[0]![0]}
        onLpChange={onLpChange}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Draft Name",
    );
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveValue(
      "France",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    rerender(
      <CompanyDocsModal
        open
        onDismiss={onDismiss}
        lp={{ ...existing, id: 8, legal_name: "Other LP", country: "GB" }}
        onLpChange={onLpChange}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Other LP",
    );
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveValue("GB");
  });

  it("sends only the plain name for a picked country, never a code or flag URL", async () => {
    const existing = lp([makeDocument(5)]);
    mockUpsert.mockResolvedValueOnce({ ...existing, country: "Peru" });
    renderModal({ lp: existing });
    const user = userEvent.setup();
    const box = await countryBox();
    await user.clear(box);
    await user.type(box, "per");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(box).toHaveValue("Peru");
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledOnce());
    const payload = mockUpsert.mock.calls[0]![0];
    expect(payload.country).toBe("Peru");
    const json = JSON.stringify(payload);
    expect(json).not.toContain("flagcdn.com");
    expect(json).not.toMatch(/"PE"|"pe"/);
  });

  it("keeps the previous country when free text is typed and abandoned", async () => {
    const existing = lp([makeDocument(5)]);
    mockUpsert.mockResolvedValueOnce(existing);
    renderModal({ lp: existing });
    const user = userEvent.setup();
    const box = await countryBox();
    await user.clear(box);
    await user.type(box, "Atlantis");
    await user.tab();
    expect(box).toHaveValue("NL");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ country: "NL" }),
      ),
    );
  });

  it("offers an off-list saved value as 'as saved' and re-picks it after another country", async () => {
    const existing = lp([makeDocument(5)]);
    mockUpsert.mockResolvedValueOnce(existing);
    renderModal({ lp: existing });
    const user = userEvent.setup();
    const box = await countryBox();
    expect(box).toHaveValue("NL");
    await user.click(box);
    expect(
      screen.getByRole("option", { name: "NL (as saved)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "France" }));
    expect(box).toHaveValue("France");
    await user.click(box);
    await user.click(screen.getByRole("option", { name: "NL (as saved)" }));
    expect(box).toHaveValue("NL");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ country: "NL" }),
      ),
    );
  });

  it("sends country null after the Clear country button", async () => {
    const existing = lp([makeDocument(5)]);
    mockUpsert.mockResolvedValueOnce({ ...existing, country: null });
    renderModal({ lp: existing });
    await countryBox();
    fireEvent.click(screen.getByRole("button", { name: "Clear country" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ country: null }),
      ),
    );
  });

  it("falls back to a free-text field holding the stored value when the list cannot load", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubCountriesFetch({ fail: true });
    const existing = lp([makeDocument(5)]);
    mockUpsert.mockResolvedValueOnce(existing);
    renderModal({ lp: existing });
    await settleCountryRetries();
    const field = await screen.findByRole("textbox", { name: "Country" });
    expect(field).toHaveValue("NL");
    expect(
      screen.getByText(
        "Couldn't load the country list. Type your country instead.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ country: "NL" }),
      ),
    );
  });

  it("deletes a persisted file by id after success and protects Verified files", async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    renderModal({ lp: lp([makeDocument(9), makeDocument(10, "Verified")]) });
    expect(screen.getAllByText("saved.pdf")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Remove saved.pdf" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove saved.pdf" }));
    expect(mockDelete).toHaveBeenCalledWith(9);
    await waitFor(() =>
      expect(screen.getAllByText("saved.pdf")).toHaveLength(1),
    );
  });

  it("disables editing when the LP is frozen and requires a known email for a new LP", () => {
    const { unmount } = renderModal({ lp: lp([], { writable: false }) });
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    unmount();
    renderModal({ lp: null });
    expect(
      screen.getByText("Sign out and sign in again to complete setup."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });

  it("uses the authenticated email for a new LP", async () => {
    saveSession({ token: "jwt", expires_in: 3600, email: "new@example.com" });
    mockUpsert.mockResolvedValueOnce(
      lp([], { contact_email: "new@example.com" }),
    );
    mockUpload.mockResolvedValueOnce({
      lp: lp([makeDocument(1)]),
      files: [{ filename: "doc.pdf", status: 201, id: 1, error: null }],
    });
    renderModal({ lp: null, sessionEmail: "new@example.com" });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "New LP" },
    });
    upload([makeFile("doc.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith({
        legal_name: "New LP",
        country: null,
        contact_email: "new@example.com",
      }),
    );
  });

  it("keeps staged files when upload fails after profile save", async () => {
    mockUpsert.mockResolvedValueOnce(lp());
    mockUpload.mockRejectedValueOnce(new ApiError(413, "too large"));
    renderModal({ lp: lp() });
    upload([makeFile("doc.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("too large"),
    );
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });

  it("reconciles a conflicted delete without hiding an unchanged server row", async () => {
    mockDelete.mockRejectedValueOnce(new ApiError(409, "verified"));
    mockGet.mockResolvedValueOnce(lp([makeDocument(9, "Verified")]));
    renderModal({ lp: lp([makeDocument(9)]) });
    fireEvent.click(screen.getByRole("button", { name: "Remove saved.pdf" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "can no longer be changed",
      ),
    );
    expect(screen.getByText("saved.pdf")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove saved.pdf" }),
    ).not.toBeInTheDocument();
  });

  it("reconciles an uncertain upload before allowing another submission", async () => {
    mockUpsert.mockResolvedValueOnce(lp());
    mockUpload.mockRejectedValueOnce(new TypeError("Connection lost"));
    mockGet
      .mockRejectedValueOnce(new TypeError("Still offline"))
      .mockResolvedValueOnce(lp([makeDocument(11)]));
    renderModal({ lp: lp() });
    upload([makeFile("saved.pdf", "application/pdf")]);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Check uploads" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check uploads" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Check uploads" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("saved.pdf")).toBeInTheDocument();
    const submitForReview = screen.getByRole("button", {
      name: "Submit for review",
    });
    expect(submitForReview).toBeEnabled();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    mockSubmit.mockResolvedValueOnce(
      lp([makeDocument(11)], { kyb_status: "UnderReview", writable: false }),
    );
    fireEvent.click(submitForReview);
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled(),
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
});

describe("CompanyDocsModal — uncertain upload with duplicate filenames (#1572, BUG-23)", () => {
  beforeEach(() => {
    saveSession({ token: "jwt", expires_in: 3600 });
  });

  function uncertainUpload(staged: File[]) {
    mockUpsert.mockResolvedValueOnce(lp());
    mockUpload.mockRejectedValueOnce(new TypeError("Connection lost"));
    renderModal({ lp: lp() });
    upload(staged);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  }

  it("keeps both same-name copies, blocks Submit, and offers Discard when the read-back cannot tell them apart", async () => {
    mockGet.mockResolvedValueOnce(
      lp([{ ...makeDocument(21), original_filename: "same.pdf" }]),
    );
    uncertainUpload([
      makeFile("same.pdf", "application/pdf", 10),
      makeFile("same.pdf", "application/pdf", 20),
    ]);
    const discard = await screen.findByRole("button", {
      name: "Discard uncertain staged files",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot tell which copy uploaded",
    );
    expect(screen.getAllByText("same.pdf")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Check uploads" }),
    ).not.toBeInTheDocument();

    fireEvent.click(discard);
    await waitFor(() =>
      expect(screen.getAllByText("same.pdf")).toHaveLength(1),
    );
    expect(
      screen.queryByRole("button", { name: "Discard uncertain staged files" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Uncertain staged files were discarded",
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("treats two returned same-name documents as ambiguous too — the LP discards the staged copies", async () => {
    mockGet.mockResolvedValueOnce(
      lp([
        { ...makeDocument(21), original_filename: "same.pdf" },
        { ...makeDocument(22), original_filename: "same.pdf" },
      ]),
    );
    uncertainUpload([
      makeFile("same.pdf", "application/pdf", 10),
      makeFile("same.pdf", "application/pdf", 20),
    ]);
    const discard = await screen.findByRole("button", {
      name: "Discard uncertain staged files",
    });
    expect(screen.getAllByText("same.pdf")).toHaveLength(4);
    fireEvent.click(discard);
    await waitFor(() =>
      expect(screen.getAllByText("same.pdf")).toHaveLength(2),
    );
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeEnabled();
  });

  it("removes exactly the matched staged file and keeps the differently named one staged", async () => {
    mockGet.mockResolvedValueOnce(
      lp([{ ...makeDocument(21), original_filename: "b.pdf" }]),
    );
    uncertainUpload([
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.pdf", "application/pdf"),
    ]);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Review the remaining files and submit again",
      ),
    );
    expect(screen.getAllByText("a.pdf")).toHaveLength(1);
    expect(screen.getAllByText("b.pdf")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
  });
});
