# Pipeline User Docs — Design Spec

**Date:** 2026-04-23
**Target branch:** `docs/update-specs-v2.3`
**Output location:** `docs/user-docs/` (served via GitHub Pages)

---

## Goal

A public-facing documentation site for the Pipeline protocol. Compelling enough to
convert a qualified on-chain lender who lands cold; honest enough that a sophisticated
reader cannot accuse it of hiding risk. Simple language, no jargon smuggling, no
self-reference to AI or drafting process. Consistent with the v2.3 product specs in
`docs/product-specs/`; no contradicting architecture claims.

The docs are not an API reference. They are not an audit report. They are a
lender-first introduction to what Pipeline is, how it earns yield, and what can go
wrong — with a light borrower track and a full security/transparency cluster.

## Audience

| Audience | Priority | What they need |
|---|---|---|
| KYC'd on-chain lenders (USDC holders considering PLUSD/sPLUSD) | Primary | Pitch, eligibility, mechanics, risks, losses, custody, addresses |
| KYB'd commodity trade-finance borrowers (reached bespoke via Open Mineral) | Secondary | Enough to know whether it's worth reaching out; clear contact path |
| Auditors, regulators, integrators | Tertiary | Navigable "Security & Transparency" cluster; links to product specs |

Borrowers are bespoke-sourced, not self-service. Treat them like Ondo treats
qualified-access investors: one page that routes the reader, not a full DIY guide.

## Voice

- **Plain English.** One idea per sentence. Active verbs.
- **Blunt.** "Your USDC sits with the custodian, not inside a smart contract" beats
  "Pipeline implements a segregated custody architecture".
- **No filler.** No "leverage", "seamlessly", "world-class", "institutional-grade"
  unless literally quoting a counterparty.
- **Disclose before selling.** Every page that quotes a yield or a cap also states the
  risk or the constraint in the same section, not two scrolls down.
- **No self-reference.** No "this document", no "we built this to", no "AI-generated",
  no drafting-process commentary.
