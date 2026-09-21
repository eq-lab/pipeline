# User Stories: #1281 — KYB: create-account validation-error state

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1281](https://github.com/eq-lab/pipeline/issues/1281)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call. `CreateAccountModal` is reachable only from
`/test?tab=auth`; it is not wired to any production entry point. These stories exercise the
**blur** path only — the submit-attempt path is not reachable in a real browser because the
`Sign Up` button is disabled whenever the form is invalid, so implicit form submission is a no-op
(logged as **BUG-20**, `docs/exec-plans/known-bugs.md`; not fixed here). Styling-only assertions
(exact colors, radii) are out of scope — visual fidelity is verified separately by the QA agent's
Figma comparison against node `6585:75897`.

---

## Story 1: A weak password plus blur shows the policy error and keeps submit disabled

**Persona:** LP typing a password that does not meet the new policy.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`, Create
Account modal open, a well-formed email entered.

**Steps:**

1. Type a 4-character password (e.g. `abcd`) into the password field.
2. Move focus away from the password field (blur).

**Expected outcomes:**

- The password field renders in its error visual (negative-secondary fill, negative-strong value
  text).
- The error caption reads exactly: "At least 8 characters, including a number and a special
  character", right-aligned below the field.
- The "Sign Up" submit button remains disabled.
- The email field is **not** in error — it keeps its default (valid) appearance.

---

## Story 2: No error while the password field is empty and untouched

**Persona:** LP who has not yet interacted with the password field.

**Pre-conditions:** Create Account modal freshly opened.

**Steps:**

1. Observe the password field without typing or focusing it.

**Expected outcomes:**

- No password error is shown.

---

## Story 3: Blurring an empty password field shows no error

**Persona:** LP who tabs through the password field without typing anything.

**Pre-conditions:** Create Account modal open, password field empty.

**Steps:**

1. Focus the password field, then move focus away (blur) without typing.

**Expected outcomes:**

- No password error is shown — an empty, untouched-by-typing field is not treated as "weak".

---

## Story 4: The error clears live once the value satisfies the policy

**Persona:** LP who corrects a weak password after seeing the error.

**Pre-conditions:** Password field has been blurred once with a weak value and shows the policy
error (Story 1).

**Steps:**

1. Continue typing into the password field until it reads `P@ssw0rd!` (9 characters, a digit, and
   a special character), without blurring again.

**Expected outcomes:**

- The error caption disappears as soon as the typed value satisfies the policy — no further blur
  is required.
- The "Sign Up" submit button becomes enabled once the email is also well-formed.

---

## Story 5: Policy boundary cases

**Persona:** Developer verifying the exact policy predicate against the Figma copy.

**Pre-conditions:** Create Account modal open, a well-formed email entered.

**Steps:**

For each password below, type it into the password field and blur:

1. `P@ssw0r` (7 characters, has a digit and a special character).
2. `Password!` (9 characters, has a special character, no digit).
3. `Password1` (9 characters, has a digit, no special character).
4. `12345678!` (9 characters, has a digit and a special character, no letter at all).
5. `P@ssw0rd!` (9 characters, has a digit and a special character).

**Expected outcomes:**

- Cases 1–3 are invalid: the policy error is shown and "Sign Up" stays disabled.
- Case 4 is **valid**: no error is shown and "Sign Up" is enabled. The policy copy does not
  require a letter, so an all-digits-plus-symbol password of sufficient length passes.
- Case 5 is valid: no error is shown and "Sign Up" is enabled.

---

## Story 6: The eye toggle still works while the password field is in error

**Persona:** LP checking what they typed after seeing the error.

**Pre-conditions:** Password field is in its error state (Story 1).

**Steps:**

1. Click the eye icon inside the password field.

**Expected outcomes:**

- The password's masked value becomes visible as plain text; the icon flips to its "hide"
  affordance (accessible name "Hide password"). The error caption and the field's error visual
  are unaffected by the toggle.

---

## Story 7: The error does not shift the layout of the fields below it

**Persona:** Developer confirming the caption is absolutely positioned per the Figma frame.

**Pre-conditions:** Create Account modal open.

**Steps:**

1. Note the vertical position of the "Sign Up" button with the password field empty (no error).
2. Trigger the password error (Story 1).

**Expected outcomes:**

- The "Sign Up" button's position is unchanged — the error caption is absolutely positioned below
  the field and adds no layout height, preserving the 32px field-to-field rhythm.

---

## Story 8: Reopening the modal clears the error

**Persona:** LP who closes the modal mid-entry with a weak password shown in error, then reopens
it.

**Pre-conditions:** Create Account modal open, password field in its error state (Story 1).

**Steps:**

1. Dismiss the modal (Escape or × button).
2. Reopen it via "Open Create Account modal".
3. Focus and blur the (now empty) password field.

**Expected outcomes:**

- On reopen, the password field is empty and shows no error.
- Blurring the empty field after reopening still shows no error (the "touched" state was also
  reset, not just the value).
