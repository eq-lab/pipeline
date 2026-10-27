# Issue #1715: LP: Country as a select dropdown instead of a free-text input (account setup modal + Account page)

Source: https://github.com/eq-lab/pipeline/issues/1715

Branch: `feat/1715-country-select` (draft PR #1716). Labels: `frontend`, `enhancement`. No parent
epic; user stories are filed under epic #1376 (KYB review lifecycle).

**User scope changes (2026-10-27), which override the issue body where they conflict:**

1. There is no Figma for this field.
2. Country options come from an external public countries API fetched at runtime, not a bundled
   ISO list. Each option shows the country's flag and name, and only the plain-text name is sent
   to the backend.
3. The list is **searchable**. The LP types to filter it (case-insensitive substring on the name;
   matching the alpha-2 code is a nice-to-have, and is included). This settles the component
   choice: a searchable combobox (text input + filtered listbox), not a native `<select>`.

## Scope

In scope (LP app and `@pipeline/ui` only; no backend change):

- **Countries source.** A runtime fetch of a public countries endpoint, wrapped in a React Query
  hook. The source is chosen in "Countries API" below; the shape is normalised to
  `{ code, name, flagUrl }[]` and sorted by name.
- **`Combobox` in `@pipeline/ui`.** A new primitive: a searchable single-select combobox using the
  WAI-ARIA APG "Editable Combobox With List Autocomplete" pattern.
  - The field is a text `<input role="combobox">` styled with `TextField` tokens and the #1399
    border rule.
  - The popup is a filtered `role="listbox"` of options, each showing a flag `<img>` and the name.
  - It is hand-rolled: none of `@headlessui/react`, `downshift`, `cmdk`, `react-aria`,
    `@radix-ui/*` or `@floating-ui/*` is a dependency of the root, `packages/frontend` or
    `packages/ui`, so **no new dependency** is added.
- **`CountryField` in the LP app.** A shared wrapper that owns the loading, failure, fallback and
  off-list logic, used on both surfaces:
  - account-setup modal: `packages/frontend/src/components/CompanyDocsModal.tsx:374-383`
    (`#company-country`);
  - Account profile card: the input is in
    `packages/frontend/src/components/account/AccountProfileCard.tsx:38-47` (`#account-country`).
    `AccountPage.tsx:173` only passes `country` / `onCountryChange` through, and the state lives
    in `useAccountPage.ts`.
- **Stored values that are not in the list.** They display as-is and are not rewritten on save.
- Tests, with the countries endpoint mocked, and docs.

Unchanged:

- `country.trim() || null` and the rule that an unchanged country is kept on save.
- Name/Country draft preservation, and the reset on a new LP identity.
- The disabled gating (`writable` / `busy` / `uncertainSubmission` / `!email`).
- The `POST /v1/lps/me` full-replace contract, and the API accepting any nullable string
  (`packages/api/src/routes/lps.rs:111,339`).
- The trustee's verbatim Jurisdiction column (`trustee-flows.md:892`).

Out of scope:

- Backend validation of `country`.
- Migrating existing `lps.country` rows.
- Sending a code or a flag URL to the backend.
- Free-text commits (typing filters only; it never becomes the value while the list is loaded).
- Any trustee code change.
- A backend proxy or cache for the countries API.
- Fuzzy or diacritic-insensitive search. "aland" does not match "Åland Islands"; the code `AX`
  does.

## Countries API (research, 2026-10-27)

- **REST Countries v3.1 no longer works.** `GET https://restcountries.com/v3.1/all?fields=name,flags,cca2`
  now returns 301 to `files-03.restcountries.com/countries.00/legacy.json`, whose body is
  `{"success":false,"errors":[{"message":"This API version has been deprecated … migrate to our new version (v5)."}]}`.
  Requests with or without `fields=` behave the same. The `name.common` / `flags.svg` / `cca2`
  shape is gone with it.
- **REST Countries v5** (`https://api.restcountries.com/countries/v5`; fields `names.common`,
  `codes.alpha_2`, `flag.url_svg`; envelope `data.objects`):
  - Every request needs `Authorization: Bearer <key>` (or `?api-key=`) from a signed-up account.
  - Browser calls are blocked unless the page's hostname is on that key's allowed-origins list.
  - The free tier caps `limit` at 100, so 249 countries takes three paginated requests.
  - The edge rate limit is 20 requests per 10 s. A monthly quota can freeze the account (403).
  - For us this means a vendor account and key, a `VITE_` env var shipped in the bundle, and
    allowlisting every deploy hostname: staging, production and preview URLs.
- **flagcdn.com (Flagpedia)**, the recommended source:
  - `GET https://flagcdn.com/en/codes.json` needs no key and is served with
    `access-control-allow-origin: *` and `cache-control: public, max-age=2678400`.
  - It returns a flat `{ "<code>": "<English common name>" }` map with 306 keys, which include US
    states (`us-ak`), UK nations (`gb-eng`) and `eu` / `un`.
  - Keeping only two-letter keys and dropping `eu` and `un` leaves 250 countries and territories:
    the 249 ISO 3166-1 entries plus `xk` Kosovo.
  - Names are common English names: "United Kingdom", "South Korea", "Taiwan", "United States".
  - Flags are `https://flagcdn.com/{code}.svg`, or sized PNGs such as `https://flagcdn.com/w40/{code}.png`.
  - Flagpedia describes it as a free CDN service (Cloudflare), with flags based on Wikimedia
    Commons vector files. It asks for a backlink and publishes no rate limit.
- **Recommendation: flagcdn.** It meets the brief (external public API, runtime fetch, flag plus
  common English name) with no account, no secret and no hostname allowlist to maintain. If
  product prefers REST Countries v5, only the adapter in step 1 changes (fetcher URL, auth
  header, pagination, field paths); see Open Questions.

## Assumptions and Risks

**Assumptions:**

- **No Figma (decision).** There are no Figma files for this field, so `Combobox` takes its styling
  from the existing `TextField` token map (`docs/frontend/ui-components.md#textfield`) plus the
  #1399 unfocused `--color-pipeline-line` border. The open list reuses surface, ink and radius
  tokens already in the theme. QA compares it against `TextField`.
- **Searchable combobox, not a native `<select>` (decision, per the user).**
  - `<option>` cannot render an `<img>` or filter as the user types, so this is a hand-rolled
    combobox.
  - The closed field shows the selected option's flag `<img>` (`https://flagcdn.com/{code}.svg`,
    20×15, `alt=""`) as a leading adornment inside the input row, followed by the name as the
    input's text.
  - Typing replaces the text with the query and filters the list.