- **Reuse the split-rail framing** from v0.3.8 ("token rail vs cash rail; the token
  rail never holds USDC") — it is the clearest mental model the project has produced.

## Information architecture

Nineteen pages (counting section indexes), organised persona-first with a shared
foundation. Numbered order matches the sidebar:

```
docs/user-docs/
├── index.md                        # 01  Home
├── how-it-works/
│   ├── index.md                    # 02  How Pipeline works (overview)
│   ├── split-rail.md               # 03  On-chain token rail vs off-chain cash rail
│   └── yield-engines.md            # 04  Two yield sources: senior coupons + T-bills
├── lenders/
│   ├── index.md                    # 05  For Lenders — landing
│   ├── onboarding.md               # 06  KYC, whitelist, freshness, minimums
│   ├── deposit-and-stake.md        # 07  USDC → PLUSD → sPLUSD
│   ├── withdraw.md                 # 08  sPLUSD → USDC via FIFO queue
│   └── dashboard.md                # 09  What lenders see (on-chain + UI)
├── borrowers.md                    # 10  For Borrowers — single page
├── risks.md                        # 11  Categorised risk disclosure
├── defaults-and-losses.md          # 12  Loss waterfall, shutdown mechanics
├── security/
│   ├── index.md                    # 13  Security & Transparency overview
│   ├── custody.md                  # 14  Custodian, MPC, split-rail detail
│   ├── supply-safeguards.md        # 15  Why PLUSD can't be inflated
│   ├── emergency-response.md       # 16  Pause + granular revoke (Ethena-style)
│   └── audits-and-addresses.md     # 17  Audits, contract addresses, live data
├── glossary.md                     # 18  Trade-finance and Pipeline terms
└── legal.md                        # 19  KYC, jurisdictions, terms
```

Home's above-the-fold contains: one-sentence pitch; a risk info-box ("yield comes from
real loans — read [Risks](./risks.md) before depositing"); four links into the trees.

## Key content emphases (non-exhaustive — per-page briefs in the writing plan)

- **Separation of on-chain and off-chain components.** Anchored in
  `how-it-works/split-rail.md` and `security/custody.md`. The sentence
  *"a bug or exploit in on-chain code cannot drain investor capital unilaterally"*
  appears verbatim on the Home page and the Custody page.
- **Custodied USDC.** Named custodian (or a placeholder slot + description of custodian
  requirements if naming is deferred). MPC policy engine. Co-signer roles. No contract
  ever holds the reserve.
- **PLUSD supply safeguards.** No hot-wallet mint path. Deposits are atomic on-chain
  via DepositManager — no off-chain signer gates them. Yield mints require two
  independent signatures (Bridge + custodian EIP-1271) plus an on-chain reserve
  invariant. Four economic caps (`maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply`,
  `freshnessWindow`).
- **Shutdown and loss architecture.** Waterfall: originator equity → sPLUSD writedown
  → IOU to PLUSD. Shutdown enters one-way; recovery rate ratchets up only; fixed-rate
  exit via `redeemInShutdown` for PLUSD, or `sPLUSD.redeem()` + `redeemInShutdown`
  for sPLUSD holders.

## Diagrams

Nine architecture diagrams. Hand-authored inline SVG in `docs/user-docs/assets/diagrams/`,
matching the `overview.html` visual language (dark `#0f1419` background; palette:
slate `#7aa2f7`, sage `#9ece6a`, amber `#e0af68`, rose `#f7768e`, lavender `#bb9af7`).

**Hard requirement:** every flow diagram (D2, D3, D4, D5, D6, D7, D9 — anything with
arrows through time) is accompanied by a numbered step-by-step walkthrough in the
page body, **one sentence per step, maximum**. The step list uses the same labels
that appear as nodes in the SVG — a reader can track "step 3" on the diagram and
"step 3" in the prose side by side. Context diagrams without a time dimension
(D1 System Context, D8 Governance) get a short paragraph instead of a numbered list.
The Reviewer agent rejects any flow diagram that ships without its walkthrough.

| # | Diagram | Where embedded | Source of truth |
|---|---|---|---|
| D1 | System Context (split-rail) | Home, Security/index | `product-specs/smart-contracts.md`, `security.md` |
| D2 | Deposit → Mint | How-it-works, Lenders/deposit | `product-specs/deposits.md` |
| D3 | Stake / Unstake | Lenders/deposit-and-stake | `product-specs/staking.md` |
| D4 | Yield Accretion | How-it-works/yield-engines | `product-specs/yield.md` |
| D5 | Withdraw → Settle | Lenders/withdraw | `product-specs/withdrawals.md` |
| D6 | Loan Lifecycle | How-it-works, Borrowers | `product-specs/loans.md` |
| D7 | Shutdown | Defaults-and-losses | `product-specs/smart-contracts.md` §Shutdown Mode |
| D8 | Governance (3 Safes + timelocks) | Security/index | `product-specs/security.md` timelock table |
| D9 | Incident Response (granular revoke + pause) | Security/emergency-response | `product-specs/smart-contracts.md` §Emergency Response |

D9 replaces overview.html's "Incident → RevokeAll" tab — that tab is stale vs v2.3
canon.

Each diagram SVG is a file, not a `<svg>` inline in Markdown. Referenced via
`{% include diagram.html src="d2-deposit-mint.svg" caption="..." %}`.

## Charts

Three Python-generated figures. Script `docs/user-docs/scripts/build_charts.py`.
Output to `docs/user-docs/assets/charts/` as SVG. Palette matches the diagram palette.

| # | Chart | Where |
|---|---|---|
| C1 | Reserve composition (USDC / USYC / USDC on active loans / USDC in transit) | Security/custody |
| C2 | Yield attribution stack (senior coupon net + T-bill accrual + fees) | How-it-works/yield-engines |
| C3 | CCR threshold ladder (watchlist 130% / maintenance 120% / margin call 110%) | Risks, Defaults-and-losses |

Charts are static at this stage (representative values, labelled clearly as
illustrative — not live data). A follow-up adds live data pulled from the Protocol
Dashboard once it exists.

**Chart accuracy rules** (the Reviewer agent enforces each one):

- Every numeric value printed on a chart — percentages, basis points, dollar amounts,
  thresholds — must match the "Numbers to quote" table below, or be derivable from
  it by a stated formula shown in the chart caption.
- Every chart displays a caption of the form `Illustrative — <what the values mean>,
  <what they are not>` (e.g. `Illustrative breakdown of a representative repayment;
  not live protocol data`).
- Axis labels, units (%, bps, USDC), and series legends are spelled out in full —
  no bare numbers without a unit.
- Colours match the palette used by the diagrams; no matplotlib defaults.
- Every chart is produced by a deterministic, committed script
  (`scripts/build_charts.py`) so any number can be traced back to a line of code
  that sourced it.

## Tech setup

- **Engine:** Jekyll (GitHub Pages default). `_config.yml` in `docs/user-docs/`.
- **Deployment:** GitHub Actions workflow at `.github/workflows/user-docs.yml` builds
  Jekyll from `docs/user-docs/` and publishes to the `gh-pages` branch. Keeps
  `docs/product-specs/` out of the public site. Triggers on pushes to
  `docs/update-specs-v2.3` that touch `docs/user-docs/**`. **Setup decision:** the
  GitHub Pages source must be configured in repo settings to serve from the
  `gh-pages` branch (one-time repo-admin action). The workflow is committed so the
  decision can be reversed without code changes if a different pattern is preferred.
- **Theme:** custom, inspired by `overview.html`. Single stylesheet at
  `assets/css/main.css`. Dark by default; no light-mode toggle in MVP.
- **Navigation:** left sidebar (section tree), top-right "Launch App" placeholder
  button, breadcrumbs on nested pages. Mobile: sidebar collapses to drawer.
- **Analytics:** none in MVP. (Decision deferred; note for later.)
- **Canonical URL:** `https://<org>.github.io/pipeline/` or a custom domain if
  provisioned; `baseurl` configurable in `_config.yml`.

## Multi-agent writing process

Per-page loop:

1. **Writer agent (general-purpose)** produces a draft given: the per-page brief; the
   relevant product-spec source file(s); the voice guide above; the glossary draft
   so far; and the "no retired v2.3 terms" checklist
   (`MINT_ATTESTOR`, `LOAN_MANAGER`, `EmergencyRevoker`, `revokeAll`, HSM-backed
   wording, off-chain wires, F-8 pre-fund, `adjustRecoveryRateDown`,
   `convertSharesAtShutdown`).
2. **Reviewer agent (general-purpose or feature-dev:code-reviewer)** critiques the
   draft against:
   - Plain-English test (no AI-speak, no filler adjectives, active voice, short
     sentences).
   - CEO-tone-without-bullshit test (selling but non-hyperbolic, discloses in the
     same section).
   - v2.3-consistency test (no retired terms; no claims that contradict the specs).
   - Number-accuracy test (fees, caps, thresholds, minimums match the approved set).
   - Disclosure-posture test (every quoted number has its constraint stated nearby).
   Returns concrete diff proposals, not vibes.
3. **Orchestrator (me)** resolves feedback, commits the page, moves on. A second
   reviewer pass runs only if the first pass returned substantive diffs.

**Parallelisation.** Within a tree, pages are written in parallel up to 3 at a time
(Writer agents are independent). Cross-referencing pages (Home, Risks, Defaults &
Losses) are written last so they can quote the vocabulary the tree pages have
established.

**Diagrams and charts.** Authored separately. SVG diagrams are hand-drafted by the
orchestrator (too style-specific for an agent); charts are generated by the Python
script and reviewed by the orchestrator for labelling clarity.

**Glossary** is a living document. Every Writer agent appends any term it used but
did not define; the Glossary writer consolidates at the end, deduplicates, and
defines each term in one or two plain sentences.

## Numbers to quote (approved set)

| Value | Where used | Source |
|---|---|---|
| $1,000 USDC minimum deposit | Lenders/onboarding, Home | v0.3.8 §3.2 |
| $5M/tx, $10M/24h rate limits | Lenders/deposit-and-stake, Risks | v0.3.8 §3.3 |
| 15% target USDC buffer (10%–20% band) | How-it-works/yield-engines, Security/custody | v0.3.8 §5.5 |
| 70/30 T-bill yield split (vault/treasury) | Yield-engines | v0.3.8 §5.4 |
| Fees: 0.5–1.5% management, 10–20% performance, 0.05–0.10% OET | Yield-engines, Risks | v0.3.8 §5.2 |
| CCR thresholds: 130 / 120 / 110 | Risks, Defaults, C3 chart | v0.3.8 §9.6 |
| Payment delay thresholds: 7d amber / 21d red | Risks | v0.3.8 §9.6 |
| Timelock durations: 48h ADMIN, 24h RISK_COUNCIL, 14d meta-timelock, 90d Chainalysis freshness | Security/supply-safeguards, Security/emergency-response | `product-specs/security.md` |

## Out of scope for MVP docs

- Live data integrations (reserve composition, current CCRs, withdrawal-queue depth)
  — placeholders now; wired to Protocol Dashboard later.
- Light/dark mode toggle.
- i18n / translations.
- API reference (not a developer product at MVP).
- Deep borrower walk-through (bespoke origination flow; one page is enough).
- Regulatory jurisdictional detail — placeholder only. Legal review owns that page.

## Open placeholders

These need inputs the Pipeline team owns. The docs will ship with clearly-marked
placeholder blocks:

- **Custodian name** (or description + selection criteria if naming is deferred).
- **Auditor names** and date-stamped audit reports.
- **Deployed contract addresses** (post-deployment).
- **Jurisdictional restrictions** list (pending legal review).
- **Protocol dashboard URL** for live-data embeds.
- **Custom domain** for the docs site, if any.

## Success criteria

A qualified on-chain lender can land cold on the Home page and within ten minutes:

1. Understand what Pipeline is in one sentence.
2. See why yield exists and where it comes from.
3. Know what can go wrong (named risk categories, not abstract hedging).
4. Know how to start (KYC route + minimum deposit).
5. Find the custody setup and the security architecture without clicking three levels deep.

A counterpart (auditor, institutional due-diligence team) can, from the Security &
Transparency cluster, verify the split-rail claim, locate the supply-safeguards
explanation, and cross-reference to `docs/product-specs/` within three clicks.
