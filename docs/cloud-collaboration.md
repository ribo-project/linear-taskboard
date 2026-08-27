# Cloud collaboration — inherited upstream mode

> **Important for this fork:** this document describes an inherited upstream Cloudflare/D1 collaboration mode. It is **not** the authoritative storage architecture for Linear-backed Projects.

## Current Linear rule

For Linear-backed Projects:

```text
Linear = authoritative Project / Issue data
SQLite = local projection/cache + Codex-only metadata
Codex = execution surface
Git/GitHub = code and PR workflow
```

Do **not** deploy D1 as a second independently writable copy of Linear Issue state.

The current Linear integration has not been designed or validated as a multi-user Cloudflare deployment. It currently assumes a local Taskboard service that owns the Linear credential and device-specific Codex workspace mapping.

## Why this code is still in the repository

The Cloudflare/D1 implementation remains in the tree because this fork intentionally stays close to upstream Codex Taskboard. Keeping upstream subsystems reduces future merge cost and preserves non-Linear features for possible later use.

Its presence does not mean it is part of the supported Linear workflow.

## Inherited cloud architecture

The upstream mode can run a shared Taskboard using:

- Cloudflare Worker Static Assets and API routes;
- D1 for Taskboard-native business data;
- R2 for attachments;
- a Durable Object for revision notifications;
- HTTPS Basic Authentication with a shared secret;
- a device-local companion for Codex/Git/worktree/path mapping.

That model was designed for Taskboard-native Projects where the cloud database is the authoritative Taskboard store.

This conflicts with the Linear fork's core invariant if applied directly to projected Linear Issues, because Linear must remain authoritative.

## What remains device-local

Even if a future Linear-compatible cloud mode is added, these values must remain device-specific unless a separate secure design explicitly changes that rule:

```text
codexProjectId
codexProjectKind
codexHostId
workspacePath
thread/runtime integration state
```

A repository path on one developer machine must never be treated as a shared Linear Project property.

## What a future Linear cloud mode would require

Before cloud collaboration can be considered supported for Linear Projects, the design needs at least:

1. a secure multi-user Linear authorization model, preferably OAuth rather than sharing one Personal API Key;
2. a clear rule for which server owns Linear polling/webhooks;
3. a relay/webhook strategy for Linear updates;
4. per-user/per-device Codex workspace mappings;
5. no second writable PM database;
6. claim locking that remains correct across multiple devices;
7. secret storage and rotation suitable for more than one local user;
8. end-to-end tests covering two devices attempting to claim the same Linear Issue.

Until then, use the local-first Linear mode described in [`../README.md`](../README.md) and [`linear-setup.zh-TW.md`](linear-setup.zh-TW.md).

## Using the inherited cloud mode for non-Linear work

The upstream Cloudflare implementation and its scripts remain available for developers who intentionally work on the inherited non-Linear Taskboard mode.

Relevant commands still exist in `package.json`, including:

```bash
npm run cloud:migrate:local
npm run dev:cloud
npm run cloud:migrate
npm run cloud:deploy:dry-run
npm run cloud:deploy
npm run cloud:data
```

These commands can create or modify Cloudflare resources. They are not part of normal Linear Taskboard setup and should not be run merely to connect Linear.

For the original detailed upstream deployment procedure, consult the corresponding documentation in the upstream [`chuspeeism/dashi-taskboard`](https://github.com/chuspeeism/dashi-taskboard) repository at the version being compared/merged.

## Source-of-truth test

When evaluating any future change to this document or cloud code, ask:

> If Linear and the cloud/local projection disagree, which one wins?

For a Linear-backed Project, the answer must remain:

> **Linear wins.**
