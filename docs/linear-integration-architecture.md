# Linear-backed Codex Taskboard Architecture

## Purpose

This fork turns Codex Taskboard into a Codex-native Linear work surface.

The target experience is:

1. Open Codex.
2. Open the Linear Taskboard entry inside Codex.
3. See Linear projects and issues without switching applications.
4. Open an issue and start or resume the matching Codex conversation.
5. Let Codex update implementation progress back to Linear.
6. Keep human review as the default completion gate.

The project must **not** become another project-management source of truth.

## Core invariant

**Linear is the authoritative source for project and issue data.**

Local SQLite may keep a projection/cache for UI performance, Codex thread binding, device workspace mapping, and transient runtime metadata. It must never become an independently editable copy of Linear issue state.

For Linear-backed issues:

- title, description, state, priority, labels, due date, assignee, project, relations, and comments originate in Linear;
- edits to supported fields are write-through operations to Linear;
- a failed Linear mutation must not be committed locally as if it succeeded;
- reconciliation must overwrite stale cached Linear fields with the current Linear representation;
- Codex-specific metadata that has no Linear equivalent may remain local.

## What we keep from upstream

The fork should preserve as much of the upstream product as possible:

- Codex launcher and CDP integration;
- embedded Taskboard entry inside the Codex UI;
- React board/list/detail UI;
- issue-to-Codex conversation routing;
- Codex thread binding;
- branch/worktree selection;
- local AI chat integration;
- project automation / auto-claim controls;
- Windows/macOS/Linux packaging;
- Markdown rendering and attachments where applicable;
- optimistic local version handling for Codex-only metadata.

Keeping these pieces is the main reason to adapt the existing project instead of rebuilding a new UI from scratch.

## What changes

### Source model

The current source model supports local issues and Jira-backed issues. Linear will be added as a first-class external source.

Target source types:

```text
local
jira
linear
```

Longer term, external trackers should use a common adapter contract instead of source-specific branches throughout the UI and database.

### Linear projects

Unlike the current Jira integration, Linear should not be flattened into one global project.

Each Linear Project should become a Taskboard project projection so that:

- project switching in Codex matches Linear;
- a Linear project can be mapped to the correct local repository/workspace;
- project-specific Codex automation settings remain meaningful;
- multiple codebases can coexist in the same Linear workspace.

Issues without a Linear project may be placed in a stable synthetic project such as `Linear · No project`.

### Native reference metadata

A Linear issue needs provider-native metadata that the generic Taskboard model cannot safely infer:

```text
issueId
issueIdentifier
organizationId/originId
teamId
teamKey
projectId
projectName
stateId
stateType
parentId
parentIdentifier
```

This metadata is required for correct write-through mutations, workflow-state resolution, project mapping, and later dependency handling.

It must not be encoded only into display strings.

## Authentication

### Phase 1: Personal API key

For the initial single-user/local prototype:

- use a Linear personal API key;
- store it only in the local Taskboard data directory;
- write the config atomically;
- set the config file to mode `0600` where supported;
- never send the API key to the React web UI;
- never place the key in issue descriptions, comments, logs, Git commits, or Codex prompts.

This mirrors the local-only credential posture already used by the Jira connection.

### Later: OAuth

Before distributing this to multiple users, replace or supplement personal API keys with Linear OAuth 2.0.

OAuth should be preferred for multi-user installations and should use the smallest practical scopes. Agent/app actor authorization should be considered when we want Linear mutations to be visibly attributed to the integration rather than a human user.

## Synchronization strategy

### Initial prototype

The first implementation can use explicit/manual refresh plus a conservative refresh interval.

The client must:

- use cursor pagination;
- handle GraphQL `errors` even when HTTP status is 200;
- recognize rate-limit errors;
- avoid one-request-per-issue patterns;
- filter by configured teams/projects after fetching when necessary.

### Production direction

Linear explicitly recommends avoiding aggressive polling. A production-ready version should move toward webhooks for issue/comment/label changes when a reachable HTTPS endpoint is available.

Local-only desktop mode cannot receive Linear webhooks directly without a public relay/tunnel, so polling/manual refresh remains a valid fallback for the desktop prototype.

## Linear → Taskboard status mapping

Linear workflow categories are broader than Taskboard's canonical states.

Default mapping:

| Linear | Taskboard |
| --- | --- |
| Backlog / Triage | `backlog` |
| Unstarted | `todo` |
| Started: ordinary | `in_progress` |
| Started: review/test/verification naming | `in_review` |
| Started: blocked/hold/waiting naming | `blocked` |
| Completed | `done` |
| Canceled / Duplicate | `canceled` |

The adapter should prefer Linear's workflow `type` and use status names only to distinguish Taskboard sub-states such as `in_review` and `blocked` inside Linear's broader `started` category.

When writing a Taskboard state back to Linear, resolve the destination against that issue's team workflow states. Never assume workflow-state UUIDs are shared across teams.

## Priority mapping

| Linear numeric priority | Taskboard |
| ---: | --- |
| 0 | `none` |
| 1 | `urgent` |
| 2 | `high` |
| 3 | `medium` |
| 4 | `low` |

## Codex thread binding

Thread binding stays local because it represents the relationship between a device's Codex environment and a Linear issue.

The issue projection should retain:

```text
threadId
codexProjectId
codexProjectKind
codexHostId
workspacePath
```