- **Filter rule.** Case-insensitive substring on the label
  (`label.toLocaleLowerCase("en").includes(query.trim().toLocaleLowerCase("en"))`), OR a
  case-insensitive exact match on the alpha-2 code (`"pe"` → Peru).
  - The order is the source order (sorted by name). There is no ranking beyond that.
  - An empty query shows the full list.
  - No matches shows one non-selectable `role="option" aria-disabled="true"` row reading "No
    countries found".
- **Blur never commits free text.** Blur, Escape or an outside click without a selection
  restores the input text to the selected option's label (or empty), and `onChange` is not
  called. Only choosing an option (click, or Enter on the active option) commits.
- **Clearing → `null`.** A clear button ("×", `aria-label="Clear country"`) shows inside the field
  when a value is set and the field is enabled. It calls `onChange("")`, so
  `country.trim() || null` sends `null`. There is no blank option in the list and no "Prefer not
  to say".
- **List surface reuses the existing menu treatment** from `NetworkSwitcher.tsx:118-121`:
  - `rounded-[var(--radius-pipeline-card)] border border-[color:var(--color-pipeline-line)]
    shadow-[0px_8px_28px_0px_rgba(0,0,40,0.14)] py-1.5`, with
    `bg-[var(--color-pipeline-surface)]` in place of the literal `bg-white` (same `#ffffff`
    value).
  - Rows use `px-4 py-2.5` and `--color-pipeline-ink`. The active row uses the same
    `bg-[color:var(--color-pipeline-line)]/30` as the switcher's hover.
  - There is no popover primitive in `@pipeline/ui` to reuse, and no new tokens are added.
- **Only the name is sent.** `country` in `POST /v1/lps/me` is the plain-text name (`name.common`
  equivalent: the flagcdn value) through the existing `country.trim() || null`. The code and flag
  URL are never sent.
- **Loading.** Until the query settles, the field is a disabled `Combobox` showing "Loading
  countries…" as its placeholder. A stored value is not shown while loading; it appears once loaded.
