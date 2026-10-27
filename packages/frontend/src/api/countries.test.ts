// spec: docs/frontend/account-page.md#country-select-1715
import { afterEach, describe, expect, it, vi } from "vitest";
import { COUNTRIES_URL, fetchCountries } from "./countries";

const FIXTURE = { pe: "Peru", nl: "Netherlands", eu: "European Union" };

describe("fetchCountries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests the codes endpoint without credentials or referrer", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const countries = await fetchCountries();
    expect(countries).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      COUNTRIES_URL,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    await expect(fetchCountries()).rejects.toThrow();
  });
});
