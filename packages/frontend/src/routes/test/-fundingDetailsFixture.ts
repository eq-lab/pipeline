// spec: docs/frontend/bank-transfers.md#fundingdetails
import type { FundingDetailsView } from "@/components/fundingDetails";

export const FUNDING_DETAILS_FIXTURE_READY: FundingDetailsView = {
  status: "ready",
  rows: [
    { label: "Company Name", value: "Example Trust LLC" },
    { label: "Bank Name", value: "Example Bank" },
    { label: "Bank Address", value: "1 Example Street" },
    { label: "Account Number", value: "00000000" },
    { label: "IBAN", value: "XX00 TEST 0000 0000 0000 00" },
    { label: "SWIFT / BIC code", value: "TESTXXXXXXX" },
    { label: "Payment reference", value: "PL-0000-0000-0000" },
  ],
  paymentReference: "PL-0000-0000-0000",
  network: "Stellar",
  receiverAddress: `G${"A".repeat(55)}`,
};

export const FUNDING_DETAILS_FIXTURE_LOADING: FundingDetailsView = {
  status: "loading",
};

export const FUNDING_DETAILS_FIXTURE_NOT_LINKED: FundingDetailsView = {
  status: "unavailable",
  reason: "not-linked",
  chainName: "Stellar",
};

export const FUNDING_DETAILS_FIXTURE_ERROR: FundingDetailsView = {
  status: "unavailable",
  reason: "error",
  chainName: "Stellar",
};
