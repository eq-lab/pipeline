// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import { describe, it, expect } from "vitest";
import type { LoanSecurityRecord } from "@/api/useLoanSecurity";
import {
  SECURITY_REGISTRY_ERROR_NAMES,
  canOfferApprove,
  emptyInspectionForm,
  inspectableRecord,
  inspectionErrorCopy,
  inspectionFormError,
  inspectionSeed,
  toNewInspection,
  type InspectionFormInput,
} from "./securityInspections";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const HASH = "ab".repeat(32);
const TODAY = "2026-11-20";
const PANEL = [A, B];

const VALID: InspectionFormInput = {
  inspector: A,
  kind: "DraftSurvey",
  dateInput: "2026-11-19",
  region: "Santos",
  siteHash: HASH,
  quantity: "1200.5",
  grade: "",
  certificateHash: HASH.toUpperCase(),
  certificateNo: "C-1",
};

describe("inspectableRecord", () => {
  const rec = (over: Partial<LoanSecurityRecord>): LoanSecurityRecord => ({
    open: true,
    protection: "WarehousePledge",
    status: "Active",
    ...over,
  });

  it("accepts the goods protections in an inspectable status", () => {
    for (const protection of [
      "EndorsedBl",
      "WarehousePledge",
      "CollateralManagement",
    ]) {
      for (const status of ["PendingPerfection", "Active"]) {
        expect(inspectableRecord(rec({ protection, status }))).toBe(true);
      }
    }
  });

  it("rejects closed, cash and other statuses", () => {
    expect(inspectableRecord(rec({ open: false }))).toBe(false);
    expect(inspectableRecord(rec({ protection: "CashCover" }))).toBe(false);
    expect(inspectableRecord(rec({ status: "Released" }))).toBe(false);
    expect(inspectableRecord({})).toBe(false);
  });
});

describe("canOfferApprove", () => {
  const row = {
    awaitingApproval: true,
    enteredBy: A,
    inspectionId: 4 as number | null,
  };

  it("hides the button for the entering wallet only", () => {
    expect(canOfferApprove(row, A)).toBe(false);
    expect(canOfferApprove(row, B)).toBe(true);
    expect(canOfferApprove(row, null)).toBe(true);
  });

  it("offers it when entered_by is not served, and never for settled rows", () => {
    expect(canOfferApprove({ ...row, enteredBy: null }, A)).toBe(true);
    expect(canOfferApprove({ ...row, awaitingApproval: false }, B)).toBe(false);
    expect(canOfferApprove({ ...row, inspectionId: null }, B)).toBe(false);
  });
});

describe("inspectionSeed", () => {
  const record: LoanSecurityRecord = {
    record_id: "7",
    open: true,
    protection: "EndorsedBl",
    status: "Active",
    unit: "MT",
    region: "Santos",
    site_hash: HASH,
  };

  it("prefills region and site hash, and the inspector for a one-entry panel", () => {
    expect(inspectionSeed(record, [A])).toEqual({
      recordId: 7,
      unit: "MT",
      inspector: A,
      region: "Santos",
      siteHash: HASH,
    });
    expect(inspectionSeed(record, PANEL)?.inspector).toBe("");
    expect(inspectionSeed(record, null)?.inspector).toBe("");
  });

  it("leaves unserved fields empty and skips records that cannot be inspected", () => {
    const seed = inspectionSeed({ ...record, region: null, site_hash: null }, [
      A,
    ]);
    expect(seed).toMatchObject({ region: "", siteHash: "" });
    expect(emptyInspectionForm(seed!).kind).toBe("");
    expect(inspectionSeed({ ...record, open: false }, [A])).toBeNull();
    expect(inspectionSeed({ ...record, record_id: "x" }, [A])).toBeNull();
  });
});

