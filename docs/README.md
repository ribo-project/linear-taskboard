# Documentation status

This fork keeps a substantial amount of upstream Codex Taskboard code so that upstream updates remain practical. Not every inherited document describes the current Linear-backed product mode.

## Current fork documentation

These documents describe the current direction and should be treated as authoritative for this fork:

- [`../README.md`](../README.md) — product overview, setup, current behavior, and build instructions.
- [`../README.zh-TW.md`](../README.zh-TW.md) — Traditional Chinese product overview and setup.
- [`linear-setup.zh-TW.md`](linear-setup.zh-TW.md) — detailed Traditional Chinese Linear setup and operating guide.
- [`linear-integration-architecture.md`](linear-integration-architecture.md) — current source-of-truth, projection, claim, dependency, and automation architecture.
- [`../PRIVACY.md`](../PRIVACY.md) — local storage and network behavior including Linear.
- [`code-signing-policy.md`](code-signing-policy.md) — signing status of this fork.

## Inherited / compatibility documentation

The following files describe upstream features that are still present in the repository but are **not the primary operating model for Linear-backed projects**:

- `cloud-collaboration.md` — upstream Cloudflare/D1 collaboration mode. Do not use D1 as a second authoritative writable store for projected Linear issues.
- `consumer-task-board-chatgpt-pro-review.md` — upstream/historical review notes, not the current product specification.
- `windows-uninstall.md` — Windows uninstall/data-retention behavior inherited from the desktop package and still relevant when building the current app.

## Source-of-truth rule

For Linear-backed projects:

```text
Linear = authoritative PM/project/issue data
SQLite = local projection/cache + Codex-only runtime metadata
Codex = execution surface
Git/GitHub = code and PR workflow
```

Any inherited document that contradicts this rule is not authoritative for the Linear integration.

## Current development boundary

The current branch implements Linear connection, projection, dependency-aware eligibility, controlled write-through, Codex workspace/thread mapping, `codex-ready`, and runnable-Todo automation policy.

The main remaining validation gate is a real desktop Codex smoke test of the complete flow:

```text
Linear Todo + codex-ready
→ claim
→ Linear In Progress
→ Codex execution
→ Linear comment
→ In Review
```

Human acceptance remains the default gate for `Done`.
