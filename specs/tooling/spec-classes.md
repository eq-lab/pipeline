Status: approved

# Spec classes

Every spec is a requirement: the code must satisfy it, and the ratchet (`specs/passing`) and the regression check apply to each one. The classes differ in one thing: who may change a spec.

- **Class A** (the default, everything outside `specs/flex/`): money, rights and roles, data and deletion, security, external actions (sending, publishing), approvals and confirmations. Only a human changes it: hash in `specs/approved`, `yarn spec:approve`. An agent does not edit an approved class A spec, does not touch `specs/approved`, and does not remove the `specs/passing` lines of those specs.
- **Class B** (flexible: an agent may change it, the owner gets a notification): everything that is NOT money, rights and roles, data and deletion, security, external actions (sending, publishing), approvals and confirmations. The class follows meaning, not interface: UI (wording, card content, service lines in chat, order), thresholds and parameters (retention, limits, timeouts, retries, "overdue after N days"), heuristics and ranking (what to show first), service matters (log and metric formats, file names, background schedules), non-interface templates and prompts. Files live under `specs/flex/` (subfolders allowed: `specs/flex/ux/views/decide.md`, `specs/flex/tuning/`). An agent may edit, add and remove class B scenarios in the same PR as the code; no human approval is needed, and a class B spec has no hash in `specs/approved`. The change is visible in the PR by its `specs/flex/` path; the owner gets a notification with the diff, without buttons (the mechanism is separate devops work). When in doubt, class A.
- A file is entirely one class: a mixed file is split into a class A file and a class B file.
- Moving a spec between classes is a class A change, made by the owner. Deleting an approved class A file already fails the hash check (the file listed in `specs/approved` does not exist), so a move from A to B is closed by itself; a class B spec that contradicts a class A spec simply makes the check red.

Below is the contract of the check (`Verify`: files with their status and hash state, lines of `specs/approved`, `specs/passing`, scenarios) and of the command (`Approve`).

## A class A spec with a matching hash is fine

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/system/agent-runs.md, status: approved, hash: match }
  approved: [specs/system/agent-runs.md]
when:
  Verify: {}
then:
  problems: []
```

## Editing an approved class A spec is an error

An agent cannot edit a class A spec: the hash does not match until the owner approves it again.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/system/agent-runs.md, status: approved, hash: differs }
  approved: [specs/system/agent-runs.md]
when:
  Verify: {}
then:
  problems:
    - { path: specs/system/agent-runs.md, code: changed }
```

## An approved class A spec without a hash is an error

An agent cannot declare a class A spec approved by itself.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/system/new.md, status: approved, hash: none }
  approved: []
when:
  Verify: {}
then:
  problems:
    - { path: specs/system/new.md, code: unapproved }
```

## A class B spec is approved without a hash and the agent edits it freely

Under `specs/flex/` the status `approved` needs no hash: a file an agent created or changed stays a requirement without a human.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: none }
  approved: []
when:
  Verify: {}
then:
  problems: []
```

## A class B spec in specs/approved is an error

Only the owner changes a file's class: a line of a class B file in `specs/approved` is a half-done move, not an approval.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: match }
  approved: [specs/flex/views/decide.md]
when:
  Verify: {}
then:
  problems:
    - { path: specs/flex/views/decide.md, code: class_mismatch }
```

## A deleted approved class A file is an error

This closes moving a class A spec to B and silent deletion: the line in `specs/approved` stays, the file is gone.

```spec
adapter: spec-classes
given_response:
  files: []
  approved: [specs/confirmations/external-actions.md]
when:
  Verify: {}
then:
  problems:
    - { path: specs/confirmations/external-actions.md, code: listed_missing }
```

## A deleted class A scenario leaving its line in passing is an error

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/tasks/tasks.md, status: approved, hash: match }
  approved: [specs/tasks/tasks.md]
  scenarios: []
  passing: ["specs/tasks/tasks.md#A human creates a task without a due date"]
when:
  Verify: {}
then:
  problems:
    - { path: specs/tasks/tasks.md, code: stale_passing }
```

## A deleted class B scenario leaves no line in passing

An agent deleting a class B scenario also removes its line in `specs/passing` (or `yarn spec:ratchet` does); for class B specs such a line without a scenario is not an error.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: none }
  approved: []
  scenarios: []
  passing: ["specs/flex/views/decide.md#Content plan and priority change"]
when:
  Verify: {}
then:
  problems: []
```

## A class B regression is an error, as for class A

A class B spec stays a requirement: a scenario that was green once and turned red fails the check.

```spec
adapter: spec-classes
given_response:
  files:
    - { path: specs/flex/views/decide.md, status: approved, hash: none }
  approved: []
  scenarios:
    - { path: specs/flex/views/decide.md, name: Card, red: true }
  passing: ["specs/flex/views/decide.md#Card"]
when:
  Verify: {}
then:
  problems:
    - { path: specs/flex/views/decide.md, code: regression }
```

## Approving a class B spec is not needed

`yarn spec:approve` refuses a path under `specs/flex/`: there is nothing to approve, the agent edits the spec.

```spec
adapter: spec-classes
given_response: {}
when:
  Approve: { path: specs/flex/views/decide.md }
then:
  rejected: class_b_not_approved
```

## Approving a class A spec works as before

```spec
adapter: spec-classes
given_response: {}
when:
  Approve: { path: specs/tasks/tasks.md }
then:
  approved: true
```
