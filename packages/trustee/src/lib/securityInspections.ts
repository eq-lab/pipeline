// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import {
  INSPECTION_KINDS,
  inspectionMeasuresQuantity,
  type InspectionKind,
  type NewInspectionInput,
} from "@pipeline/wallet-connect";
import type { LoanSecurityRecord } from "@/api/useLoanSecurity";
import { amErrorCode } from "./accessManagerAction";
import { valueDateSeconds } from "./wireOut";
import { toUserError, type UserFacingError } from "@/utils/userError";

export const ENTER_NO_ROLE = "This wallet is not allowed to enter inspections.";
export const APPROVE_NO_ROLE =
  "This wallet is not allowed to approve inspections.";
export const ENTERED_BY_THIS_WALLET =
  "Entered by this wallet. A second operator approves it.";
export const CONNECT_TO_ENTER =
  "Connect a Stellar wallet to enter an inspection.";
export const CONNECT_TO_APPROVE = "Connect a Stellar wallet to approve.";
export const REGISTRY_PAUSED_INSPECTIONS =
  "The SecurityRegistry is paused. Inspections can't be entered or approved until it resumes.";
export const NO_PANEL =
  "No inspectors are on the panel. The Risk Council sets the panel.";
export const NO_PANEL_CARD = "No inspectors are on the panel.";
export const ENTER_HELP =
  "An entered inspection counts for nothing until a second operator approves it.";
export const APPROVE_EFFECT =
  "Approving computes the variances against the document quantity, the lot's latest inspection and the reference grade. The record is flagged when a variance is above the loan's tolerance; only the Risk Council clears a flag.";
export const COUNTED_QTY_NOTE =
  "Counted quantity is the smaller of the document quantity and the latest approved inspection.";

const INSPECTABLE_PROTECTIONS = [
  "EndorsedBl",
  "WarehousePledge",
  "CollateralManagement",
];
const INSPECTABLE_STATUSES = ["PendingPerfection", "Active"];
const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_7DP = /^\d+(\.\d{1,7})?$/;
const HEX32 = /^[0-9a-f]{64}$/;

export function inspectableRecord(record: LoanSecurityRecord): boolean {
  return (
    record.open === true &&
    INSPECTABLE_PROTECTIONS.includes(record.protection ?? "") &&
    INSPECTABLE_STATUSES.includes(record.status ?? "")
  );
}

export function canOfferApprove(
  row: {
    awaitingApproval: boolean;
    enteredBy: string | null;
    inspectionId: number | null;
  },
  wallet: string | null | undefined,
): boolean {
  if (!row.awaitingApproval || row.inspectionId == null) return false;
  return row.enteredBy == null || row.enteredBy !== wallet;
}

export interface InspectionSeed {
  recordId: number;
  unit: string | null;
  inspector: string;
  region: string;
  siteHash: string;
}

export interface InspectionFormInput {
  inspector: string;
  kind: InspectionKind | "";
  dateInput: string;
  region: string;
  siteHash: string;
  quantity: string;
  grade: string;
  certificateHash: string;
  certificateNo: string;
}

