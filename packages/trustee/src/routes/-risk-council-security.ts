// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { useState } from "react";
import {
  FLAG_OUTCOMES,
  SECURITY_PAYMENT_TERMS,
  securityReasonHash,
  type FlagOutcome,
  type SecurityPaymentTerm,
  type SecurityRegistryCall,
  type SecurityTermsInput,
} from "@pipeline/wallet-connect";
import {
  useLoanSecurity,
  type LoanSecurityInspection,
  type LoanSecurityRecord,
  type LoanSecurityTerms,
} from "@/api/useLoanSecurity";
import {
  bpsToPercentText,
  defaultRateToPercentText,
  durationToSeconds,
  formatServedDuration,
  percentToBpsStrict,
  percentToDefaultRate,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  secondsToUnitText,
} from "@/utils/securityTermsUnits";
import { buildSecurityCard, ltvRowText } from "./-loanSecurity";
import {
  formatLoanLabel,
  useRiskCouncilActionView,
  useRiskCouncilLoanBase,
  useTextHash,
  type ActionView,
  type LabelValue,
  type PageState,
} from "./-risk-council-shared";

export const SECURITY_TERMS_NO_ROLE =
  "Setting security terms belongs to the Risk Council.";
export const SECURITY_FLAG_NO_ROLE =
  "Settling an inspection flag belongs to the Risk Council.";
export const SECURITY_RELEASE_NO_ROLE =
  "Releasing a record with the lenders' consent belongs to the Risk Council.";
export const NO_SECURITY_TERMS = "No security terms are set for this loan.";
export const NO_FLAGGED_RECORDS = "No flagged records.";
export const NO_OPEN_RECORDS = "No open records.";
export const SECURITY_PAUSED_NOTE =
  "The SecurityRegistry is paused. Executing is blocked until it resumes.";
export const REFRESH_PENDING_NOTE =
  "Served state is refreshing after a recent change. It can lag by up to a minute.";
export const RELEASE_WARNING =
  "Releasing burns the record NFT. This cannot be undone.";

export const OUTCOME_EFFECTS: Record<FlagOutcome, string> = {
  Accepted:
    "The variance is explained: the flagging inspection's quantity and grade become the record's reference. Clears the flag.",
  TopUpRequired:
    "Opens a margin call if LTV is above the advance ratio. Clears the flag.",
  Escalated: "Suspected fraud or missing goods. The flag stays.",
};

export const PAYMENT_TERM_LABELS: Record<SecurityPaymentTerm, string> = {
  Lc: "Letter of credit (Lc)",
  Dp: "Documents against payment (Dp)",
  Da: "Documents against acceptance (Da)",
  OpenAccount: "Open account",
};

export function releaseConfirmText(recordId: string): string {
  return `Release record #${recordId}? This burns the record NFT and cannot be undone.`;
}

export type TermsFieldKey =
  | "advanceRatio"
  | "marginCallRatio"
  | "curePeriod"
  | "priceStaleAfter"
  | "gracePeriod"
  | "defaultRate"
  | "attestationInterval"
  | "inspectionInterval"
  | "tolerance"
  | "gradeTolerance";

export interface TermsFormValues extends Record<TermsFieldKey, string> {
  paymentTerm: SecurityPaymentTerm | "";
}

export interface TermsFieldSpec {
  key: TermsFieldKey;
  label: string;
  placeholder: string;
}

export const TERMS_FIELDS: ReadonlyArray<TermsFieldSpec> = [
  { key: "advanceRatio", label: "Advance ratio (%)", placeholder: "e.g. 70" },
  {
    key: "marginCallRatio",
    label: "Margin call ratio (%)",
    placeholder: "e.g. 80",
  },
  { key: "curePeriod", label: "Cure period (days)", placeholder: "e.g. 7" },
  {
    key: "priceStaleAfter",
    label: "Price stale after (hours, 0 = no limit)",
    placeholder: "e.g. 24",
  },
  { key: "gracePeriod", label: "Grace period (days)", placeholder: "e.g. 3" },
  {
    key: "defaultRate",
    label: "Default rate (%)",
    placeholder: "e.g. 2",
  },
  {
    key: "attestationInterval",
    label: "Attestation interval (days, 0 = off)",
    placeholder: "e.g. 30",
  },
  {
    key: "inspectionInterval",
    label: "Inspection interval (days, 0 = off)",
    placeholder: "e.g. 30",
  },
  {
    key: "tolerance",
    label: "Quantity tolerance (%)",
    placeholder: "e.g. 0.5",
  },
  {
    key: "gradeTolerance",
    label: "Grade tolerance (%)",
    placeholder: "e.g. 0.25",
  },
];