- **Failure means a free-text fallback.** After React Query's retries are exhausted, the field
  renders the existing `TextField`, with the same id, label, #1399 class and disabled gating,
  holding the current draft. The stored value therefore survives and the LP is never blocked.
  - A muted caption (`--text-pipeline-caption`, `--color-pipeline-ink-muted`) reads "Couldn't load
    the country list. Type your country instead."
  - There is no retry button. The query is re-attempted on the next mount (modal reopen or page
    visit) because a failed query is not cached as success.
- **Off-list stored values.** Matching is exact (case- and whitespace-sensitive), with no
  normalisation (memory: display backend values verbatim). Older free-text rows such as `"NL"`,
  `"peru"` or the ISO long form "United Kingdom of Great Britain and Northern Ireland" do not
  match.
  - They are appended as `{ value: raw, label: "<raw> (as saved)", selectedLabel: raw }` (no `iconUrl`), and
    are searchable like any other option.
  - When the off-list value is selected, the closed field shows the raw value without the
    "(as saved)" suffix and without a flag.
  - Options are built from the saved baseline and the draft together, so the LP can switch back
    before saving.
  - The existing trim-on-save still applies. A stored value with surrounding whitespace is trimmed
    on its next save, as it is today.
- **React Query hook** `useCountries()`: `queryKey: ["countries", "flagcdn", "en"]`,
  `staleTime: Infinity`, `gcTime: Infinity`, `retry: 2`, `refetchOnWindowFocus: false`. The fetch
  happens once per page load and is shared by both surfaces.
  - Both call sites already render inside the shared `QueryClientProvider` mounted by
    `EvmWalletProvider` (`packages/frontend/src/main.tsx:31-44`; `CompanyDocsModal` is rendered by
    `AuthFlowProvider` at `:34`), so no new provider is needed.
- **No CSP.** No `Content-Security-Policy` exists anywhere in the repo (checked `packages/frontend`
  and deploy configs), so `connect-src` / `img-src` need no change.
- **Tailwind.** The new `Combobox` lives in `packages/ui/src`. `packages/frontend/src/index.css:6`
  already has `@source "../../ui/src/**/*.{ts,tsx}"`, so no `@source` change is needed.

**Risks:**

- **Third-party availability.** If flagcdn is down, blocked or changes its shape, the field falls
  back to free text. Data quality degrades for that session, but onboarding is not blocked. The
  parser rejects a malformed payload (non-object, or zero valid entries) by throwing, which routes
  to the fallback.
- **Privacy.** Each LP's browser contacts flagcdn.com (Cloudflare), which sees IP, User-Agent and
  Referer for the JSON and for each flag image. Mitigation: `referrerPolicy="no-referrer"` on the
  flag `<img>` and `fetch(..., { referrerPolicy: "no-referrer", credentials: "omit" })`. This is
  noted in `docs/SECURITY.md`.
- **Names can change upstream.** If flagcdn renames an entry, rows stored under the old name show
  as "(as saved)" and are kept, so nothing is lost or rewritten silently. The trustee's verbatim
  column may then show mixed spellings across LPs.
- **Accessibility burden.** A hand-rolled combobox must implement the APG contract itself. Step 3
  spells it out, and the tests cover it.
- **Overflow.** The list can overflow the account-setup modal's scroll container, because the
  popup is absolutely positioned inside the field. `max-h-72` plus the modal's own scrolling
  should keep it reachable. The coder verifies this at phone width. If the modal clips it, the
  fix is to render the list above the field when there is no room below, not a new portal
  dependency.
- **Existing tests.** `CompanyDocsModal.test.tsx`, `-account.test.tsx` and
  `AuthFlowProvider.setup.test.tsx` render without a `QueryClientProvider`. They need a test
  wrapper, and a stub for global `fetch` for `https://flagcdn.com/en/codes.json`, using the
  `vi.stubGlobal("fetch", …)` precedent in `components/dashboard/use*Panel.test.tsx`. Country
  assertions move from `textbox` to `combobox`.

## Open Questions

- **Countries API vendor.** The suggested REST Countries v3.1 endpoint is gone (it redirects to a
  deprecation error). Its replacement, v5, needs a signed-up account, a browser-exposed API key
  restricted to allowlisted hostnames, and three paginated calls per load. The plan uses keyless
  flagcdn.com `codes.json` with flagcdn SVG flags. Confirm flagcdn is acceptable, or say that
  REST Countries v5 is wanted and who will own the account, the key (env var
  `VITE_RESTCOUNTRIES_API_KEY`) and the allowed-origins list for staging, production and preview
  hosts.

## Implementation Steps

