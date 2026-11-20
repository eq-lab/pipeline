// spec: docs/frontend/trustee-flows.md#settlement-addresses
import type { LpSummary } from "@/api/useLps";
import { isStellarTarget } from "@/lib/targetChains";
import { formatIsoDateTimeUtc } from "@/utils/formatDate";

export type SettlementChainKind = "stellar" | "evm";

export interface SettlementAddressRow {
  kind: SettlementChainKind;
  chainLabel: "Stellar" | "EVM";
  address: string;
  signer: string | null;
  isUnproven: boolean;
  linkedAt: string;
}

export type SettlementAddressFields = Pick<
  LpSummary,
  | "stellar_address"
  | "address_linked_at"
  | "stellar_signer_address"
  | "evm_address"
  | "evm_address_linked_at"
  | "evm_signer_address"
>;

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export function settlementAddressRows(
  lp: SettlementAddressFields,
): SettlementAddressRow[] {
  const rows: SettlementAddressRow[] = [];
  if (present(lp.stellar_address)) {
    const signer = present(lp.stellar_signer_address)
      ? lp.stellar_signer_address
      : null;
    rows.push({
      kind: "stellar",
      chainLabel: "Stellar",
      address: lp.stellar_address,
      signer,
      isUnproven: signer === null,
      linkedAt: formatIsoDateTimeUtc(lp.address_linked_at),
    });
  }
  if (present(lp.evm_address)) {
    const signer = present(lp.evm_signer_address)
      ? lp.evm_signer_address
      : null;
    rows.push({
      kind: "evm",
      chainLabel: "EVM",
      address: lp.evm_address,
      signer,
      isUnproven: signer === null,
      linkedAt: formatIsoDateTimeUtc(lp.evm_address_linked_at),
    });
  }
  return rows;
}

export function linkedAddressesLabel(lp: SettlementAddressFields): string {
  const rows = settlementAddressRows(lp);
  if (rows.length === 0) return "No";
  return rows
    .map((row) =>
      row.isUnproven ? `${row.chainLabel} (unproven)` : row.chainLabel,
    )
    .join(" + ");
}

export function chainKindOf(
  chainId: number | null | undefined,
): SettlementChainKind {
  return isStellarTarget(chainId) ? "stellar" : "evm";
}