function served(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function inspectionSeed(
  record: LoanSecurityRecord,
  panel: string[] | null,
): InspectionSeed | null {
  const id = record.record_id;
  if (!inspectableRecord(record) || typeof id !== "string") return null;
  if (!/^\d+$/.test(id)) return null;
  return {
    recordId: Number(id),
    unit: typeof record.unit === "string" && record.unit ? record.unit : null,
    inspector: panel?.length === 1 ? panel[0]! : "",
    region: served(record.region),
    siteHash: served(record.site_hash),
  };
}

export function emptyInspectionForm(seed: InspectionSeed): InspectionFormInput {
  return {
    inspector: seed.inspector,
    kind: "",
    dateInput: "",
    region: seed.region,
    siteHash: seed.siteHash,
    quantity: "",
    grade: "",
    certificateHash: "",
    certificateNo: "",
  };
}

function normalisedHash(value: string): string {
  return value.trim().toLowerCase();
}

export function inspectionFormError(
  input: InspectionFormInput,
  panel: string[] | null,
  today: string,
): string | null {
  if (!panel?.includes(input.inspector))
    return "Pick an inspector from the panel.";
  if (input.kind === "" || !INSPECTION_KINDS.includes(input.kind)) {
    return "Pick the kind of inspection.";
  }
  if (
    !DATE_INPUT.test(input.dateInput) ||
    Number.isNaN(valueDateSeconds(input.dateInput))
  ) {
    return "Pick the inspection date.";
  }
  if (input.dateInput > today)
    return "The inspection date can't be in the future.";
  if (
    inspectionMeasuresQuantity(input.kind) &&
    !DECIMAL_7DP.test(input.quantity.trim())
  ) {
    return "Enter the quantity found, at most 7 decimals.";
  }
  const grade = input.grade.trim();
  if (grade !== "" && !DECIMAL_7DP.test(grade)) {
    return "Enter the grade as a number with at most 7 decimals, or leave it empty.";
  }
  if (
    !HEX32.test(normalisedHash(input.siteHash)) ||
    !HEX32.test(normalisedHash(input.certificateHash))
  ) {
    return "Enter the 64-character hex hash.";
  }
  if (input.certificateNo.trim() === "") return "Enter the certificate number.";
  return null;
}

export function toNewInspection(
  input: InspectionFormInput,
): NewInspectionInput {
  const kind = input.kind as InspectionKind;
  return {
    inspector: input.inspector,
    kind,
    inspectedAt: valueDateSeconds(input.dateInput),
    region: input.region.trim(),
    siteHash: normalisedHash(input.siteHash),
    quantity: inspectionMeasuresQuantity(kind) ? input.quantity.trim() : "0",
    grade: input.grade.trim() === "" ? "0" : input.grade.trim(),
    certificateHash: normalisedHash(input.certificateHash),
    certificateNo: input.certificateNo.trim(),
  };
}

export const SECURITY_REGISTRY_ERROR_NAMES: Record<string, string> = {
  "1": "NonExistentRecord",
  "2": "NonExistentLot",
  "3": "TooManyRecords",
  "4": "InvalidQuantity",
  "5": "InvalidUnit",
  "6": "UnitMismatch",
  "7": "InvalidLocation",
  "8": "InvalidCommodity",
  "9": "LoanClosed",
  "10": "WrongLoanStatus",
  "11": "WrongLot",
  "12": "WrongRecordStatus",
  "13": "TooManyDocs",
  "14": "NoTerms",
  "15": "InvalidRatio",
  "16": "LotAlreadyCounted",
  "17": "NotCounting",
  "18": "Flagged",
  "19": "LtvTooHigh",
  "20": "NotConfigured",
  "21": "Overflow",
  "22": "InvalidValue",
  "23": "Unauthorized",
  "24": "NonTransferable",
  "25": "NonExistentInspection",
  "26": "NotGoodsRecord",
  "27": "NotInspector",
  "28": "InvalidInspectionDate",
  "29": "TooManyInspections",
  "30": "AlreadyApproved",
  "31": "SameOperator",
  "32": "NotFlagged",
};

export const INSPECTION_ERROR_COPY: Record<string, string> = {
  "1": "This record does not exist on-chain.",
  "4": "The quantity found must be greater than zero.",
  "12": "This record's status does not allow an inspection.",
  "14": "This loan has no security terms yet. Set them first.",
  "23": "This wallet is not allowed to enter or approve inspections.",
  "25": "This inspection does not exist on-chain.",
  "26": "Only goods records are inspected.",
  "27": "The inspector is not on the inspector panel. The panel may have changed; reload.",
  "28": "The inspection date can't be in the future.",
  "29": "A record holds at most 64 inspections.",
  "30": "This inspection has already been approved.",
  "31": "The operator who entered an inspection can't approve it. A second operator must approve it.",
};

export function inspectionErrorCopy(
  err: unknown,
  fallback: string,
): UserFacingError {
  const mapped = toUserError(err, fallback);
  if (/^You cancelled the transaction/.test(mapped.message)) return mapped;
  const code = amErrorCode(mapped.details);
  const name = code == null ? undefined : SECURITY_REGISTRY_ERROR_NAMES[code];
  if (code == null || name == null) return mapped;
  const copy = INSPECTION_ERROR_COPY[code];
  return {
    message:
      copy == null
        ? `SecurityRegistry error ${name} (#${code}).`
        : `${copy} (${name})`,
    details: mapped.details,
    isSpecific: true,
  };
}