1. **Countries source (LP app).** Create `packages/frontend/src/lib/countries.ts`.
   - Header: `// spec: docs/frontend/account-page.md#country-select-1715`.
   - Exports:
     - `COUNTRIES_URL = "https://flagcdn.com/en/codes.json"` and
       `flagUrl(code) => \`https://flagcdn.com/${code}.svg\``.
     - `type Country = { code: string; name: string; flagUrl: string }`.
     - `parseCountries(json: unknown): Country[]`:
       - The input must be a plain object of string → string.
       - Keep keys matching `/^[a-z]{2}$/`, excluding `eu` and `un`.
       - Upper-case `code` and build `flagUrl` from the lower-case key.
       - Sort with `name.localeCompare(other, "en")`.
       - Throw on a non-object or an empty result.
     - `fetchCountries(signal)`: `fetch(COUNTRIES_URL, { signal, credentials: "omit", referrerPolicy: "no-referrer" })`.
       It throws on `!res.ok`, then `parseCountries(await res.json())`.
     - `countryOptions(countries: Country[], ...values: (string | null | undefined)[]): SelectOption[]`:
       - Maps each country to `{ value: name, label: name, iconUrl: flagUrl, keywords: [code] }`.
       - Then, for each distinct non-empty value with no exact `name` match, appends
         `{ value: raw, label: \`${raw} (as saved)\`, selectedLabel: raw }`.
       - The return type is `ComboboxOption[]`.
2. **Query hook.** Create `packages/frontend/src/lib/useCountries.ts`, with the same header.
   - It is `useQuery({ queryKey: ["countries", "flagcdn", "en"], queryFn: ({ signal }) => fetchCountries(signal), staleTime: Infinity, gcTime: Infinity, retry: 2, refetchOnWindowFocus: false })`.
   - Return `{ countries, status }`, where `status` is `"loading" | "ready" | "error"`.
