// spec: docs/frontend/account-page.md#settlement-address-1813
import { describe, expect, it } from "vitest";
import type { LpResponse } from "@/api";
import {
  SETTLEMENT_CAPTIONS,
  deriveSettlementRow,
  settlementWritable,
  type SettlementRowInput,
} from "./settlementAddress";

const A = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";
const B = "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB";

function lp(overrides: Partial<LpResponse> = {}): LpResponse {
  return {
    id: 1,
    legal_name: "Acme",
    country: "NL",
    contact_email: "a@example.com",
    stellar_address: null,
    address_linked_at: null,
    kyb_status: "NotStarted",
    writable: true,
    notify_on_review: false,
    owner_account_id: "acc",
    owner_chain_id: null,
    owner_address: null,
    created_at: "2026-10-30",
    documents: [],
    ...overrides,
  };
}

function row(input: Partial<SettlementRowInput>) {
  return deriveSettlementRow({
    lpRead: "loaded",
    lp: lp(),
    stellarAddress: null,
    evmConnected: false,
    link: "idle",
    ...input,
  });
}

describe("settlementWritable", () => {
  it.each([
    ["NotStarted", null, true],
    ["UnderReview", null, true],
    ["UnderReview", A, true],
    ["Passed", null, true],
    ["Passed", A, false],
    ["Failed", null, false],
    ["Failed", A, false],
  ])("%s with address %s -> %s", (kyb_status, stellar_address, expected) => {
    expect(settlementWritable(lp({ kyb_status, stellar_address }))).toBe(
      expected,
    );
  });
});

describe("deriveSettlementRow", () => {
  it("linking wins over a Passed LP and shows the connected address", () => {
    expect(
      row({
        link: "linking",
        stellarAddress: A,
        lp: lp({ kyb_status: "Passed", stellar_address: B }),
      }),
    ).toEqual({
      address: A,
      caption: SETTLEMENT_CAPTIONS.linking,
      tone: "muted",
    });
  });

  it.each(["taken", "error"] as const)(
    "%s is negative and keeps the served address",
    (link) => {
      expect(row({ link, lp: lp({ stellar_address: B }) })).toEqual({
        address: B,
        caption: SETTLEMENT_CAPTIONS[link],
        tone: "negative",
      });
    },
  );

  it("Passed with a different connected wallet explains it is not linked", () => {
    expect(
      row({
        stellarAddress: A,
        lp: lp({ kyb_status: "Passed", stellar_address: B }),
      }),
    ).toEqual({
      address: B,
      caption: SETTLEMENT_CAPTIONS.fixedNotConnected,
      tone: "muted",
    });
  });

  it("Passed with a served address and nothing different connected is fixed", () => {
    expect(
      row({ lp: lp({ kyb_status: "Passed", stellar_address: B }) }).caption,
    ).toBe(SETTLEMENT_CAPTIONS.fixed);
  });

  it("a served address matching the connected wallet says linked, verbatim", () => {
    expect(row({ stellarAddress: A, lp: lp({ stellar_address: A }) })).toEqual({
      address: A,
      caption: SETTLEMENT_CAPTIONS.linked,
      tone: "muted",
    });
  });

  it("a served address with another wallet connected has no caption", () => {
    expect(
      row({ stellarAddress: A, lp: lp({ stellar_address: B }) }).caption,
    ).toBeNull();
  });

  it("before the LP exists the connected address is shown as pending", () => {
    expect(row({ lpRead: "absent", lp: null, stellarAddress: A })).toEqual({
      address: A,
      caption: SETTLEMENT_CAPTIONS.pending,
      tone: "muted",
    });
  });

  it("an EVM-only wallet needs a Stellar wallet", () => {
    expect(row({ lp: null, lpRead: "absent", evmConnected: true })).toEqual({
      address: null,
      caption: SETTLEMENT_CAPTIONS.needsStellar,
      tone: "muted",
    });
  });

  it("nothing connected asks for a Stellar wallet", () => {
    expect(row({ lp: null, lpRead: "absent" })).toEqual({
      address: null,
      caption: SETTLEMENT_CAPTIONS.connectStellar,
      tone: "muted",
    });
  });

  it("a loaded LP with no address and a Stellar wallet shows the empty row", () => {
    expect(row({ stellarAddress: A })).toEqual({
      address: null,
      caption: null,
      tone: "muted",
    });
  });
});
