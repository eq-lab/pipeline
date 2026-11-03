import { describe, it, expect } from "vitest";
import { mapKybStatus, mapLpToRow } from "./-useLpCounterpartiesTable";
import type { LpSummary } from "@/api/useLps";

const BASE_LP: LpSummary = {
  id: 42,
  legal_name: "Acme Capital LP",
  country: "CH",
  contact_email: "ops@acme.example",
  stellar_address: null,
  address_linked_at: null,
  stellar_signer_address: null,
  evm_address: null,
  evm_signer_address: null,
  evm_address_linked_at: null,
  kyb_status: "NotStarted",
  owner_account_id: "00000000-0000-0000-0000-0000000000aa",
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
      band: "info",
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

  it("renders 'No' when neither address is linked (null or empty)", () => {
    expect(mapLpToRow(BASE_LP).blockchainAddress).toBe("No");
    expect(
      mapLpToRow({ ...BASE_LP, stellar_address: "", evm_address: "" })
        .blockchainAddress,
    ).toBe("No");
  });

  it("renders the linked chains and flags an unproven Stellar address", () => {
    const stellar = { stellar_address: "GXYZ", stellar_signer_address: "GSIG" };
    const evm = { evm_address: "0xabc", evm_signer_address: "0xabc" };
    expect(mapLpToRow({ ...BASE_LP, ...stellar }).blockchainAddress).toBe(
      "Stellar",
    );
    expect(mapLpToRow({ ...BASE_LP, ...evm }).blockchainAddress).toBe("EVM");
    expect(
      mapLpToRow({ ...BASE_LP, ...stellar, ...evm }).blockchainAddress,
    ).toBe("Stellar + EVM");
    expect(
      mapLpToRow({ ...BASE_LP, stellar_address: "GXYZ" }).blockchainAddress,
    ).toBe("Stellar (unproven)");
  });

  it("always renders '—' for bankInfo, even with an unmapped future field on the payload", () => {
    const withExtraField = {
      ...BASE_LP,
      bank_info_available: true,
    } as LpSummary & { bank_info_available: boolean };
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
