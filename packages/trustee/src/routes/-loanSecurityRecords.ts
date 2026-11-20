// spec: docs/frontend/trustee-flows.md#security-records-card
import type {
  LoanSecurityInspection,
  LoanSecurityRecord,
  UseLoanSecurityResult,
} from "@/api/useLoanSecurity";
import { formatFullUsd, formatUsdExact } from "@/utils/formatUsd";
import {
  COUNTED_QTY_NOTE,
  inspectionSeed,
  type InspectionSeed,
} from "@/lib/securityInspections";
import {
  formatMoveBps,
  markDueReasonsText,
  suggestionStatusLabel,
  type RevalueSeed,
} from "@/lib/securityMarks";
import {
  buildSecurityCard,
  formatUnixDate,
  type SecurityRow,
} from "./-loanSecurity";

const DECIMAL = /^-?\d+(\.\d+)?$/;

export const NO_RECORDS_TEXT =
  "No security records are registered for this loan.";
export const AWAITING_APPROVAL_TEXT = "Awaiting approval";

export interface SecurityRecordChip {
  label: string;
  tone: "attention" | "negative" | "neutral";
}

export interface SecurityActor {
  address: string | null;
  date: string;
}

export interface SecurityInspectionRow {
  id: string;
  inspectionId: number | null;
  inspector: string | null;
  certificateNo: string;
  enteredBy: string | null;
  awaitingApproval: boolean;
  kind: string;
  inspected: string;
  quantity: string;
  grade: string;
  entered: SecurityActor;
  approved: SecurityActor | "awaiting" | null;
  varianceReference: string;
  variancePrevious: string;
  varianceGrade: string;
  flagged: boolean;
  resolution: string;
  latest: boolean;
}

export interface SecurityRecordView {
  key: string;
  recordId: string;
  title: string;
  status: string;
  chips: SecurityRecordChip[];
  rows: SecurityRow[];
  attestedBy: string | null;
  inspections: SecurityInspectionRow[];
  revalue: RevalueSeed | null;
  revalueRows: SecurityRow[];
  inspect: InspectionTarget | null;
  openFlag: { inspectionId: string } | null;
}

export interface InspectionTarget {
  seed: InspectionSeed;
  title: string;
  rows: SecurityRow[];
}

export interface SecurityRecordsView {
  state: "hidden" | "empty" | "ready";
  records: SecurityRecordView[];
  panel: string[] | null;
  paused: boolean;
  tolerances: { quantity: string; grade: string };
}

