# User Stories: #1408 — Remove redundant Account review message

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1408](https://github.com/eq-lab/pipeline/issues/1408)
Spec: [LP entity verification](../../product-specs/kyb-lp-verification.md)

## Story 1: Frozen account status uses the document banner

Open Account with an UnderReview LP and then a Passed LP. The generic paragraph “Your account
is under review or approved. Profile and document changes are unavailable.” is absent. The
existing document status banner remains, and profile/document edit restrictions still apply.

## Story 2: Declined verification keeps its specific message

Open Account with a Failed LP. The distinct verification-declined paragraph remains visible,
and the record stays frozen. Loading and request-error feedback remain available.
