# User Stories: #787 — Trustee: implement the sign-in section (Figma 4174-31660)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#787](https://github.com/eq-lab/pipeline/issues/787)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This is a UI-only sign-in gate — no auth/session backend, no wallet wiring (deferred to
#778). Stories verify the screen renders the wallet-connect prompt copy and controls; visual
fidelity (spacing, radius, colors) is verified separately by the QA agent's Figma comparison.

---

## Story 1: Sign-in route renders the login prompt

**Persona:** Trustee operator visiting the app before connecting a wallet.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`).

**Steps:**

1. Navigate to `http://localhost:5174/sign-in`.
2. Observe the page content.

**Expected outcomes:**

- A centered card is visible with a navy circular icon badge above the heading.
- The heading reads "Sign in to access Pipeline".
- Subtext reads "Connect your wallet to unlock the dashboard, metrics, and deal activity."
- A full-width black pill button labelled "Connect Wallet" is visible.
- Footer caption reads "No account? Contact your administrator."

---

## Story 2: Connect Wallet button is a documented no-op

**Persona:** Trustee operator / developer verifying the UI-only scope.

**Pre-conditions:** On `/sign-in`.

**Steps:**

1. Click the "Connect Wallet" button.

**Expected outcomes:**

- Nothing happens: no navigation, no network request, no error thrown. The button click is
  inert pending the wallet/session layer (issue #778; see
  `docs/exec-plans/tech-debt-tracker.md` TD-34).

---

## Story 3: Sign-in screen uses shared design tokens (no raw hex)

**Persona:** Developer verifying visual consistency with the rest of the Trustee/LP apps.

**Pre-conditions:** On `/sign-in`.

**Steps:**

1. Inspect the card, icon badge, heading, and button via browser DevTools.

**Expected outcomes:**

- The heading uses the Besley display font; body/caption text uses Graphik LC.
- The icon badge and button fills resolve to the shared `--color-pipeline-brand` (navy) and
  `--color-pipeline-cta` (near-black) tokens respectively — not ad hoc hex values baked into
  the component logic.
- The button is fully rounded (pill) and spans the card's full width.
