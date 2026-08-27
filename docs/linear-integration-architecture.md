# Linear-backed Codex Taskboard Architecture

## Purpose

This fork turns the upstream Codex Taskboard into a Codex-native Linear work surface.

The target experience is:

1. Open Codex.
2. Open Taskboard inside Codex.
3. See projected Linear Projects and Issues.
4. Map a Linear Project to the current Codex workspace.
5. Explicitly authorize an Issue with `codex-ready`.
6. Let Project Automation claim only runnable work.
7. Write execution progress/results back to Linear.
8. Stop at `In Review` for human acceptance.

## Core invariant

**Linear is the authoritative project-management source for Linear-backed projects.**

The local SQLite database is not a second PM database. It is used for:

- a local projection/cache of Linear Project and Issue data;
- Codex thread binding;
- device-specific Codex project/workspace mapping;
- local runtime metadata;
- upstream Taskboard features that do not have a Linear equivalent.

For Linear-backed Issues, a successful local-looking change must never be treated as authoritative unless the corresponding Linear write succeeds.

## High-level architecture

```text
Linear GraphQL API
       ↓
Linear client
       ↓
Linear integration / mapping
       ↓
SQLite projection decorator
       ↓
Existing Taskboard server/API/UI
       ↓
Existing Codex launcher / injection / Skill / automation
       ↓
Codex project + thread + worktree
       ↓
Git / GitHub
       ↓
Linear comment + In Review
```

## What is preserved from upstream

The fork intentionally keeps the upstream implementation wherever possible:

- React board/list/detail UI;
- local Taskboard HTTP service;
- `taskctl` CLI;
- `manage-taskboard` Skill;
- Codex launcher and CDP integration;
- issue-to-Codex routing;
- thread binding;
- branch/worktree support;
- Project Automation;
- quota-aware automation controls;
- Tauri packaging for Windows/macOS/Linux;
- Markdown and existing local Taskboard capabilities.

Linear-specific behavior is added around these boundaries instead of rewriting the product.

## Source types

The shared source model supports:

```text
local
jira
linear
```

Linear uses a dedicated external projection while preserving the generic Taskboard shape exposed to the UI and CLI.

## Linear connection

The initial implementation is single-user/local-first and uses a Linear Personal API Key.

The credential is:

- accepted only by the local service / `linearctl` setup path;
- stored in the Taskboard data directory;
- written atomically;
- restricted to mode `0600` where supported;
- never returned to the React UI;
- never placed in Issue content, comments, Codex prompts, or Git commits.

The stored connection config includes optional Team / Project scope and whether synchronization should be limited to Issues assigned to the current Linear user.

Future multi-user distribution may add OAuth, but OAuth is not required for the current local prototype.

## Linear project projection

Each Linear Project becomes its own Taskboard Project projection.

This is required because Project-level Codex workspace mapping and Project Automation must remain meaningful across multiple repositories.

A projected Issue keeps provider-native metadata such as:

```text
issueId
issueIdentifier
teamId
teamKey
projectId
projectName
stateId
stateType
parentId
parentIdentifier
```

These values are used for write-through and must not be inferred from display strings.

## Synchronization

The current desktop flow uses conservative synchronization rather than aggressive polling:

- initial sync;
- manual sync;
- periodic refresh where appropriate.

The Linear client uses cursor pagination and handles GraphQL `errors` independently of HTTP status.

A production multi-user mode can later add webhooks when a reachable HTTPS endpoint exists.

## Status mapping

Linear workflow types are mapped into Taskboard canonical states.

| Linear | Taskboard |
| --- | --- |
| Backlog / Triage | `backlog` |
| Unstarted | `todo` |
| Started: ordinary | `in_progress` |
| Started: review/test/verification naming | `in_review` |
| Started: blocked/hold/waiting naming | `blocked` |
| Completed | `done` |
| Canceled / Duplicate | `canceled` |

When Taskboard writes a state back to Linear, it resolves the destination against that Issue's Team workflow states. Workflow-state IDs are never assumed to be shared across Teams.

The current RIB workflow observed during implementation contains:

```text
Backlog
Todo
In Progress
In Review
Done
Canceled
Duplicate
```

## Priority mapping

The normalization layer uses Linear's numeric priority mapping:

| Linear | Taskboard |
| ---: | --- |
| 0 | `none` |
| 1 | `urgent` |
| 2 | `high` |
| 3 | `medium` |
| 4 | `low` |

A lower-level priority write-through helper exists, but the current Linear UI does not expose general property editing as an authoritative Linear editing surface yet.

## Comments

Linear comments are read from Linear when needed and created directly in Linear.

They are not maintained as a second independently editable comment database for projected Issues.

Codex uses Linear comments to report implementation summary, verification results, PR information, and remaining risks.

## `codex-ready`

Automatic execution authorization is represented by a real Linear Label:

```text
codex-ready
```

The Label is not a local Taskboard flag.

When the user explicitly chooses **Allow Codex**:

1. reuse an existing `codex-ready` Label case-insensitively when present;
2. otherwise create it in Linear;
3. add it incrementally to the Issue without overwriting other Labels;
4. reconcile the projection.

When the user chooses **Disable Codex**:

1. remove only `codex-ready` when it exists;
2. do not create the Label merely to disable it;
3. keep unrelated Labels unchanged;
4. reconcile the projection.

Connecting or synchronizing Linear never silently applies `codex-ready`.

## Dependency model

Linear native Issue relations are authoritative for blockers.

The projection stores dependency metadata separately from the upstream local relation model because Linear blockers can cross Project or Team boundaries.

A projected Linear Issue includes a dependency snapshot with enough information to determine whether blockers are resolved.

### Fail-closed rule

If blocker relation pagination/synchronization is incomplete, the dependency snapshot is marked incomplete and the Issue is **not claimable**.

The system never converts "dependency data unavailable" into "no blockers".

## Claim eligibility

The server calculates claim eligibility rather than asking the Skill or prompt to reconstruct it.

For a new Linear claim, the Task JSON contains:

```json
{
  "claimEligibility": {
    "eligible": true,
    "reasons": []
  }
}
```

New-claim eligibility requires at minimum:

```text
source = linear
status = todo
codex-ready present
dependency snapshot complete
all blockers resolved
not archived
no existing/conflicting binding
```

Possible fail-closed reasons include:

```text
STATUS_NOT_TODO
MISSING_CODEX_READY
DEPENDENCIES_INCOMPLETE
BLOCKED_BY_DEPENDENCY
ALREADY_BOUND
ARCHIVED
```

## Continuation eligibility

An Issue that already has a complete Codex binding must not be rejected merely because it is already bound.

For that case the server exposes:

```json
{
  "continuationEligibility": {
    "eligible": true,
    "reasons": []
  }
}
```

Continuation still requires `codex-ready`, complete dependency data, clear blockers, and valid Todo state while the continuation is being re-acquired.

A complete binding contains:

```text
threadId
codexProjectId
codexProjectKind
codexHostId
workspacePath
```

The runnable-Todo policy additionally rejects a task when the top-level `threadId` disagrees with `threadBinding.threadId`.

## Codex workspace mapping

Each projected Linear Project can be mapped to the current Codex project/workspace.

The fork reuses the upstream storage contract instead of introducing another mapping database:

```text
taskboard.projectCodexIdentities.v1
taskboard.deviceWorkspacePaths.v1
```

The mapping supports local and remote/SSH Codex projects by retaining:

```text
codexProjectId
codexProjectKind
codexHostId
workspacePath
```

## Claim write-through

The critical transition is `Todo → In Progress`.

Before Linear is mutated, the server rechecks:

- optimistic version;
- current eligibility;
- dependency completeness;
- unresolved blockers;
- `codex-ready`;
- binding consistency.

A stale version or invalid gate returns a conflict before calling Linear.

After a successful Linear state mutation, the projection is reconciled.

## Skill behavior

The bundled `manage-taskboard` Skill is Linear-aware.

For Linear Issues it treats server-calculated eligibility as authoritative:

- unbound Issue → `claimEligibility`;
- bound continuation → `continuationEligibility`.

It does not override a false server result by reinterpreting local Taskboard relations.

The Skill still preserves the upstream lifecycle rules:

- do not execute Backlog work;
- claim before implementation;
- use optimistic versions;
- preserve complete bindings;
- verify and report work;
- finish at `In Review` by default;
- do not autonomously mark implementation work `Done` without explicit acceptance policy.

## Automation selection

The automation prompt is source-aware:

```text
Linear + unbound
→ claimEligibility.eligible

Linear + complete existing binding
→ continuationEligibility.eligible

Non-Linear
→ existing local relations.blockedBy behavior
```

The Issue is read again immediately before the claim transition so the automation cannot rely only on an earlier list snapshot.

## Runnable Todo policy

The upstream automation host originally distinguished only whether any Todo existed.

This fork adds:

```text
hasTodo
hasRunnableTodo
```

For Linear:

- unbound → runnable only when `claimEligibility.eligible === true`;
- complete bound continuation → runnable only when `continuationEligibility.eligible === true`;
- missing/incomplete/mismatched binding → fail closed.

For non-Linear tasks, the existing local blocker rule remains.

### Temporary automation pause

When Todo exists but none is runnable:

```text
hasTodo = true
hasRunnableTodo = false
```

the expensive Codex automation is paused with a temporary `no-runnable` reason.

This pause **does not set `enabledByUser = false`**.

The lightweight policy timer keeps checking and can resume the Codex automation when work becomes runnable.

Temporary pause reasons are persisted so a restart does not confuse a policy pause with a user-disabled automation.

Quota pauses, no-Todo behavior, and externally/manual paused automation keep separate semantics.

## Linear UI contract

Projected Linear Projects are labeled:

```text
Linear · Source
```

The UI exposes supported controlled operations such as:

- Linear connection/sync;
- Codex workspace mapping;
- `Allow Codex` / `Disable Codex`;
- comment flow;
- opening/resuming Codex work.

Local task creation is hidden for Linear-backed Projects.

Fields without complete Linear write-through are presented as read-only so the UI does not imply that a local-only edit has changed Linear.

## Current end-to-end lifecycle

```text
Linear Todo
  + codex-ready
  + dependencies clear
  + workspace mapped
        ↓
hasRunnableTodo = true
        ↓
Project Automation
        ↓
re-read Issue
        ↓
claim gate
        ↓
Linear In Progress
        ↓
create/resume Codex thread
        ↓
implementation + verification
        ↓
Linear result comment
        ↓
Linear In Review
        ↓
human review
        ↓
Done
```

## Current implementation status

### Implemented

- [x] Linear config store.
- [x] Linear GraphQL client.
- [x] Linear Project/Issue projection.
- [x] Linear connection and sync UI.
- [x] `linearctl` setup/sync/status/clear CLI.
- [x] Team-specific status resolution.
- [x] Linear comments.
- [x] `codex-ready` write-through.
- [x] Linear blocker projection including cross-Project blockers.
- [x] fail-closed dependency completeness.
- [x] `claimEligibility`.
- [x] `continuationEligibility`.
- [x] server-side claim gate before Linear mutation.
- [x] Codex Project/workspace mapping.
- [x] Linear-aware Skill selection rules.
- [x] source-aware automation prompt.
- [x] runnable-Todo automation host policy.
- [x] temporary automation pause/resume semantics.
- [x] controlled read-only UI for unsupported Linear mutations.

### Still pending / intentionally incomplete

- [ ] First complete Windows Codex Desktop smoke test of the real Linear → Codex → Linear workflow.
- [ ] General UI write-through for title/description/assignee/due date/relations/attachments.
- [ ] OAuth/multi-user authorization.
- [ ] Webhook/relay synchronization.
- [ ] Fork-specific signed desktop release process.
- [ ] broader production hardening after local desktop validation.

## Cloud mode

The upstream repository contains a Cloudflare/D1 collaboration mode. It remains in the tree for upstream compatibility, but it is not the current authoritative architecture for Linear-backed Projects.

Do not introduce a second writable D1 copy of Linear Issue truth.

## Non-goals

- replacing Linear as PM;
- creating a second authoritative issue database;
- automatically merging PRs;
- marking all work `Done` without human review;
- public SaaS hosting in the current phase;
- Symphony/multi-worker orchestration before the single-worker flow is proven;
- replacing GitHub as the code/PR system.

## Upstream maintenance rule

Keep the fork as close to upstream as practical.

Prefer:

1. Linear-specific modules;
2. decorators/adapters around upstream boundaries;
3. narrow source-aware changes;
4. focused regression tests for modified boundaries.

Avoid broad renaming or UI rewrites that make future upstream merges unnecessarily difficult.
