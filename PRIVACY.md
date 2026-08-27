# Privacy

Linear Taskboard for Codex is a local-first application derived from the upstream Codex Taskboard.

This fork does not send Taskboard usage telemetry to the fork maintainer.

## Local data

The local Taskboard runtime stores data required for the UI, projection cache, launcher/runtime state, and Codex execution bindings.

Typical source-checkout data is stored under:

```text
.data/taskboard.sqlite
.data/linear-connection.json
```

Desktop package paths inherited from upstream may use the platform application-data directory instead.

Examples:

- Windows data: `%APPDATA%\Codex Taskboard`
- Windows launcher logs: `%LOCALAPPDATA%\Codex Taskboard\Logs`
- macOS data: `~/Library/Application Support/Codex Taskboard`
- macOS logs: `~/Library/Logs/Codex Taskboard`

The bundled `manage-taskboard` Skill may also be installed into the current user's `.agents/skills/manage-taskboard` directory by the desktop launcher.

## Linear credential

The current single-user integration uses a Linear Personal API Key.

The key is:

- stored only in the local Linear connection config;
- written atomically;
- restricted to mode `0600` where supported;
- never returned to the React UI;
- never intentionally written to Issue descriptions, comments, Codex prompts, Git commits, or browser local storage;
- read from `LINEAR_API_KEY` when using `linearctl configure` from the command line.

Clearing the Linear connection removes the local stored connection credential.

## Network activity

The application may make network requests to services required by features the user explicitly uses:

### Linear

The local Taskboard service calls Linear's GraphQL API to:

- validate the configured account/workspace;
- read Projects, Issues, workflow states, labels, blockers, and comments;
- write supported status transitions;
- create comments;
- add/remove the `codex-ready` Label;
- perform other explicitly supported Linear write-through operations.

Linear-backed Project/Issue data remains authoritative in Linear. SQLite is a local projection/cache and does not replace Linear as the PM database.

### OpenAI / Codex

The official Codex application and related Codex services use OpenAI services under the user's existing OpenAI account and applicable OpenAI terms.

This fork stores local Codex execution metadata such as thread/workspace bindings so a Linear Issue can be routed back to the correct Codex context.

### GitHub

GitHub may be contacted by inherited update/release features, development workflows, or the user's Git/PR workflow. This fork currently does not publish an official signed desktop release.

### Optional inherited cloud mode

The upstream codebase includes an optional Cloudflare/D1 collaboration mode. It is not the authoritative storage model for Linear-backed Projects in this fork.

Users must not configure that inherited mode as a second independently writable source of Linear Issue truth.

## Local HTTP service

The desktop/embedded experience uses a local HTTP service to connect the Taskboard UI, launcher, and `taskctl`.

For the strongest local-only posture, bind the service to loopback (`127.0.0.1`).

LAN/tunnel features inherited from upstream should be enabled only on trusted networks and with the documented deployment boundary.

## No advertising or maintainer analytics

This fork does not include advertising or a fork-maintainer analytics service.

## Removing local data

Removing the desktop application may leave user data and the installed Skill, depending on the inherited platform installer behavior.

See [Windows uninstall](docs/windows-uninstall.md) for the current Windows retained-data behavior.

For a source checkout, removing the configured Taskboard data directory removes the local SQLite projection/runtime data and Linear connection config. This does not delete data stored in Linear, GitHub, or OpenAI services.
