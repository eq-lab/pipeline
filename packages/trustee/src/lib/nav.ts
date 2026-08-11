/**
 * The six Trustee nav sections.
 *
 * spec: docs/frontend/trustee-flows.md#nav-sections-libnavts (Figma source,
 * #777→#786 taxonomy history, why `badgeCount` is unpopulated).
 */

export interface TrusteeNavItem {
  /** TanStack Router path, e.g. "/origination". */
  path: string;
  /** Nav label shown next to the icon. */
  navLabel: string;
  /** Page heading for the placeholder route. */
  heading: string;
  /** One-line placeholder description shown on the route body. */
  description: string;
  /** Optional backend-served count for the nav badge; omitted = no badge. */
  badgeCount?: number;
}

export const TRUSTEE_NAV_ITEMS: readonly TrusteeNavItem[] = [
  {
    path: "/",
    navLabel: "Overview",
    heading: "Overview",
    description:
      "Portfolio-wide summary of Trustee actions across every flow type. Content lands in a later sub-issue of epic #775.",
  },
  {
    path: "/origination",
    navLabel: "Origination",
    heading: "Origination",
    description:
      "Origination approval flows (Type 1 — direct Trustee-key writes). Calldata build/decode + broadcast UI lands in a later sub-issue of epic #775.",
  },
  {
    path: "/loans",
    navLabel: "Loans",
    heading: "Loans",
    description:
      "Loan disbursement and lifecycle flows (Types 1 and 2). Content lands in a later sub-issue of epic #775.",
  },
  {
    path: "/cash-management",
    navLabel: "Cash Management",
    heading: "Cash Management",
    description:
      "Capital Wallet MPC co-signature flows (Type 2 — T-Bill allocation swap, Withdrawal Queue Wallet top-up). Content lands in a later sub-issue of epic #775.",
  },
  {
    path: "/risk-council",
    navLabel: "Risk Council",
    heading: "Risk Council",
    description:
      "RISK_COUNCIL proposals and timelock tracker (Type 3). See docs/product-specs/trustee-dashboard.md, 'Type 3 — RISK_COUNCIL proposals'. Content lands in a later sub-issue of epic #775.",
  },
  {
    path: "/audit-log",
    navLabel: "Audit Log",
    heading: "Audit Log",
    description:
      "Read-only decision monitoring and audit trail (Type 4). See docs/product-specs/trustee-dashboard.md, 'Type 4 — Decision monitoring'. Content lands in a later sub-issue of epic #775.",
  },
] as const;