The first Codex session that claims an issue owns that binding until it hands off, stops, or is explicitly replaced by the user. This prevents two Codex conversations from silently working the same issue.

The Linear issue itself should receive human-readable progress comments and PR links, not opaque local thread identifiers unless there is a clear user-facing reason.

## Start-in-Codex flow

Target interaction:

```text
Linear issue in embedded board
        ↓
Start in Codex
        ↓
Resolve Linear project → local Codex project/workspace
        ↓
Create/open Codex conversation
        ↓
Bind issue ↔ thread
        ↓
Move eligible issue to Linear Started/In Progress
        ↓
Load issue + latest comments + repo instructions
        ↓
Implement and validate
        ↓
Write result/PR/test evidence to Linear
        ↓
Move issue to In Review
        ↓
Human accepts → Done
```

Default policy: Codex does not autonomously mark an implementation issue Done unless the user explicitly enables that behavior later.

## Automation direction

The upstream project already contains project-level Auto-claim controls with interval, model, reasoning effort, pause state, and quota awareness. Reuse this before introducing a separate dispatcher service.

Target automatic eligibility policy:

```text
source = linear
AND status = todo
AND label contains codex-ready
AND all blocking issues are completed/canceled as appropriate
AND project has a valid Codex workspace mapping
AND issue has no active thread binding owned by another run
```

When eligible, automation may start a Codex task and move the Linear issue into the team's first applicable Started/In Progress state.

This keeps the architecture simple:

```text
Linear
  ↓
Linear adapter / projection
  ↓
Existing Taskboard UI + existing project automation
  ↓
Codex
  ↓
Git / GitHub
  ↓
Linear In Review
```

OpenAI Symphony remains an optional future path if we need a long-running multi-worker orchestrator. It is not required for the first useful version.

## Implementation phases

### Phase 0 — Foundation

- [x] Fork upstream as `ribo-project/linear-taskboard`.
- [x] Add a dedicated development branch.
- [x] Add local Linear connection config store.
- [x] Add a minimal Linear GraphQL client.
- [x] Add workflow/priority normalization helpers.
- [x] Add unit tests for the new independent modules.
- [x] Document source-of-truth and integration boundaries.

### Phase 1 — Read-only Linear board

- [ ] Add `linear` as a supported source in shared/web types.
- [ ] Add database projection tables/columns for Linear native refs.
- [ ] Add `syncLinearSnapshot` (or generic external-tracker sync) to the database layer.
- [ ] Create one Taskboard project projection per Linear Project.
- [ ] Add a synthetic project for issues with no Linear project.
- [ ] Add local server routes for connection status/configuration/sync.
- [ ] Add a Linear connection UI.
- [ ] Show Linear projects/issues in the existing Codex Taskboard UI.
- [ ] Disable unsupported local-only issue mutations until write-through exists.

Acceptance gate: a local user can connect Linear, refresh, switch among Linear projects, open issues, and follow links without creating a divergent local copy.

### Phase 2 — Write-through issue operations

- [ ] Status update with team-specific workflow resolution.
- [ ] Priority update.
- [ ] Title/description update.
- [ ] Due date update.
- [ ] Comment create/read synchronization.
- [ ] Label mutation after label-ID resolution rules are defined.
- [ ] Reconcile after every successful write.

Acceptance gate: supported edits made in Codex appear in Linear and survive a full resync with no local divergence.

### Phase 3 — Codex execution binding

- [ ] Map Linear project → Codex project/workspace.
- [ ] Start/resume Codex conversation from a Linear issue.
- [ ] Persist thread binding locally.
- [ ] Move issue to In Progress on successful claim.
- [ ] Load issue/comments into the execution prompt/skill.
- [ ] Post implementation/test/PR result back to Linear.
- [ ] Move completed worker result to In Review.

Acceptance gate: the manual "go to Linear, copy the issue ID, tell Codex to start" step is eliminated.

### Phase 4 — Auto-claim

- [ ] Reuse existing Project Automation UI.
- [ ] Add `codex-ready` eligibility filter.
- [ ] Add dependency/blocker check.
- [ ] Add duplicate claim protection.
- [ ] Add failure/backoff policy.
- [ ] Keep human review as the default final gate.

Acceptance gate: approved Linear issues can progress from Todo to a Codex run and then to In Review without manual prompting.

### Phase 5 — Distribution / multi-user hardening

- [ ] OAuth 2.0.
- [ ] Optional app actor authorization.
- [ ] Webhook/relay strategy.
- [ ] Secret redaction tests.
- [ ] Signed Windows/macOS releases as required.
- [ ] Upstream sync strategy and conflict policy.

## Non-goals for the first version

- replacing Linear project management;
- creating a new cloud control plane;
- maintaining a second authoritative issue database;
- automatically merging PRs;
- automatically marking every issue Done;
- multi-agent orchestration across many hosts;
- public SaaS hosting;
- replacing GitHub as the code/PR system.

## Upstream maintenance rule

Keep the fork as close to upstream as practical.

Prefer:

1. new Linear-specific modules;
2. a small generic adapter interface;
3. narrow source-aware changes in database/API/UI code;
4. tests around every modified upstream boundary.

Avoid broad renaming or visual rewrites until the Linear workflow is stable. This will make future upstream merges significantly easier.