3. **`Combobox` primitive in `@pipeline/ui`.** Hand-rolled; no new dependency. Create these files
   under `packages/ui/src/components/Combobox/`:
   - `Combobox.tsx` (render);
   - `useCombobox.ts` (all state and keyboard logic, per `docs/FRONTEND.md` code-structure
     rule 2);
   - `filterOptions.ts` (pure filter);
   - `index.ts` and `Combobox.stories.tsx`.

   Each file starts with the header `// spec: docs/frontend/ui-components.md#combobox` and has no
   other comments. Export `Combobox`, `ComboboxProps` and `ComboboxOption` from
   `packages/ui/src/index.ts`.
   - **Props:**
     ```ts
     interface ComboboxOption { value: string; label: string; iconUrl?: string; keywords?: string[]; selectedLabel?: string }
     interface ComboboxProps {
       id?: string; value: string; onChange: (next: string) => void;
       options: readonly ComboboxOption[]; placeholder?: string;
       emptyText?: string; clearLabel?: string;
       disabled?: boolean; invalid?: boolean; error?: string; className?: string;
     }
     ```
     - `keywords` carries `[code]` for exact code matching.
     - `selectedLabel` lets an off-list option show its raw value when closed.
     - `emptyText` defaults to "No results". `CountryField` passes "No countries found".
     - `clearLabel` defaults to "Clear". `CountryField` passes "Clear country".
   - **`filterOptions(options, query)`:** a pure export. With `q = query.trim().toLocaleLowerCase("en")`:
     - An empty `q` returns all options.
     - Otherwise it keeps options where `label.toLocaleLowerCase("en").includes(q)` or some
       `keyword.toLocaleLowerCase("en") === q`, preserving input order.
   - **DOM, matching `TextField`'s layout so the #1399 selector works unchanged:**
     - **Outer `div`:** `relative w-full` plus `className`. It holds the root ref for
       outside-click detection.
     - **Field-row `div`:** exactly `TextField.tsx:79-88`. That is `flex h-14 w-full items-center
       gap-1 rounded-[var(--radius-pipeline-card)] px-3 border border-transparent
       focus-within:border-[color:var(--color-pipeline-ink-subtle)]`, with surface fill, or the
       negative-secondary fill when `invalid`. Inside it, in order:
       1. **Flag.** The selected option's flag `<img>` (20×15, `alt=""`, `aria-hidden`,
          `referrerPolicy="no-referrer"`, `rounded-[2px] object-cover shrink-0`), shown only while
          the input text equals the selected option's display label (that is, not while the user
          is searching).
       2. **Input.** `<input id type="text" role="combobox" aria-autocomplete="list"
          aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && active ? optionId : undefined} aria-invalid
          aria-describedby={errorId} autoComplete="off" spellCheck={false}>`.
          - It uses `TextField`'s input classes (`min-w-0 flex-1 bg-transparent outline-none`,
            body typography, ink or negative text, ink-muted placeholder).
          - `<label htmlFor>` names it, so `getByRole("combobox", { name: "Country" })` works.
       3. **Clear button.** When `value !== ""` and not `disabled`: `<button type="button"
          aria-label={clearLabel} tabIndex={-1}>`, a 32×32 hit area like `TextField`'s eye
          button, with a 12×12 "×" stroke SVG in ink-muted.
       4. **Chevron.** The 10×6 chevron SVG copied from `NetworkSwitcher.tsx:89-101`
          (`aria-hidden`, ink-muted, rotated 180° while open). It sits inside a `<button
          type="button" tabIndex={-1} aria-label="Show options">` that toggles the list and
          focuses the input.
     - **Popup.** `<ul role="listbox" id={listId} aria-label={label-of-input}>`, rendered only while
       open.
       - Classes: `absolute top-full left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto
         rounded-[var(--radius-pipeline-card)] border border-[color:var(--color-pipeline-line)]
         bg-[var(--color-pipeline-surface)] py-1.5 shadow-[0px_8px_28px_0px_rgba(0,0,40,0.14)]`
         (the `NetworkSwitcher` menu treatment).
       - **Options.** Each is `<li role="option" id aria-selected={value === option.value}>`
         containing a flag `<img loading="lazy">` (or a 20×15 spacer when there is no `iconUrl`)
         and the label.
         - Classes: `flex items-center gap-2 px-4 py-2.5 cursor-pointer` with body typography and
           ink colour.
         - The active row gets `bg-[color:var(--color-pipeline-line)]/30`, and the selected row
           `font-[var(--font-weight-medium)]`.
         - `onMouseDown={e => e.preventDefault()}` keeps input focus; click selects.
       - **No matches.** A single `<li role="option" aria-disabled="true">{emptyText}</li>` in
         ink-muted, which is never active or selectable.
     - **Error caption.** Identical to `TextField.tsx:127-140`.
   - **State (`useCombobox`):** `open`, `query` (the input text), `activeIndex`, and `committed`
     (the label shown for `value`, i.e. `selectedLabel ?? label` of the matching option, or `""`).
     When `value` or `options` change while closed, the input text resyncs to `committed`.
   - **Behaviour (APG editable combobox, list autocomplete without automatic selection):**
     - **Typing.** Sets `query`, opens the list, filters with `filterOptions`, and resets
       `activeIndex` to the first match, or -1 when there are none. It never calls `onChange`.
     - **Focusing or clicking the input.** Selects the input text, so typing replaces it. The list
       does not open on focus alone; a click on the input or the chevron opens it with the full
       list.
     - **ArrowDown / ArrowUp.** When closed, opens the list with the active option set to the
       selected option, or the first one. When open, moves the active option, clamped and without
       wrapping. Alt+ArrowDown opens without moving.
     - **Home / End.** Work as in a normal text input; they do not move the list.
     - **Enter.** When open with an active option, calls `onChange(option.value)`, closes the
       list, sets the input text to the committed label and calls `preventDefault()`. With no
       active option it only closes and restores the text.
     - **Escape.** When open, closes and restores the text. When closed, the field's `onChange` is
       not touched (APG lets Escape clear the field; we don't, because clearing is the explicit
       clear button).
     - **Tab and blur (focusout leaving the root).** Close and restore the text. Never commit.
     - **Pointerdown outside the root.** Closes and restores the text.
     - **Clicking an option.** Commits that option, closes the list and keeps focus on the input.
     - **Clear button.** Calls `onChange("")`, clears the text, closes the list and focuses the
       input.
     - **Scroll.** The active option scrolls into view with `scrollIntoView({ block: "nearest" })`,
       guarded for jsdom.
     - **Disabled.** `disabled` disables the input and both buttons and keeps the list closed.
   - **Stories:** Default, With flags (a few hard-coded flagcdn URLs), Filtered with no matches,
     Disabled ("Loading countries…"), Invalid.
