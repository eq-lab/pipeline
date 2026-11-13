// spec: docs/frontend/account-page.md#settlement-address
import { createElement } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LpResponse } from "@/api";
import {
  SETTLEMENT_CAPTIONS as C,
  SETTLEMENT_FORM_COPY,
  SETTLEMENT_LABELS,
  baseAction,
  connectedWallet,
  deriveSettlementRows,
  otherAllowed,
  otherTarget,
  parseSettlementInput,
  sameAddress,
  settlementWritable,
  type ConnectedWallet,
  type SettlementLinkState,
  type SettlementRowsInput,
} from "./settlementAddress";
import { useEvmWallet } from "@/wallet/evm/useEvmWallet";
import { useStellarWallet } from "@/wallet/stellar/useStellarWallet";
import { WalletViewProvider, useWalletView } from "@/wallet/WalletViewContext";

const walletState = vi.hoisted(() => ({
  evm: { isConnected: false, address: undefined as string | undefined },
  stellar: { isConnected: false, address: undefined as string | undefined },
}));

vi.mock("@/wallet/evm/useEvmWallet", () => ({
  useEvmWallet: () => walletState.evm,
}));
vi.mock("@/wallet/stellar/useStellarWallet", () => ({
  useStellarWallet: () => walletState.stellar,
}));
vi.mock("@/wallet/useSingleWalletInvariant", () => ({
  useSingleWalletInvariant: () => {},
}));

vi.mock("@/wallet", async () => ({
  isStellarSettlementAddress: (
    await vi.importActual<
      typeof import("@/wallet/stellar/settlementAddressFormat")
    >("@/wallet/stellar/settlementAddressFormat")
  ).isStellarSettlementAddress,
}));

const A = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";
const B = "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB";
const E1 = "0xAbC0000000000000000000000000000000000001";
const E2 = "0xdef0000000000000000000000000000000000002";
const G2 = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const CONTRACT = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";

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
    settlement_bank_account: null,
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
const idle: SettlementLinkState = {
  kind: null,
  phase: "idle",
  mode: "wallet",
};

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
    ["EVM alone", { isConnected: true, address: E1 }, off, evm(E1)],
    ["Stellar alone", off, { isConnected: true, address: A }, stellar(A)],
    [
      "winning wallet connected without address",
      { isConnected: true, address: undefined },
      off,
      null,
    ],
    [
      "EVM wins without address even when Stellar has one",
      { isConnected: true, address: undefined },
      { isConnected: true, address: A },
      null,
    ],
    ["none", off, off, null],
  ])("%s", (_name, e, s, expected) => {
    expect(connectedWallet(e, s)).toEqual(expected);
  });
});

describe("settlement rows follow the wallet view", () => {
  function viewAndRows() {
    const { result } = renderHook(
      () => ({
        view: useWalletView().kind,
        rows: deriveSettlementRows({
          lpRead: "loaded",
          lp: lp(),
          connected: connectedWallet(useEvmWallet(), useStellarWallet()),
          link: idle,
        }),
      }),
      {
        wrapper: ({ children }) =>
          createElement(WalletViewProvider, null, children),
      },
    );
    return result.current;
  }

  it("both connected: the single row is the view's kind", () => {
    walletState.evm = { isConnected: true, address: E1 };
    walletState.stellar = { isConnected: true, address: A };
    const { view, rows: result } = viewAndRows();
    expect(view).toBe("evm");
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe(view);
    expect(result[0]?.action).toBe("link");
  });

  it("Stellar only: the single row is stellar", () => {
    walletState.evm = { isConnected: false, address: undefined };
    walletState.stellar = { isConnected: true, address: A };
    const { view, rows: result } = viewAndRows();
    expect(view).toBe("stellar");
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe(view);
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
      signer: null,
      other: false,
      form: null,
    });
  });

  it.each(["requesting", "verifying"] as const)(
    "1: %s is busy with no button",
    (phase) => {
      expect(
        one({
          connected: stellar(A),
          link: { kind: "stellar", phase, mode: "wallet" },
        }),
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
        link: { kind: "stellar", phase: "signing", mode: "wallet" },
      }),
    ).toMatchObject({ caption: C.signing, action: null, busy: true });
  });

  it("3: confirming a change names both addresses and offers no other button", () => {
    expect(
      one({
        connected: stellar(B),
        lp: lp({ stellar_address: A }),
        link: { kind: "stellar", phase: "confirming", mode: "wallet" },
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
      link: { kind: "stellar", phase: "confirming", mode: "wallet" },
    });
    expect(view.confirm).toBeNull();
    expect(view.caption).toBe(C.linked);
  });

  it("4: declined offers the base action again", () => {
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "declined", mode: "wallet" },
      }),
    ).toMatchObject({ caption: C.declined, tone: "muted", action: "link" });
    expect(
      one({
        connected: stellar(B),
        lp: lp({ stellar_address: A }),
        link: { kind: "stellar", phase: "declined", mode: "wallet" },
      }),
    ).toMatchObject({ action: "change" });
  });

  it.each(["proofFailed", "error"] as const)(
    "5/7: %s is negative with Try again",
    (phase) => {
      expect(
        one({
          connected: stellar(A),
          link: { kind: "stellar", phase, mode: "wallet" },
        }),
      ).toMatchObject({ caption: C[phase], tone: "negative", action: "retry" });
    },
  );

  it.each(["proofFailed", "error"] as const)(
    "5/7: %s without a base action has no button",
    (phase) => {
      expect(
        one({
          lp: lp({ stellar_address: A }),
          link: { kind: "stellar", phase, mode: "wallet" },
        }),
      ).toMatchObject({ action: null });
    },
  );

  it("6: taken is negative without a button", () => {
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "taken", mode: "wallet" },
      }),
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
      link: { kind: "evm", phase: "signing", mode: "wallet" },
    });
    expect(result[0]).toMatchObject({ caption: null, busy: false });
    expect(result[1]).toMatchObject({ caption: C.signing, busy: true });
  });

  it("only exposes confirm while confirming", () => {
    const base = { connected: stellar(B), lp: lp({ stellar_address: A }) };
    expect(one(base).confirm).toBeNull();
    expect(
      one({
        ...base,
        link: { kind: "stellar", phase: "declined", mode: "wallet" },
      }).confirm,
    ).toBeNull();
    expect(
      one({
        ...base,
        link: { kind: "stellar", phase: "confirming", mode: "wallet" },
      }).confirm,
    ).not.toBeNull();
  });
});

