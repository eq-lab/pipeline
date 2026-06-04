# User Story #481 — Welcome heading → content gap (mobile)

**Issue:** [#481](https://github.com/eq-lab/pipeline/issues/481)
**Epic:** #463 Home page
**Figma ref:** frame `1989:8292`, heading node `1989:8293`

---

## Story

As a mobile user viewing the home page at 402px viewport width,
I want the spacing between the Welcome heading and the first card below it
to match the Figma spec (16px),
so the layout feels tight and purposeful rather than over-spaced.

---

## Acceptance criteria

1. At 402px viewport width the vertical gap between the bottom of the `WelcomeHeader`
   component and the top of the first card (Connect Wallet promo or portfolio card)
   is **16px** (Tailwind `gap-4`).

2. At 768px viewport width and above (md breakpoint) the gap remains **48px**
   (Tailwind `gap-12`) — desktop spacing is unchanged.

3. No other layout dimensions are affected.

---

## Test steps (QA agent)

1. Open the app at http://localhost:5173/ with viewport set to 402×900px.
2. Inspect the vertical distance between the bottom edge of the `WelcomeHeader`
   block and the top edge of the `ConnectWalletPromoCard`.
3. Confirm the gap is 16px.
4. Resize the viewport to 1280×900px.
5. Confirm the gap between `WelcomeHeader` and the outer white card is 48px.
