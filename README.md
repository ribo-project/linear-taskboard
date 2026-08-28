[English](README.md) | [繁體中文](README.zh-TW.md)

# Linear Taskboard for Codex

A Codex-native work surface backed by **Linear**. This project is a fork of the upstream Codex Taskboard and keeps its embedded Codex UI, launcher, Skill, thread binding, worktree support, and project automation while making Linear the authoritative source for project and issue data.

> **Development status:** the Linear integration is implemented on the current development branch and is still being validated with the desktop Codex runtime. This fork does not currently publish an official signed desktop release.

## Why this fork exists

The goal is to remove the manual loop of opening Linear, copying an issue ID, switching to Codex, and telling Codex to start.

The intended workflow is:

```text
Linear
  ↓
Linear adapter / local projection
  ↓
Taskboard inside Codex
  ↓
Codex conversation + repository/worktree
  ↓
Git / GitHub
  ↓
Linear In Review
  ↓
Human review → Done
```

**Linear remains the source of truth.** SQLite is only a local projection/cache plus storage for Codex-only execution metadata such as thread and workspace bindings.

## Current capabilities

### Linear connection and projection

- Connect a Linear workspace with a personal API key or OAuth 2.0.
- Scope synchronization by team/project and optionally to issues assigned to the current Linear user.
- Project each Linear Project into the existing Taskboard project UI.
- Keep Linear issue identifiers such as `RIB-123` visible in the board and detail view.
- Reconcile Linear data into SQLite without turning SQLite into a second editable issue database.
- Synchronize Linear blocker relationships, including cross-project blockers.

### Controlled Linear write-through

The fork currently writes these operations back to Linear:

- workflow/status transitions used by the Codex claim/review flow;
- comments;
- the explicit `codex-ready` label used to authorize automatic execution.

Unsupported Linear fields remain read-only in the Taskboard UI until their write-through path is implemented. In particular, do not treat local title, description, assignee, due-date, relation, or attachment editing as authoritative Linear editing.

### Codex execution binding

Each Linear Project can be mapped to the current Codex project/workspace. The existing Taskboard storage contract is reused for:

- `codexProjectId`;
- `codexProjectKind`;
- `codexHostId`;
- `workspacePath`.

A claimed issue can retain a complete Codex thread binding so that the same conversation can resume work without another conversation silently taking ownership.

### Dependency-aware automation

A Linear Todo is runnable only when the same server-side eligibility rules pass:

```text
status = Todo
AND label contains codex-ready
AND dependency snapshot is complete
AND all blockers are resolved
AND the issue has a valid new-claim or continuation binding state
AND the Linear Project has a usable Codex workspace mapping
```

The automation host distinguishes **Todo exists** from **runnable Todo exists**. If all Todo issues are blocked or not authorized, the expensive Codex cron is paused while the lightweight policy check remains enabled and can resume automation when an issue becomes runnable.

Codex stops at **In Review** by default. Moving an implementation issue to **Done** remains a human review/acceptance action.

## Requirements

For source development:

- Node.js 22.5 or newer.
- Git.
- A Linear account. The bundled public OAuth 2.0 application is used by default; a personal API key remains available as an advanced fallback.
- Codex desktop app when testing the embedded Codex experience.
- Rust 1.88+ and platform build tools only when building the Tauri desktop application.

Platform packaging requirements inherited from upstream still apply to macOS, Windows, and Ubuntu builds.

## Run from source

Install dependencies and build the web assets first:

```powershell
npm ci
npm run build
```

Choose one of the following startup paths. Do not run both at the same time because they use the same local port.

### A. Start the browser Web Taskboard only

This starts the local web server. It does not launch or inject into Codex Desktop.

```powershell
npm start
```

Open <http://127.0.0.1:47823> in a browser.

### B. Show Taskboard in the Codex Desktop sidebar

On Windows, first create the “main Codex + CDP” shortcut with PowerShell 7. This keeps the existing Codex conversations, projects, and settings in the same Codex window for injection.

