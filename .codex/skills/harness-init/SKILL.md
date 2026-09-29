---
name: harness-init
description: Bootstrap a new project from a product requirements document with a Codex-ready docs-first repository harness. Use for a requested new-project harness, not ordinary Pipeline development.
---

# Harness Init

Take a PRD path and target repository. Read the PRD and the target repo before writing. If the PRD is missing, ask for it. Build a resumable execution plan at `docs/exec-plans/active/harness-init.md`; on a later run, resume from the first incomplete phase. Adapt the structure to the actual product and stack.

## Phases

1. **Plan:** extract product identity, users, domains, features, stack, integrations, security and reliability needs, and open decisions. Record a phase checklist and proposed docs/package layout in the plan. Ask only for decisions that cannot reasonably be inferred from the PRD.
2. **Foundation:** write a compact `AGENTS.md` (under 100 lines) that maps to deeper docs and states the repo's real workflow. Write `ARCHITECTURE.md` with package boundaries, allowed dependency directions, and provider entry points. Do not create Claude-specific files or permission settings for a Codex-only target.
3. **Docs:** create indexes and focused product specs, user stories, design decisions, plans, references, quality, reliability, and security docs as relevant. Link every page from a reachable index. Keep product behavior in specs and implementation rationale in plans/design docs.
4. **Skills:** create only skills that support actual recurring workflows in `.codex/skills/<name>/SKILL.md` with `name` and discriminating `description` frontmatter. Use the Codex `skill-creator` guidance and add `agents/openai.yaml` when UI metadata is useful. Do not copy Claude tool allowlists, model names, `Agent(...)` examples, or slash-command assumptions. Keep permissions and external actions within the target repo's rules.
5. **Enforcement:** add a doc linter, architecture boundary checks, and CI only where the stack supports meaningful checks. Give error messages a concrete remediation. Do not ship placeholder CI that always passes.
6. **Verify:** run the new linter and relevant checks; inspect links, skill frontmatter, architecture rules, and feature-to-spec/story coverage. Archive the completed plan and report remaining decisions or debt.

Create a feature branch before tracked edits, and follow the target repo's PR policy. Do not create application code, database infrastructure, or deployment resources unless the user separately requests them. Any generated repo must follow its own `AGENTS.md`; do not transplant Pipeline's issue labels or flows without checking whether they apply.