4. **`CountryField` (LP app).** Create `packages/frontend/src/components/account/CountryField.tsx`
   (header `// spec: docs/frontend/account-page.md#country-select-1715`).
   - Props: `{ id, value, savedValue, onChange, disabled, className }`. It calls `useCountries()`.
   - `countryOptions` (step 1) now sets `keywords: [code]` on every country option. For each
     off-list option it sets `label: "<raw> (as saved)"` and `selectedLabel: raw`.
   - Render by status:
     - `"loading"`: `<Combobox id value="" options={[]} placeholder="Loading countries…"
       disabled />`.
     - `"ready"`: `<Combobox id value={value} onChange={onChange}
       options={countryOptions(countries, savedValue, value)} placeholder="Search country"
       emptyText="No countries found" clearLabel="Clear country" disabled={disabled} />`.
     - `"error"`: `<TextField id value={value} onChange={onChange} placeholder="Country"
       disabled={disabled} />`, followed by the muted fallback caption `<p>`. This is the only
       path where free text can be committed, so the LP is never blocked.
   - Pass the #1399 `className`
     (`[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]`) through to the
     `Combobox` or `TextField` in every branch.
5. **Account-setup modal.** In `packages/frontend/src/components/CompanyDocsModal.tsx`, replace
   the Country `TextField` (lines 376-383) with
   `<CountryField id="company-country" value={country} savedValue={profileBaseline.country} onChange={setCountry} disabled={!writable || busy} className=… />`.
   Keep the `<label htmlFor="company-country">` wrapper. State and payload (lines 78-125, 184-193)
   are unchanged.
6. **Account profile card.**
   - `packages/frontend/src/components/account/AccountProfileCard.tsx`: add the prop
     `savedCountry: string`, and replace the Country `TextField` (lines 40-47) with
     `<CountryField id="account-country" value={country} savedValue={savedCountry} onChange={onCountryChange} disabled={disabled} className=… />`.
   - `packages/frontend/src/components/account/useAccountPage.ts`: add
     `savedCountry: baseline.country` to the returned object. The save and baseline logic is
     unchanged.
   - `packages/frontend/src/components/account/AccountPage.tsx:173`: pass
     `savedCountry={account.savedCountry}`.
7. **Lint and checks.**
   - Run `npx tsx scripts/lint-comments.ts`. Each new file has exactly one spec header; none of
     the touched files is in `scripts/lint-comments.baseline.json` today.
   - Run `yarn lint`, `yarn vitest run` and `yarn build` in `packages/frontend`, and `yarn lint` in
     `packages/ui`.
   - Run `npx tsx scripts/lint-docs.ts`.
   - No new route, so no routeTree regeneration.

## Test Strategy

Mock only the external endpoint (`vi.stubGlobal("fetch", …)` matching `https://flagcdn.com/en/codes.json`)
and the LP API module, as today. No localStorage mocks. Each test file that renders a country
field wraps it in a fresh `QueryClient({ defaultOptions: { queries: { retry: false } } })`
provider. The hook's own `retry: 2` is checked separately, by asserting its options or by a
fake-timer test.

- **`packages/frontend/src/lib/countries.test.ts`** (new):
  - `parseCountries` on a fixture containing `pe`, `nl`, `gb`, `xk`, `gb-eng`, `us-ak`, `eu` and
    `un`: it keeps only `PE`, `NL`, `GB`, `XK`, sorted by name, with correct `flagUrl`s.
  - It throws on `null`, an array, or `{}`.
  - `fetchCountries` throws on a non-OK response, and calls `fetch` with `credentials: "omit"`
    and `referrerPolicy: "no-referrer"`.
  - `countryOptions`:
    - Exact matches add no extra option.
    - `("NL", "France")` appends `{ value: "NL", label: "NL (as saved)" }` with no `iconUrl`.
    - Duplicate values are de-duplicated.
    - `"peru"` and `" Peru"` are off-list.
    - `null` and `""` are ignored.
- **`packages/frontend/src/lib/useCountries.test.tsx`** (new):
  - The status goes loading → ready with sorted countries.
  - After a rejected fetch, the status is error.
  - A second consumer under the same client does not refetch (`fetch` is called once).
