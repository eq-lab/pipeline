# User Stories: #2054 — Add email screen: "Already have an account? Sign in" link

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#2054](https://github.com/eq-lab/pipeline/issues/2054)
Spec: [auth-components.md#addemailmodal](../../frontend/auth-components.md#addemailmodal)

No Figma frame (decision 2026-11-19); the link reuses the auth screens' existing text-link styling.

---

## Story 1: A wallet-only visitor with an existing email account signs in from Add email

**Persona:** An LP with a connected wallet and no session who already registered an email account.

**Pre-conditions:**
- Wallet connected, no session; `/account` shows the wallet-only variant.

**Steps:**
1. Click `Add email` on `/account`.
2. Below `Save`, read the line "Already have an account? Sign in" and click `Sign in`.
3. Enter the existing email and password and click `Sign In`.

**Expected:**
- The Add email screen shows the muted "Already have an account?" with an ink `Sign in` link below `Save`, same treatment as the Create account footer.
- Clicking it opens the Sign in screen.
- A successful sign-in saves the session and the visitor is back on `/account`, now authenticated.
- No wallet data is sent in the login request.

---

## Story 2: Forgot password and back/close from the sign-in screen

**Persona:** The same visitor, who forgot the password.

**Steps:**
1. From Add email, click `Sign in`.
2. Click `Forgot password?`, then go back to Sign in.
3. Close the Sign in screen.

**Expected:**
- `Forgot password?` opens the reset flow exactly as from the header's Sign in.
- Closing the flow returns to `/account` with the wallet-only variant unchanged.

---

## Story 3: Creating an account from Add email is unchanged

**Persona:** A wallet-only visitor with no email account.

**Steps:**
1. Click `Add email`, enter a valid email and password, click `Save`, complete OTP.
2. Repeat, but press Back on the OTP screen.

**Expected:**
- OTP verification saves the session and returns to `/account`.
- The OTP back arrow returns to the Add email screen, not Sign in.
