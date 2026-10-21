# User Stories: #1346 — Auth modals: validation reveals on blur only (BUG-20)

Epic: [#1247 — KYB / V1.0 onboarding](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1346](https://github.com/eq-lab/pipeline/issues/1346)
Spec: [docs/frontend/auth-components.md#signinmodal](../../frontend/auth-components.md#signinmodal)

No visual change. These stories pin the contract after the dead submit-attempt path was removed:
an invalid form cannot be submitted (the only submit button is disabled), and field errors appear
on blur only. Applies to Sign In, Create Account, Add email, Forgot password and Reset password.

---

## Story 1: Enter on an invalid form does nothing

**Persona:** LP on the Sign In modal.

**Steps:**

1. Type `dsfdffs` in the email field and press Enter; also click the greyed "Sign In" button.

**Expected outcomes:**

- No request in the Network tab, no error text, the button stays at 32% opacity and disabled.

---

## Story 2: Errors reveal on blur

**Persona:** LP on the Create Account modal.

**Steps:**

1. Type `dsfdffs` in the email field and tab to the password field.
2. Type `short` in the password field and tab out of it.

**Expected outcomes:**

- After step 1: "Enter the correct email address" under the email field.
- After step 2: "At least 8 characters, including a number and a special character" under the password field; "Sign Up" still disabled.
- Fixing both fields clears the errors and enables the button; Enter then submits.

---

## Story 3: An empty password never shows an error

**Persona:** LP on either modal.

**Steps:**

1. Click into the password field and tab out without typing.

**Expected outcomes:**

- No error text appears (the disabled button is the only gate); the old "Enter the correct password" copy never renders anywhere.
