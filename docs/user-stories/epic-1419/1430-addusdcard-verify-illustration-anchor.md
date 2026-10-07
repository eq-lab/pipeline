# User Stories: #1430 — AddUsdCard verify/verifying illustration anchor and frame height

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1430](https://github.com/eq-lab/pipeline/issues/1430)
Spec: [docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md#addusdcard)
Figma: `verify` https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97695&m=dev ·
`verifying` https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98539&m=dev

These stories cover the card's composition — which part of the artwork is visible and what clips
it — not its typography or colors. The anchor table lives in the spec.

---

## Story 1: The verify card shows only the clipped left edge of the artwork

**Persona:** A signed-in, unverified LP with no wallet connected, on the desktop home screen.

**Pre-conditions:**

- Home state 2 renders (see
  [1422-home-unverified-state.md](./1422-home-unverified-state.md)).
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`).
2. Observe the `AddUsdCard` (`data-variant="verify"`) in the bottom-right stack.

**Expected outcomes:**

- The striped-check artwork sits in the card's **right** half, behind the text column, and is cut
  off by the card's right and bottom edges. It does not span the full card width and does not sit
  in a band under the text.
- "Verify your account" / "Complete KYB to unlock bank transfers." are fully legible — no artwork
  passes in front of them.
- "Start Verification" sits at the bottom-left, over the artwork's lower-left corner, and is not
  obscured by it.

---

## Story 2: The verify card keeps its designed height inside the home stack

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Load `/` and measure the `AddUsdCard` (`data-testid="home-add-usd-card"`).
2. Measure the stack that holds it (`data-testid="home-add-usd-stack"`,
   `data-node-id="6701:97694"`).

**Expected outcomes:**

- Step 1: the card is 246px tall at every viewport width where the desktop grid renders. It is not
  stretched to fill the grid row, so the artwork never drops below the button.
- Step 2: the stack is the card (246) + `gap-4` (16) + `EarnedCard` (82) — it does not force the
  card to grow.

---

## Story 3: The verifying card uses its own anchor

**Persona:** A reviewer checking every `AddUsdCard` variant.

**Pre-conditions:** `/test?tab=auth` is open; each variant previews at 313px width.

**Steps:**

1. Compare the `verify` and `verifying` cards.

**Expected outcomes:**

- Both are 246px tall and clip the artwork at the card edge.
- `verifying` shows slightly less artwork than `verify` and sits slightly higher — the two frames
  carry different offsets (see the anchor table in
  [bank-transfers.md](../../frontend/bank-transfers.md#addusdcard)); they are not a single shared
  offset.

---

## Story 4: The horizontal variants are unchanged

**Persona:** Same as Story 3.

**Pre-conditions:** Same as Story 3.

**Steps:**

1. Observe the `locked`, `unlocked` and `funded` cards.

**Expected outcomes:**

- None of them renders the illustration, none is pinned to 246px, and each still grows to fill the
  stack it is mounted in.