```powershell
npm run codex:shortcut
```

The command creates `Codex.lnk` on the Desktop. It starts the existing launcher/injector, which opens the main Codex profile with CDP on `127.0.0.1:9231` and starts Taskboard. Drag that shortcut to the taskbar once, then open Codex from the new taskbar icon; you do not need to run `npm run codex`. Windows 11 may not expose a programmatic taskbar-pin action, so the one-time drag is expected.

To run the launcher/injector directly, use:

```powershell
$env:CODEX_TASKBOARD_HOST="127.0.0.1"
npm run codex
```

`npm start` alone does not add a sidebar entry. The Plugin SessionStart hook ensures the resident launcher is running and does not automatically open the Taskboard panel.

### Codex Plugin installation

The repository also includes a local Codex Plugin. Its SessionStart hook ensures that one resident launcher is running; it does not open the Taskboard automatically. The existing launcher/injector adds and repairs the Taskboard entry in the Codex sidebar.

From the repository root, register the repository-local marketplace and install the Plugin:

```powershell
codex plugin marketplace add .
codex plugin add linear-taskboard@personal
```

Start a new Codex session after installation. The Plugin hook may require review and trust before it can ensure the launcher.

By default, local data is stored under `.data/`, including:

```text
.data/taskboard.sqlite
.data/linear-connection.json
```

The Linear credential file is local-only and is written with restrictive permissions where the platform supports them. The API key is never returned to the React UI.

For frontend development:

```bash
npm run dev
```

## Connect Linear

The preferred path is the Taskboard UI:

1. Open the project menu.
2. Choose **Connect Linear** / **Linear Settings**.
3. Choose **Connect with Linear OAuth**; the browser opens Linear and reuses the user's existing login session.
4. Optionally restrict synchronization to specific Team IDs or Project IDs.
5. Choose whether to synchronize only issues assigned to the current Linear user.
6. Synchronize.

The API key is used by the local Taskboard service to call Linear's GraphQL API. It is not stored in issue content, Codex prompts, Git commits, or browser local storage.

OAuth 2.0 is the default connection path. The repository includes the public OAuth application client ID, so users do not need to configure an environment variable. The Taskboard uses Authorization Code + PKCE; after the user approves access in Linear, return to Taskboard and choose **Sync now**.

```powershell
npm run codex
```

The redirect URI is already registered in the public Linear OAuth application. OAuth tokens are stored only in the local config file, refreshed automatically, and never returned to the browser. Do not paste an API key or OAuth token into chat, issues, comments, or commits.

### CLI bootstrap

`linearctl` is also available for local setup and diagnostics:

```bash
LINEAR_API_KEY=... npm run linear -- configure
npm run linear -- status
npm run linear -- sync
npm run linear -- clear
```

Useful scope examples:

```bash
# Include issues beyond those assigned to the current Linear user.
LINEAR_API_KEY=... npm run linear -- configure --all

# Restrict the projection to one or more Linear teams/projects.
LINEAR_API_KEY=... npm run linear -- configure \
  --team-id <LINEAR_TEAM_ID> \
  --project-id <LINEAR_PROJECT_ID>
```

The API key is intentionally read from `LINEAR_API_KEY`; it is not accepted as a command-line flag.

## Prepare a Linear Project for Codex

For each Linear Project that Codex should execute:

1. Open the projected Linear Project in Taskboard.
2. Bind it to the current Codex project/workspace.
3. Put the intended Linear Issue in `Todo`.
4. Open the Issue detail and choose **Allow Codex** to apply the `codex-ready` Linear label.
5. Ensure all blockers are resolved.
6. Enable the existing Project Automation when automatic claim is desired.

`codex-ready` is stored in Linear, not as a local Taskboard flag. Connecting or synchronizing Linear never silently authorizes issues for Codex.

## Codex claim lifecycle

The expected automated lifecycle is:

