# User Stories: #1629 — LP: portfolio chart plots the served sPLUSD value on a timestamp axis

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1629](https://github.com/eq-lab/pipeline/issues/1629) (chart half of item 3 and item 4; the rest shipped in #1658)
Spec: [docs/frontend/dashboard-components.md#portfolioplaceholdercard](../../frontend/dashboard-components.md#portfolioplaceholdercard)

LP dashboard (`packages/frontend`) against staging. Needs a wallet that holds sPLUSD on the current
vault, so `GET /v1/positions/history` returns buckets with `splusd_value`.

---

## Story 1: Bars, tooltip and Y axis show the sPLUSD value in USD

**Persona:** LP with sPLUSD in a connected wallet.

**Steps:**

1. Open `/` with the Network tab open and hover several bars on the Total Balance chart.

**Expected outcomes:**

- `/v1/positions/history` items carry `splusd_value`, and the response carries a `splusd_value` stat.
- The tooltip shows that bucket's `splusd_value` formatted as USD, not the share count.
- The Y axis top label matches the served `splusd_value.max` (rounded up to an even display value).
- The last bar's tooltip is close to the headline; a small difference is expected (live read vs closing price sample).

---

## Story 2: A bucket without a served value shows a dash

**Persona:** LP whose history has a bucket without `splusd_value`.

**Steps:**

1. Hover the bucket in the Network-tab response that lacks `splusd_value`.

**Expected outcomes:**

- No bar is drawn for that bucket and the tooltip value reads `—`, never `$0.00`.
- If the response has no `splusd_value` stat, the card shows no Y axis.

---

## Story 3: The chart is laid out by time

**Persona:** LP with a history that has gaps between buckets.

**Steps:**

1. Hover inside a time gap between two bars.

**Expected outcomes:**

- The tooltip shows the latest bucket at or before the cursor.
- The date labels under the chart are spread by time, not by bucket index.
- A dense, evenly spaced history looks the same as before.
