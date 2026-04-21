---
name: harness-init
description: Bootstrap a new project with harness engineering methodology from a product requirements document
argument-hint: <path-to-prd.md> — absolute or relative path to the PRD markdown file
user_invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# lint:docs skip-spec-ref

# Harness Init — Bootstrap a New Project from a PRD

Set up the complete harness engineering structure for a new project. The input is a product requirements document (PRD) in markdown format. The output is a fully wired docs-first development environment — no application code, only the scaffolding that lets agents build reliably.

This skill is **session-resumable**. It creates an exec plan on first run. If context runs out mid-execution, run this skill again with the same PRD path — it will detect the existing exec plan and resume from the last completed phase.

## Philosophy

These principles — drawn from harness engineering practice — guide every decision this skill makes:

1. **Repository-local knowledge.** Everything an agent needs to reason about the product lives in version control. If it's not in the repo, it doesn't exist to the agent.
2. **AGENTS.md is a map, not an encyclopedia.** Keep it under 100 lines. Point to deeper sources of truth in `docs/`.
3. **Plans are first-class artifacts.** Execution plans are checked into the repo, not held in chat context. This is what makes work resumable.
4. **Architecture rules must be mechanically enforceable.** Encode taste into linters, not comments. Custom lint errors become agent remediation instructions.
5. **Progressive disclosure.** Agents start with a small stable entry point and are taught where to look next, rather than being overwhelmed up front.
6. **Documentation leads, code follows.** Specs are written before implementation. If docs are stale after a change, the task is not done.
7. **Separate generation from evaluation.** Skills that build and skills that test are distinct. QA skills log bugs — they never fix code inline.

---

## Execution

### Phase 0: Parse & Plan

**Goal:** Read the PRD, extract structure, create the bootstrapping exec plan.

1. **Read the PRD** from `$ARGUMENTS` (file path). If the file doesn't exist, stop and ask the user.

2. **Check for existing exec plan.** Look for `docs/exec-plans/active/harness-init.md` in the target project. If found, read it and **skip to the first incomplete phase** — this is a resumed session.

3. **Extract from the PRD** (write findings to the exec plan):
   - **Product identity:** name, elevator pitch (1-2 sentences), target users
   - **Business domains:** the distinct areas of functionality (e.g., "auth", "billing", "game-mechanics"). Each domain becomes a product spec and a potential architecture boundary.
   - **Feature inventory:** list every discrete feature mentioned. Group features under their domain. This becomes the product specs breakdown.
   - **Tech stack:** languages, frameworks, databases, third-party services mentioned. This informs ARCHITECTURE.md and CI configuration.
   - **User roles / personas:** who interacts with the system and how. This informs security boundaries and user stories.
   - **API surface:** any endpoints, webhooks, or integration points mentioned.
   - **Non-functional requirements:** performance targets, scaling expectations, security constraints, compliance needs. These feed QUALITY_SCORE.md, RELIABILITY.md, and SECURITY.md.
   - **Identified risks or constraints:** anything the PRD flags as risky, deferred, or explicitly out of scope.

4. **Create the exec plan** at `docs/exec-plans/active/harness-init.md` with:
   - All extracted data from step 3
   - The phase checklist (phases 1-7) with `[ ]` checkboxes
   - The proposed domain list and product spec decomposition
   - The proposed directory layout

5. **Present the exec plan to the user.** Summarize:
   - How many domains were identified
   - How many product specs will be created
   - The proposed directory layout
   - Any ambiguities or questions about the PRD

   **Wait for explicit approval before proceeding to Phase 1.**

---

### Phase 1: Harness Foundation

**Goal:** Create the three root-level files that anchor the entire harness.

#### 1.1 — `CLAUDE.md`

```markdown
# CLAUDE

Read `AGENTS.md` first. Follow all instructions there.
```

That's it. Two lines. This file exists solely so Claude Code loads the harness workflow.

#### 1.2 — `AGENTS.md`

Create AGENTS.md following the template at `.claude/skills/harness-init/templates/AGENTS.md.template`. Customize it:

- Replace `{{PROJECT_NAME}}` with the product name
- Replace `{{GITHUB_REPO}}` — ask the user for the GitHub org/repo if not obvious from the PRD
- Replace `{{LINT_COMMAND}}` with the appropriate lint command for the tech stack (e.g., `yarn lint:arch`, `npm run lint`, `cargo clippy`). If unknown, use a placeholder and add a tech-debt entry.
- Keep it **under 100 lines**. If you find yourself exceeding this, move content to a `docs/` file and link to it.

