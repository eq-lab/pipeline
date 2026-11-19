# User story: #2082 — Trustee + wallet-connect: EVM setTerms for the deployed f92d719 SecurityRegistry (12-field Terms)

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/2082
**Status:** Initial

---

## Overview

Hoodi runs the SecurityRegistry `pipeline-contracts@f92d719`: a 12-field `Terms` (the Stellar field set) and `setTerms` selector `0x36b14cd2`. The EVM encoder from #1942 targets `150631a` (15 fields, `0x45f225f5`), which the Hoodi registry does not dispatch (`FailedCall`). The Trustee now detects the build from the registry's implementation bytecode and mirrors the Stellar `set_terms` approach on `f92d719`: the Stellar 10 inputs, the first ratio rule only, no `defaultRatioBps` / `originatorFeeRate`, `marginCallAt = 0`. Contracts and deployments are not changed. Spec: `docs/frontend/trustee-flows.md#risk-council-security-actions` (section "Deployed build (#2082)") and `#risk-council-pending-operations`.

Persona: Risk Council member on the Trustee console, signed in on the EVM chain, with an EVM wallet. QA wallet: the SecurityRegistry flows on Hoodi use `0xfe1748f511583f6c9349f672593e6312bedfce40`, the only account holding the role of `setTerms`, `resolveFlag` and `releaseWithConsent` (the named role holder `0x96ef761f…04e4` holds no SecurityRegistry role and sees "Setting security terms belongs to the Risk Council."). The stories run in the epic QA pass #1945. Stage chain `99000001` (Stellar) is the regression reference.

On-chain evidence for this issue is the Hoodi `eth_call` simulation of `AccessManager.execute(SR, 0x36b14cd2…)` from the role wallet: it passes the selector dispatch, the role check and the registry's `restricted` modifier and reverts only on `LoanRegistryNonExistentLoanId`, because Hoodi has no loans yet.

---

## Story 1 — On Hoodi the Set terms form is the 10-input form and calls 0x36b14cd2

**Given** an EVM loan on Hoodi and the connected wallet `0xfe1748f5…`

**When** the member opens `/risk-council/security/<id>?chain=<hoodi>`

**Then:**

- The Set terms form shows 10 numeric inputs and the payment-term select, with no "Default ratio (%)" and no "Originator fee rate (%)"
- Only "The margin call ratio must be at least the advance ratio." can block the form
- Set terms signs `AccessManager.execute(SecurityRegistry, 0x36b14cd2…)` with the 12-field `Terms` and `marginCallAt = 0`
- While the build is being read the form shows the 10 inputs and Set terms is disabled; an unrecognised build shows "Failed to read this wallet's permissions." with the reason in the details

---

## Story 2 — After execution the current terms show no extra rows

**Given** Set terms was executed on a drawn Hoodi loan

**When** the next fold completes and the member reloads the page

**Then:**

- "Current security terms" lists the Stellar rows and no "Default ratio" or "Originator fee rate"
- A scheduled `setTerms` row, when a role delay exists, renders the same Stellar rows and Execute sends the served calldata unchanged

This needs a drawn Hoodi loan (none exists yet) and the served terms of #2073.

---

## Story 3 — A 150631a deployment and Stellar are unchanged

**Given** a deployment whose SecurityRegistry implementation has `0x45f225f5` (or a mocked `terms15`), and separately the Stellar stage chain `99000001`

**When** the member opens the Security page

**Then:**

- The `150631a` form keeps its 12 inputs and the second ratio rule, and Set terms calls `0x45f225f5`
- The Stellar form keeps its 10 inputs and its encoding
