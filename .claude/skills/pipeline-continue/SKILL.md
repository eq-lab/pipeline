---
name: pipeline-continue
description: Continue development work on the Pipeline protocol — resumes from last session state
user_invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent, Skill
---

# lint:docs skip-spec-ref

# Pipeline Continue — Harness Engineering Workflow

Resume incremental development on the Pipeline protocol.

## Phase 0: Orient

1. Read `AGENTS.md` — this is the authoritative workflow. Follow it exactly.
2. Read `claude-progress.md` (local, gitignored) — find last session's state and suggested task.
3. Run `gh issue list --state open` and `git log --oneline -10`.

Report to user in 3-4 lines. Ask which task to pick up, or suggest one.

## Phase 1: Execute the AGENTS.md workflow

Follow `AGENTS.md` **Workflow** section steps 0-9 in exact order. Do not skip or reorder steps. Key checkpoints where you must pause:

- **After step 4 (Review & approval):** Present spec + exec plan to the user. Wait for explicit confirmation before coding.
- **After step 6 (Testing):** Report test results before proceeding to archive.

Use the `/issue` skill for step 0 (pick or create task).

Key docs for Pipeline:
- Smart contracts: [`docs/product-specs/smart-contracts.md`](../../docs/product-specs/smart-contracts.md)
- Bridge service: [`docs/product-specs/bridge-service.md`](../../docs/product-specs/bridge-service.md)
- Security model: [`docs/SECURITY.md`](../../docs/SECURITY.md)

## Phase 2: Record

After completing the workflow:

1. Update `features.json` (local) — mark feature as passing if verified.
2. Append session entry to `claude-progress.md` (local) with: commit range, what was done, key decisions, current state, next suggested task.