const EMPTY_TERMS_FORM: TermsFormValues = {
  advanceRatio: "",
  marginCallRatio: "",
  curePeriod: "",
  priceStaleAfter: "",
  gracePeriod: "",
  defaultRate: "",
  attestationInterval: "",
  inspectionInterval: "",
  tolerance: "",
  gradeTolerance: "",
  paymentTerm: "",
};

function durationPrefill(
  seconds: string | undefined,
  unitSeconds: number,
): string {
  return seconds == null ? "" : (secondsToUnitText(seconds, unitSeconds) ?? "");
}

export function prefillTermsForm(
  terms: LoanSecurityTerms | null | undefined,
): TermsFormValues {
  if (terms == null) return EMPTY_TERMS_FORM;
  const bps = (value: number | undefined) =>
    value == null ? "" : bpsToPercentText(value);
  const term = SECURITY_PAYMENT_TERMS.find((t) => t === terms.payment_term);
  return {
    advanceRatio: bps(terms.advance_ratio_bps),
    marginCallRatio: bps(terms.margin_call_ratio_bps),
    curePeriod: durationPrefill(terms.cure_period, SECONDS_PER_DAY),
    priceStaleAfter: durationPrefill(terms.price_stale_after, SECONDS_PER_HOUR),
    gracePeriod: durationPrefill(terms.grace_period, SECONDS_PER_DAY),
    defaultRate:
      terms.default_rate == null
        ? ""
        : defaultRateToPercentText(terms.default_rate),
    attestationInterval: durationPrefill(
      terms.attestation_interval,
      SECONDS_PER_DAY,
    ),
    inspectionInterval: durationPrefill(
      terms.inspection_interval,
      SECONDS_PER_DAY,
    ),
    tolerance: bps(terms.tolerance_bps),
    gradeTolerance: bps(terms.grade_tolerance_bps),
    paymentTerm: term ?? "",
  };
}

interface ParsedTerms {
  advanceRatioBps: number | null;
  marginCallRatioBps: number | null;
  curePeriod: string | null;
  priceStaleAfter: string | null;
  gracePeriod: string | null;
  defaultRate: number | null;
  attestationInterval: string | null;
  inspectionInterval: string | null;
  toleranceBps: number | null;
  gradeToleranceBps: number | null;
}

export function parseTermsForm(values: TermsFormValues): ParsedTerms {
  return {
    advanceRatioBps: percentToBpsStrict(values.advanceRatio),
    marginCallRatioBps: percentToBpsStrict(values.marginCallRatio),
    curePeriod: durationToSeconds(values.curePeriod, SECONDS_PER_DAY),
    priceStaleAfter: durationToSeconds(
      values.priceStaleAfter,
      SECONDS_PER_HOUR,
    ),
    gracePeriod: durationToSeconds(values.gracePeriod, SECONDS_PER_DAY),
    defaultRate: percentToDefaultRate(values.defaultRate),
    attestationInterval: durationToSeconds(
      values.attestationInterval,
      SECONDS_PER_DAY,
    ),
    inspectionInterval: durationToSeconds(
      values.inspectionInterval,
      SECONDS_PER_DAY,
    ),
    toleranceBps: percentToBpsStrict(values.tolerance),
    gradeToleranceBps: percentToBpsStrict(values.gradeTolerance),
  };
}

export const RATIO_ORDER_ERROR =
  "The margin call ratio must be at least the advance ratio.";

export function ratioOrderInvalid(parsed: ParsedTerms): boolean {
  return (
    parsed.advanceRatioBps !== null &&
    parsed.marginCallRatioBps !== null &&
    parsed.marginCallRatioBps < parsed.advanceRatioBps
  );
}

