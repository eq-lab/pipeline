// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import {
  accessAction,
  amErrorCode,
  evmCouncilErrorCopy,
  evmErrorName,
  EVM_SECURITY_ERROR_COPY,
  otherWalletCopy,
  riskCouncilErrorCopy,
  riskCouncilRoleLine,
  RISK_COUNCIL_AM_ERROR_COPY,
} from "./accessManagerAction";
import { reverseAction } from "@/routes/-repayment-recovery";

const sched = (readyAt: number) => ({ operationId: "x", readyAt });

describe("accessAction", () => {
  it("returns all five outcomes", () => {
    expect(accessAction(undefined, undefined)).toBeNull();
    expect(accessAction({ immediate: true, delay: 0 }, undefined)).toBe(
      "execute-now",
    );
    expect(accessAction({ immediate: false, delay: 0 }, undefined)).toBe(
      "no-role",
    );
    expect(
      accessAction({ immediate: false, delay: 86400 }, undefined),
    ).toBeNull();
    expect(accessAction({ immediate: false, delay: 86400 }, sched(0))).toBe(
      "schedule",
    );
    expect(accessAction({ immediate: false, delay: 86400 }, sched(5))).toBe(
      "execute-scheduled",
    );
  });

  it("keeps reverseAction as the same function", () => {
    expect(reverseAction).toBe(accessAction);
  });
});

describe("riskCouncilRoleLine", () => {
  const noRole = "Declaring a default belongs to the Risk Council.";
  it("covers each state", () => {
    expect(riskCouncilRoleLine("execute-now", 0, null, noRole)).toBe(
      "Risk Council: this executes at once, with one signature.",
    );
    expect(riskCouncilRoleLine("schedule", 86400, null, noRole)).toBe(
      "Risk Council: this deployment applies a 24 h delay. Schedule it, then execute after the ready time. The Guardian or the Admin can cancel it during the wait.",
    );
    expect(
      riskCouncilRoleLine("execute-scheduled", 86400, 1_800_000_000, noRole),
    ).toBe("Scheduled. Executable from 2027-01-15 08:00 UTC.");
    expect(riskCouncilRoleLine("no-role", 0, null, noRole)).toBe(noRole);
    expect(riskCouncilRoleLine(null, null, null, noRole)).toBe(
      "Checking this wallet's permissions…",
    );
  });
});

describe("AM error copy", () => {
  it("extracts the code and maps it", () => {
    const details = "HostError: Error(Contract, #7)";
    expect(amErrorCode(details)).toBe("7");
    expect(amErrorCode("nope")).toBeNull();
    expect(riskCouncilErrorCopy("execute", details)).toBe(
      RISK_COUNCIL_AM_ERROR_COPY["execute:7"],
    );
    expect(riskCouncilErrorCopy("execute", "Error(Contract, #8)")).toMatch(
      /expired.*again/,
    );
    expect(riskCouncilErrorCopy("schedule", "Error(Contract, #9)")).toMatch(
      /already scheduled/,
    );
    expect(riskCouncilErrorCopy("execute", "Error(Contract, #99)")).toBeNull();
  });

  it("explains an already scheduled operation that may be outside the indexed window", () => {
    expect(RISK_COUNCIL_AM_ERROR_COPY["schedule:9"]).toBe(
      "This operation is already scheduled. It may have been scheduled outside the indexed window; the scheduling wallet can execute it once it is ready.",
    );
  });

  it("names the scheduling wallet when another wallet tries to execute", () => {
    expect(otherWalletCopy("GSCHEDULERADDRESS1234567890ABCD")).toBe(
      "Only the scheduling wallet (GSCHED…ABCD) can execute this.",
    );
  });
});

describe("EVM council error copy (#1942)", () => {
  it("finds the custom-error name in a viem message", () => {
    expect(
      evmErrorName(
        'The contract function "execute" reverted with the following reason:\nAccessManagerNotReady(bytes32 operationId)',
      ),
    ).toBe("AccessManagerNotReady");
    expect(evmErrorName("execution reverted: EnforcedPause()")).toBe(
      "EnforcedPause",
    );
    expect(evmErrorName("insufficient funds")).toBeNull();
  });

  it("matches LoanRegistry and Minter error names", () => {
    expect(
      evmErrorName(
        "reverted: LoanRegistryWrongCurrentStatus(uint8 currentStatus)",
      ),
    ).toBe("LoanRegistryWrongCurrentStatus");
    expect(
      evmErrorName("reverted: MinterInsufficientBankCash(uint256,uint256)"),
    ).toBe("MinterInsufficientBankCash");
  });

  it("maps each name to the shared copy", () => {
    expect(evmCouncilErrorCopy("AccessManagerNotReady(bytes32)")).toBe(
      RISK_COUNCIL_AM_ERROR_COPY["execute:7"],
    );
    expect(evmCouncilErrorCopy("AccessManagerNotScheduled(bytes32)")).toBe(
      RISK_COUNCIL_AM_ERROR_COPY["execute:6"],
    );
    expect(evmCouncilErrorCopy("AccessManagerExpired(bytes32)")).toBe(
      RISK_COUNCIL_AM_ERROR_COPY["execute:8"],
    );
    expect(evmCouncilErrorCopy("AccessManagerAlreadyScheduled(bytes32)")).toBe(
      RISK_COUNCIL_AM_ERROR_COPY["schedule:9"],
    );
    expect(evmCouncilErrorCopy("SecurityRegistryNoTerms()")).toContain(
      "no security terms",
    );
    expect(evmCouncilErrorCopy("SecurityRegistryNotFlagged()")).toContain(
      "no flag",
    );
    expect(
      evmCouncilErrorCopy("SecurityRegistryWrongRecordStatus()"),
    ).toContain("status");
    expect(evmCouncilErrorCopy("SecurityRegistryInvalidRatio()")).toBe(
      "The ratios must be in order: advance ≤ margin call ≤ default.",
    );
    expect(evmCouncilErrorCopy("EnforcedPause()")).toBe(
      EVM_SECURITY_ERROR_COPY.EnforcedPause,
    );
  });

  it("maps the AccessManager names for every target kind", () => {
    for (const kind of [
      "loan_registry",
      "minter",
      "security_registry",
    ] as const) {
      expect(evmCouncilErrorCopy("AccessManagerNotReady(bytes32)", kind)).toBe(
        RISK_COUNCIL_AM_ERROR_COPY["execute:7"],
      );
    }
  });

  it("maps EnforcedPause and the security names only for security_registry", () => {
    expect(evmCouncilErrorCopy("EnforcedPause()", "security_registry")).toBe(
      EVM_SECURITY_ERROR_COPY.EnforcedPause,
    );
    expect(evmCouncilErrorCopy("EnforcedPause()", "loan_registry")).toBeNull();
    expect(evmCouncilErrorCopy("EnforcedPause()", "minter")).toBeNull();
    expect(
      evmCouncilErrorCopy("SecurityRegistryNoTerms()", "loan_registry"),
    ).toBeNull();
  });

  it("falls through for LoanRegistry and Minter errors", () => {
    expect(
      evmCouncilErrorCopy(
        "LoanRegistryWrongCurrentStatus(uint8)",
        "loan_registry",
      ),
    ).toBeNull();
    expect(evmCouncilErrorCopy("MinterAlreadyReversed()", "minter")).toBeNull();
  });

  it("returns null for an unmapped name", () => {
    expect(
      evmCouncilErrorCopy("AccessManagerUnauthorizedCall(a,b,c)"),
    ).toBeNull();
    expect(evmCouncilErrorCopy("plain failure")).toBeNull();
  });
});