```text
Todo + codex-ready
        ↓
eligibility recheck
        ↓
claim → Linear In Progress
        ↓
create/resume Codex thread
        ↓
implementation + verification
        ↓
write result comment to Linear
        ↓
Linear In Review
        ↓
human acceptance → Done
```

Claiming uses optimistic versions and binding checks. A stale issue version, incomplete dependency snapshot, unresolved blocker, missing `codex-ready`, or conflicting thread binding fails closed before Linear is mutated.

## Use `taskctl`

The upstream `taskctl` CLI remains the execution interface used by the bundled `manage-taskboard` Skill.

Examples:

```bash
npm run taskctl -- issue list --project <TASKBOARD_PROJECT_ID> --status todo --json
npm run taskctl -- issue get <ISSUE_IDENTIFIER> --json
```

For projected Linear issues, JSON responses include server-calculated execution metadata such as:

- `linearDependencies`;
- `claimEligibility`;
- `continuationEligibility`;
- Codex thread/workspace binding metadata when present.

Agents must use these server-calculated eligibility results instead of recreating Linear dependency logic from local relations.

## Embed in Codex

The fork retains the upstream CDP/launcher integration.

For development:

```bash
CODEX_TASKBOARD_HOST=127.0.0.1 npm run codex
```

To inject into a Codex instance already launched with CDP:

```bash
npm run codex:inject -- --port 9229 --open
```

The launcher keeps the Taskboard service local and uses the existing Codex project/thread route integration. It does not patch Codex application files.

## Desktop builds

This fork currently expects local/CI builds rather than a public signed binary release.

### Windows x64

```powershell
npm ci
npm run app:build:windows
```

### macOS universal

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run app:build
```

### Ubuntu 24.04 x64

```bash
npm ci
npm run app:build:linux:x64
```

Do not use the upstream repository's release downloads as if they were releases of this Linear fork.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_TASKBOARD_HOST` | `0.0.0.0` | HTTP bind address; use `127.0.0.1` for loopback-only access |
| `CODEX_TASKBOARD_PORT` | `47823` | local HTTP port |
| `CODEX_TASKBOARD_TRUSTED_ORIGINS` | unset | exact HTTPS origins accepted through the inherited loopback/tunnel boundary |
| `CODEX_TASKBOARD_DATA_DIR` | `.data` | SQLite and local Linear configuration directory |
| `CODEX_TASKBOARD_URL` | `http://127.0.0.1:47823` | `taskctl` API origin |
| `LINEAR_API_KEY` | unset | credential used by `linearctl configure`; not accepted as a CLI flag |

## Cloud collaboration

The upstream repository includes an optional Cloudflare/D1 collaboration mode. That code remains in this fork for upstream compatibility, but **it is not the authoritative storage path for Linear-backed projects**.

For the current Linear workflow:

- Linear is authoritative for project/issue state;
- the local SQLite database is a projection/cache;
- Codex/device workspace mappings remain device-local;
- do not deploy the upstream D1 mode as a second writable source for projected Linear issues.

See `docs/README.md` for the status of inherited documentation.

## Verify

```bash
npm run check
```

This runs TypeScript checking, the production web build, component tests, and the Node server/CLI/injection test suite. GitHub Actions also builds the supported desktop launcher targets.

## Documentation

- [Traditional Chinese README](README.zh-TW.md)
- [Linear setup and usage (Traditional Chinese)](docs/linear-setup.zh-TW.md)
- [Linear integration architecture](docs/linear-integration-architecture.md)
- [Privacy](PRIVACY.md)
- [Documentation status / inherited docs](docs/README.md)

## Upstream

This project is derived from [`chuspeeism/dashi-taskboard`](https://github.com/chuspeeism/dashi-taskboard) and intentionally keeps large parts of the upstream Codex Taskboard implementation so future upstream updates remain practical.

The fork-specific rule is simple: **Linear owns project-management truth; Taskboard provides the Codex work surface and local execution metadata.**

See [LICENSE](LICENSE) for licensing terms.
