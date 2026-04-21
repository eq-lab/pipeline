---
name: pipeline-audit
description: Run a harness audit on the Pipeline protocol — check docs freshness, architecture compliance, feature accuracy, and code hygiene
user_invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, Skill
---

# lint:docs skip-spec-ref

# Pipeline Harness Audit

Garbage-collect stale artifacts and catch drift. Run this every 5-10 sessions or before milestones.

## Checklist

### 1. Feature List Accuracy

Generate `features.json` locally by scanning the codebase and GitHub Issues (`gh issue list`). For each feature, verify whether it still works. Compare against the previous `features.json` if it exists. Report corrections.

`features.json` is gitignored — it's a local agent artifact, not committed.

### 2. GitHub Issues Hygiene

Run `gh issue list --state open` and `gh issue list --state closed --limit 20`. Check:
- Open issues with `in-progress` label — do they have active branches and open PRs?
- Closed issues — were their exec plans moved to `completed/`?
- Stale open issues — should any be closed or re-labeled?

### 3. Documentation Freshness

Check all docs referenced in `AGENTS.md`:
- Do file paths match the actual project structure?
- Are exec plans in the right directory (active vs completed)?
- Do product spec index links all resolve?
- Does `ARCHITECTURE.md` match the actual package structure?
- Are open items in `docs/exec-plans/tech-debt-tracker.md` still valid?

### 4. Architecture Compliance

Read `ARCHITECTURE.md`, then verify:
- Dependency direction: `contracts ← worker ← api ← frontend` — no backwards imports
- Worker does not import from API or frontend
- API does not import from worker at runtime
- New code in correct packages

### 5. Code Hygiene

Scan for:
- TODO/FIXME/HACK comments that should be tracked in tech-debt-tracker.md
- Unused imports (Rust: `cargo check`, TS: `tsc --noEmit`)
- Dead code

### 6. Git Health

Check commit conventions, uncommitted changes, stash list, branch cleanliness.

### 7. Bugs & Tech Debt Reconciliation

Reconcile `docs/exec-plans/known-bugs.md` and `docs/exec-plans/tech-debt-tracker.md` against GitHub Issues.

1. Parse open items from each file.
2. Search for existing issues: `gh issue list --search "<keywords>" --state all`.
3. If an open issue exists: remove the entry from the file. If only a closed issue exists: keep for re-evaluation.
4. **Present a summary table and wait for user confirmation** before creating any issues or editing files.
5. After confirmation: create issues using `/issue` skill, remove processed entries.

## Reporting

Present findings as a structured report with score (X/7 clean). Ask the user which issues to fix.

## After Fixing

1. Update `claude-progress.md` (local, gitignored) with audit session entry.
2. Update `features.json` (local, gitignored) with current feature state.
3. Commit only tracked files: `chore: harness audit — <summary of fixes>`.
4. For every issue found, ask: "How do I prevent this?" and update AGENTS.md or add linter rules.
