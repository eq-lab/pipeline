---
name: issue
description: Create and manage Pipeline GitHub Issues using the current issue protocol. Use for duplicate checks, epic sub-issues, claiming, labels, comments, and lifecycle changes.
---

# Issue

Read `docs/ISSUE_PROTOCOL.md` before changing an Issue. It is the source of truth for types, statuses, epic grouping, claiming, QA scheduling, and user-story artifacts. Read `AGENTS.md` for repo workflow rules.

## Before acting

1. Search open and closed Issues for duplicates with `gh issue list --state all --search '<keywords>'`.
2. Read the Issue and every comment with `gh issue view <number> -c`. Check its labels and assignees.
3. For a work sub-issue, read its parent epic for scope and links. Use the GraphQL `issue.parent` field or the epic's REST `sub_issues` endpoint in the protocol.
4. Do not take an Issue assigned to someone else without an explicit handoff. Skip `needs-feedback` until the human answers and removes that modifier.

## Create and update

- Give each open Issue exactly one protocol type label and, except for epics, one status label. New work enters `backlog` or `blocked`.
- Attach work to its epic as a native GitHub sub-issue. A standalone bug is allowed when no epic applies.
- Claim work by assigning yourself and replacing its status in one `gh issue edit` call. Explain blockers in a comment before moving to `blocked`.
- Keep the body current for scope; record decisions, handoffs, and results in comments.
- Let `Closes #<number>` in a merged PR close implementation, bug, or docs Issues. Never close an epic.
- Follow the QA scheduling rules in protocol §5.3; implementing agents do not edit the epic's `qa` Issue.

The `manager` skill owns lifecycle transitions during managed work. Planner and coder do not edit labels; `ux-tester` owns only its QA Issue and bugs it files.
