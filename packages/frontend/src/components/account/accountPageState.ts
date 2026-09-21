// spec: docs/frontend/account-page.md#accountpagestate
export type AccountDocumentsState =
  | "verify"
  | "staged"
  | "under-review"
  | "missing"
  | "invalid"
  | "verified";

export type KybStatus =
  | "NotStarted"
  | "InProgress"
  | "UnderReview"
  | "Passed"
  | "Failed";

export type KybDocumentStatus =
  | "NotProvided"
  | "Provided"
  | "Verified"
  | "Rejected";

export interface AccountDocumentRecord {
  name: string;
  status: KybDocumentStatus;
}

export interface DeriveDocumentsStateInput {
  kybStatus: KybStatus;
  documents: AccountDocumentRecord[];
  stagedCount: number;
}

export function deriveDocumentsState({
  kybStatus,
  documents,
  stagedCount,
}: DeriveDocumentsStateInput): AccountDocumentsState {
  if (kybStatus === "Passed") return "verified";
  if (documents.some((d) => d.status === "Rejected")) return "invalid";
  if (documents.some((d) => d.status === "NotProvided")) return "missing";
  if (kybStatus === "UnderReview") return "under-review";
  if (stagedCount > 0) return "staged";
  return "verify";
}

export interface AccountStatePreview {
  kybStatus: KybStatus;
  documents: AccountDocumentRecord[];
  missingDocumentName?: string;
}

const VERIFIED_DOCUMENTS: AccountDocumentRecord[] = [
  { name: "certificate-of-incorporation.pdf", status: "Verified" },
  { name: "registry-of-legal-entities.pdf", status: "Verified" },
  { name: "certificate-of-good-standing.pdf", status: "Verified" },
  { name: "legal-address.pdf", status: "Verified" },
  { name: "shareholder-register.pdf", status: "Verified" },
  { name: "government-id.pdf", status: "Verified" },
  { name: "proof-of-address.pdf", status: "Verified" },
];

export const ACCOUNT_STATE_PREVIEWS: Record<
  AccountDocumentsState,
  AccountStatePreview
> = {
  verify: { kybStatus: "NotStarted", documents: [] },
  staged: { kybStatus: "NotStarted", documents: [] },
  "under-review": {
    kybStatus: "UnderReview",
    documents: VERIFIED_DOCUMENTS.map((d) => ({
      name: d.name,
      status: "Provided",
    })),
  },
  missing: {
    kybStatus: "InProgress",
    documents: [
      { name: "certificate-of-incorporation.pdf", status: "NotProvided" },
      ...VERIFIED_DOCUMENTS.slice(1),
    ],
    missingDocumentName: "Certificate of Incorporation",
  },
  invalid: {
    kybStatus: "InProgress",
    documents: [
      { name: "certificate-of-incorporation.pdf", status: "Verified" },
      { name: "registry-of-legal-entities.pdf", status: "Rejected" },
      ...VERIFIED_DOCUMENTS.slice(2),
    ],
  },
  verified: { kybStatus: "Passed", documents: VERIFIED_DOCUMENTS },
};

const PREVIEW_STAGED_FILE_NAMES: readonly string[] = [
  "certificate-of-incorporation.pdf",
  "registry-of-legal-entities.pdf",
  "certificate-of-good-standing.pdf",
  "legal-address.pdf",
  "shareholder-register.pdf",
  "government-id.pdf",
];

export function createPreviewStagedFiles(): File[] {
  return PREVIEW_STAGED_FILE_NAMES.map(
    (name) => new File([], name, { type: "application/pdf" }),
  );
}

export function parseAccountStatePreview(
  raw: unknown,
): AccountDocumentsState | undefined {
  if (typeof raw !== "string") return undefined;
  return raw in ACCOUNT_STATE_PREVIEWS
    ? (raw as AccountDocumentsState)
    : undefined;
}