describe("parseSettlementInput", () => {
  it("returns a null error for empty or whitespace input", () => {
    expect(parseSettlementInput("stellar", "")).toEqual({
      ok: false,
      error: null,
    });
    expect(parseSettlementInput("evm", "   ")).toEqual({
      ok: false,
      error: null,
    });
  });

  it("trims and uppercases a Stellar address and accepts G… and C…", () => {
    expect(parseSettlementInput("stellar", ` ${G2.toLowerCase()} `)).toEqual({
      ok: true,
      address: G2,
    });
    expect(parseSettlementInput("stellar", CONTRACT)).toEqual({
      ok: true,
      address: CONTRACT,
    });
  });

  it("rejects an invalid Strkey with the Stellar message", () => {
    expect(parseSettlementInput("stellar", A)).toEqual({
      ok: false,
      error: SETTLEMENT_FORM_COPY.invalid.stellar,
    });
    expect(parseSettlementInput("stellar", "GABC")).toMatchObject({
      ok: false,
    });
  });

  it("keeps a mixed-case EVM address as typed after trimming", () => {
    expect(parseSettlementInput("evm", `  ${E1} `)).toEqual({
      ok: true,
      address: E1,
    });
  });

  it.each([
    "0x123",
    `${E1}0`,
    "0xZZZ0000000000000000000000000000000000001",
    E1.slice(2),
  ])("rejects EVM input %s with the Ethereum message", (value) => {
    expect(parseSettlementInput("evm", value)).toEqual({
      ok: false,
      error: SETTLEMENT_FORM_COPY.invalid.evm,
    });
  });
});

describe("otherTarget", () => {
  it("has no signer when the address is the connected wallet", () => {
    expect(otherTarget("stellar", A, stellar(A))).toEqual({
      address: A,
      signer: null,
    });
    expect(otherTarget("evm", E1.toLowerCase(), evm(E1))).toEqual({
      address: E1.toLowerCase(),
      signer: null,
    });
  });

  it("uses the connected wallet as the signer otherwise, lowercased for EVM", () => {
    expect(otherTarget("stellar", CONTRACT, stellar(A))).toEqual({
      address: CONTRACT,
      signer: A,
    });
    expect(otherTarget("evm", E2, evm(E1))).toEqual({
      address: E2,
      signer: E1.toLowerCase(),
    });
  });
});

describe("otherAllowed", () => {
  it("needs a writable LP and a connected wallet of the kind", () => {
    expect(otherAllowed(lp(), "stellar", stellar(A))).toBe(true);
    expect(otherAllowed(null, "stellar", stellar(A))).toBe(false);
    expect(
      otherAllowed(lp({ kyb_status: "Failed" }), "stellar", stellar(A)),
    ).toBe(false);
    expect(otherAllowed(lp(), "stellar", null)).toBe(false);
    expect(otherAllowed(lp(), "stellar", evm(E1))).toBe(false);
  });
});

