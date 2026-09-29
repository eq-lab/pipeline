---
name: pipeline-continue
description: Resume Pipeline development from GitHub Issues, current branches, and active plans. Use when asked to continue prior repo work without a specific task.
---

# Pipeline Continue

Read `AGENTS.md`, `ARCHITECTURE.md`, `docs/ISSUE_PROTOCOL.md`, recent commits, working-tree status, open Issues, and `docs/exec-plans/active/`. An Issue and its comments are the durable task state; do not rely on a local progress file or an earlier chat summary alone.

Find the most relevant unfinished work: first a task assigned to the current user on the current branch, then a matching active plan, then unclaimed backlog work. Respect `needs-feedback`, assignees, blockers, and epic context. State the task you found and continue its applicable `$manager`, `$planner`, or `$coder` workflow. If several unrelated candidates remain and the user has not indicated which one, give a short choice with Issue numbers.

Record decisions and handoffs in the Issue comments per the protocol. Do not invent a separate mandatory 10-step workflow or require plan approval for frontend work when the current manager flow does not.