function trimDecimal(value: unknown): string | null {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

export function formatDecimal7(value: unknown): string {
  const trimmed = trimDecimal(value);
  if (trimmed == null) return "—";
  const [whole = "", fraction] = trimmed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function formatQuantity(value: unknown, unit: unknown): string {
  const text = formatDecimal7(value);
  if (text === "—") return text;
  return typeof unit === "string" && unit.length > 0 ? `${text} ${unit}` : text;
}

export function formatVariance(bps: unknown): string {
  return typeof bps === "number" && Number.isFinite(bps) ? `${bps} bps` : "—";
}

export function formatActor(address: unknown, at: unknown): SecurityActor {
  return {
    address: typeof address === "string" && address.length > 0 ? address : null,
    date: formatUnixDate(at),
  };
}

function verbatim(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

function formatPrice(record: LoanSecurityRecord): string {
  const perUnit = trimDecimal(record.mark?.value_per_unit);
  if (perUnit == null) return "—";
  const benchmark = record.mark?.benchmark;
  const unit = record.unit;
  const price = `${formatUsdExact(perUnit)}${
    typeof unit === "string" && unit.length > 0 ? ` per ${unit}` : ""
  }`;
  return typeof benchmark === "string" && benchmark.length > 0
    ? `${benchmark} · ${price}`
    : price;
}

function isRevaluable(record: LoanSecurityRecord): boolean {
  return (
    record.open === true &&
    (record.suggestion_status != null || record.mark?.value_per_unit != null)
  );
}

function formatSuggested(record: LoanSecurityRecord): string {
  const statusText = suggestionStatusLabel(record.suggestion_status);
  if (statusText != null) return statusText;
  const mark = record.suggested_mark;
  const perUnit = trimDecimal(mark?.value_per_unit);
  if (perUnit == null) return "—";
  const unit = record.unit;
  const price = `${formatUsdExact(perUnit)}${
    typeof unit === "string" && unit.length > 0 ? ` per ${unit}` : ""
  }`;
  return typeof mark?.benchmark === "string" && mark.benchmark.length > 0
    ? `${mark.benchmark} · ${price}`
    : price;
}

function revalueRows(record: LoanSecurityRecord): SecurityRow[] {
  return [
    { label: "Current price", value: formatPrice(record) },
    { label: "Suggested price", value: formatSuggested(record) },
    { label: "Move vs suggestion", value: formatMoveBps(record.move_bps) },
    {
      label: "Mark due",
      value:
        record.mark_due === true
          ? markDueReasonsText(record.mark_due_reasons)
          : record.mark_due === false
            ? "No"
            : "—",
    },
    { label: "Mark due at", value: formatUnixDate(record.mark_due_at) },
  ];
}

function revalueSeed(
  record: LoanSecurityRecord,
  title: string,
): RevalueSeed | null {
  const id = record.record_id;
  if (!isRevaluable(record) || typeof id !== "string" || !/^\d+$/.test(id)) {
    return null;
  }
  const suggested = record.suggested_mark;
  const served = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    recordId: Number(id),
    title,
    suggestedValue: served(suggested?.value_per_unit),
    suggestedBenchmark: served(suggested?.benchmark),
    suggestedHash: served(suggested?.report_hash),
    currentBenchmark: served(record.mark?.benchmark),
  };
}

function recordChips(record: LoanSecurityRecord): SecurityRecordChip[] {
  const chips: SecurityRecordChip[] = [];
  if (record.flagged_by != null || record.valuation?.flagged === true) {
    chips.push({ label: "Flagged", tone: "negative" });
  }
  if (record.attestation_stale === true) {
    chips.push({ label: "Attestation stale", tone: "attention" });
  }
  if (record.inspection_stale === true) {
    chips.push({ label: "Inspection stale", tone: "attention" });
  }
  if (record.mark_stale === true || record.valuation?.stale === true) {
    chips.push({ label: "Price stale", tone: "attention" });
  }
  if (record.mark_due === true) {
    chips.push({ label: "Mark due", tone: "attention" });
  }
  if (record.counts_toward_value === false) {
    chips.push({ label: "Not counted", tone: "neutral" });
  }
  if (record.open === false) chips.push({ label: "Closed", tone: "neutral" });
  return chips;
}

function servedAddress(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function servedId(value: unknown): number | null {
  return typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : null;
}

function formatLatestInspection(record: LoanSecurityRecord): string {
  const lot = record.lot;
  const id = lot?.latest_inspection_id;
  if (typeof id !== "string" || id.length === 0) return "—";
  return `${formatQuantity(lot?.latest_quantity, record.unit)} · Inspection #${id} · ${formatUnixDate(lot?.latest_inspected_at)}`;
}

function inspectionRow(
  inspection: LoanSecurityInspection,
  unit: unknown,
): SecurityInspectionRow {
  let approved: SecurityInspectionRow["approved"] = null;
  if (typeof inspection.approved_by === "string") {
    approved = formatActor(inspection.approved_by, inspection.approved_at);
  } else if (inspection.approved_by == null && inspection.complete !== false) {
    approved = "awaiting";
  }
  return {
    id: verbatim(inspection.inspection_id),
    inspectionId: servedId(inspection.inspection_id),
    inspector: servedAddress(inspection.inspector),
    certificateNo: verbatim(inspection.certificate_no),
    enteredBy: servedAddress(inspection.entered_by),
    awaitingApproval: approved === "awaiting",
    kind: verbatim(inspection.kind),
    inspected: formatUnixDate(inspection.inspected_at),
    quantity: formatQuantity(inspection.quantity, unit),
    grade: formatDecimal7(inspection.grade),
    entered: formatActor(inspection.entered_by, inspection.entered_at),
    approved,
    varianceReference: formatVariance(inspection.variance_reference_bps),
    variancePrevious: formatVariance(inspection.variance_previous_bps),
    varianceGrade: formatVariance(inspection.variance_grade_bps),
    flagged: inspection.flagged === true,
    resolution: verbatim(inspection.resolution),
    latest: inspection.is_lot_latest === true,
  };
}

function recordView(
  record: LoanSecurityRecord,
  index: number,
  panel: string[] | null,
): SecurityRecordView {
  const recordId = verbatim(record.record_id);
  const title = `Record #${recordId} · ${verbatim(record.protection)}`;
  const seed = revalueSeed(record, title);
  const inspectSeed = inspectionSeed(record, panel);
  return {
    key: `${recordId}-${index}`,
    recordId,
    title,
    status: verbatim(record.status),
    chips: recordChips(record),
    rows: [
      { label: "Commodity", value: verbatim(record.commodity) },
      {
        label: "Document quantity",
        value: formatQuantity(record.reference_quantity, record.unit),
      },
      {
        label: "Counted quantity",
        value: formatQuantity(record.valuation?.counted_quantity, record.unit),
      },
      {
        label: "Latest inspection",
        value: formatLatestInspection(record),
        note: COUNTED_QTY_NOTE,
      },
      { label: "Value", value: formatFullUsd(record.valuation?.value) },
      { label: "Price", value: formatPrice(record) },
      { label: "Price updated", value: formatUnixDate(record.mark?.at) },
      ...(seed == null ? [] : revalueRows(record).slice(1)),
      { label: "Attested", value: formatUnixDate(record.attested_at) },
    ],
    attestedBy:
      typeof record.attested_by === "string" && record.attested_by.length > 0
        ? record.attested_by
        : null,
    inspections: (record.inspections ?? []).map((inspection) =>
      inspectionRow(inspection ?? {}, record.unit),
    ),
    revalue: seed,
    revalueRows: seed == null ? [] : revalueRows(record),
    inspect:
      inspectSeed == null
        ? null
        : {
            seed: inspectSeed,
            title,
            rows: [
              { label: "Commodity", value: verbatim(record.commodity) },
              {
                label: "Document quantity",
                value: formatQuantity(record.reference_quantity, record.unit),
              },
              {
                label: "Reference grade",
                value: formatDecimal7(record.reference_grade),
              },
            ],
          },
    openFlag:
      typeof record.flagged_by === "string" && record.flagged_by.length > 0
        ? { inspectionId: record.flagged_by }
        : null,
  };
}

function servedPanel(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : null;
}

export function buildSecurityRecords(
  result: UseLoanSecurityResult,
): SecurityRecordsView {
  const panel = servedPanel(result.data?.inspectors);
  const terms = result.data?.terms;
  const tolerances = {
    quantity: formatVariance(terms?.tolerance_bps),
    grade: formatVariance(terms?.grade_tolerance_bps),
  };
  const paused = result.data?.paused === true;
  if (buildSecurityCard(result).state !== "ready") {
    return { state: "hidden", records: [], panel, paused, tolerances };
  }
  const records = result.data?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return { state: "empty", records: [], panel, paused, tolerances };
  }
  return {
    state: "ready",
    records: records.map((r, i) => recordView(r ?? {}, i, panel)),
    panel,
    paused,
    tolerances,
  };
}
