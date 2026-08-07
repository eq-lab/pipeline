# Issue #1032: Wallet block: testnet ↔ mainnet network switcher (trustee dashboard + protocol app)

Source: https://github.com/eq-lab/pipeline/issues/1032

> **Revision 2 (2026-08-06).** The first revision of this plan designed a runtime in-app switch
> driven by per-network-prefixed env vars (`VITE_MAINNET_*`/`VITE_TESTNET_*`) with a persisted
> store and reload semantics. The user corrected the infra premise: **no such vars exist and none
> are planned** — ArgoCD deploys each environment single-network with the SAME flat var names
> (`VITE_STELLAR_CHAIN_ID`, …) set to different values in `test.yaml` vs `prod.yaml`, and the two
> networks live at different origins. The switcher is therefore a **cross-deployment link**, not a
> config swap. The wrong-direction implementation was discarded before commit; this plan replaces
> the old one wholesale (see git history for revision 1).

## Scope

Each deployment knows (a) which network it itself is, and (b) the URLs of the sibling
deployments, from one new env var. The wallet block in both apps gains a network row showing the
current network and offering the other(s) as links that navigate (full page, cross-origin) to the
counterpart deployment. Real-funds affordance: mainnet is visually distinct, and switching **to**
mainnet asks a lightweight confirm first (resolved Q7).

Out of scope: any runtime config swapping, network store, query re-keying, session eviction, or
wallet-kit re-coordination — separate origins isolate all of that naturally. EVM remains untouched
(resolved Q4: Stellar-only concern; the link-out design is chain-agnostic anyway).

## Design

1. **Current-network identity** — derived from the deployment's own existing config: the Stellar
   network passphrase (`Test SDF Network ; September 2015` → `testnet`, `Public Global Stellar
   Network ; September 2015` → `mainnet`; anything else → treat as `testnet`-styled with the raw
   name shown). No new var needed for identity.
2. **Sibling links** — new env var, same name in both apps:
   `VITE_NETWORK_LINKS="mainnet=https://app.pipeline.one,testnet=https://pipeline.stage.eqlab.net"`
   (trustee yaml uses the dashboard URLs). Parsed defensively: entries `name=url`,
   comma-separated; malformed entries dropped; networks absent from the var are simply not
   offered; if only the current network remains (or the var is unset), the switcher renders as a
   static network label with no menu — the "hidden when unconfigured" behavior the issue requires.
