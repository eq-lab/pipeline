# Core Beliefs

Operating principles that guide every decision on this project — for humans and agents alike.

## 1. Repository-local knowledge

Everything an agent needs to reason about the product lives in version control. If it's not in the repo, it doesn't exist to the agent. External decisions, vendor choices, and architectural rationale belong in `docs/design-docs/`, not in Slack or Notion.

## 2. AGENTS.md is a map, not an encyclopedia

AGENTS.md stays under 100 lines. It points to deeper sources of truth in `docs/`. Expanding AGENTS.md with inline detail is always wrong — add a `docs/` file and link to it.

## 3. Plans are first-class artifacts

Execution plans are checked into the repo at `docs/exec-plans/active/`. This makes work resumable across context resets and auditable after completion. A task without a plan is not a task — it is noise.

## 4. Architecture rules must be mechanically enforceable

Taste encoded into linters outlasts taste encoded into comments. The dependency direction (`contracts ← worker ← api ← frontend`) is not a suggestion — it should eventually be checked by CI.

## 5. Documentation leads, code follows

Specs are written before implementation. If the docs are stale after a change, the task is not done. This is not bureaucracy — it is the mechanism by which the next agent (or human) understands why the code is the way it is.

## 6. Cash rail and token rail are kept strictly separate

Smart contracts hold no USDC or USYC. On-chain code emits events; off-chain MPC policy enforces cash-rail authority. This is the primary capital-protection property of the protocol and must never be eroded for implementation convenience.

## 7. The bridge is adversarially bounded by design

The bridge service's MPC permissions, counterparty addresses, and transaction envelope bounds are the attack surface. They are deliberately narrow: auto-signing is scoped to four categories with pinned destinations and hard caps. Any widening of bridge permissions is a security decision, not an implementation decision.

## 8. Whitelist enforcement is tight by default

PLUSD transfers revert for any recipient not in the WhitelistRegistry (KYCed LPs or foundation-multisig-approved DeFi venues). Relaxing this to a denylist model (Phase 2) is a governance decision, not a default. Agents must never bypass or soften whitelist checks without an explicit governance decision.

## 9. All external data is validated at the boundary

KYC results from Sumsub, screening results from Chainalysis, price data from Platts/Argus, and NAV data from the USYC issuer are all untrusted until validated. The bridge service is the validation boundary — downstream code (API, frontend) may treat bridge-validated data as authoritative.