The AGENTS.md must contain:
- **Start here** section (orient → read ARCHITECTURE.md → check issues → check exec plans → treat docs/ as source of truth)
- **Navigation** section (links to all docs/ subdirectories, grouped by purpose)
- **Workflow** section (the 10-step process: issue → spec → plan → docs → review → implement → test → archive → commit → PR)
- **Rules** section (git rules, lint rules, docs-first rules, bug tracking, tech debt)

#### 1.3 — `ARCHITECTURE.md`

Derive from the PRD's tech stack and domain structure:
- **Layering model:** define the dependency direction for the project. Default to `types → config → repo → service → runtime → ui` unless the PRD suggests otherwise.
- **Package/module layout:** map the domains from Phase 0 into a directory structure. Be specific about where each domain's code will live.
- **Applications:** list each deployable unit (API server, web frontend, worker, admin, etc.) with its port and purpose.
- **Cross-cutting concerns:** identify providers/shared infrastructure (auth, database, events, telemetry, etc.)
- **Data-fetching patterns** (if frontend exists): specify the preferred approach.

Mark `[x]` on Phase 1 in the exec plan.

---

### Phase 2: Documentation Tree

**Goal:** Create the full `docs/` directory structure with index files and operational documents.

#### 2.1 — Directory structure

```
docs/
├── design-docs/
│   ├── index.md
│   └── core-beliefs.md
├── exec-plans/
│   ├── active/
│   │   └── harness-init.md  (already exists from Phase 0)
│   ├── completed/
│   ├── known-bugs.md
│   └── tech-debt-tracker.md
├── generated/
├── product-specs/
│   ├── index.md
│   └── user-stories.md
├── references/
├── PLANS.md
├── PRODUCT_SENSE.md
├── QUALITY_SCORE.md
├── RELIABILITY.md
└── SECURITY.md
```

Add `FRONTEND.md` and `DESIGN.md` only if the PRD describes a frontend application.

#### 2.2 — Core beliefs (`docs/design-docs/core-beliefs.md`)

Write 5-8 operating principles derived from the PRD and harness methodology. Always include:
- Repository-local knowledge is easier for agents to discover, validate, and update.
- `AGENTS.md` should be a compact map, not a monolithic instruction dump.
- Plans are first-class artifacts and belong in version control.
- Architecture rules should be mechanically enforceable whenever possible.
- Predictable package boundaries improve both human and agent readability.

Add project-specific beliefs based on the PRD (e.g., "All external data is validated at the boundary" or "AI features are first-class product concerns, not afterthoughts").

#### 2.3 — `docs/design-docs/index.md`

Design catalog with verification status. Start with one entry: core-beliefs.md.

#### 2.4 — `docs/PRODUCT_SENSE.md`

Derived from the PRD:
- Elevator pitch (1-2 sentences)
- Core loop (what does the user do repeatedly?)
- Key differentiators
- Success metrics (if the PRD mentions any)
- What this product is NOT (anti-goals)

#### 2.5 — `docs/QUALITY_SCORE.md`

Define MVP quality bars. Derive from PRD non-functional requirements. Include:
- Latency targets (API p50, p95)
- Frontend performance (LCP, FID, bundle size) — if applicable
- Availability target
- Test coverage threshold (default: 100% for domain services)
- Any domain-specific quality metrics

#### 2.6 — `docs/RELIABILITY.md`

- Performance targets and scaling path
- Monitoring strategy
- Disaster recovery approach
- Known scaling limits from the PRD

#### 2.7 — `docs/SECURITY.md`

- Authentication method(s)
- Authorization model
- Trust boundaries (user → API → DB, API → external services, etc.)
- Data handling requirements
- Operational endpoint protection

#### 2.8 — `docs/PLANS.md`

Short file pointing to `docs/exec-plans/active/` and `docs/exec-plans/completed/`.

#### 2.9 — `docs/FRONTEND.md` (if applicable)

- Visual direction
- Component library / design system
- Responsive behavior rules
- Real-time update strategy (if applicable)

#### 2.10 — Tracking files

