# User Stories: #1745 — Trustee/LP (staging): basic-auth credentials in the page URL boot the app twice

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521)
Issue: [#1745](https://github.com/eq-lab/pipeline/issues/1745)
Spec: [docs/frontend/trustee-flows.md#app-bootstrap--providers](../../frontend/trustee-flows.md#app-bootstrap--providers)

Trustee app (`packages/trustee`) and LP app (`packages/frontend`) opened behind basic auth (staging), with DevTools open (Console and Network) before the first load.

---

## Story 1: Trustee opened via a credentialed URL

**Persona:** Trustee opening `https://user:pass@<trustee-host>/`.

**Steps:**

1. Open the credentialed URL and let the page settle.
2. Check the address bar, then run `performance.getEntriesByType('resource')` in the console.

**Expected outcomes:**

- The address bar loses the `user:pass@` part, with no second credentials prompt.
- `index-*.js` is requested once.
- `#root` has a single `__reactContainer$` key and no `duplicate boot` console error.

---

## Story 2: Sign in, then tab clicks

**Persona:** Signed-out trustee on the credentialed URL.

**Steps:**

1. Sign in with an allow-listed wallet.
2. Click through the dashboard tabs.

**Expected outcomes:**

- After sign-in the URL is `/` and the dashboard renders.
- The URL follows each tab click and never sticks on `/sign-in`.
- Console lines are not duplicated.

---

## Story 3: LP app opened via a credentialed URL

**Persona:** Liquidity provider opening `https://user:pass@<lp-host>/`.

**Steps:**

1. Open the credentialed URL and check the address bar and resource entries.

**Expected outcomes:**

- The userinfo is removed from the address bar and the app loads once (`index-*.js` requested once).

---

## Story 4: Plain URL

**Persona:** Any user opening a URL without credentials.

**Steps:**

1. Open the app at a plain `https://<host>/` URL.

**Expected outcomes:**

- No extra navigation happens and the app boots once.
