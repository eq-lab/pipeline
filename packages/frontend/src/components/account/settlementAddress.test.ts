// spec: docs/frontend/account-page.md#settlement-address
import { describe, expect, it } from "vitest";
import type { LpResponse } from "@/api";
import {
  SETTLEMENT_CAPTIONS as C,
  SETTLEMENT_LABELS,
  baseAction,
  connectedWallet,
  deriveSettlementRows,
  sameAddress,
  settlementWritable,
  type ConnectedWallet,
  type SettlementLinkState,
  type SettlementRowsInput,
} from "./settlementAddress";

const A = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";
const B = "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB";
const E1 = "0xAbC0000000000000000000000000000000000001";
const E2 = "0xdef0000000000000000000000000000000000002";

function lp(overrides: Partial<LpResponse> = {}): LpResponse {
  return {
    id: 1,
    legal_name: "Acme",
    country: "NL",
    contact_email: "a@example.com",
    stellar_address: null,
    address_linked_at: null,
    stellar_signer_address: null,
    evm_address: null,
    evm_signer_address: null,
    evm_address_linked_at: null,
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

const stellar = (address: string): ConnectedWallet => ({
  kind: "stellar",
  address,
});
const evm = (address: string): ConnectedWallet => ({ kind: "evm", address });
const idle: SettlementLinkState = { kind: null, phase: "idle" };

function rows(input: Partial<SettlementRowsInput>) {
  return deriveSettlementRows({
    lpRead: "loaded",
    lp: lp(),
    connected: null,
    link: idle,
    ...input,
  });
}

function one(input: Partial<SettlementRowsInput>) {
  const result = rows(input);
  expect(result).toHaveLength(1);
  return result[0]!;
}

describe("settlementWritable", () => {
  it.each([
    ["NotStarted", true],
    ["Draft", true],
    ["UnderReview", true],
    ["Passed", true],
    ["Rejected", true],
    ["Failed", false],
  ])("%s -> %s", (kyb_status, expected) => {
    expect(settlementWritable(lp({ kyb_status }))).toBe(expected);
  });
});

describe("sameAddress", () => {
  it("compares EVM addresses case-insensitively and Stellar verbatim", () => {
    expect(sameAddress("evm", E1, E1.toLowerCase())).toBe(true);
    expect(sameAddress("stellar", A, A.toLowerCase())).toBe(false);
    expect(sameAddress("stellar", A, A)).toBe(true);
  });
});

describe("connectedWallet", () => {
  const off = { isConnected: false, address: undefined };
  it.each([
    [
      "EVM wins over Stellar",
      { isConnected: true, address: E1 },
      { isConnected: true, address: A },
      evm(E1),
    ],
    [
      "Stellar when EVM is off",
      off,
      { isConnected: true, address: A },
      stellar(A),
    ],
    ["EVM alone", { isConnected: true, address: E1 }, off, evm(E1)],
    ["none", off, off, null],
    [
      "connected without address",
      { isConnected: true, address: undefined },
      off,
      null,
    ],
  ])("%s", (_name, e, s, expected) => {
    expect(connectedWallet(e, s)).toEqual(expected);
  });
});

describe("baseAction", () => {
  it("is null without an LP or without a connected wallet of the kind", () => {
    expect(baseAction(null, "stellar", stellar(A))).toBeNull();
    expect(baseAction(lp(), "stellar", null)).toBeNull();
    expect(baseAction(lp(), "stellar", evm(E1))).toBeNull();
    expect(baseAction(lp(), "evm", stellar(A))).toBeNull();
  });

  it.each(["NotStarted", "UnderReview", "Passed"])(
    "%s: link when nothing is served, change when different, link when unproven, null when proven",
    (kyb_status) => {
      expect(baseAction(lp({ kyb_status }), "stellar", stellar(A))).toBe(
        "link",
      );
      expect(
        baseAction(
          lp({ kyb_status, stellar_address: B }),
          "stellar",
          stellar(A),
        ),
      ).toBe("change");
      expect(
        baseAction(
          lp({ kyb_status, stellar_address: A }),
          "stellar",
          stellar(A),
        ),
      ).toBe("link");
      expect(
        baseAction(
          lp({ kyb_status, stellar_address: A, stellar_signer_address: A }),
          "stellar",
          stellar(A),
        ),
      ).toBeNull();
    },
  );

  it("Failed refuses everything", () => {
    const failed = lp({ kyb_status: "Failed" });
    expect(baseAction(failed, "stellar", stellar(A))).toBeNull();
    expect(
      baseAction(
        lp({ kyb_status: "Failed", stellar_address: B }),
        "stellar",
        stellar(A),
      ),
    ).toBeNull();
  });

  it("EVM compares case-insensitively and reads the EVM signer", () => {
    const proven = lp({
      evm_address: E1.toLowerCase(),
      evm_signer_address: E1.toLowerCase(),
    });
    expect(baseAction(proven, "evm", evm(E1))).toBeNull();
    expect(
      baseAction(lp({ evm_address: E1.toLowerCase() }), "evm", evm(E1)),
    ).toBe("link");
    expect(baseAction(proven, "evm", evm(E2))).toBe("change");
  });
});

describe("deriveSettlementRows", () => {
  it("returns the generic row with nothing served or connected", () => {
    expect(one({ lp: null, lpRead: "absent" })).toEqual({
      kind: null,
      label: SETTLEMENT_LABELS.none,
      address: null,
      caption: C.connect,
      tone: "muted",
      action: null,
      confirm: null,
      busy: false,
    });
  });

  it.each(["requesting", "verifying"] as const)(
    "1: %s is busy with no button",
    (phase) => {
      expect(
        one({ connected: stellar(A), link: { kind: "stellar", phase } }),
      ).toMatchObject({
        caption: C.linking,
        action: null,
        busy: true,
        tone: "muted",
      });
    },
  );

  it("2: signing is busy with the signing caption", () => {
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "signing" },
      }),
    ).toMatchObject({ caption: C.signing, action: null, busy: true });
  });

  it("3: confirming a change names both addresses and offers no other button", () => {
    expect(
      one({
        connected: stellar(B),
        lp: lp({ stellar_address: A }),
        link: { kind: "stellar", phase: "confirming" },
      }),
    ).toMatchObject({
      address: A,
      caption: C.confirm,
      action: null,
      confirm: { from: A, to: B },
    });
  });

  it("3: confirming falls through when the change no longer applies", () => {
    const view = one({
      connected: stellar(A),
      lp: lp({ stellar_address: A, stellar_signer_address: A }),
      link: { kind: "stellar", phase: "confirming" },
    });
    expect(view.confirm).toBeNull();
    expect(view.caption).toBe(C.linked);
  });

  it("4: declined offers the base action again", () => {
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "declined" },
      }),
    ).toMatchObject({ caption: C.declined, tone: "muted", action: "link" });
    expect(
      one({
        connected: stellar(B),
        lp: lp({ stellar_address: A }),
        link: { kind: "stellar", phase: "declined" },
      }),
    ).toMatchObject({ action: "change" });
  });

  it.each(["proofFailed", "error"] as const)(
    "5/7: %s is negative with Try again",
    (phase) => {
      expect(
        one({ connected: stellar(A), link: { kind: "stellar", phase } }),
      ).toMatchObject({ caption: C[phase], tone: "negative", action: "retry" });
    },
  );

  it.each(["proofFailed", "error"] as const)(
    "5/7: %s without a base action has no button",
    (phase) => {
      expect(
        one({
          lp: lp({ stellar_address: A }),
          link: { kind: "stellar", phase },
        }),
      ).toMatchObject({ action: null });
    },
  );

  it("6: taken is negative without a button", () => {
    expect(
      one({ connected: stellar(A), link: { kind: "stellar", phase: "taken" } }),
    ).toMatchObject({ caption: C.taken, tone: "negative", action: null });
  });

  it("8: a served unproven address equal to the connected one offers Link wallet", () => {
    expect(
      one({
        connected: stellar(A),
        lp: lp({ kyb_status: "Passed", stellar_address: A }),
      }),
    ).toMatchObject({ address: A, caption: C.unproven, action: "link" });
  });

  it("9: a proven match says linked with no button", () => {
    expect(
      one({
        connected: stellar(A),
        lp: lp({ stellar_address: A, stellar_signer_address: A }),
      }),
    ).toMatchObject({ caption: C.linked, action: null });
  });

  it("10: a different connected wallet offers Change wallet", () => {
    expect(
      one({ connected: stellar(B), lp: lp({ stellar_address: A }) }),
    ).toMatchObject({ address: A, caption: C.different, action: "change" });
  });

  it("11: a served address with no wallet of its kind, or Failed, has no caption or button", () => {
    expect(one({ lp: lp({ stellar_address: A }) })).toMatchObject({
      address: A,
      caption: null,
      action: null,
    });
    expect(
      one({
        connected: stellar(B),
        lp: lp({ kyb_status: "Failed", stellar_address: A }),
      }),
    ).toMatchObject({ caption: null, action: null });
  });

  it("12: a connected wallet before the LP exists shows a dash caption and no button", () => {
    expect(
      one({ lp: null, lpRead: "absent", connected: stellar(A) }),
    ).toMatchObject({
      address: null,
      caption: C.needsLp,
      action: null,
    });
  });

  it("13: a connected wallet with nothing served offers Link wallet", () => {
    expect(one({ connected: evm(E1) })).toMatchObject({
      kind: "evm",
      label: SETTLEMENT_LABELS.evm,
      address: null,
      caption: C.notLinked,
      action: "link",
    });
  });

  it("14: Failed or a still-loading LP with a connected wallet shows an empty row", () => {
    expect(
      one({ connected: stellar(A), lp: lp({ kyb_status: "Failed" }) }),
    ).toMatchObject({
      caption: null,
      action: null,
    });
    expect(
      one({ lp: null, lpRead: "unknown", connected: stellar(A) }),
    ).toMatchObject({
      caption: null,
      action: null,
    });
  });

  it("renders two rows, Stellar first, when both addresses are served", () => {
    const result = rows({
      lp: lp({ stellar_address: A, evm_address: E1.toLowerCase() }),
      connected: evm(E1),
    });
    expect(result.map((row) => row.kind)).toEqual(["stellar", "evm"]);
    expect(result[0]).toMatchObject({
      label: SETTLEMENT_LABELS.stellar,
      action: null,
    });
    expect(result[1]).toMatchObject({ caption: C.unproven, action: "link" });
  });

  it("scopes a phase to its kind and leaves the other row alone", () => {
    const result = rows({
      lp: lp({ stellar_address: A, evm_address: E1.toLowerCase() }),
      connected: evm(E1),
      link: { kind: "evm", phase: "signing" },
    });
    expect(result[0]).toMatchObject({ caption: null, busy: false });
    expect(result[1]).toMatchObject({ caption: C.signing, busy: true });
  });

  it("only exposes confirm while confirming", () => {
    const base = { connected: stellar(B), lp: lp({ stellar_address: A }) };
    expect(one(base).confirm).toBeNull();
    expect(
      one({ ...base, link: { kind: "stellar", phase: "declined" } }).confirm,
    ).toBeNull();
    expect(
      one({ ...base, link: { kind: "stellar", phase: "confirming" } }).confirm,
    ).not.toBeNull();
  });
});
