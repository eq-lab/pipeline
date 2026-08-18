/**
 * Form state + pure transforms for origination.new.tsx (#1100).
 * spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100.
 */
import { useState } from "react";
import type { LoanDocumentInput, SubmitLoanInput } from "@/api/useSubmitLoan";

// ── Field model ───────────────────────────────────────────────────────────────

export interface FieldDef {
  path: string;
  label: string;
  numeric?: boolean;
  required: boolean;
  placeholder?: string;
}

export interface SectionDef {
  title: string;
  fields: FieldDef[];
}

export const FORM_SECTIONS: SectionDef[] = [
  {
    title: "Loan & metadata",
    fields: [
      { path: "to", label: "Mint to (Stellar address)", required: true },
      { path: "metadata_uri", label: "Metadata URI", required: true },
      {
        path: "secondary_metadata_uri",
        label: "Secondary metadata URI (optional)",
        required: false,
      },
      { path: "originator", label: "Originator", required: true },
      { path: "borrower_id", label: "Borrower", required: true },
      { path: "commodity", label: "Commodity", required: true },
      { path: "corridor", label: "Corridor", required: true },
      { path: "governing_law", label: "Governing law", required: true },
      {
        path: "protection",
        label: "Protection (optional)",
        required: false,
        placeholder: "e.g. LC at sight",
      },
    ],
  },
  {
    title: "Economics",
    fields: [
      {
        path: "economics.original_facility_size",
        label: "Facility size (USDC, 6-decimal string)",
        required: true,
        placeholder: "1200000.000000",
      },
      {
        path: "economics.original_senior_tranche",
        label: "Senior tranche (USDC, 6-decimal string)",
        required: true,
      },
      {
        path: "economics.original_equity_tranche",
        label: "Equity tranche (USDC, 6-decimal string)",
        required: true,
      },
      {
        path: "economics.original_offtaker_price",
        label: "Offtaker price (USDC, 6-decimal string)",
        required: true,
      },
      {
        path: "economics.senior_interest_rate_bps",
        label: "Senior interest rate (bps)",
        required: true,
        numeric: true,
      },
      {
        path: "economics.origination_date",
        label: "Origination date (unix seconds)",
        required: true,
        numeric: true,
      },
      {
        path: "economics.original_maturity_date",
        label: "Maturity date (unix seconds)",
        required: true,
        numeric: true,
      },
    ],
  },
  {
    title: "Collateral",
    fields: [
      {
        path: "initial_ccr",
        label: "Initial CCR (1e6-scaled, min 1000000)",
        required: true,
        numeric: true,
      },
      {
        path: "initial_location.location_type",
        label: "Location type (Vessel / Warehouse / TankFarm / Other)",
        required: true,
      },
      {
        path: "initial_location.location_identifier",
        label: "Location identifier",
        required: true,
        placeholder: "IMO 9834521",
      },
      {
        path: "initial_location.tracking_url",
        label: "Tracking URL",
        required: true,
      },
      {
        path: "initial_location.updated_at",
        label: "Location updated at (unix seconds)",
        required: true,
        numeric: true,
      },
    ],
  },
  {
    title: "Collateral valuation",
    fields: [
      {
        path: "collateral_valuation.valuation_mode",
        label: "Valuation mode (StandardGoods / MetalConcentrate)",
        required: true,
      },
      {
        path: "collateral_valuation.asset",
        label: "Asset symbol",
        required: true,
        placeholder: "XAU",
      },
      {
        path: "collateral_valuation.price_provider",
        label: "Price provider",
        required: true,
      },
      {
        path: "collateral_valuation.haircut_pct",
        label: "Haircut (fraction string, 0–1)",
        required: true,
        placeholder: "0.15",
      },
      {
        path: "collateral_valuation.quantity_dmt",
        label: "Quantity (dry metric tonnes)",
        required: true,
      },
    ],
  },
  {
    title: "Fee schedule",
    fields: [
      {
        path: "fee_schedule.mgmt_fee_rate_bps",
        label: "Management fee (bps, annualised)",
        required: true,
        numeric: true,
      },
      {
        path: "fee_schedule.perf_fee_rate_bps",
        label: "Performance fee (bps)",
        required: true,
        numeric: true,
      },
      {
        path: "fee_schedule.oet_alloc_rate_bps",
        label: "OET allocation (bps, annualised)",
        required: true,
        numeric: true,
      },
    ],
  },
];

const ALL_FIELDS: FieldDef[] = FORM_SECTIONS.flatMap((s) => s.fields);

export function emptyFormValues(): Record<string, string> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.path, ""]));
}

// ── Import from JSON ──────────────────────────────────────────────────────────

export type ParsedSubmissionJson =
  | {
      ok: true;
      values: Record<string, string>;
      documents: LoanDocumentInput[] | null;
      missingFields: string[];
    }
  | { ok: false; error: string };

function readPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Record<string, unknown>)[key];
  }, root);
}

export function parseSubmissionJson(text: string): ParsedSubmissionJson {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON — nothing was imported." };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return {
      ok: false,
      error: "Expected a single JSON object with the submission fields.",
    };
  }

  const values: Record<string, string> = {};
  const missingFields: string[] = [];
  for (const field of ALL_FIELDS) {
    const raw = readPath(root, field.path);
    if (typeof raw === "string" || typeof raw === "number") {
      values[field.path] = String(raw);
    } else if (field.required) {
      missingFields.push(field.path);
    }
  }

  const rawDocuments = (root as Record<string, unknown>).documents;
  let documents: LoanDocumentInput[] | null = null;
  if (Array.isArray(rawDocuments)) {
    documents = rawDocuments.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const { name, uri } = entry as Record<string, unknown>;
      return typeof name === "string" && typeof uri === "string"
        ? [{ name, uri }]
        : [];
    });
  }

  return { ok: true, values, documents, missingFields };
}

