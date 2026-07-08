# User Stories: #786 — Trustee: implement the app shell (Figma 4116-8855)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#786](https://github.com/eq-lab/pipeline/issues/786)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This replaces the #777 scaffold's topbar-based `TrusteeShell` with the persistent left-sidebar
app shell from Figma node `4116:8855` ("Aside"). Per-flow signing content behind each nav item
is still a placeholder (later sub-issues of epic #775, #780–#782) — these stories verify the
shell/nav structure, active-route state, and account chip behavior. Visual fidelity (spacing,
colors, radii) is verified separately by the QA agent's Figma comparison.

---

## Story 1: Sidebar renders all six nav sections with the wordmark

**Persona:** Trustee operator visiting the app after signing in.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the left sidebar.

**Expected outcomes:**

- A fixed navy sidebar renders on the left with the Pipeline wordmark at the top.
- Six nav items are listed in order: Overview, Origination, Loans, Cash Management, Risk
  Council, Audit Log.
- Each nav item shows an icon glyph and a label; no numeric count badges are shown (see
  `docs/exec-plans/tech-debt-tracker.md` TD-36 — no backend count source yet).
- A divider line separates Overview from Origination/Loans/Cash Management, and another
  separates that group from Risk Council/Audit Log.

---

## Story 2: Active nav item reflects the current route

**Persona:** Trustee operator navigating between sections.

**Pre-conditions:** Signed in, sidebar visible.

**Steps:**

1. Click "Loans" in the sidebar.
2. Observe the sidebar and page content.
3. Click "Overview".

**Expected outcomes:**

- After clicking "Loans", the browser navigates to `/loans`; the "Loans" nav item shows the
  active style (white surface background, brand-navy label/icon) and no other item is active.
- The page body shows the "Loans" placeholder heading.
- After clicking "Overview", the browser navigates to `/`; "Overview" becomes the active item
  and "Loans" returns to its inactive (white-on-navy) style.
- Active state is driven by the actual route (not a hardcoded label) — this holds for every
  nav item, not just the two exercised here.

---

## Story 3: Account chip shows the connected address and "Trustee · connected"

**Persona:** Trustee operator checking their session identity.

**Pre-conditions:** Signed in with a connected wallet.

**Steps:**

1. Observe the bottom of the sidebar.

**Expected outcomes:**

- A chip is pinned to the bottom of the sidebar showing a circular avatar glyph, the
  connected wallet address truncated as `0x1234…abcd` (or the Stellar equivalent), and the
  subtitle "Trustee · connected".
- A "⋯" affordance is visible to the right of the chip.

---

## Story 4: "⋯" opens a menu with Sign out

**Persona:** Trustee operator ending their session.

**Pre-conditions:** Signed in, sidebar visible.

**Steps:**

1. Click the "⋯" affordance in the account chip.
2. Observe the menu that appears.
3. Click "Sign out".

**Expected outcomes:**

- Clicking "⋯" opens a small popover menu containing a single "Sign out" item.
- Clicking "Sign out" ends the session and redirects to `/sign-in` (per
  `useTrusteeSession().signOut`, unchanged from #791).
- There is no other always-visible sign-out control on the page.

---

## Story 5: Sidebar is hidden on the standalone sign-in route

**Persona:** Trustee operator who has not yet signed in.

**Pre-conditions:** No active session (signed out, or a fresh browser session).

**Steps:**

1. Navigate to `http://localhost:5174/sign-in`.
2. Observe the page.

**Expected outcomes:**

- No sidebar is rendered — the sign-in card is centered over a full-viewport-height overlay
  (no 73px topbar offset).
- Navigating to any other route while unauthenticated redirects back to `/sign-in` (unchanged
  `RouteGate` behavior from #791).