export function buildSetTermsCall(
  loanId: number | null,
  values: TermsFormValues,
): SecurityRegistryCall | null {
  const p = parseTermsForm(values);
  if (
    loanId === null ||
    values.paymentTerm === "" ||
    p.advanceRatioBps === null ||
    p.marginCallRatioBps === null ||
    p.curePeriod === null ||
    p.priceStaleAfter === null ||
    p.gracePeriod === null ||
    p.defaultRate === null ||
    p.attestationInterval === null ||
    p.inspectionInterval === null ||
    p.toleranceBps === null ||
    p.gradeToleranceBps === null ||
    ratioOrderInvalid(p)
  ) {
    return null;
  }
  const terms: SecurityTermsInput = {
    advanceRatioBps: p.advanceRatioBps,
    marginCallRatioBps: p.marginCallRatioBps,
    curePeriod: p.curePeriod,
    priceStaleAfter: p.priceStaleAfter,
    paymentTerm: values.paymentTerm,
    gracePeriod: p.gracePeriod,
    defaultRate: p.defaultRate,
    attestationInterval: p.attestationInterval,
    inspectionInterval: p.inspectionInterval,
    toleranceBps: p.toleranceBps,
    gradeToleranceBps: p.gradeToleranceBps,
  };
  return { fn: "set_terms", loanId, terms };
}

export function termsFieldEcho(
  key: TermsFieldKey,
  values: TermsFormValues,
): { echo: string | null; invalid: boolean } {
  const raw = values[key];
  if (raw.trim() === "") return { echo: null, invalid: false };
  const p = parseTermsForm(values);
  const bps: Partial<Record<TermsFieldKey, number | null>> = {
    advanceRatio: p.advanceRatioBps,
    marginCallRatio: p.marginCallRatioBps,
    tolerance: p.toleranceBps,
    gradeTolerance: p.gradeToleranceBps,
  };
  const seconds: Partial<Record<TermsFieldKey, string | null>> = {
    curePeriod: p.curePeriod,
    priceStaleAfter: p.priceStaleAfter,
    gracePeriod: p.gracePeriod,
    attestationInterval: p.attestationInterval,
    inspectionInterval: p.inspectionInterval,
  };
  if (key in bps) {
    const value = bps[key] ?? null;
    return {
      echo: value === null ? null : `= ${value} bps`,
      invalid: value === null,
    };
  }
  if (key === "defaultRate") {
    return {
      echo: p.defaultRate === null ? null : `= ${p.defaultRate} (1e6 scale)`,
      invalid: p.defaultRate === null,
    };
  }
  const value = seconds[key] ?? null;
  return {
    echo: value === null ? null : `= ${value} s`,
    invalid: value === null,
  };
}

export function formatTermsRows(
  terms: LoanSecurityTerms | null | undefined,
): LabelValue[] {
  if (terms == null) return [];
  const bps = (value: number | undefined) =>
    value == null ? "—" : `${bpsToPercentText(value)}%`;
  return [
    { label: "Advance ratio", value: bps(terms.advance_ratio_bps) },
    { label: "Margin call ratio", value: bps(terms.margin_call_ratio_bps) },
    { label: "Cure period", value: formatServedDuration(terms.cure_period) },
    {
      label: "Price stale after",
      value: formatServedDuration(terms.price_stale_after),
    },
    { label: "Payment term", value: terms.payment_term ?? "—" },
    { label: "Grace period", value: formatServedDuration(terms.grace_period) },
    {
      label: "Default rate",
      value:
        terms.default_rate == null
          ? "—"
          : `${defaultRateToPercentText(terms.default_rate)}%`,
    },
    {
      label: "Attestation interval",
      value: formatServedDuration(terms.attestation_interval),
    },
    {
      label: "Inspection interval",
      value: formatServedDuration(terms.inspection_interval),
    },
    { label: "Quantity tolerance", value: bps(terms.tolerance_bps) },
    { label: "Grade tolerance", value: bps(terms.grade_tolerance_bps) },
  ];
}

export interface FlaggedRecordRow {
  recordId: string;
  recordNumber: number | null;
  protection: string;
  lot: string;
  commodity: string;
  flag: LabelValue[];
}

export interface OpenRecordOption {
  recordId: string;
  label: string;
}

function dash(value: string | number | null | undefined): string {
  return value == null || value === "" ? "—" : String(value);
}

