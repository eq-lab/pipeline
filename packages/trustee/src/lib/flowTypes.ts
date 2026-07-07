/**
 * The four Trustee flow types, per `docs/product-specs/trustee-dashboard.md`
 * (spec #453). Every Trustee action is one of these types; the type sets the
 * UX affordance, so the dashboard is organised by type (issue #777).
 *
 * This is scaffold-only metadata (route path, nav label, heading, one-line
 * description) — no flow logic. Each per-type route is filled in by a later
 * sub-issue of epic #775.
 */

export interface TrusteeFlowType {
  /** TanStack Router path, e.g. "/type1-direct". */
  path: string;
  /** Short label used in the topbar nav. */
  navLabel: string;
  /** Page heading naming the type. */
  heading: string;
  /** One-line description drawn from the spec's "Mechanism" / "UX affordance" columns. */
  description: string;
}

export const TRUSTEE_FLOW_TYPES: readonly TrusteeFlowType[] = [
  {
    path: "/type1-direct",
    navLabel: "Type 1 · Direct",
    heading: "Type 1 — Direct Trustee-key writes",
    description:
      "One-click broadcast after decoded-calldata review — the Trustee EOA broadcasts directly, no other signer, no timelock.",
  },
  {
    path: "/type2-mpc",
    navLabel: "Type 2 · MPC",
    heading: "Type 2 — Capital Wallet MPC co-signature",
    description:
      "Assemble the request, Trustee co-signs in the 3-of-5 custodian MPC, dashboard tracks signature collection toward settlement.",
  },
  {
    path: "/type3-council",
    navLabel: "Type 3 · RISK_COUNCIL",
    heading: "Type 3 — RISK_COUNCIL proposals",
    description:
      "Proposal builder plus timelock tracker for the 3-of-5 RISK_COUNCIL Safe (24h, GUARDIAN-cancelable) — the Trustee cannot execute.",
  },
  {
    path: "/type4-monitoring",
    navLabel: "Type 4 · Monitoring",
    heading: "Type 4 — Decision monitoring",
    description:
      "Read-only display and alerting surfaces, with a retrigger control where a downstream service (Relayer plus custodian) acts.",
  },
] as const;
