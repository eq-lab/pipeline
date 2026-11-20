import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@/api";
import type { LpDocument, LpResponse } from "@/api";
import { clearSession, saveSession } from "@/auth/session";
import { useAccountPage } from "./useAccountPage";

const mockGet = vi.fn();
const mockUpsert = vi.fn();
const mockUpload = vi.fn();
const mockSubmit = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    getMyLp: (...args: unknown[]) => mockGet(...args),
    upsertMyLp: (...args: unknown[]) => mockUpsert(...args),
    uploadMyDocuments: (...args: unknown[]) => mockUpload(...args),
    submitMyLp: (...args: unknown[]) => mockSubmit(...args),
    deleteMyDocument: (...args: unknown[]) => mockDelete(...args),
  };
});

function doc(
  id: number,
  name = "company.pdf",
  status: LpDocument["status"] = "Provided",
): LpDocument {
  return {
    id,
    lp_id: 1,
    original_filename: name,
    status,
    size_bytes: 10,
    content_type: "application/pdf",
    reject_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-09-29",
    download_url: null,
  };
}

function lp(overrides: Partial<LpResponse> = {}): LpResponse {
  return {
    id: 1,
    legal_name: "Original Ltd",
    country: "GB",
    contact_email: "stored@example.com",
    stellar_address: null,
    address_linked_at: null,
    stellar_signer_address: null,
    evm_address: null,
    evm_signer_address: null,
    evm_address_linked_at: null,
    kyb_status: "NotStarted",
    writable: true,
    notify_on_review: false,
    settlement_bank_account: null,
    owner_account_id: "account",
    owner_chain_id: null,
    owner_address: null,
    created_at: "2026-09-29",
    documents: [doc(1)],
    ...overrides,
  };
}

function signIn(email?: string) {
  saveSession({ token: "token", expires_in: 3600, email });
}

beforeEach(() => {
  clearSession();
  mockGet.mockReset();
  mockUpsert.mockReset();
  mockUpload.mockReset();
  mockSubmit.mockReset().mockImplementation(async () => {
    const uploaded = await mockUpload.mock.results.at(-1)?.value;
    return { ...uploaded.lp, kyb_status: "UnderReview", writable: false };
  });
  mockDelete.mockReset();
});

