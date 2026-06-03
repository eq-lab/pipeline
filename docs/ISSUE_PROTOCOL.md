# Issue Protocol

The agent-agnostic contract for working with GitHub Issues in this repository. Any agent — a coding agent, a QA agent, a personal assistant, a human — participates in the same task board by following this document. It defines only what is **observable to other agents**: issue types, labels, status transitions, grouping, and comment conventions. *How* an agent performs its work internally (planning, flows, tooling) is out of scope — each agent brings its own skills on top of this protocol.

## 1. Principles

1. **GitHub Issues are the shared state.** There is no other task tracker. An agent that needs to know "what is the status of X" reads the issue; an agent that changes the status of X edits the issue. No side channels.
2. **This document is the contract.** Agents derive their own skills/prompts from it. When the protocol changes, this file changes first, via PR.
3. **Labels carry the machine-readable state.** Type, status, and modifiers are labels with strict rules (below). Free text goes in bodies and comments.
4. **Comments are the event log.** Decisions, scope changes, blockers, hand-offs, and results are posted as issue comments — never assumed from chat history.

## 2. Issue types

Every open issue carries **exactly one type label**: `epic`, `implementation`, `bug`, `docs`, or `qa`.

### `epic` — business feature container

All dev work is grouped under an epic. An epic describes one business feature.

- **Body must contain:** what the feature is and why, link to the product spec (if one exists), scope boundaries (what is explicitly out).
- **Structure:** all work issues (`implementation`, `bug`, `docs`, `qa`) are attached as **native GitHub sub-issues** of the epic. GitHub renders the progress automatically.
- **A `qa` sub-issue is created together with the epic** (see `qa` below).
- Epics carry no status label — their state is the aggregate of their sub-issues.
- **Done when:** all sub-issues are closed and the final QA pass is green. The `qa` sub-issue closes last, then the epic.

### `implementation` — code work

- **Body must contain:** what needs to happen, why, affected areas. The issue must be a sub-issue of an epic.
- Modifier `trivial` marks work that needs no planning — the implementing agent may go straight to code.
- **Done when:** code, tests, and lint are green; a **user-stories doc** for the change exists (see §6); the PR is merged; and a comment linking the user-stories doc is posted on the epic's `qa` issue (see §5.3).

### `bug` — defect

- **Body must contain:** observed vs expected behavior, reproduction steps, location (page/module).
- Bugs found while testing an epic are filed as sub-issues of that epic. Bugs with no related epic may stand alone.
- **Done when:** fixed with a regression test and the PR is merged. If the fix changes user-visible behavior, update the relevant user-stories doc and notify the `qa` issue as in §5.3.

### `docs` — documentation update

- Docs-only change: specs, guides, user docs, generated docs.
- **Done when:** the docs PR is merged and `npx tsx scripts/lint-docs.ts` passes.

### `qa` — testing pass

One `qa` issue per epic, created together with the epic as its sub-issue. Manual testing does **not** happen after each task — it happens when an agent picks up the `qa` issue.

- **Body:** a checklist of user-stories docs to verify. Implementing agents append to it via comments (§5.3); the QA agent folds comments into the checklist when claiming.
- **Lifecycle:**
  1. Created `blocked` (nothing to test yet).
  2. First merged `implementation`/`bug` sub-issue flips it to `backlog`.
  3. A QA agent claims it (`in-progress`), executes every linked user-stories doc not yet verified, files found defects as `bug` sub-issues of the same epic, and posts a results comment (stories run, pass/fail per story, bugs filed).
  4. If the epic still has open work issues → back to `blocked` (waiting for more work to test).
  5. When all sibling sub-issues are closed and the latest pass is green → close the `qa` issue, then the epic.

## 3. Labels

### Type labels (exactly one per issue)

| Label | Meaning |
|---|---|
| `epic` | Business feature container; parent of sub-issues |
| `implementation` | Code work |
| `bug` | Defect — observed vs expected + repro in body |
| `docs` | Documentation-only change |
| `qa` | Testing pass for an epic |

### Status labels (exactly one per open non-epic issue)

| Label | Meaning |
|---|---|
| `backlog` | Ready to pick up, unclaimed |
| `in-progress` | Claimed and being worked (assignee must be set) |
| `review` | PR open, awaiting human review/merge |
| `blocked` | Cannot proceed — explain the blocker in a comment |

Closed = done. There is no `completed` label. Every new issue enters as `backlog` or `blocked`.

### Modifier labels (optional, combine freely)

| Label | Meaning |
|---|---|
| `trivial` | Implementation needs no planning step |
| `priority` | Pick before other backlog items |
| `frontend` / `backend` | Routing hint — which kind of agent should pick it up |

## 4. Status transitions

```text
            ┌──────────► blocked ◄──────────┐
            │               │                │
backlog ────┴──► in-progress ──► review ──► closed
   ▲                │
   └────────────────┘  (work abandoned: unassign + back to backlog)
```

A status change is always a remove-then-add pair so exactly one status label is set:

```bash
gh issue edit <number> --remove-label backlog --add-label in-progress
```

