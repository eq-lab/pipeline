// spec: docs/frontend/trustee-flows.md#disburse-1898
import { describe, it, expect, vi } from "vitest";
import type { LoanDisbursementState } from "@pipeline/wallet-connect";

vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99_000_001, EVM_CHAIN_ID: 560_048 },
}));

import {
  DEBT_NOT_REGISTERED,
  DISBURSE_CONNECT_WALLET,
  DISBURSE_NOT_CONFIGURED,
  DISBURSE_NO_ROLE,
  MINTER_PAUSED,
  REUSED_DISBURSE_REFERENCE,
  disburseErrorCopy,
  disburseFormError,
  disburseView,
  type DisburseViewInput,
} from "./disburse";

const STELLAR = 99_000_001;
const EVM = 560_048;
const OK = { isPending: false, isError: false };

const LOAN: LoanDisbursementState = {
  status: "Approved",
  carvedOut: false,
  disbursed: "0",
  originalSeniorTranche: "500000000000",
};

function input(overrides: Partial<DisburseViewInput> = {}): DisburseViewInput {
  return {
    chainId: STELLAR,
    configured: true,
    connected: true,
    loan: { data: LOAN, ...OK },
    deal: { data: { debt: "CDEBT" }, ...OK },
    trustline: { data: { holder: "CHOLDER", trustline: "present" }, ...OK },
    paused: { data: false, ...OK },
    access: { data: { immediate: true, delay: 0 }, ...OK },
    ...overrides,
  };
}

const reason = (view: ReturnType<typeof disburseView>) =>
  view.kind === "blocked" ? view.reason : null;

describe("disburseView", () => {
  it("is ready when every check passes", () => {
    expect(disburseView(input())).toEqual({ kind: "ready" });
  });

  it("blocks an EVM loan with the Stellar-only line", () => {
    expect(reason(disburseView(input({ chainId: EVM })))).toMatch(
      /Stellar only/,
    );
  });

  it("blocks when unconfigured", () => {
    expect(reason(disburseView(input({ configured: false })))).toBe(
      DISBURSE_NOT_CONFIGURED,
    );
  });

  it("hides while the loan read is pending and blocks on error", () => {
    expect(
      disburseView(
        input({ loan: { data: undefined, isPending: true, isError: false } }),
      ),
    ).toEqual({ kind: "hidden" });
    expect(
      reason(
        disburseView(
          input({ loan: { data: undefined, isPending: false, isError: true } }),
        ),
      ),
    ).toBe("Could not read this loan on-chain.");
  });

  it.each([
    ["Default", {}],
    ["Closed", {}],
    ["Performing", { carvedOut: true }],
    ["Performing", { disbursed: "500000000000" }],
  ])("hides a %s loan that cannot take a disbursement %j", (status, extra) => {
    expect(
      disburseView(
        input({ loan: { data: { ...LOAN, status, ...extra }, ...OK } }),
      ),
    ).toEqual({ kind: "hidden" });
  });

  it.each(["Approved", "Performing", "WatchList"])(
    "shows a %s loan",
    (status) => {
      expect(
        disburseView(input({ loan: { data: { ...LOAN, status }, ...OK } })),
      ).toEqual({ kind: "ready" });
    },
  );

  it("blocks on the deal states", () => {
    expect(reason(disburseView(input({ deal: { data: null, ...OK } })))).toBe(
      DEBT_NOT_REGISTERED,
    );
    expect(
      reason(
        disburseView(
          input({ deal: { data: undefined, isPending: true, isError: false } }),
        ),
      ),
    ).toBe("Checking the debt token…");
    expect(
      reason(
        disburseView(
          input({ deal: { data: undefined, isPending: false, isError: true } }),
        ),
      ),
    ).toMatch(/Could not read/);
  });

  it("blocks on a missing or unverifiable trustline, naming the holder", () => {
    const missing = reason(
      disburseView(
        input({
          trustline: {
            data: { holder: "CHOLDER", trustline: "missing" },
            ...OK,
          },
        }),
      ),
    );
    expect(missing).toMatch(/CHOLDER/);
    expect(missing).toMatch(/Operations|operations/);
    expect(
      reason(
        disburseView(
          input({
            trustline: { data: undefined, isPending: false, isError: true },
          }),
        ),
      ),
    ).toMatch(/Could not verify/);
    expect(
      reason(
        disburseView(
          input({
            trustline: { data: undefined, isPending: true, isError: false },
          }),
        ),
      ),
    ).toMatch(/Checking/);
  });

  it("blocks when the minter is paused or the read fails", () => {
    expect(reason(disburseView(input({ paused: { data: true, ...OK } })))).toBe(
      MINTER_PAUSED,
    );
    expect(
      reason(
        disburseView(
          input({
            paused: { data: undefined, isPending: false, isError: true },
          }),
        ),
      ),
    ).toMatch(/Could not check/);
  });

  it("asks for a wallet before checking the role", () => {
    expect(reason(disburseView(input({ connected: false })))).toBe(
      DISBURSE_CONNECT_WALLET,
    );
  });

  it("maps the can_call states", () => {
    expect(
      reason(
        disburseView(
          input({
            access: { data: undefined, isPending: true, isError: false },
          }),
        ),
      ),
    ).toMatch(/Checking this wallet/);
    expect(
      reason(
        disburseView(
          input({
            access: { data: undefined, isPending: false, isError: true },
          }),
        ),
      ),
    ).toMatch(/Could not verify this wallet/);
    expect(
      reason(
        disburseView(
          input({ access: { data: { immediate: false, delay: 7200 }, ...OK } }),
        ),
      ),
    ).toBe(
      "This wallet holds the Trustee role with a 2 h delay; the app does not schedule disbursements.",
    );
    expect(
      reason(
        disburseView(
          input({ access: { data: { immediate: false, delay: 0 }, ...OK } }),
        ),
      ),
    ).toBe(DISBURSE_NO_ROLE);
  });
});