- `docs/exec-plans/known-bugs.md` — empty template with Open / Resolved sections
- `docs/exec-plans/tech-debt-tracker.md` — empty template with Known Gaps / Post-MVP sections
- `docs/generated/` — empty directory (add `.gitkeep`)

#### 2.11 — AGENTS.md link verification

After creating all docs, verify every file is reachable from AGENTS.md via markdown links. Add any missing links to the Navigation section.

Mark `[x]` on Phase 2 in the exec plan.

---

### Phase 3: Product Specs

**Goal:** Decompose the PRD into individual, focused product specs.

This is the most context-intensive phase. For large PRDs, process domains one at a time.

#### 3.1 — Product spec decomposition

For each domain identified in Phase 0, create a product spec at `docs/product-specs/<domain>.md`. Follow these rules:

- **One spec per feature domain**, not per implementation task.
- **Frame everything as behavior.** "Registration" not "Problem." "Access Control" not "Guard chain changes."
- **Typical sections:** Overview → Behavior (flows, rules, parameters) → API Contract → Data Model → Security considerations.
- **Include implementation details when they define behavior.** API contracts (method, path, request/response shapes), data models (table, columns, types), security rules.
- **Describe target behavior only.** No change history, no migration notes.
- **Keep each spec under 150 lines.** If a domain is too large, split it into sub-features.
- **Cross-reference related specs** — but avoid mutual references (A→B and B→A suggests overlapping scope).

#### 3.2 — User stories (`docs/product-specs/user-stories.md`)

Create testable user stories grouped by user journey. Format:

```markdown
## US-<DOMAIN>-<N>: <Title>

**As a** <role>, **I want to** <action>, **so that** <benefit>.

**Acceptance criteria:**
- [ ] <concrete, testable criterion>
- [ ] <another criterion>
```

Derive these from the PRD's feature descriptions. Every feature in every product spec should have at least one corresponding user story.

#### 3.3 — Product specs index (`docs/product-specs/index.md`)

Write the index following the format guidelines (how to write a spec, current entries list). Use the template at `.claude/skills/harness-init/templates/product-specs-index.md.template`.

Mark `[x]` on Phase 3 in the exec plan. **Present a summary to the user** — list all specs created, total user stories, and any PRD features that were ambiguous or deferred.

---

### Phase 4: Skills

**Goal:** Create the core Claude Code skills that implement the harness workflow.

Create these skills under `.claude/skills/`:

#### 4.1 — `issue/SKILL.md`

GitHub Issue management skill. Adapted from the template at `.claude/skills/harness-init/templates/skill-issue.md.template`. Customize `{{GITHUB_REPO}}`.

#### 4.2 — `pr/SKILL.md`

Pull request creation skill. Adapted from template.

#### 4.3 — `hte-continue/skill.md`

The "resume work" skill. Reads AGENTS.md workflow, checks exec plans and progress, asks user which task to pick up. Rename the `hte-` prefix to match the project (e.g., `<project>-continue`). Adapt from template.

#### 4.4 — `hte-audit/skill.md`

The "garbage collection" skill. Checks docs freshness, architecture compliance, feature accuracy, code hygiene. Rename prefix to match project. Adapt from template.

#### 4.5 — `test-fast/SKILL.md`

Fast lint + unit + integration test runner. Customize commands for the project's tech stack. If the stack is not yet decided, create a placeholder with TODO markers.

#### 4.6 — `test/SKILL.md`

Master test skill that chains test-fast → test-verified (if applicable).

#### 4.7 — Local progress files

Create `.gitignore` entries for:
- `claude-progress.md`
- `features.json`

These are local agent artifacts, not committed.

Mark `[x]` on Phase 4 in the exec plan.

---

### Phase 5: Quality Infrastructure

**Goal:** Set up mechanical enforcement — linters, CI, and permission boundaries.

#### 5.1 — Doc linter (`scripts/lint-docs.ts` or equivalent)

Create a documentation linter that enforces:
1. **AGENTS.md line count** — warn >100, error >150
2. **Reachability** — all `.md` files under `docs/` must be reachable via links from AGENTS.md
3. **Markdown formatting** — closed fences, no trailing whitespace, single newline EOF
4. **No acceptance criteria in product specs** — only in `user-stories.md`
5. **Spec filename blocklist** — warn on migration/redesign/switch/replace terms
6. **Skills reference product specs** — warn if a skill has no product spec reference (skip with `# lint:docs skip-spec-ref`)
7. **Spec size limit** — warn >150 lines, error >200
8. **Mutual spec references** — warn when two specs link to each other

