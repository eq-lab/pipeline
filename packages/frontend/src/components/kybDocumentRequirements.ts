// spec: docs/frontend/account-page.md#kybdocumentrequirements
import { COMPANY_DOCUMENT_SLOTS } from "@/components/useCompanyDocsModal";

export const REQUIREMENTS_LEAD_LINE = "Requirement documents:";

export const KYB_DOCUMENT_REQUIREMENTS: readonly string[] = [
  ...COMPANY_DOCUMENT_SLOTS.map((slot) => slot.label),
  "Personal KYC for each shareholder / UBO:",
];

export const KYB_UBO_SUB_REQUIREMENTS: readonly string[] = [
  "Government-issued ID.",
  "Proof of Address (bill, bank or credit card statements)",
];
