/**
 * The six Trustee nav sections, per Figma node `4116:8855` ("Aside") and
 * `docs/product-specs/trustee-dashboard.md` (spec #453).
 *
 * This replaces the #777 scaffold's `TRUSTEE_FLOW_TYPES` (Type-1..4 taxonomy)
 * — the Figma nav is the real product navigation (issue #786). Per-flow
 * signing content for each section still lands in later sub-issues of epic
 * #775 (#780–#782); these routes render placeholder page bodies until then.
 *
 * `badgeCount` is intentionally unpopulated today — there is no backend
 * source for the counts shown in the Figma mock (1 / 4 / 3 on Origination /
 * Loans / Cash Management). Per the project rule [no frontend-computed
 * metrics], the badge slot renders only when a count is supplied; see
 * `TrusteeSidebar`'s `NavBadge`. Wiring a real count is tracked in
 * `docs/exec-plans/tech-debt-tracker.md`.
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
