# User Stories: #1715 — LP: Country as a searchable select with flags

Epic: [#1376 — KYB review lifecycle](https://github.com/eq-lab/pipeline/issues/1376)
Issue: [#1715](https://github.com/eq-lab/pipeline/issues/1715)
Spec: [KYB: LP entity verification](../../product-specs/kyb-lp-verification.md)

Behaviour detail: [Country select](../../frontend/account-page.md#country-select-1715) and
[Combobox](../../frontend/ui-components.md#combobox).

## Story 1: Country is picked from a list with flags

Open Finish account setup. Click Country: a list of countries opens, each row with its flag and
English name. Pick one: the closed field shows the selected flag and name.

## Story 2: The list is searchable

Type "per": the list narrows to Peru. Replace it with "nl": Netherlands appears (code match).
Type nonsense such as "zzz": a single "No countries found" row is shown and cannot be selected.

## Story 3: Only the name is stored

Pick Peru with ArrowDown and Enter, then Submit for review. The stored country is "Peru" and the
trustee's Jurisdiction column shows "Peru". In DevTools Network, the `POST /v1/lps/me` body has
`country: "Peru"` with no code and no flag URL.

## Story 4: Free text is never committed

Type "Atlantis" and Tab away: the field returns to the previous country and nothing is saved.
Pressing Escape while the list is open also restores the previous country.

## Story 5: Clearing stores nothing

Click "Clear country" and save. The stored country is `null` and the trustee shows "—".

## Story 6: A saved value that is not in the list is kept

For an LP stored with country "NL": the field shows "NL" without a flag and the list offers "NL (as
saved)". A Name-only save leaves the country as "NL". Picking France and then "NL (as saved)" again
and saving also keeps "NL".

## Story 7: Loading and failure never block the LP

While the list loads, the field is disabled and reads "Loading countries…". With `flagcdn.com`
blocked in DevTools (request blocking), the field becomes a plain text input that keeps the stored
value, shows "Couldn't load the country list. Type your country instead.", and saving still works.

## Story 8: The Account page behaves the same

Visit `/account` while authenticated. The Country field behaves as in Stories 1-6, keeps its draft
through a document upload, and is disabled while the LP is UnderReview or Passed.

## Story 9: Keyboard and screen reader

Tab into Country, type, move with the arrow keys, press Enter to pick, Escape to dismiss, and Tab
out. A screen reader announces a combobox named Country, its expanded state, and the active option.

## Story 10: Borders and other fields are unchanged

The unfocused Country field shows the #1399 one-pixel border and the focus border when focused. On
a phone-width viewport the open list is fully reachable inside the account-setup modal. Sign in and
Create account fields are unchanged.