describe("inspectionFormError", () => {
  it("accepts a valid form, an empty grade and today", () => {
    expect(inspectionFormError(VALID, PANEL, TODAY)).toBeNull();
    expect(
      inspectionFormError({ ...VALID, dateInput: TODAY }, PANEL, TODAY),
    ).toBeNull();
  });

  it("rejects an inspector off the panel", () => {
    expect(inspectionFormError({ ...VALID, inspector: "" }, PANEL, TODAY)).toBe(
      "Pick an inspector from the panel.",
    );
    expect(inspectionFormError(VALID, null, TODAY)).toBe(
      "Pick an inspector from the panel.",
    );
  });

  it("rejects a missing kind, a bad date and a future date", () => {
    expect(inspectionFormError({ ...VALID, kind: "" }, PANEL, TODAY)).toMatch(
      /kind/,
    );
    expect(
      inspectionFormError({ ...VALID, dateInput: "" }, PANEL, TODAY),
    ).toMatch(/date/);
    expect(
      inspectionFormError({ ...VALID, dateInput: "2026-11-21" }, PANEL, TODAY),
    ).toBe("The inspection date can't be in the future.");
  });

  it("validates the quantity unless the kind is a sampling assay", () => {
    for (const quantity of ["", "-1", "1.12345678", "abc"]) {
      expect(inspectionFormError({ ...VALID, quantity }, PANEL, TODAY)).toBe(
        "Enter the quantity found, at most 7 decimals.",
      );
    }
    expect(
      inspectionFormError(
        { ...VALID, kind: "SamplingAssay", quantity: "" },
        PANEL,
        TODAY,
      ),
    ).toBeNull();
  });

  it("validates a non-empty grade", () => {
    expect(
      inspectionFormError({ ...VALID, grade: "-1" }, PANEL, TODAY),
    ).toMatch(/grade/);
    expect(
      inspectionFormError({ ...VALID, grade: "98.5" }, PANEL, TODAY),
    ).toBeNull();
  });

  it("validates both hashes and the certificate number", () => {
    const hashMessage = "Enter the 64-character hex hash.";
    expect(inspectionFormError({ ...VALID, siteHash: "" }, PANEL, TODAY)).toBe(
      hashMessage,
    );
    expect(
      inspectionFormError({ ...VALID, certificateHash: "zz" }, PANEL, TODAY),
    ).toBe(hashMessage);
    expect(
      inspectionFormError({ ...VALID, certificateNo: " " }, PANEL, TODAY),
    ).toMatch(/certificate number/);
  });
});

describe("toNewInspection", () => {
  it("sends 00:00 UTC, lowercases hashes and defaults the grade to 0", () => {
    expect(toNewInspection(VALID)).toEqual({
      inspector: A,
      kind: "DraftSurvey",
      inspectedAt: Date.UTC(2026, 10, 19) / 1000,
      region: "Santos",
      siteHash: HASH,
      quantity: "1200.5",
      grade: "0",
      certificateHash: HASH,
      certificateNo: "C-1",
    });
  });

  it("sends a zero quantity for a sampling assay and keeps a served grade", () => {
    const out = toNewInspection({
      ...VALID,
      kind: "SamplingAssay",
      quantity: "999",
      grade: " 98.5 ",
    });
    expect(out.quantity).toBe("0");
    expect(out.grade).toBe("98.5");
  });
});

describe("inspectionErrorCopy", () => {
  const copy = (code: number) =>
    inspectionErrorCopy(
      new Error(`simulation error: HostError: Error(Contract, #${code})`),
      "fallback",
    );

  it("puts the contract error name in the message", () => {
    expect(copy(27).message).toMatch(/inspector panel.*\(NotInspector\)$/);
    expect(copy(30).message).toBe(
      "This inspection has already been approved. (AlreadyApproved)",
    );
    expect(copy(31).message).toMatch(
      /second operator must approve.*\(SameOperator\)/,
    );
    expect(copy(31).details).toContain("#31");
    expect(copy(31).isSpecific).toBe(true);
  });

  it("names a known code without copy and keeps unknown codes generic", () => {
    expect(copy(18).message).toBe("SecurityRegistry error Flagged (#18).");
    expect(copy(999).message).not.toMatch(/SecurityRegistry error/);
    expect(copy(999).details).toContain("#999");
  });

  it("passes a wallet rejection through and pins all 32 names", () => {
    expect(
      inspectionErrorCopy(new Error("User rejected the request"), "x").message,
    ).toMatch(/cancelled/);
    expect(Object.keys(SECURITY_REGISTRY_ERROR_NAMES)).toHaveLength(32);
    expect(SECURITY_REGISTRY_ERROR_NAMES["31"]).toBe("SameOperator");
  });
});
