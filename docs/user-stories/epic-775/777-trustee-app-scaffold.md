# User Stories: #777 — Trustee: scaffold packages/trustee Vite app (port 5174)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#777](https://github.com/eq-lab/pipeline/issues/777)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This is a structural scaffold — no Trustee flow logic. Stories verify the shell renders,
routes exist, and the app is genuinely isolated from the LP frontend (port, entrypoint,
theme).

---

## Story 1: Trustee dev server runs on its own port (5174, strictPort)

**Persona:** Developer running the Trustee app locally.

**Pre-conditions:** Repo dependencies installed (`yarn install`).

**Steps:**

1. Run `yarn workspace @pipeline/trustee dev` (or `yarn trustee:dev`).
2. Observe the Vite server URL printed to the terminal.

**Expected outcomes:**

- The server starts on `http://localhost:5174`.
- If port 5174 is already occupied, Vite fails to start rather than silently picking
  another port (`strictPort: true`) — confirms no silent collision with the LP app.

---

## Story 2: LP frontend still runs unaffected on 5173

**Persona:** Developer running both apps side by side.

**Pre-conditions:** Trustee dev server running on 5174 (Story 1).

**Steps:**

1. In a separate terminal, run `yarn workspace @pipeline/frontend dev` (or `yarn front:dev`).
2. Observe the Vite server URL printed to the terminal.

**Expected outcomes:**

- The LP frontend starts on `http://localhost:5173` (assuming the port is free) with no
  conflict or error caused by the Trustee dev server running concurrently.

---

## Story 3: Trustee landing page lists all four flow types

**Persona:** Trustee operator (once auth lands) or a developer previewing the shell.

**Pre-conditions:** Trustee dev server running at `http://localhost:5174`.

**Steps:**

1. Navigate to `http://localhost:5174/`.
2. Observe the page content.

**Expected outcomes:**

- The page title (browser tab) reads "Pipeline Trustee".
- A "Trustee Admin" heading is visible.
- Four links are visible, one per Trustee flow type, labelled with each type's full heading:
  - "Type 1 — Direct Trustee-key writes"
  - "Type 2 — Capital Wallet MPC co-signature"
  - "Type 3 — RISK_COUNCIL proposals"
  - "Type 4 — Decision monitoring"
- Clicking each link navigates to its respective route (see Stories 4-7).

---

## Story 4: Type 1 (Direct) placeholder route

**Persona:** Trustee operator / developer.

**Pre-conditions:** Trustee dev server running.

**Steps:**

1. Navigate to `http://localhost:5174/type1-direct`.
2. Observe the page content.

**Expected outcomes:**

- A heading "Type 1 — Direct Trustee-key writes" is visible.
- A one-line description mentioning "one-click broadcast after decoded-calldata review" is
  visible.
- No data tables, forms, or wallet-connect prompts are present — this is a placeholder only.

---

## Story 5: Type 2 (MPC) placeholder route

**Persona:** Trustee operator / developer.

**Pre-conditions:** Trustee dev server running.

**Steps:**

1. Navigate to `http://localhost:5174/type2-mpc`.
2. Observe the page content.

**Expected outcomes:**

- A heading "Type 2 — Capital Wallet MPC co-signature" is visible.
- A one-line description mentioning MPC co-signing / signature collection tracking is
  visible.
- No data tables, forms, or wallet-connect prompts are present.

---

## Story 6: Type 3 (RISK_COUNCIL) placeholder route

**Persona:** Trustee operator / developer.

**Pre-conditions:** Trustee dev server running.

**Steps:**

1. Navigate to `http://localhost:5174/type3-council`.
2. Observe the page content.

**Expected outcomes:**

- A heading "Type 3 — RISK_COUNCIL proposals" is visible.
- A one-line description mentioning "proposal builder" and a "timelock tracker" is visible.
- No data tables, forms, or wallet-connect prompts are present.

---

## Story 7: Type 4 (Monitoring) placeholder route

**Persona:** Trustee operator / developer.

**Pre-conditions:** Trustee dev server running.

**Steps:**

1. Navigate to `http://localhost:5174/type4-monitoring`.
2. Observe the page content.

**Expected outcomes:**

- A heading "Type 4 — Decision monitoring" is visible.
- A one-line description mentioning read-only display/alerting is visible.
- No data tables, forms, or wallet-connect prompts are present.

---

## Story 8: Shared design tokens render correctly (theme parity with LP app)

**Persona:** Developer verifying visual consistency between the two apps.

**Pre-conditions:** Trustee dev server running.

**Steps:**

1. Navigate to `http://localhost:5174/`.
2. Inspect the page's fonts, colors, and card surfaces via browser DevTools.

**Expected outcomes:**

- The Besley (display) and Graphik LC (body) fonts load and render (no fallback-only text).
- The Pipeline wordmark (Logo) renders in the topbar, matching the LP app's logo asset.
- The landing page's flow-type list renders inside a `Card` component with the same paper/
  ink token colors used by the LP app (no raw hex codes visually distinct from the design
  system).

---

## Story 9: Topbar navigation links to every flow type

**Persona:** Trustee operator navigating between flow types.

**Pre-conditions:** Trustee dev server running.

**Steps:**

1. Navigate to `http://localhost:5174/`.
2. Observe the topbar (header row) above the page content.
3. Click each of the four nav labels in turn.

**Expected outcomes:**

- The topbar shows the Pipeline wordmark + "Trustee Admin" label on the left.
- Four nav links are visible on the right: "Type 1 · Direct", "Type 2 · MPC",
  "Type 3 · RISK_COUNCIL", "Type 4 · Monitoring".
- Clicking each nav link navigates to the corresponding `/type{N}-*` route.
- The topbar persists (same header) across all routes, including the landing page.

---

## Story 10: Production build succeeds and emits a static SPA bundle

**Persona:** Developer / CI running the build.

**Pre-conditions:** Repo dependencies installed.

**Steps:**

1. Run `yarn workspace @pipeline/trustee build`.
2. Inspect the output.

**Expected outcomes:**

- The command exits successfully (`tsc -b && vite build`, no type errors).
- `packages/trustee/dist/index.html` and hashed asset files are emitted.
- The LP frontend build (`yarn workspace @pipeline/frontend build`) is unaffected and also
  succeeds when run separately.

---

## Story 11: Docker image builds and serves the SPA with injected runtime env

**Persona:** Developer / CI building the deploy image.

**Pre-conditions:** Docker available locally.

**Steps:**

1. Run `docker build --target trustee -t pipeline-trustee .` from the repo root.
2. Run the image with `-e VITE_API_BASE_URL=<url>` and a mapped port.
3. Request `GET /__env.js` and `GET /` (and a client-side route, e.g. `/type1-direct`) from
   the running container.

**Expected outcomes:**

- The image builds successfully (`trustee-build` + `trustee` stages).
- `/__env.js` returns `window.__ENV__ = { "VITE_API_BASE_URL": "<url>" };` reflecting the
  env var passed at `docker run` time.
- `GET /` returns HTTP 200 with the SPA shell.
- `GET /type1-direct` (a client-side route with no matching file) also returns HTTP 200 with
  the SPA shell (nginx `try_files` fallback to `index.html`), not a 404.