describe("disburseFormError", () => {
  const ok = {
    amountInput: "100",
    bankCashRaw: "1000000000",
    valueDateInput: "2026-11-10",
    today: "2026-11-12",
    reference: "WIRE-1",
  };

  it("accepts a valid form and an amount equal to bank cash", () => {
    expect(disburseFormError(ok)).toBeNull();
    expect(disburseFormError({ ...ok, amountInput: "100" })).toBeNull();
  });

  it("rejects empty, zero and over-precise amounts", () => {
    for (const amountInput of ["", "0", "abc", "1.00000001"]) {
      expect(disburseFormError({ ...ok, amountInput })).toBe(
        "Enter the amount disbursed (up to 7 decimals).",
      );
    }
  });

  it("rejects an amount above the booked bank cash", () => {
    expect(disburseFormError({ ...ok, amountInput: "100.0000001" })).toMatch(
      /booked bank cash \(\$100\) is below this amount/,
    );
  });

  it("skips the bank cash check when it is unknown", () => {
    expect(
      disburseFormError({ ...ok, bankCashRaw: null, amountInput: "999999" }),
    ).toBeNull();
  });

  it("rejects a missing or future date", () => {
    expect(disburseFormError({ ...ok, valueDateInput: "" })).toBe(
      "Enter the value date.",
    );
    expect(disburseFormError({ ...ok, valueDateInput: "2026-11-13" })).toBe(
      "The value date cannot be in the future.",
    );
  });

  it("rejects an empty or overlong reference", () => {
    expect(disburseFormError({ ...ok, reference: "   " })).toMatch(
      /bank reference/,
    );
    expect(disburseFormError({ ...ok, reference: "x".repeat(141) })).toMatch(
      /at most 140/,
    );
    expect(
      disburseFormError({ ...ok, reference: ` ${"x".repeat(140)} ` }),
    ).toBeNull();
  });
});

describe("disburseErrorCopy", () => {
  const sim = (code: string) =>
    new Error(
      `disburse simulation error: HostError: Error(Contract, #${code})`,
    );

  it("maps the paused, reused-reference and bank-cash codes", () => {
    expect(disburseErrorCopy(sim("1000")).message).toBe(MINTER_PAUSED);
    expect(disburseErrorCopy(sim("7")).message).toBe(REUSED_DISBURSE_REFERENCE);
    expect(disburseErrorCopy(sim("8")).message).toMatch(/bank cash/);
  });

  it("maps #13 to the tranche copy with the values verbatim", () => {
    expect(
      disburseErrorCopy(sim("13"), {
        disbursed: "100000000000",
        originalSeniorTranche: "500000000000",
      }).message,
    ).toBe(
      "This exceeds the loan's senior tranche ($10,000 of $50,000 already disbursed).",
    );
  });

  it("maps status and carve-out codes", () => {
    expect(disburseErrorCopy(sim("3")).message).toMatch(/does not allow/);
    expect(disburseErrorCopy(sim("21")).message).toMatch(/carved out/);
  });

  it("passes a wallet rejection through", () => {
    const copy = disburseErrorCopy(new Error("User declined access"));
    expect(copy.message).toMatch(/cancelled the transaction/);
  });

  it("falls back for an unknown code", () => {
    const copy = disburseErrorCopy(sim("99"));
    expect(copy.message).toMatch(/Could not|No signature/);
  });
});