- **`packages/frontend/src/components/Combobox.dom.test.tsx`** (new; same pattern as
  `TextField.dom.test.tsx`; uses `userEvent`).
  - **`filterOptions` (unit):**
    - `"per"` and `"PER"` both match Peru.
    - `"land"` matches Finland, Iceland, Ireland, Netherlands, New Zealand and so on (substring).
    - `"pe"` matches Peru by code even though "pe" is also a substring of other names.
    - An empty or whitespace query returns all options.
    - The order is preserved.
  - **Role and name.** The input is `combobox` named by the label, with `aria-expanded` false at
    rest. Clicking the input opens a `listbox`, and options carry their flag `img` (`alt=""`).
  - **Filtering by typing.** Typing "neth" leaves exactly the "Netherlands" option, and
    `onChange` is not called while typing. Typing "zzz" shows "No countries found" with
    `aria-disabled`.
  - **Keyboard selection.**
    - ArrowDown opens the list. ArrowDown and ArrowUp move `aria-activedescendant`.
    - Enter calls `onChange` with the active option's `value` and closes the list.
    - Typing "united" then ArrowDown then Enter selects the second "United …" match.
  - **Escape.** Closes the list and restores the input text to the selected label, without
    `onChange`.
  - **Blur restores and never commits free text.** Type "Atlantis", then Tab: `onChange` is not
    called and the input shows the previous label.
  - **Click.** Clicking an option commits it, and focus stays on the input.
  - **Closed field.** It shows the selected option's flag `img` and its label. An off-list option
    with `selectedLabel` shows the raw value.
  - **Clear.** "Clear" calls `onChange("")`, and the clear button is absent when `value === ""`
    or `disabled`.
  - **Outside pointerdown.** Closes the list.
  - **Disabled.** The input is disabled, and the list never opens.
  - **Error state.** `invalid` sets `aria-invalid`, and `error` adds `role="alert"` plus
    `aria-describedby`.
  - **Layout.** `className` lands on the outer wrapper, and the row has the `focus-within` border
    class.
- **`packages/frontend/src/components/account/CountryField.test.tsx`** (new):
  - Before the fetch resolves, the combobox is disabled and shows "Loading countries…".
  - Once ready, the selected value shows with its flag `img`.
  - Typing "per" filters the list to Peru, and typing "nl" (the code) finds Netherlands.
  - With `savedValue="NL"`, an "NL (as saved)" option appears and stays offered after picking
    "France".
  - On fetch failure, a textbox labelled Country appears holding the current value, along with
    the fallback caption, and typing calls `onChange`.
  - The payload values passed to `onChange` are plain names, never codes or URLs.
- **`packages/frontend/src/components/CompanyDocsModal.test.tsx`** (update):
  - Add the query wrapper and the fetch stub (fixture `{ nl, pe, us, fr, gb, "gb-eng", eu }`).
    Country assertions move from the `textbox` role to `combobox` (the input keeps a combobox
    role).
  - **Only the name reaches the payload.** Type "per", press ArrowDown and Enter (or click
    "Peru"), then Submit. `mockUpsert` receives exactly `country: "Peru"`. Assert the payload
    contains neither `"PE"`, `"pe"` nor any `flagcdn.com` URL.
  - **Payload by code search.** Selecting by typing "us" and clicking "United States" sends
    `country: "United States"`. Update the `saved` fixture to match.
  - **Free text never commits.** Typing "Atlantis" and blurring, then Submit, sends the previous
    value: `"NL"` for the existing fixture.
  - **Off-list value preserved.** The `"NL"` fixture shows "NL" in the field, and the list
    contains "NL (as saved)". A Name-only save sends `"NL"`. Re-picking "NL (as saved)" after
    "France" also sends `"NL"`.
  - **Clear to `null`.** Clicking "Clear country" then saving sends `country: null`.
  - **Fallback.** With a failing fetch, Country is a `textbox` prefilled with `"NL"`, and saving
    sends `"NL"`.
  - **Draft preservation (test at `:439`).** Pick "France" in place of typing `"FR"`, and keep the
    new-identity `"GB"` as an off-list assertion (it is not "United Kingdom").
- **`packages/frontend/src/components/account/AccountProfileCard.test.tsx`** (new):
  - The card renders `CountryField`, and `savedCountry` is threaded through.
  - Selecting calls `onCountryChange` with the name.
  - `disabled` disables the field.
- **`packages/frontend/src/components/account/useAccountPage.test.tsx`** (update):
  - `savedCountry` equals the loaded country and holds through `setCountry("France")` until the
    save resolves, then follows the response.
  - `setCountry("")` followed by a save sends `country: null`.
- **`packages/frontend/src/routes/-account.test.tsx` and
  `packages/frontend/src/auth/AuthFlowProvider.setup.test.tsx`** (update): add the query wrapper
  and the fetch stub if they render the profile card or the modal. Run them to confirm.

