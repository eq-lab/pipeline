import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSession } from "@/auth/session";
import { ApiError, subscribeSessionEnded } from "./client";
import {
  deleteMyDocument,
  getMyLp,
  getMyPaymentDetails,
  getLinkAddressChallenge,
  verifyLinkAddress,
  upsertMyLp,
  uploadMyDocuments,
} from "./lps";

beforeEach(() => {
  localStorage.clear();
  saveSession({ token: "jwt", expires_in: 3600, email: "lp@example.com" });
  vi.restoreAllMocks();
});

describe("LP API client", () => {
  it("requests a challenge with query params and bearer auth, without a signer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "m", nonce: "n" }), {
        status: 200,
      }),
    );
    const challenge = await getLinkAddressChallenge(99000001, "GABC");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/v1\/lps\/me\/link-address\/challenge\?/);
    expect(url).toContain("chain_id=99000001");
    expect(url).toContain("address=GABC");
    expect(url).not.toContain("signer_address");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.headers).toEqual({ Authorization: "Bearer jwt" });
    expect(challenge).toEqual({ message: "m", nonce: "n" });
  });

  it("posts the exact verify body with bearer auth and returns the LP", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, stellar_address: "GABC" }), {
        status: 200,
      }),
    );
    const lp = await verifyLinkAddress({
      chain_id: 99000001,
      address: "GABC",
      signature: "sig",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/v1\/lps\/me\/link-address\/verify$/,
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer jwt",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      chain_id: 99000001,
      address: "GABC",
      signature: "sig",
    });
    expect(lp.stellar_address).toBe("GABC");
  });

  it("surfaces a 422 as ApiError without ending the session", async () => {
    const ended = vi.fn();
    const off = subscribeSessionEnded(ended);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad signature" }), { status: 422 }),
    );
    await expect(
      verifyLinkAddress({ chain_id: 1, address: "GABC", signature: "x" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(ended).not.toHaveBeenCalled();
    off();
  });

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

  it("reads payment details for a chain with bearer auth", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ chain_id: 99000001 }), { status: 200 }),
      );
    await getMyPaymentDetails(99000001);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/v1\/lps\/me\/payment-details\?chain_id=99000001$/,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer jwt",
    });
  });

  it("rejects payment details with an ApiError carrying status 409", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "no address" }), { status: 409 }),
    );
    await expect(getMyPaymentDetails(1)).rejects.toMatchObject({
      status: 409,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 409 }),
    );
    await expect(getMyPaymentDetails(1)).rejects.toBeInstanceOf(ApiError);
  });
});