Whoever moves an issue to `blocked` must say why in a comment. Whoever clears the blocker moves it back to `backlog` (or `in-progress` if still assigned).

## 5. Coordination rules

### 5.1 Claiming

1. Read the issue **and its comments** first — they may contain decisions made since creation.
2. If the issue is assigned to someone else, do not touch it. No exceptions without the assignee's (or a human's) explicit hand-off in a comment.
3. Claim atomically: self-assign and flip the status in one step.

```bash
gh issue edit <number> --add-assignee @me --remove-label backlog --add-label in-progress
```

4. If you stop working on a claimed issue without finishing, unassign yourself, return it to `backlog` (or `blocked` with a reason), and post a comment describing the state you left it in.

### 5.2 Communication

- The issue **body** is the source of truth for *what*; **comments** are the log of *what changed since*. Significant scope changes get folded back into the body with a comment noting the edit.
- Every decision that another agent might depend on goes in a comment — model choices, deferred work, discovered constraints.

### 5.3 QA hand-off

When an `implementation` or `bug` PR merges, the implementing agent must:

1. Comment on the epic's `qa` issue with a link to the user-stories doc covering the change (path, see §6).
2. If the `qa` issue is `blocked`, flip it to `backlog`.

This is the only signal QA agents watch — work that skips it is invisible to testing.

### 5.4 Discovering work

```bash
# what is testable right now
gh issue list --state open --label qa,backlog

# unclaimed implementation work, priority first
gh issue list --state open --label implementation,backlog --json number,title,labels

# everything in flight
gh issue list --state open --label in-progress --json number,title,assignees
```

## 6. Artifacts

- **User-stories docs** live at `docs/user-stories/epic-<epic-number>/<issue-number>-<slug>.md` and are committed in the same PR as the implementation. Each doc lists story-based test cases: persona, steps, expected outcome — concrete enough for an agent to execute against the running app.
- Each new doc is linked from `docs/user-stories/index.md` (reachability requirement of `lint-docs`).
- Stable stories may be promoted into the permanent regression suite by the QA agent after a green pass.

## 7. Command reference

Operations with `gh` CLI and REST equivalents (for agents without `gh`). Replace `{repo}` with `eq-lab/pipeline`.

| Operation | gh CLI | REST |
|---|---|---|
| Create issue | `gh issue create --title T --label "implementation,backlog" --body B` | `POST /repos/{repo}/issues` `{title, body, labels}` |
| Edit labels | `gh issue edit N --remove-label A --add-label B` | `DELETE /repos/{repo}/issues/N/labels/A` + `POST /repos/{repo}/issues/N/labels` `{labels:[B]}` |
| Assign | `gh issue edit N --add-assignee @me` | `POST /repos/{repo}/issues/N/assignees` `{assignees:[user]}` |
| Comment | `gh issue comment N --body B` | `POST /repos/{repo}/issues/N/comments` `{body}` |
| Close | `gh issue close N` | `PATCH /repos/{repo}/issues/N` `{state:"closed"}` |
| View + comments | `gh issue view N -c` | `GET /repos/{repo}/issues/N` + `GET /repos/{repo}/issues/N/comments` |

### Sub-issues (epic grouping)

The sub-issue API takes the child's **database ID**, not its number:

```bash
# attach issue <child> to epic <epic>
CHILD_ID=$(gh api repos/eq-lab/pipeline/issues/<child> --jq .id)
gh api repos/eq-lab/pipeline/issues/<epic>/sub_issues -F sub_issue_id="$CHILD_ID"

# list an epic's sub-issues
gh api repos/eq-lab/pipeline/issues/<epic>/sub_issues --jq '.[] | "\(.number) \(.title) [\(.state)]"'

# find an epic's qa sub-issue
gh api repos/eq-lab/pipeline/issues/<epic>/sub_issues \
  --jq '.[] | select(.labels[].name == "qa") | .number'
```

REST: `POST /repos/{repo}/issues/{epic}/sub_issues` `{sub_issue_id}`, `GET /repos/{repo}/issues/{epic}/sub_issues`.

## Appendix: label provisioning

One-time setup for a repo adopting this protocol:

```bash
gh label create epic           --color a66c36 --description "Business feature container" --force
gh label create implementation --color 0E8A16 --description "Code work" --force
gh label create bug            --color d73a4a --description "Something isn't working" --force
gh label create docs           --color 0075ca --description "Documentation-only change" --force
gh label create qa             --color D4C5F9 --description "Testing pass for an epic" --force
gh label create backlog        --color C5DEF5 --description "Ready to pick up, unclaimed" --force
gh label create in-progress    --color FBCA04 --description "Claimed and being worked" --force
gh label create review         --color FEF2C0 --description "PR open, awaiting review" --force
gh label create blocked        --color B60205 --description "Cannot proceed — see comments" --force
gh label create trivial        --color C2E0C6 --description "No planning step needed" --force
gh label create priority       --color FF6B6B --description "Pick before other backlog items" --force
```

Labels retired by this protocol (delete after migration): `planning`, `planned`, `executing`, `executed`, `testing`, `tested`, `enhancement`, `documentation`.
