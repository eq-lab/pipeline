# User Stories: #1568 — Trustee: wallet auth always sends chain_id; clear error for an unsupported network

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1568](https://github.com/eq-lab/pipeline/issues/1568)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#sign-in-flow-791-hardened-793794795),
[docs/frontend/trustee-flows.md#auth-endpoint-wrappers](../../frontend/trustee-flows.md#auth-endpoint-wrappers-apiauthts)

Trustee app (`packages/trustee`) against an API that includes backend #1559 (`chain_id` required on
challenge and verify). Story 2 needs a Trustee build whose `VITE_EVM_CHAIN_ID` is **not** in the
API's `CHAINS` (prod today: Trustee EVM `1` vs API `99000002`), or a local API with `CHAINS`
narrowed.

---

## Story 1: Sign-in sends the configured chain id on both calls

**Persona:** Trustee signing in on a supported chain.

**Pre-conditions:** Staging Trustee app, allow-listed wallet, Network tab open.

**Steps:**

1. Click Sign in, pick the EVM (or Soroban) row, approve the signature.

**Expected outcomes:**

- `GET /v1/auth/challenge?address=…&chain_id=560048` (`99000001` for Soroban), then `POST /v1/auth/verify` whose JSON body carries the same `chain_id`.
- The dashboard renders; no error.

---

## Story 2: A chain the API does not know shows a clear message

**Persona:** Trustee on a deployment whose chain is not configured on the API.

**Pre-conditions:** As above, with the Trustee's chain absent from the API's `CHAINS`.

**Steps:**

1. Click Sign in, pick the unsupported chain's wallet row.

**Expected outcomes:**

- The challenge call returns `400` with `unknown chain_id: <id> (configured: …)`.
- The sign-in card shows "This network isn't supported by the sign-in server. Contact your administrator." — not the raw API text; no signature is requested and no verify call is made.
- Picking the other, supported chain signs in normally.

---

## Story 3: Other failures keep their existing copy

**Persona:** Trustee hitting an unrelated error.

**Pre-conditions:** Story 1 setup; a wallet that is not allow-listed, and (separately) the API stopped.

**Steps:**

1. Sign in with the non-allow-listed wallet.
2. Stop the API and sign in again.

**Expected outcomes:**

- Step 1 shows "This wallet is not authorized to sign in. Contact your administrator."
- Step 2 shows "Could not reach the sign-in service. Please try again."