describe("baseAction with a separate served signer", () => {
  it("is null when the connected wallet is the signer of a different address", () => {
    expect(
      baseAction(
        lp({ stellar_address: CONTRACT, stellar_signer_address: A }),
        "stellar",
        stellar(A),
      ),
    ).toBeNull();
  });

  it("is change when another signer served the different address", () => {
    expect(
      baseAction(
        lp({ stellar_address: CONTRACT, stellar_signer_address: B }),
        "stellar",
        stellar(A),
      ),
    ).toBe("change");
  });

  it("matches the signer case-insensitively for EVM", () => {
    expect(
      baseAction(
        lp({
          evm_address: E2.toLowerCase(),
          evm_signer_address: E1.toLowerCase(),
        }),
        "evm",
        evm(E1),
      ),
    ).toBeNull();
  });
});

describe("deriveSettlementRows: different address", () => {
  const linkedContract = lp({
    stellar_address: CONTRACT,
    stellar_signer_address: A,
  });

  it("shows the signer only when it differs from the address", () => {
    expect(one({ lp: linkedContract, connected: stellar(A) }).signer).toBe(A);
    expect(
      one({
        lp: lp({ stellar_address: A, stellar_signer_address: A }),
        connected: stellar(A),
      }).signer,
    ).toBeNull();
    expect(
      one({ lp: lp({ stellar_address: A }), connected: stellar(A) }).signer,
    ).toBeNull();
    expect(
      one({
        lp: lp({
          evm_address: E1.toLowerCase(),
          evm_signer_address: E1,
        }),
      }).signer,
    ).toBeNull();
    expect(one({}).signer).toBeNull();
  });

  it("explains that the connected wallet is the signer of the linked address", () => {
    expect(one({ lp: linkedContract, connected: stellar(A) })).toMatchObject({
      caption: C.linkedSigner,
      tone: "muted",
      action: null,
      other: true,
    });
  });

  it("offers the entry only for a loaded writable LP with a wallet of the kind and an idle row", () => {
    expect(one({ connected: stellar(A) }).other).toBe(true);
    expect(
      one({ connected: stellar(A), lp: lp({ kyb_status: "Failed" }) }).other,
    ).toBe(false);
    expect(
      one({ connected: stellar(A), lp: null, lpRead: "absent" }).other,
    ).toBe(false);
    expect(one({}).other).toBe(false);
    expect(one({ lp: lp({ stellar_address: A }) }).other).toBe(false);
    const both = rows({
      lp: lp({ stellar_address: A, evm_address: E1.toLowerCase() }),
      connected: evm(E1),
    });
    expect(both.map((row) => row.other)).toEqual([false, true]);
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "signing", mode: "wallet" },
      }).other,
    ).toBe(false);
    expect(
      one({
        connected: stellar(B),
        lp: lp({ stellar_address: A }),
        link: { kind: "stellar", phase: "confirming", mode: "wallet" },
      }).other,
    ).toBe(false);
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "editing", mode: "other" },
      }).other,
    ).toBe(false);
  });

  it("renders the form with the hint while editing a first link", () => {
    expect(
      one({
        connected: stellar(A),
        link: { kind: "stellar", phase: "editing", mode: "other" },
      }),
    ).toMatchObject({
      caption: C.otherHint,
      action: null,
      busy: false,
      form: { current: null, signer: A, busy: false },
    });
  });

  it("shows the current address and the change caption while editing a served address", () => {
    expect(
      one({
        connected: stellar(B),
        lp: lp({ stellar_address: A }),
        link: { kind: "stellar", phase: "editing", mode: "other" },
      }),
    ).toMatchObject({
      caption: C.confirm,
      form: { current: A, signer: B, busy: false },
    });
  });

  it.each([
    ["requesting", C.linkingAddress, "muted", true],
    ["verifying", C.linkingAddress, "muted", true],
    ["signing", C.signing, "muted", true],
    ["declined", C.declined, "muted", false],
    ["proofFailed", C.proofFailed, "negative", false],
    ["taken", C.addressTaken, "negative", false],
    ["error", C.addressError, "negative", false],
  ] as const)(
    "%s in other mode keeps the form with its caption",
    (phase, caption, tone, busy) => {
      expect(
        one({
          connected: stellar(A),
          link: { kind: "stellar", phase, mode: "other" },
        }),
      ).toMatchObject({
        caption,
        tone,
        busy,
        action: null,
        other: false,
        form: { current: null, signer: A, busy },
      });
    },
  );

  it("scopes an open form to its kind", () => {
    const result = rows({
      lp: lp({ stellar_address: A, evm_address: E1.toLowerCase() }),
      connected: evm(E1),
      link: { kind: "evm", phase: "editing", mode: "other" },
    });
    expect(result[0]?.form).toBeNull();
    expect(result[1]?.form).not.toBeNull();
  });
});