## Docs to Update

- **`docs/frontend/ui-components.md`**: add a new `## Combobox` section, in alphabetical order
  between `CoinIcon` and `ConversionCard`. Cover:
  - the source paths;
  - "No Figma: styled from the TextField token map (#1715)";
  - the props;
  - the DOM layout shared with `TextField` and why it matters (the #1399 child selector);
  - a token table: `TextField` rows, plus the list surface and border, the active and selected
    option, the flag size and the chevron;
  - the filter rule (substring on the label plus exact keyword/code match);
  - the APG editable-combobox keyboard and ARIA contract, including that blur, Escape and
    outside click restore the text and never commit;
  - the clear button;
  - the hand-rolled, no-dependency decision;
  - the reason it is not a native `<select>` (searchable, images in options).
- **`docs/frontend/auth-components.md` § CompanyDocsModal**:
  - Line 630: Country is now `CountryField` / `Combobox` with the same #1399 border.
  - Line 636: Name is a `TextField` and Country is a searchable country combobox. Cover the clear
    button → `null`, the "(as saved)" off-list option, and the free-text fallback.
- **`docs/frontend/account-page.md`**:
  - Rewrite the profile-card paragraph (lines 25-33).
  - Add a `### Country select (#1715)` subsection under "Production LP data contract (#1373)"
    (anchor `#country-select-1715`, referenced by code headers). It covers:
    - the source: flagcdn `codes.json` filtered to two-letter codes minus `eu`/`un`, sorted with
      `en` collation, and the React Query settings;
    - flags from `flagcdn.com/{code}.svg`;
    - only the name is sent;
    - type-to-filter by name or code;
    - the loading, failure-fallback and clear → `null` behaviour;
    - the exact-match off-list rule, built from the saved value and the draft together;
    - the server still accepts any string;
    - the no-referrer and credential-less requests.
- **`docs/frontend/trustee-flows.md:936`**: replace "optional free-text field with no validation
  and no frontend writer yet" with: the LP app now offers a dropdown of common English country
  names from flagcdn (#1715) but falls back to free text when the list cannot load, and the API
  still accepts any string. Rows may therefore hold common names, older codes or free text such
  as `"CH"`. The column stays verbatim, with no mapping.
- **`docs/product-specs/kyb-lp-verification.md:22`**: change "optional country" to "optional
  country picked from a public country list (stored as its English name; free text if the list
  is unavailable)".
- **`docs/SECURITY.md`**: one line under third-party/browser calls. The LP app fetches
  `flagcdn.com` (country list and flag images) without credentials or a referrer, and no user
  data is sent.
- **`docs/references/index.md`**: add a flagcdn / Flagpedia pointer (codes.json, flag URL
  formats, the attribution request).
- **`docs/user-stories/epic-1376/1715-country-select.md`** (new; house format with Epic #1376,
  Issue #1715 and a Spec link to `kyb-lp-verification.md`). Stories:
  1. The setup modal's Country opens a list of countries, each with a flag. The closed field
     shows the selected flag and name.
  2. Typing "per" narrows the list to Peru, and typing "nl" finds Netherlands. Nonsense text
     shows "No countries found".
  3. Selecting Peru with ArrowDown and Enter, then submitting, stores "Peru". The trustee's
     Jurisdiction column shows "Peru". DevTools Network shows `country: "Peru"` with no code or
     URL.
  4. Typing "Atlantis" and tabbing away restores the previous country, and nothing is saved.
     Escape also restores.
  5. "Clear country" plus save stores `null`, and the trustee shows `—`.
  6. A stored `"NL"` shows "NL" without a flag, the list offers "NL (as saved)", and a Name-only
     save leaves it unchanged.
  7. While loading, the field is disabled with "Loading countries…". With flagcdn blocked (via
     DevTools request blocking), the field becomes a text input that keeps the stored value, and
     saving still works.
  8. The Account profile card behaves the same, including draft preservation through a document
     upload and the disabled state while UnderReview or Passed.
  9. Keyboard only: Tab in, type, use the arrows, Enter, Escape and Tab out. A screen reader
     announces the combobox, its expanded state and the active option.
  10. The #1399 border shows when unfocused and the focus border when focused. Sign in and
      Create account are unchanged.
- **`docs/user-stories/index.md`**: add the #1715 row to the "Epic #1376 — KYB review lifecycle"
  table, and set the #1399 row (Epic #1247 table) to "Amended by #1715".
