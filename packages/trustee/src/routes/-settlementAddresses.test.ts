import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560048 },
}));

import {
  chainKindOf,
  linkedAddressesLabel,
  settlementAddressRows,
  type SettlementAddressFields,
} from "./-settlementAddresses";

const NONE: SettlementAddressFields = {
  stellar_address: null,
  address_linked_at: null,
  stellar_signer_address: null,
  evm_address: null,
  evm_address_linked_at: null,
  evm_signer_address: null,
};
const STELLAR = {
  stellar_address: "GADDR",
  address_linked_at: "2026-10-01T10:30:00Z",
  stellar_signer_address: "GADDR",
};
const EVM = {
  evm_address: "0xabc",
  evm_address_linked_at: "2026-09-02T00:00:00Z",
  evm_signer_address: "0xabc",
};

describe("linkedAddressesLabel", () => {
  it("is No when nothing is linked, for null and empty", () => {
    expect(linkedAddressesLabel(NONE)).toBe("No");
    expect(
      linkedAddressesLabel({ ...NONE, stellar_address: "", evm_address: "" }),
    ).toBe("No");
  });

  it("names the linked chains and flags unproven ones", () => {
    expect(linkedAddressesLabel({ ...NONE, ...STELLAR })).toBe("Stellar");
    expect(
      linkedAddressesLabel({
        ...NONE,
        ...STELLAR,
        stellar_signer_address: null,
      }),
    ).toBe("Stellar (unproven)");
    expect(linkedAddressesLabel({ ...NONE, ...EVM })).toBe("EVM");
    expect(linkedAddressesLabel({ ...NONE, ...STELLAR, ...EVM })).toBe(
      "Stellar + EVM",
    );
    expect(
      linkedAddressesLabel({
        ...NONE,
        ...STELLAR,
        ...EVM,
        stellar_signer_address: null,
      }),
    ).toBe("Stellar (unproven) + EVM");
  });
});

describe("settlementAddressRows", () => {
  it("lists Stellar first, then EVM", () => {
    const rows = settlementAddressRows({ ...NONE, ...EVM, ...STELLAR });
    expect(rows.map((row) => row.kind)).toEqual(["stellar", "evm"]);
  });

  it("marks a null signer as unproven", () => {
    const [row] = settlementAddressRows({
      ...NONE,
      ...STELLAR,
      stellar_signer_address: null,
    });
    expect(row).toMatchObject({ signer: null, isUnproven: true });
  });

  it("serves a signer that differs from the address verbatim", () => {
    const [row] = settlementAddressRows({
      ...NONE,
      ...STELLAR,
      stellar_address: "CCONTRACT",
      stellar_signer_address: "GSIGNER",
    });
    expect(row).toMatchObject({
      address: "CCONTRACT",
      signer: "GSIGNER",
      isUnproven: false,
    });
  });

  it("formats linked-at and uses a dash when null", () => {
    const rows = settlementAddressRows({
      ...NONE,
      ...STELLAR,
      ...EVM,
      evm_address_linked_at: null,
    });
    expect(rows[0]!.linkedAt).toBe("1 Oct 2026, 10:30 UTC");
    expect(rows[1]!.linkedAt).toBe("—");
  });
});

describe("chainKindOf", () => {
  it("maps chain ids to a kind, defaulting to Stellar", () => {
    expect(chainKindOf(99_000_001)).toBe("stellar");
    expect(chainKindOf(560048)).toBe("evm");
    expect(chainKindOf(undefined)).toBe("stellar");
    expect(chainKindOf(null)).toBe("stellar");
  });
});