function variance(bps: number | null | undefined): string {
  return bps == null ? "—" : `${bps} bps`;
}

export function flaggingInspection(
  record: LoanSecurityRecord,
): LoanSecurityInspection | null {
  const flagged = (record.inspections ?? []).filter(
    (i) => i.flagged === true && i.resolution == null,
  );
  return flagged.length === 0 ? null : flagged[flagged.length - 1]!;
}

function recordNumber(recordId: string): number | null {
  return /^\d+$/.test(recordId) ? Number(recordId) : null;
}

export function flaggedRows(
  records: ReadonlyArray<LoanSecurityRecord> | undefined,
): FlaggedRecordRow[] {
  return (records ?? [])
    .filter((r) => r.flagged_by != null && r.record_id != null)
    .map((r) => {
      const recordId = r.record_id as string;
      const inspection = flaggingInspection(r);
      return {
        recordId,
        recordNumber: recordNumber(recordId),
        protection: dash(r.protection),
        lot: dash(r.lot_id),
        commodity: dash(r.commodity),
        flag: [
          { label: "Flagged by", value: dash(r.flagged_by) },
          { label: "Inspection kind", value: dash(inspection?.kind) },
          { label: "Inspector", value: dash(inspection?.inspector) },
          { label: "Quantity", value: dash(inspection?.quantity) },
          { label: "Grade", value: dash(inspection?.grade) },
          {
            label: "Variance vs reference",
            value: variance(inspection?.variance_reference_bps),
          },
          {
            label: "Variance vs previous",
            value: variance(inspection?.variance_previous_bps),
          },
          {
            label: "Grade variance",
            value: variance(inspection?.variance_grade_bps),
          },
        ],
      };
    });
}

export function openRecordOptions(
  records: ReadonlyArray<LoanSecurityRecord> | undefined,
): OpenRecordOption[] {
  return (records ?? [])
    .filter((r) => r.open === true && r.record_id != null)
    .map((r) => ({
      recordId: r.record_id as string,
      label: `#${r.record_id} — ${dash(r.protection)}, ${dash(r.commodity)}, lot ${dash(r.lot_id)} (${dash(r.status)})`,
    }));
}

export function buildResolveFlagCall(
  recordNumber: number | null,
  outcome: FlagOutcome,
  reasonHash: string | null,
): SecurityRegistryCall | null {
  if (recordNumber === null || reasonHash === null) return null;
  return { fn: "resolve_flag", recordId: recordNumber, outcome, reasonHash };
}

export function buildReleaseCall(
  recordId: string,
  consentHash: string | null,
): SecurityRegistryCall | null {
  const id = recordNumber(recordId);
  if (id === null || consentHash === null) return null;
  return { fn: "release_with_consent", recordId: id, consentHash };
}

export interface SetTermsFormView {
  values: TermsFormValues;
  setField: (key: TermsFieldKey, value: string) => void;
  setPaymentTerm: (value: SecurityPaymentTerm | "") => void;
  echoes: Record<TermsFieldKey, { echo: string | null; invalid: boolean }>;
  ratioOrderError: string | null;
  action: ActionView;
}

export interface ReleaseFormView {
  options: OpenRecordOption[];
  selected: string;
  setSelected: (recordId: string) => void;
  consent: string;
  setConsent: (value: string) => void;
  consentHash: string | null;
  confirmText: string | null;
  action: ActionView;
}

export interface RiskCouncilSecurityView {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  loanLabel: string;
  ltv: string | null;
  termsRows: LabelValue[];
  hasTerms: boolean;
  paused: boolean;
  pausedNote: string | null;
  refreshNote: string | null;
  securityLoading: boolean;
  flagged: FlaggedRecordRow[];
  setTerms: SetTermsFormView;
  release: ReleaseFormView;
  chainId: number;
  loanNumber: number | null;
  executeGate: string | null;
}

