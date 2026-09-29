import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSession } from "@/auth/session";
import {
  deleteMyDocument,
  getMyLp,
  upsertMyLp,
  uploadMyDocuments,
} from "./lps";

beforeEach(() => {
  localStorage.clear();
  saveSession({ token: "jwt", expires_in: 3600, email: "lp@example.com" });
  vi.restoreAllMocks();
});

describe("LP API client", () => {
  it("authenticates the read and sends a full JSON profile", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), { status: 200 }),
      );
    await getMyLp();
    await upsertMyLp({
      legal_name: "Acme",
      country: "NL",
      contact_email: "lp@example.com",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer jwt",
    });
    const profile = fetchMock.mock.calls[1]?.[1];
    expect(profile?.headers).toEqual({
      Authorization: "Bearer jwt",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(profile?.body as string)).toEqual({
      legal_name: "Acme",
      country: "NL",
      contact_email: "lp@example.com",
    });
  });

  it("sends file parts only, preserving order, and parses a 207 response", async () => {
    const response = {
      lp: { documents: [] },
      files: [
        { filename: "same.pdf", status: 201, id: 1, error: null },
        { filename: "same.pdf", status: 400, id: null, error: "invalid bytes" },
      ],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 207 }),
      );
    const files = [
      new File(["a"], "same.pdf", { type: "application/pdf" }),
      new File(["b"], "same.pdf", { type: "application/pdf" }),
    ];
    expect(await uploadMyDocuments(files)).toEqual(response);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toEqual({ Authorization: "Bearer jwt" });
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).getAll("files")).toEqual(files);
    expect(Array.from((request?.body as FormData).keys())).toEqual([
      "files",
      "files",
    ]);
  });

  it("deletes by document id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await deleteMyDocument(42);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(
      /\/v1\/lps\/me\/documents\/42$/,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { Authorization: "Bearer jwt" },
    });
  });
});