// ── Form → request payload ────────────────────────────────────────────────────

export type BuiltSubmission =
  | { ok: true; input: SubmitLoanInput }
  | {
      ok: false;
      fieldErrors: Record<string, string>;
    };

export function buildSubmitLoanInput(
  values: Record<string, string>,
  documents: LoanDocumentInput[],
): BuiltSubmission {
  const fieldErrors: Record<string, string> = {};
  const get = (path: string) => (values[path] ?? "").trim();

  for (const field of ALL_FIELDS) {
    const value = get(field.path);
    if (field.required && value === "") {
      fieldErrors[field.path] = "Required.";
    } else if (field.numeric && value !== "" && !/^\d+$/.test(value)) {
      fieldErrors[field.path] = "Must be a whole non-negative number.";
    }
  }
  for (const [i, doc] of documents.entries()) {
    if (doc.name.trim() === "" || doc.uri.trim() === "") {
      fieldErrors[`documents.${i}`] = "Both name and URI are required.";
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const num = (path: string) => Number.parseInt(get(path), 10);
  const secondary = get("secondary_metadata_uri");

  return {
    ok: true,
    input: {
      to: get("to"),
      metadata_uri: get("metadata_uri"),
      originator: get("originator"),
      borrower_id: get("borrower_id"),
      commodity: get("commodity"),
      corridor: get("corridor"),
      governing_law: get("governing_law"),
      protection: get("protection"),
      ...(secondary !== "" ? { secondary_metadata_uri: secondary } : {}),
      documents: documents.map((d) => ({
        name: d.name.trim(),
        uri: d.uri.trim(),
      })),
      economics: {
        original_facility_size: get("economics.original_facility_size"),
        original_senior_tranche: get("economics.original_senior_tranche"),
        original_equity_tranche: get("economics.original_equity_tranche"),
        original_offtaker_price: get("economics.original_offtaker_price"),
        senior_interest_rate_bps: num("economics.senior_interest_rate_bps"),
        origination_date: num("economics.origination_date"),
        original_maturity_date: num("economics.original_maturity_date"),
      },
      initial_ccr: num("initial_ccr"),
      initial_location: {
        location_type: get("initial_location.location_type"),
        location_identifier: get("initial_location.location_identifier"),
        tracking_url: get("initial_location.tracking_url"),
        updated_at: num("initial_location.updated_at"),
      },
      collateral_valuation: {
        valuation_mode: get("collateral_valuation.valuation_mode"),
        asset: get("collateral_valuation.asset"),
        price_provider: get("collateral_valuation.price_provider"),
        haircut_pct: get("collateral_valuation.haircut_pct"),
        quantity_dmt: get("collateral_valuation.quantity_dmt"),
      },
      fee_schedule: {
        mgmt_fee_rate_bps: num("fee_schedule.mgmt_fee_rate_bps"),
        perf_fee_rate_bps: num("fee_schedule.perf_fee_rate_bps"),
        oet_alloc_rate_bps: num("fee_schedule.oet_alloc_rate_bps"),
      },
    },
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface OriginationNewForm {
  values: Record<string, string>;
  setValue: (path: string, value: string) => void;
  documents: LoanDocumentInput[];
  addDocument: () => void;
  removeDocument: (index: number) => void;
  setDocument: (index: number, doc: LoanDocumentInput) => void;
  importWarning: string[] | null;
  importFromJson: (text: string) => string | null;
  fieldErrors: Record<string, string>;
  buildForSubmit: () => SubmitLoanInput | null;
}

export function useOriginationNewForm(): OriginationNewForm {
  const [values, setValues] = useState<Record<string, string>>(emptyFormValues);
  const [documents, setDocuments] = useState<LoanDocumentInput[]>([]);
  const [importWarning, setImportWarning] = useState<string[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setValue = (path: string, value: string) => {
    setValues((prev) => ({ ...prev, [path]: value }));
    setFieldErrors((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const importFromJson = (text: string): string | null => {
    const parsed = parseSubmissionJson(text);
    if (!parsed.ok) return parsed.error;
    setValues({ ...emptyFormValues(), ...parsed.values });
    setDocuments(parsed.documents ?? []);
    setImportWarning(
      parsed.missingFields.length > 0 ? parsed.missingFields : null,
    );
    setFieldErrors({});
    return null;
  };

  const buildForSubmit = (): SubmitLoanInput | null => {
    const built = buildSubmitLoanInput(values, documents);
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      return null;
    }
    setFieldErrors({});
    return built.input;
  };

  return {
    values,
    setValue,
    documents,
    addDocument: () => setDocuments((prev) => [...prev, { name: "", uri: "" }]),
    removeDocument: (index) =>
      setDocuments((prev) => prev.filter((_, i) => i !== index)),
    setDocument: (index, doc) =>
      setDocuments((prev) => prev.map((d, i) => (i === index ? doc : d))),
    importWarning,
    importFromJson,
    fieldErrors,
    buildForSubmit,
  };
}
