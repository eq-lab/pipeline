import { describe, it, expect } from "vitest";
import { mapKybStatus, mapLpToRow } from "./-useLpCounterpartiesTable";
import type { LpResponse } from "@/api/useLps";

const BASE_LP: LpResponse = {
  id: 42,
  legal_name: "Acme Capital LP",
  country: "CH",
  contact_email: "ops@acme.example",
  stellar_address: null,
  address_linked_at: null,
  kyb_status: "NotStarted",
  owner_chain_id: 99_000_001,
  owner_address: "GABC",
  created_at: "2026-06-18T23:40:00Z",
};

describe("mapKybStatus", () => {
  it("maps every served enum value to the exact label + band", () => {
    expect(mapKybStatus("NotStarted")).toEqual({
      label: "New",
      band: "neutral",
    });
    expect(mapKybStatus("InProgress")).toEqual({
      label: "KYB Pending",
      band: "attention",
    });
    expect(mapKybStatus("UnderReview")).toEqual({
      label: "KYB Pending",
      band: "attention",
    });
    expect(mapKybStatus("Passed")).toEqual({
      label: "Approved",
      band: "positive",
    });
    expect(mapKybStatus("Failed")).toEqual({
      label: "Rejected",
      band: "negative",
    });
  });

  it("falls back to the raw string, neutral band, for an unknown value", () => {
    expect(mapKybStatus("Something")).toEqual({
      label: "Something",
      band: "neutral",
    });
  });

  it("falls back to the em-dash for an empty string", () => {
    expect(mapKybStatus("")).toEqual({ label: "—", band: "neutral" });
  });
});

describe("mapLpToRow", () => {
  it("renders '—' for a null country", () => {
    expect(mapLpToRow({ ...BASE_LP, country: null }).jurisdiction).toBe("—");
  });

  it("renders '—' for an empty-string country", () => {
    expect(mapLpToRow({ ...BASE_LP, country: "" }).jurisdiction).toBe("—");
  });

  it("renders a real country string verbatim, no code-to-name translation", () => {
    expect(mapLpToRow({ ...BASE_LP, country: "CH" }).jurisdiction).toBe("CH");
    expect(
      mapLpToRow({ ...BASE_LP, country: "Switzerland" }).jurisdiction,
    ).toBe("Switzerland");
  });

  it("renders 'No' for a null or empty stellar_address", () => {
    expect(
      mapLpToRow({ ...BASE_LP, stellar_address: null }).blockchainAddress,
    ).toBe("No");
    expect(
      mapLpToRow({ ...BASE_LP, stellar_address: "" }).blockchainAddress,
    ).toBe("No");
  });

  it("renders 'Yes' for a non-empty stellar_address", () => {
    expect(
      mapLpToRow({ ...BASE_LP, stellar_address: "GXYZ" }).blockchainAddress,
    ).toBe("Yes");
  });

  it("always renders '—' for bankInfo, even with an unmapped future field on the payload", () => {
    const withExtraField = {
      ...BASE_LP,
      bank_info_available: true,
    } as LpResponse & { bank_info_available: boolean };
    expect(mapLpToRow(withExtraField).bankInfo).toBe("—");
    expect(mapLpToRow(BASE_LP).bankInfo).toBe("—");
  });

  it("formats created_at as day + short month + year; '—' for garbage", () => {
    expect(
      mapLpToRow({ ...BASE_LP, created_at: "2026-06-18T23:40:00Z" })
        .registeredOn,
    ).toBe("18 Jun 2026");
    expect(
      mapLpToRow({ ...BASE_LP, created_at: "not-a-date" }).registeredOn,
    ).toBe("—");
  });

  it("renders '—' for an empty legal_name", () => {
    expect(mapLpToRow({ ...BASE_LP, legal_name: "" }).legalName).toBe("—");
  });
});