Adapt the language to match the project's tech stack. If the project uses TypeScript, use the Node.js-based linter from this repo as reference. If Python, write an equivalent. If uncertain, default to TypeScript.

#### 5.2 — GitHub Actions

Create `.github/workflows/lint.yml`:
- Triggers on PR and push to main
- Runs the doc linter
- Runs the project's code linter (if known)

Create `.github/workflows/tests.yml`:
- Triggers on PR and push to main
- Runs unit tests
- Runs integration tests (if applicable)
- Placeholder steps if test commands aren't known yet

#### 5.3 — `.claude/settings.json`

Create the Claude Code permission allowlist. Include:
- Git operations (checkout, branch, push, commit, apply, stash, log, diff, status)
- GitHub CLI operations (issue, pr)
- Lint and test commands
- Read access to the project directory
- Skill script execution paths

Pattern: minimal surface, explicit allowlists, no wildcard overreach.

#### 5.4 — Architecture linter placeholder

If the tech stack supports it (TypeScript → `eslint-plugin-boundaries`, Rust → module visibility, etc.), create a placeholder configuration file or document the setup in `docs/`. If the stack is unknown, add an entry to the tech debt tracker: "Set up architecture boundary linting once stack is finalized."

Mark `[x]` on Phase 5 in the exec plan.

---

### Phase 6: Design Docs (if applicable)

**Goal:** Create design documents for non-obvious architectural decisions mentioned in the PRD.

Scan the PRD for:
- Trade-off discussions ("we chose X over Y because...")
- Domain-specific design decisions (anti-cheat, pricing model, data pipeline architecture, etc.)
- Security architecture beyond basic auth

For each, create a design doc at `docs/design-docs/<topic>.md` with:
- **Context:** what problem is being solved
- **Decision:** what was chosen
- **Rationale:** why this approach over alternatives
- **Consequences:** what this enables and what it constrains

Update `docs/design-docs/index.md` with entries.

Mark `[x]` on Phase 6 in the exec plan.

---

### Phase 7: Verify & Finalize

**Goal:** Validate the entire harness is internally consistent and present it to the user.

1. **Run the doc linter** (if it's executable). Fix any issues.

2. **Verify AGENTS.md** is under 100 lines and links to all `docs/` files.

3. **Verify every product spec** is listed in `docs/product-specs/index.md`.

4. **Verify every feature** from the PRD has at least one product spec and one user story.

5. **Count completeness:**
   - Domains extracted: N
   - Product specs created: N
   - User stories written: N
   - Design docs created: N
   - Skills created: N
   - CI workflows created: N

6. **Move the exec plan** from `docs/exec-plans/active/harness-init.md` to `docs/exec-plans/completed/harness-init.md`.

7. **Present the final summary** to the user:
   - What was created (file count by category)
   - Any deferred items (logged in tech-debt-tracker.md)
   - Any PRD ambiguities that need human clarification
   - Suggested first task for the development phase

8. **Commit** with message: `chore: bootstrap harness from PRD — <product name>`

Mark `[x]` on Phase 7 in the exec plan.

---

## Resuming After Context Reset

When this skill is invoked and `docs/exec-plans/active/harness-init.md` already exists:

1. Read the exec plan
2. Find the last checked `[x]` phase
3. Read any relevant artifacts already created (AGENTS.md, ARCHITECTURE.md, existing specs)
4. Report current state to the user: "Phases 0-N complete. Resuming from Phase N+1."
5. Continue execution from the next incomplete phase

The exec plan contains all extracted PRD data, so re-reading the full PRD is unnecessary on resume — only consult it if a specific detail is needed.

---

## What This Skill Does NOT Do

- **No application code.** No scaffolding of actual source files, package.json, Cargo.toml, etc.
- **No database setup.** Schema docs are created as empty placeholders in `docs/generated/`.
- **No deployment configuration.** Dockerfiles, Terraform, etc. are out of scope.
- **No external service setup.** No Privy, Stripe, or third-party API configuration.

The harness is the environment that lets agents write all of the above reliably. This skill builds the harness.