describe("useAccountPage", () => {
  it("hands every adopted LP to onLpAdopted and ignores a missing LP", async () => {
    signIn("session@example.com");
    const loaded = lp();
    const saved = lp({ legal_name: "Renamed Ltd" });
    mockGet.mockResolvedValueOnce(loaded);
    mockUpsert.mockResolvedValueOnce(saved);
    const onLpAdopted = vi.fn();
    const { result } = renderHook(() => useAccountPage(true, onLpAdopted));
    await waitFor(() => expect(onLpAdopted).toHaveBeenCalledWith(loaded));
    act(() => result.current.setLegalName("Renamed Ltd"));
    await act(async () => result.current.saveProfile());
    expect(onLpAdopted).toHaveBeenLastCalledWith(saved);
  });

  it("does not call onLpAdopted on a 404", async () => {
    signIn("session@example.com");
    mockGet.mockRejectedValueOnce(new ApiError(404, "missing"));
    const onLpAdopted = vi.fn();
    const { result } = renderHook(() => useAccountPage(true, onLpAdopted));
    await waitFor(() => expect(result.current.readState).toBe("absent"));
    expect(onLpAdopted).not.toHaveBeenCalled();
  });

  it("keeps loading distinct from a missing LP and retries a failed read", async () => {
    signIn("session@example.com");
    let reject!: (error: Error) => void;
    mockGet
      .mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail;
        }),
      )
      .mockRejectedValueOnce(new ApiError(404, "missing"));
    const { result } = renderHook(() => useAccountPage());
    expect(result.current.readState).toBe("loading");
    expect(result.current.email).toBeUndefined();
    await act(async () => reject(new Error("offline")));
    expect(result.current.readState).toBe("error");
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.readState).toBe("absent"));
    expect(result.current.email).toBe("session@example.com");
  });

  it("uses stored email and saves only the complete edited profile", async () => {
    signIn("different@example.com");
    mockGet.mockResolvedValue(lp());
    mockUpsert.mockImplementation(async (profile) =>
      lp({ legal_name: profile.legal_name, country: profile.country }),
    );
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    expect(result.current.email).toBe("stored@example.com");
    expect(result.current.country).toBe("GB");
    act(() => result.current.setLegalName("Edited Ltd"));
    await act(async () => result.current.saveProfile());
    expect(mockUpsert).toHaveBeenCalledWith({
      legal_name: "Edited Ltd",
      country: "GB",
      contact_email: "stored@example.com",
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(result.current.canSaveProfile).toBe(false);
  });

  it("tracks savedCountry as the baseline and sends null for a cleared country", async () => {
    signIn();
    mockGet.mockResolvedValue(lp({ contact_email: "stored@example.com" }));
    let release!: () => void;
    mockUpsert.mockImplementationOnce(
      (profile) =>
        new Promise((resolve) => {
          release = () => resolve(lp({ country: profile.country }));
        }),
    );
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    expect(result.current.savedCountry).toBe("GB");
    act(() => result.current.setCountry("France"));
    expect(result.current.savedCountry).toBe("GB");
    let saving!: Promise<unknown>;
    act(() => {
      saving = result.current.saveProfile();
    });
    expect(result.current.savedCountry).toBe("GB");
    await act(async () => {
      release();
      await saving;
    });
    expect(result.current.savedCountry).toBe("France");
    mockUpsert.mockImplementationOnce(async (profile) =>
      lp({ country: profile.country }),
    );
    act(() => result.current.setCountry(""));
    await act(async () => result.current.saveProfile());
    expect(mockUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ country: null }),
    );
  });

  it("requires session email for creation and does not invent one", async () => {
    signIn();
    mockGet.mockRejectedValue(new ApiError(404, "missing"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("absent"));
    act(() => result.current.setLegalName("New Ltd"));
    expect(result.current.email).toBeUndefined();
    expect(result.current.canSaveProfile).toBe(false);
    expect(result.current.canUpload).toBe(false);
  });

  it("creates a new LP before uploading its first document", async () => {
    signIn("session@example.com");
    mockGet.mockRejectedValue(new ApiError(404, "missing"));
    mockUpsert.mockResolvedValue(
      lp({
        documents: [],
        legal_name: "New Ltd",
        country: null,
        contact_email: "session@example.com",
      }),
    );
    mockUpload.mockResolvedValue({
      lp: lp({
        legal_name: "New Ltd",
        country: null,
        contact_email: "session@example.com",
        documents: [doc(9)],
      }),
      files: [{ filename: "company.pdf", status: 201, id: 9, error: null }],
    });
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("absent"));
    act(() => result.current.setLegalName("New Ltd"));
    act(() =>
      result.current.documents.addFiles([
        new File(["x"], "company.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    expect(mockUpsert).toHaveBeenCalledWith({
      legal_name: "New Ltd",
      country: null,
      contact_email: "session@example.com",
    });
    expect(mockUpload).toHaveBeenCalledOnce();
    expect(result.current.lp?.documents.map((document) => document.id)).toEqual(
      [9],
    );
    expect(result.current.documents.files).toHaveLength(0);
  });

  it("preserves an unsaved draft while deleting a persisted document", async () => {
    signIn("session@example.com");
    mockGet.mockResolvedValue(lp());
    mockDelete.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() => result.current.setLegalName("Draft Ltd"));
    await act(async () => result.current.removeDocument(1));
    expect(mockDelete).toHaveBeenCalledWith(1);
    expect(result.current.lp?.documents).toHaveLength(0);
    expect(result.current.legalName).toBe("Draft Ltd");
    expect(result.current.canSaveProfile).toBe(true);
  });

  it("keeps a document on failed delete and reconciles a conflict", async () => {
    signIn("session@example.com");
    mockGet
      .mockResolvedValueOnce(lp())
      .mockResolvedValueOnce(lp({ writable: false }));
    mockDelete.mockRejectedValue(new ApiError(409, "frozen"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    await act(async () => result.current.removeDocument(1));
    expect(result.current.lp?.documents).toHaveLength(1);
    expect(result.current.writable).toBe(false);
    expect(result.current.actionError).toContain("can no longer be changed");
  });

  it("removes only confirmed upload successes in request order, even with duplicate names", async () => {
    signIn("session@example.com");
    mockGet.mockResolvedValue(lp({ documents: [] }));
    mockUpload.mockResolvedValue({
      lp: lp({ documents: [doc(2)] }),
      files: [
        { filename: "company.pdf", status: 201, id: 2, error: null },
        {
          filename: "company.pdf",
          status: 400,
          id: null,
          error: "too many files",
        },
      ],
    });
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() =>
      result.current.documents.addFiles([
        new File(["a"], "company.pdf", { type: "application/pdf" }),
        new File(["b"], "company.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(result.current.documents.files).toHaveLength(1);
    expect(result.current.actionError).toContain("company.pdf: too many files");
  });

  it("shows all ordered HTTP 400 file errors without dropping staged files", async () => {
    signIn("session@example.com");
    mockGet.mockResolvedValue(lp({ documents: [] }));
    mockUpload.mockRejectedValue(
      new ApiError(400, "rejected", {
        lp: lp({ documents: [] }),
        files: [
          { filename: "a.pdf", status: 400, id: null, error: "too large" },
          { filename: "b.pdf", status: 400, id: null, error: "wrong type" },
        ],
      }),
    );
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() =>
      result.current.documents.addFiles([
        new File(["a"], "a.pdf", { type: "application/pdf" }),
        new File(["b"], "b.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    expect(result.current.documents.files).toHaveLength(2);
    expect(result.current.actionError).toContain(
      "a.pdf: too large; b.pdf: wrong type",
    );
  });

  it("reconciles an uncertain upload before allowing a retry", async () => {
    signIn("session@example.com");
    mockGet
      .mockResolvedValueOnce(lp({ documents: [] }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(lp({ documents: [doc(7)] }));
    mockUpload.mockRejectedValue(new Error("connection lost"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() =>
      result.current.documents.addFiles([
        new File(["a"], "company.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    expect(result.current.uncertainIds).toEqual([]);
    expect(result.current.canUpload).toBe(false);
    await act(async () => result.current.checkUploads());
    await waitFor(() => expect(result.current.uncertainIds).toBeNull());
    expect(result.current.documents.files).toHaveLength(0);
    expect(result.current.lp?.documents.map((document) => document.id)).toEqual(
      [7],
    );
  });

  it("keeps duplicate-name files staged until the user discards the ambiguous batch", async () => {
    signIn("session@example.com");
    mockGet
      .mockResolvedValueOnce(lp({ documents: [] }))
      .mockResolvedValueOnce(lp({ documents: [doc(7, "duplicate.pdf")] }));
    mockUpload.mockRejectedValue(new Error("connection lost"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() =>
      result.current.documents.addFiles([
        new File(["first"], "duplicate.pdf", { type: "application/pdf" }),
        new File(["second"], "duplicate.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    expect(result.current.lp?.documents.map((document) => document.id)).toEqual(
      [7],
    );
    expect(result.current.documents.files).toHaveLength(2);
    expect(result.current.ambiguousNames).toEqual(["duplicate.pdf"]);
    expect(result.current.canUpload).toBe(false);
    expect(result.current.actionError).toContain(
      "cannot tell which copy uploaded",
    );
    act(() => result.current.discardAmbiguous());
    expect(result.current.documents.files).toHaveLength(0);
    expect(result.current.uncertainIds).toBeNull();
    act(() =>
      result.current.documents.addFiles([
        new File(["replacement"], "missing.pdf", { type: "application/pdf" }),
      ]),
    );
    expect(result.current.canUpload).toBe(true);
    expect(mockUpload).toHaveBeenCalledOnce();
  });

  it("locks actions while Check uploads is reading the server", async () => {
    signIn("session@example.com");
    let resolve!: (value: LpResponse) => void;
    mockGet
      .mockResolvedValueOnce(lp({ documents: [] }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
    mockUpload.mockRejectedValue(new Error("connection lost"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() =>
      result.current.documents.addFiles([
        new File(["a"], "company.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    act(() => {
      void result.current.checkUploads();
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.canUpload).toBe(false);
    await act(async () => resolve(lp({ documents: [doc(7)] })));
    expect(result.current.busy).toBe(false);
    expect(result.current.documents.files).toHaveLength(0);
  });

  it("refuses profile and document mutation for a frozen LP", async () => {
    signIn("session@example.com");
    mockGet.mockResolvedValue(
      lp({ writable: false, kyb_status: "UnderReview" }),
    );
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("loaded"));
    act(() => result.current.setLegalName("Attempted edit"));
    act(() =>
      result.current.documents.addFiles([
        new File(["x"], "new.pdf", { type: "application/pdf" }),
      ]),
    );
    expect(result.current.canSaveProfile).toBe(false);
    expect(result.current.canUpload).toBe(false);
    await act(async () => result.current.removeDocument(1));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("surfaces the declined copy and sets the no-retry flag for a 403 account_suspended read", async () => {
    signIn("session@example.com");
    mockGet.mockRejectedValue(new ApiError(403, "account_suspended"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("error"));
    expect(result.current.actionError).toBe(
      "Your account verification was declined. Profile and document changes are unavailable.",
    );
    expect(result.current.actionError).not.toContain("account_suspended");
    expect(result.current.suspended).toBe(true);
  });

  it("keeps today's behavior for an unrelated 403", async () => {
    signIn("session@example.com");
    mockGet.mockRejectedValue(new ApiError(403, "role_forbidden"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("error"));
    expect(result.current.actionError).toBe("role_forbidden");
    expect(result.current.suspended).toBe(false);
  });

  it("still renders the session-expired copy for a 401", async () => {
    signIn("session@example.com");
    mockGet.mockRejectedValue(new ApiError(401, "expired"));
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("error"));
    expect(result.current.actionError).toBe(
      "Your session expired. Sign in again to continue.",
    );
    expect(result.current.suspended).toBe(false);
  });

  it("ignores an LP response after sign-out and performs no preview read", async () => {
    signIn("session@example.com");
    let resolve!: (value: LpResponse) => void;
    mockGet.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useAccountPage());
    act(() => clearSession());
    await act(async () => resolve(lp()));
    expect(result.current.lp).toBeNull();
    expect(result.current.readState).toBe("error");
    expect(result.current.email).toBeUndefined();
    mockGet.mockClear();
    renderHook(() => useAccountPage(false));
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("useAccountPage settlement bank account", () => {
  async function loaded(overrides: Partial<LpResponse> = {}) {
    signIn("session@example.com");
    mockGet.mockResolvedValue(lp(overrides));
    const hook = renderHook(() => useAccountPage());
    await waitFor(() => expect(hook.result.current.readState).toBe("loaded"));
    return hook;
  }

  const summary = {
    account_holder_name: "Holder",
    bank_name: "Bank",
    account_last4: "5432",
  };

  it("sends the trimmed payload through Save profile, then resets the draft", async () => {
    const { result } = await loaded();
    mockUpsert.mockResolvedValueOnce(lp({ settlement_bank_account: summary }));
    act(() => result.current.bank.openForm());
    act(() => result.current.bank.setField("account_holder_name", " Holder "));
    act(() => result.current.bank.setField("bank_name", "Bank"));
    act(() => result.current.bank.setField("iban", "GB82"));
    expect(result.current.canSaveProfile).toBe(true);
    await act(async () => result.current.saveProfile());
    expect(mockUpsert.mock.calls[0]![0].settlement_bank_account).toEqual({
      account_holder_name: "Holder",
      bank_name: "Bank",
      bank_address: null,
      account_number: null,
      iban: "GB82",
      swift_bic_code: null,
      routing_number: null,
    });
    expect(result.current.bank.open).toBe(false);
    expect(result.current.bank.dirty).toBe(false);
    expect(result.current.bankAccount).toEqual(summary);
  });

  it("sends no key without a draft or with an open blank form", async () => {
    const { result } = await loaded();
    mockUpsert.mockResolvedValue(lp({ legal_name: "Renamed" }));
    act(() => result.current.setLegalName("Renamed"));
    act(() => result.current.bank.openForm());
    await act(async () => result.current.saveProfile());
    expect("settlement_bank_account" in mockUpsert.mock.calls[0]![0]).toBe(
      false,
    );
  });

  it("shows a field 400 inline, keeps the draft and raises no generic alert", async () => {
    const { result } = await loaded();
    mockUpsert.mockRejectedValueOnce(
      new ApiError(400, "settlement_bank_account.iban: is not a valid IBAN"),
    );
    act(() => result.current.bank.openForm());
    act(() => result.current.bank.setField("iban", "bad"));
    await act(async () => result.current.saveProfile());
    expect(result.current.bank.errors.iban).toBe("Enter a valid IBAN.");
    expect(result.current.actionError).toBeUndefined();
    expect(result.current.bank.draft.iban).toBe("bad");
    expect(result.current.busy).toBe(false);
  });

  it("clears the draft and refreshes on a 409", async () => {
    const { result } = await loaded();
    mockUpsert.mockRejectedValueOnce(new ApiError(409, "frozen"));
    mockGet.mockResolvedValue(
      lp({ writable: false, kyb_status: "UnderReview" }),
    );
    act(() => result.current.bank.openForm());
    act(() => result.current.bank.setField("iban", "GB82"));
    await act(async () => result.current.saveProfile());
    expect(result.current.bank.dirty).toBe(false);
    expect(result.current.bank.open).toBe(false);
    await waitFor(() => expect(result.current.writable).toBe(false));
  });

  it("blocks upload and submit for review while the draft is dirty", async () => {
    const { result } = await loaded({ documents: [doc(1)] });
    act(() =>
      result.current.documents.addFiles([
        new File(["x"], "new.pdf", { type: "application/pdf" }),
      ]),
    );
    expect(result.current.canUpload).toBe(true);
    expect(result.current.canSaveProfile).toBe(false);
    act(() => result.current.bank.openForm());
    act(() => result.current.bank.setField("iban", "GB82"));
    expect(result.current.canUpload).toBe(false);
    expect(result.current.canSubmitForReview).toBe(false);
    expect(result.current.canSaveProfile).toBe(true);
  });

  it("resets the draft when the session token changes", async () => {
    const { result } = await loaded();
    act(() => result.current.bank.openForm());
    act(() => result.current.bank.setField("iban", "GB82"));
    mockGet.mockResolvedValue(lp({ id: 2 }));
    act(() =>
      saveSession({ token: "other", expires_in: 3600, email: "s@example.com" }),
    );
    await waitFor(() => expect(result.current.bank.dirty).toBe(false));
    expect(result.current.bank.open).toBe(false);
  });

  it("keeps the LP-creating upsert in saveDocuments free of the key", async () => {
    signIn("session@example.com");
    mockGet.mockRejectedValueOnce(new ApiError(404, "missing"));
    mockUpsert.mockResolvedValueOnce(lp({ documents: [] }));
    mockUpload.mockResolvedValue({
      lp: lp({ documents: [doc(9)] }),
      files: [{ filename: "company.pdf", status: 201, id: 9, error: null }],
    });
    const { result } = renderHook(() => useAccountPage());
    await waitFor(() => expect(result.current.readState).toBe("absent"));
    act(() => result.current.setLegalName("New Ltd"));
    act(() =>
      result.current.documents.addFiles([
        new File(["x"], "company.pdf", { type: "application/pdf" }),
      ]),
    );
    await act(async () => result.current.saveDocuments());
    expect("settlement_bank_account" in mockUpsert.mock.calls[0]![0]).toBe(
      false,
    );
  });
});
