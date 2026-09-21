# User Stories: #1284 — LP Account page — wallet, corporate email, KYB documents hub

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1284](https://github.com/eq-lab/pipeline/issues/1284)
Spec: [docs/frontend/account-page.md](../../frontend/account-page.md)

This is a presentational route — no network call, no persistence, no auth. It is reachable only
at `http://localhost:5173/account` under the dev server (`beforeLoad` redirects to `/` when
`ENV.IS_DEV` is false); the six designed documents states are reachable via `?state=<id>` links on
`/test?tab=auth`. Styling-only assertions (exact colors, radii, spacing) are out of scope — visual
fidelity is verified separately by the QA agent's Figma comparison against nodes `6701-98099`,
`6701-98137`, `6701-98175`, `6701-98022`, `6701-97982`, and `6701-98061`.

---

## Story 1: The `verify` state shows the upload flow with Save disabled

**Persona:** A newly created LP with no documents on file.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/account?state=verify`.

**Steps:**

1. Observe the Documents section.

**Expected outcomes:**

- A banner reads exactly "Verify your account" / "Upload your company documents to unlock bank
  transfers."
- An upload row reads "Upload documents" / "pdf, jpg, png files up to 10MB" with a trailing
  `Upload` button.
- The requirements list is present, ending with "Personal KYC for each shareholder / UBO:" and its
  two nested items.
- No document rows are shown.
- The `Save` button is present and disabled.

---

## Story 2: The `staged` state shows staged rows and an enabled Save

**Pre-conditions:** At `http://localhost:5173/account?state=staged`.

**Steps:**

1. Observe the Documents section.

**Expected outcomes:**

- The banner reads "Verify your identity" (not "Verify your account" — a deliberate per-frame
  copy difference, not a bug).
- Six staged file rows are shown, each with an "Uploaded" caption and a "Remove {filename}"
  button.
- The `Save` button is enabled.

---

## Story 3: Staging flow — pick files, rows appear, Save enables, removing the last disables it again

**Pre-conditions:** At `http://localhost:5173/account?state=verify`.

**Steps:**

1. Use the upload row's `Upload` button to select one accepted file (pdf, jpg, or png, ≤10MB).
2. Observe the new row and the `Save` button.
3. Click that row's remove button.
4. Observe the `Save` button again.

**Expected outcomes:**

- After step 1: a new row appears with the file's name and an "Uploaded" caption; `Save` becomes
  enabled.
- After step 3: the row disappears and `Save` becomes disabled again.

---

## Story 4: A rejected file recolors the upload row's caption without changing layout

**Pre-conditions:** At `http://localhost:5173/account?state=verify`.

**Steps:**

1. Select a file with a disallowed type (e.g. `.exe`) or one larger than 10MB via the upload row.

**Expected outcomes:**

- No document row is added for the rejected file.
- The upload row's helper caption ("pdf, jpg, png files up to 10MB") switches to its negative
  color and carries `role="alert"`; no new copy or layout element appears.
- Selecting a mixed batch (one accepted, one rejected) stages the accepted file and still shows
  the rejection recoloring.

---

## Story 5: Save is an inert seam — clicking it never fabricates a state transition

**Pre-conditions:** At `http://localhost:5173/account?state=staged`.

**Steps:**

1. Click the `Save` button.

**Expected outcomes:**

- Nothing about the rendered page changes — the same banner, upload row, requirements list, and
  staged rows remain exactly as before. The page does **not** transition to the "under review"
  state. (Backend wiring for the real transition lands in #1267/#1273/#1254.)

---

## Story 6: The `under-review` stand-in shows submitted files with no remove control and no Save

**Pre-conditions:** At `http://localhost:5173/account?state=under-review`.

**Steps:**

1. Observe the Documents section.

**Expected outcomes:**

- The banner reads "Verifying account" / "We are reviewing your documents."
- Every submitted file row shows an "Uploaded" caption and has **no** remove button.
- There is no upload row, no requirements list, and no `Save` button.

---

## Story 7: The `missing` state shows a negative banner naming the missing document

**Pre-conditions:** At `http://localhost:5173/account?state=missing`.

**Steps:**

1. Observe the Documents section.

**Expected outcomes:**

- A negative-toned banner reads "Certificate of Incorporation required" / "Please upload the
  document." with a trailing `Upload` button.
- Six document rows are shown, all captioned "Verified" with a decorative trailing chevron.
- There is no row for the missing document itself — it is represented only by the banner.
- No upload row, no requirements list, no `Save` button.

---

## Story 8: The `invalid` state shows one rejected document with a Re-upload action

**Pre-conditions:** At `http://localhost:5173/account?state=invalid`.

**Steps:**

1. Observe the Documents section.

**Expected outcomes:**

- A negative-toned banner (no trailing button) reads "Re-upload your document" / "Some
  information may be missing or incorrect".
- One document row is captioned "Invalid document" and has a trailing `Re-upload` text button.
- The remaining six document rows are captioned "Verified" with a decorative chevron.
- No upload row, no requirements list, no `Save` button.

---

## Story 9: The `verified` state shows only the completed document list

**Pre-conditions:** At `http://localhost:5173/account?state=verified`.

**Steps:**

1. Observe the Documents section.

**Expected outcomes:**

- No banner is shown.
- All seven document rows are captioned "Verified" with a decorative trailing chevron.
- No upload row, no requirements list, no `Save` button.

---

## Story 10: Wallet card — disconnected shows Connect Wallet; connecting reveals address and balance

**Pre-conditions:** At `http://localhost:5173/account`, wallet disconnected.

**Steps:**

1. Observe the wallet card.
2. Connect a wallet (or use the mock wallet layer).
3. Observe the wallet card again.

**Expected outcomes:**

- Disconnected: a 72px circle with a generic wallet glyph and a full-width `Connect Wallet`
  button; clicking it opens the shared connect-wallet picker.
- Connected: a `Wallet` row shows the truncated address plus a copy button; a `USDC balance` row
  shows the formatted balance, or `—` when it has not resolved yet.

---

## Story 11: Switching the wallet namespace tab does not disconnect the other namespace

**Pre-conditions:** At `http://localhost:5173/account`, an EVM wallet connected, Stellar
disconnected.

**Steps:**

1. Click the `Stellar` tab in the wallet card.
2. Click back to the `Ethereum` tab.

**Expected outcomes:**

- After step 1: the wallet card shows Stellar's (disconnected) view; the EVM wallet remains
  connected in the background.
- After step 2: the EVM wallet's address and balance reappear unchanged — selecting a tab never
  triggers a disconnect.

---

## Story 12: Corporate email renders `—` until the backend is wired

**Pre-conditions:** At `http://localhost:5173/account`.

**Steps:**

1. Observe the Corporate email section.

**Expected outcomes:**

- The `Email` row shows `—` (no client-computed or placeholder address) — #1254 wires the real
  value.
