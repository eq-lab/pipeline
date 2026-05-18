/**
 * Unit tests for `src/api/client.ts`.
 *
 * Covers:
 *   - Mock key (with query string) resolves first.
 *   - Mock key (without query string) resolves when with-query key is absent.
 *   - With no mock key set, delegates to `globalThis.fetch`.
 *   - Non-2xx with JSON `{ error }` body rejects with that message.
 *   - Non-2xx with non-JSON body falls back to `response.statusText`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiFetch } from "./client";

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

// Replace globalThis.fetch with a mock function for the entire test file.
// This prevents any real network calls from being made.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
});

afterEach(() => {
  localStorage.clear();
});

// ── Mock layer ────────────────────────────────────────────────────────────────

describe("apiFetch — mock layer: with-query-string key", () => {
  it("returns the mocked value when the with-query key is set", async () => {
    const payload = { requests: [{ type: "Deposit" }] };
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests?wallet=0x1234",
      JSON.stringify(payload),
    );

    const result = await apiFetch("/v1/requests?wallet=0x1234");

    expect(result).toEqual(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the with-query key over the without-query key when both are set", async () => {
    const withQuery = { requests: [{ type: "Deposit", _source: "withQuery" }] };
    const withoutQuery = {
      requests: [{ type: "Withdraw", _source: "withoutQuery" }],
    };
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests?wallet=0x1234",
      JSON.stringify(withQuery),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(withoutQuery),
    );

    const result = await apiFetch("/v1/requests?wallet=0x1234");

    expect(result).toEqual(withQuery);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("apiFetch — mock layer: without-query-string fallback", () => {
  it("falls back to the without-query key when the with-query key is absent", async () => {
    const payload = { requests: [] };
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(payload),
    );

    const result = await apiFetch("/v1/requests?wallet=0x1234");

    expect(result).toEqual(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up the key directly when path has no query string", async () => {
    const payload = { ok: true };
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/health",
      JSON.stringify(payload),
    );

    const result = await apiFetch("/v1/health");

    expect(result).toEqual(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Real fetch ────────────────────────────────────────────────────────────────

describe("apiFetch — real fetch (no mock keys)", () => {
  it("calls fetch with the resolved URL when no mock keys are set", async () => {
    const responseBody = { requests: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(responseBody), { status: 200 }),
    );

    const result = await apiFetch("/v1/requests?wallet=0x1234");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/requests?wallet=0x1234",
      undefined,
    );
    expect(result).toEqual(responseBody);
  });

  it("passes RequestInit options to fetch", async () => {
    const responseBody = { ok: true };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(responseBody), { status: 200 }),
    );

    await apiFetch("/v1/data", { method: "POST", body: JSON.stringify({}) });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/data", {
      method: "POST",
      body: JSON.stringify({}),
    });
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("apiFetch — non-2xx responses", () => {
  it("throws with the JSON error message on non-2xx with { error } body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    await expect(apiFetch("/v1/requests")).rejects.toThrow("boom");
  });

  it("falls back to statusText when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(apiFetch("/v1/requests")).rejects.toThrow(
      "Internal Server Error",
    );
  });

  it("falls back to statusText when the error body has no 'error' field", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "oops" }), {
        status: 422,
        statusText: "Unprocessable Entity",
      }),
    );

    await expect(apiFetch("/v1/requests")).rejects.toThrow(
      "Unprocessable Entity",
    );
  });
});
