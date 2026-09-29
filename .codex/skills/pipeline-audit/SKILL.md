---
name: pipeline-audit
description: Audit Pipeline repository documentation, issue hygiene, architecture boundaries, and tracked bugs or debt. Use for a requested harness audit or milestone readiness review.
---

# Pipeline Audit

Read `AGENTS.md`, `ARCHITECTURE.md`, and `docs/ISSUE_PROTOCOL.md`. Inspect the repo and GitHub Issues without changing issue state during the audit. Verify:

1. Active Issues have valid type/status labels, correct epic grouping, and any `in-progress` work has an assignee and branch/PR.
2. Closed work has its plan archived, and user-facing implementation has a reachable user-stories doc under `docs/user-stories/`.
3. Links from `AGENTS.md` and docs indexes resolve; package layout and allowed dependencies match `ARCHITECTURE.md`.
4. `docs/exec-plans/known-bugs.md` and `tech-debt-tracker.md` entries are still open and not duplicated by tracked Issues.
5. Relevant lint/type checks expose any concrete hygiene failures. Run only checks justified by the audit scope.

Report findings with file or Issue evidence, severity, and suggested action. Separate confirmed defects from uncertain findings. Before creating or relabeling Issues as part of a requested cleanup, check for duplicates and follow `$issue`; do not close work based only on apparent staleness. When asked to fix findings, use a feature branch and the repository workflow.
