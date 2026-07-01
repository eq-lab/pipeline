# User Stories: #719 — Withdrawal Queue UI (Panel C)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#719](https://github.com/eq-lab/pipeline/issues/719)
Plan: `docs/exec-plans/active/issue-719-withdrawal-queue-ui.md`
Figma desktop: [node 3283:14893](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14893&m=dev)
Figma mobile: [node 3283:72387](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387&m=dev)

---

## Story 1: Ready state — summary cards + queue table

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; mock data set for the withdrawal queue.

**Steps:**

1. Set mock data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/withdrawal-queue",
     JSON.stringify({
       summary: {
         in_queue_usd: "1850000.000000",
         requests_count: 6,
         estimated_wait_days: "3.2",
         liquid_cover: null,
       },
       items: [
         { account: "0x7a3f2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f3f", amount: "620000.000000", status: "Completed" },
         { account: "0xabcdef1234567890abcdef1234567890abcdef12", amount: "480000.000000", status: "Queued" },
       ],
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Withdrawal Queue" panel.

**Expected outcomes:**

- The panel title reads **"Withdrawal Queue"**.
- Four summary cards are visible:
  - **"In Queue"** shows **$1.9M**.
  - **"Requests"** shows **6**.
  - **"Estimated wait"** shows **~3.2 days**.
  - **"Liquid Cover"** shows **—** (em-dash — always null until the reserves endpoint exists).
- The table has three columns: **Holder / Amount / Status**.
- First row: Holder **"0x7a3f…9f3f"**, Amount **$620.0K**, Status **"Completed"** in green.
- Second row: Holder **"0xabcd…ef12"**, Amount **$480.0K**, Status **"Queued"** in muted ink.
- The `data-testid="dashboard-panel-withdrawal-queue"` attribute is present on the panel root.

---

## Story 2: Empty state — no queue items

**Persona:** Any user when there are no pending withdrawal requests.

**Pre-conditions:** Mock data with an empty items array.

**Steps:**

1. Set mock data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/withdrawal-queue",
     JSON.stringify({
       summary: { in_queue_usd: "0.000000", requests_count: 0, estimated_wait_days: null, liquid_cover: null },
       items: [],
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Withdrawal Queue" panel.

**Expected outcomes:**

- The panel shows the empty state body (PanelEmpty).
- The panel does NOT crash.

---

## Story 3: Error state — API returns 500

**Persona:** Any user when the backend is unavailable.

**Pre-conditions:** No mock key set; the real API returns a 500 error or is unavailable.

**Steps:**

1. Clear any mock keys for `pipeline.mock.api.GET./v1/withdrawal-queue`.
2. Ensure the API server returns 500 for `/v1/withdrawal-queue`.
3. Navigate to `http://localhost:3000/dashboard`.
4. Observe the "Withdrawal Queue" panel.

**Expected outcomes:**

- The panel shows the error state body (PanelError).
- A **retry button** is visible. Clicking it triggers a refetch.
- The panel does NOT crash or show loading indefinitely.

---

## Story 4: "Show more" — expand when there are more than 5 items

**Persona:** Any user when the queue has more than 5 items.

**Pre-conditions:** Mock data with 6 or more items.

**Steps:**

1. Set mock data with 6 items:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/withdrawal-queue",
     JSON.stringify({
       summary: { in_queue_usd: "3000000.000000", requests_count: 6, estimated_wait_days: "5.0", liquid_cover: null },
       items: [
         { account: "0x1111111111111111111111111111111111111111", amount: "100000.000000", status: "Completed" },
         { account: "0x2222222222222222222222222222222222222222", amount: "200000.000000", status: "Queued" },
         { account: "0x3333333333333333333333333333333333333333", amount: "300000.000000", status: "Queued" },
         { account: "0x4444444444444444444444444444444444444444", amount: "400000.000000", status: "Completed" },
         { account: "0x5555555555555555555555555555555555555555", amount: "500000.000000", status: "Queued" },
         { account: "0x6666666666666666666666666666666666666666", amount: "600000.000000", status: "Queued" },
       ],
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Withdrawal Queue" panel table.

**Expected outcomes:**

- Only **5 rows** are visible initially.
- A **"Show more"** button is visible below the table.
- Clicking **"Show more"** reveals the 6th row.
- After expanding, the "Show more" button disappears.

---

## Story 5: Status colour treatment

**Persona:** Any user reviewing the withdrawal queue.

**Pre-conditions:** Ready state mock data with both `Completed` and `Queued` items.

**Steps:**

1. Set mock data as in Story 1.
2. Navigate to `http://localhost:3000/dashboard` and find the "Withdrawal Queue" table.

**Expected outcomes:**

- The **"Completed"** status label renders in **green** (positive colour token).
- The **"Queued"** status label renders in **muted ink** (neutral colour token).
- Status labels are rendered **verbatim** (the API value is shown exactly — no relabelling).

---

## Story 6: Address truncation

**Persona:** Any user observing the Holder column.

**Pre-conditions:** Ready state with known addresses.

**Steps:**

1. Set mock data as in Story 1.
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the Holder column in the Withdrawal Queue table.

**Expected outcomes:**

- Long EVM addresses are shown in `0xXXXX…XXXX` (6+4) form.
- The full address is NOT displayed (truncated to prevent layout overflow).

---

## Story 7: Null `estimated_wait_days` renders em-dash

**Persona:** Any user when the estimated wait is not yet computable.

**Pre-conditions:** Mock data with `estimated_wait_days: null`.

**Steps:**

1. Set mock data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/withdrawal-queue",
     JSON.stringify({
       summary: { in_queue_usd: "500000.000000", requests_count: 2, estimated_wait_days: null, liquid_cover: null },
       items: [
         { account: "0x1111111111111111111111111111111111111111", amount: "500000.000000", status: "Queued" },
       ],
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Estimated wait" summary card.

**Expected outcomes:**

- The **"Estimated wait"** card shows **"—"** (em-dash).
- The **"Liquid Cover"** card also shows **"—"** (always null today).
