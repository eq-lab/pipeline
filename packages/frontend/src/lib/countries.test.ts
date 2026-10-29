// spec: docs/frontend/account-page.md#country-select-1715
import { describe, expect, it } from "vitest";
import { countryOptions, flagUrl, parseCountries } from "./countries";

const FIXTURE = {
  pe: "Peru",
  nl: "Netherlands",
  gb: "United Kingdom",
  xk: "Kosovo",
  "gb-eng": "England",
  "us-ak": "Alaska",
  eu: "European Union",
  un: "United Nations",
};

describe("parseCountries", () => {
  it("keeps two-letter codes except eu/un, sorted by name, with flag URLs", () => {
    expect(parseCountries(FIXTURE)).toEqual([
      { code: "XK", name: "Kosovo", flagUrl: "https://flagcdn.com/xk.svg" },
      {
        code: "NL",
        name: "Netherlands",
        flagUrl: "https://flagcdn.com/nl.svg",
      },
      { code: "PE", name: "Peru", flagUrl: "https://flagcdn.com/pe.svg" },
      {
        code: "GB",
        name: "United Kingdom",
        flagUrl: "https://flagcdn.com/gb.svg",
      },
    ]);
  });

  it.each([null, [], {}, "x", { eu: "European Union" }])(
    "throws on %j",
    (input) => {
      expect(() => parseCountries(input)).toThrow();
    },
  );
});

describe("countryOptions", () => {
  const countries = parseCountries(FIXTURE);

  it("maps countries to name options with code keywords and flags", () => {
    const options = countryOptions(countries, "Peru");
    expect(options).toHaveLength(4);
    expect(options.find((o) => o.value === "Peru")).toEqual({
      value: "Peru",
      label: "Peru",
      iconUrl: flagUrl("pe"),
      keywords: ["PE"],
    });
  });

  it("appends off-list values once, as saved, with no flag", () => {
    const options = countryOptions(countries, "NL", "France", "NL");
    expect(options.slice(4)).toEqual([
      { value: "NL", label: "NL (as saved)", selectedLabel: "NL" },
      { value: "France", label: "France (as saved)", selectedLabel: "France" },
    ]);
    expect(options[4]).not.toHaveProperty("iconUrl");
  });

  it("matches exactly, so differently cased or padded values are off-list", () => {
    const options = countryOptions(countries, "peru", " Peru");
    expect(options.map((o) => o.value).slice(4)).toEqual(["peru", " Peru"]);
  });

  it("ignores null, undefined and empty values", () => {
    expect(countryOptions(countries, null, undefined, "")).toHaveLength(4);
  });
});
