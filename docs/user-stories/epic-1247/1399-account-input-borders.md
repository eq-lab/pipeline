# User Stories: #1399 — Account input borders

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1399](https://github.com/eq-lab/pipeline/issues/1399)
Spec: [KYB: LP entity verification](../../product-specs/kyb-lp-verification.md)

## Story 1: Account setup fields are visibly bounded

Open Finish account setup through onboarding or `/test?tab=auth`. Name and Country each display
one visible border around the input control while empty or filled. Focus each field by mouse and
keyboard: the existing focus border remains visible. During submission or with a nonwritable LP,
the fields keep their existing disabled behavior.

## Story 2: The Account profile card matches setup

Visit `/account` while authenticated. Name and Country have the same visible borders as setup.
Edit and save the profile; the borders remain on the controls, with no second border around the
field wrapper. Focus and disabled behavior remain consistent with setup.

## Story 3: Other text fields retain their styling

Open Sign in and Create account. Their shared TextField styling remains unchanged. The border
change applies only to Name and Country in setup and the Account profile card.