export function useRiskCouncilSecurity(
  chainId: number,
  loanIdParam: string,
): RiskCouncilSecurityView {
  const base = useRiskCouncilLoanBase(chainId, loanIdParam);
  const security = useLoanSecurity(chainId, loanIdParam);
  const served = security.data;
  const executeGate = served?.paused === true ? SECURITY_PAUSED_NOTE : null;

  const [overrides, setOverrides] = useState<Partial<TermsFormValues>>({});
  const prefill = prefillTermsForm(served?.terms);
  const values: TermsFormValues = { ...prefill, ...overrides };
  const termsCall = buildSetTermsCall(base.loanId, values);
  const parsed = parseTermsForm(values);

  const termsAction = useRiskCouncilActionView({
    chainId,
    call: termsCall,
    fn: "set_terms",
    noRoleCopy: SECURITY_TERMS_NO_ROLE,
    labels: {
      now: "Set terms",
      schedule: "Schedule terms",
      execute: "Execute terms",
    },
    enabled: true,
    executeGate,
    loanId: base.loanId ?? undefined,
  });

  const options = openRecordOptions(served?.records);
  const [picked, setPicked] = useState("");
  const selected = options.some((o) => o.recordId === picked)
    ? picked
    : (options[0]?.recordId ?? "");
  const [consent, setConsent] = useState("");
  const consentHash = useTextHash(consent, securityReasonHash);
  const releaseCall = buildReleaseCall(selected, consentHash);
  const releaseAction = useRiskCouncilActionView({
    chainId,
    call: releaseCall,
    fn: "release_with_consent",
    noRoleCopy: SECURITY_RELEASE_NO_ROLE,
    labels: {
      now: "Release with consent",
      schedule: "Schedule release",
      execute: "Execute release",
    },
    enabled: selected !== "",
    executeGate,
    loanId: base.loanId ?? undefined,
  });

  const echoes = Object.fromEntries(
    TERMS_FIELDS.map(({ key }) => [key, termsFieldEcho(key, values)]),
  ) as SetTermsFormView["echoes"];

  return {
    state: base.state,
    errorMessage: base.errorMessage,
    errorDetails: base.errorDetails,
    loanId: loanIdParam,
    loanLabel: formatLoanLabel(base.entry?.originator, base.entry?.commodity),
    ltv: ltvRowText(buildSecurityCard(security), served),
    termsRows: formatTermsRows(served?.terms),
    hasTerms: served?.terms != null,
    paused: served?.paused === true,
    pausedNote: executeGate,
    refreshNote: served?.refresh_pending === true ? REFRESH_PENDING_NOTE : null,
    securityLoading: security.isLoading,
    flagged: flaggedRows(served?.records),
    setTerms: {
      values,
      setField: (key, value) =>
        setOverrides((prev) => ({ ...prev, [key]: value })),
      setPaymentTerm: (value) =>
        setOverrides((prev) => ({ ...prev, paymentTerm: value })),
      echoes,
      ratioOrderError: ratioOrderInvalid(parsed) ? RATIO_ORDER_ERROR : null,
      action: termsAction,
    },
    release: {
      options,
      selected,
      setSelected: setPicked,
      consent,
      setConsent,
      consentHash,
      confirmText: selected === "" ? null : releaseConfirmText(selected),
      action: releaseAction,
    },
    chainId,
    loanNumber: base.loanId,
    executeGate,
  };
}

export interface ResolveFlagFormView {
  outcome: FlagOutcome;
  setOutcome: (outcome: FlagOutcome) => void;
  reason: string;
  setReason: (value: string) => void;
  reasonHash: string | null;
  action: ActionView;
}

export function useResolveFlagForm({
  chainId,
  loanId,
  recordNumber,
  executeGate,
}: {
  chainId: number;
  loanId: number | null;
  recordNumber: number | null;
  executeGate: string | null;
}): ResolveFlagFormView {
  const [outcome, setOutcome] = useState<FlagOutcome>(FLAG_OUTCOMES[0]!);
  const [reason, setReason] = useState("");
  const reasonHash = useTextHash(reason, securityReasonHash);
  const call = buildResolveFlagCall(recordNumber, outcome, reasonHash);
  const action = useRiskCouncilActionView({
    chainId,
    call,
    fn: "resolve_flag",
    noRoleCopy: SECURITY_FLAG_NO_ROLE,
    labels: {
      now: "Resolve flag",
      schedule: "Schedule resolution",
      execute: "Execute resolution",
    },
    enabled: true,
    executeGate,
    loanId: loanId ?? undefined,
  });
  return { outcome, setOutcome, reason, setReason, reasonHash, action };
}