3. **UI (resolved Q5 — menu rows):**
   - LP app: a network row at the top of `AccountDropdown` (above the EVM/Stellar segmented
     control) — current network with a colored dot (testnet: muted; mainnet: the brand navy /
     distinct accent), other networks as rows that navigate on click.
   - Trustee: a row in the existing `⋯` AccountMenu popover in `TrusteeSidebar`, same content
     model.
   - Also render the current-network label statically in the wallet block itself (both apps) so
     the active network is always visible without opening a menu (issue acceptance: "active
     network always labeled").
4. **Mainnet confirm (resolved Q7):** clicking a mainnet link opens a small confirm
   (`window.confirm` is acceptable per plan simplicity; a styled dialog if the app already has a
   trivial one to reuse) — copy: "Switch to Mainnet? You'll leave this testnet environment." On
   confirm, `window.location.assign(url)`.
5. Shared parsing/identity helpers live in `@pipeline/wallet-connect` (`src/network/links.ts`) so
   both apps use one implementation; UI stays per-app (unchanged D2 rationale).

## Assumptions and Risks

- The stage LP app origin is `pipeline.stage.eqlab.net` and trustee stage is
  `dashboard.pipeline.stage.eqlab.net`; mainnet: `app.pipeline.one` / `dashboard.pipeline.one`.
  The env var carries these — no hardcoding; ops fills real values per yaml.
- Navigation is cross-origin: no state carries over (by design). Wallets must be re-connected on
  the other origin; the switcher copy should not promise otherwise.
- `docker/frontend/entrypoint.sh` / `docker/trustee/entrypoint.sh` enumerate `VITE_` keys —
  add `VITE_NETWORK_LINKS` to both (or generalize to a prefix passthrough if trivial).
- The #997 branch is concurrently rewriting trustee comments; this branch is cut from main. Keep
  new inline comments minimal (rule 6) to reduce conflict surface.

## Open Questions

_None — the approach and URL-config shape were confirmed by the user in-session (2026-08-06):
link-out switcher; single `VITE_NETWORK_LINKS` var._

## Implementation Steps

1. ✅ `packages/wallet-connect/src/network/links.ts` (+ export from `src/index.ts`):
   `parseNetworkLinks(raw: string | undefined): NetworkLink[]` (`{ id, label, url }`, order
   preserved, malformed dropped) and `networkIdFromPassphrase(passphrase: string): { id, label }`.
   Labels: `testnet` → "Testnet", `mainnet` → "Mainnet", unknown → raw id capitalized.
2. ✅ `packages/frontend/src/lib/env.ts` + `packages/trustee/src/lib/env.ts`: add
   `NETWORK_LINKS: readString("VITE_NETWORK_LINKS", "")` (optional, default empty).
3. ✅ LP `AccountDropdown` (`packages/frontend/src/components/AccountDropdown.tsx`): network row per
   Design §3; current network from `networkIdFromPassphrase(ENV.STELLAR_NETWORK_PASSPHRASE)`;
   links from `parseNetworkLinks(ENV.NETWORK_LINKS)` minus the current network. Static label in
   the wallet pill area if one isn't naturally visible. Implemented via a shared
   `getNetworkSwitcherState()` composition helper (`packages/frontend/src/wallet/networkSwitcher.ts`)
   consumed by both `useAccountDropdown.ts` (menu row) and `TopBar.tsx` (always-visible badge).
4. ✅ Trustee `TrusteeSidebar` AccountMenu popover: same content model, sidebar idiom styling.
   Mirrored per-app composition helper: `packages/trustee/src/lib/networkSwitcher.ts`.
5. ✅ Mainnet confirm on navigate (Design §4): shared `navigateToNetworkLink` in
   `@pipeline/wallet-connect`, used by both apps.
6. ✅ Docker entrypoints: pass `VITE_NETWORK_LINKS` through (`docker/frontend/entrypoint.sh`,
   `docker/trustee/entrypoint.sh`).
7. ✅ `.env.example`: documented the new var with both apps' example values.
8. ✅ Docs: `docs/frontend/wallet-flows.md` — new `## Network switcher (cross-deployment links)`
   section capturing Design §1–4; also catalogued `getNetworkSwitcherState` in
   `docs/frontend/hooks.md` (used by 2+ components per app). No product-spec touch needed —
   neither `dashboards.md` nor the trustee spec enumerate wallet-block contents.
9. ✅ Verification gate (below). Also required a one-line fix to
   `packages/trustee/vite.config.ts` (add the same `test.server.deps.inline` for
   `@stellar/freighter-api`/`@creit.tech/stellar-wallets-kit` that `packages/frontend/vite.config.ts`
   already has) — the trustee test suite had never before exercised the real (non-mocked)
   `@pipeline/wallet-connect` barrel, which this issue's composition helper does.

## Test Strategy

- Unit (wallet-connect): `parseNetworkLinks` — happy path, empty/unset, malformed entries
  dropped, order preserved; `networkIdFromPassphrase` — testnet/public/unknown passphrases.
- Unit (LP + trustee component tests, existing harnesses): switcher row renders current network;
  other-network row present when links var provides it and absent when not; mainnet row click
  asks confirm before navigating (mock `window.confirm`/`location.assign`); unset var → static
  label only.
- Gates: `npx tsx scripts/lint-docs.ts` 0 errors; lint+build per touched package; trustee suite
  stays green (762); targeted vitest for new/touched LP+wallet-connect test files (LP full suite
  pass/fail set unchanged, #1003).

## Docs to Update

- `docs/frontend/wallet-flows.md` — the new switcher section (Step 8).
- `.env.example` — `VITE_NETWORK_LINKS` for both apps.
- Ops note in the PR body: `test.yaml`/`prod.yaml` need the var added per environment for the
  switcher to appear (absent var = hidden, safe default).

## Decision Log

- 2026-08-06: Revision 1 (per-network env prefixes + runtime store + reload) discarded on user
  correction — ArgoCD provides single-network environments with flat var names; switching is
  navigation between deployments. Confirmed with the user: link-out approach; single
  `VITE_NETWORK_LINKS` var. Q6 (session eviction) is moot under separate origins. The latent
  stale-trustee-session-on-chain-repoint bug revision 1 found remains real but is out of scope
  here — file separately if wanted.
