import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TaskboardDatabase } from "../server/database.mjs";
import { installLinearProjection } from "../server/linear-projection.mjs";

async function withDatabase(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-projection-"));
  let database = null;
  try {
    database = new TaskboardDatabase(path.join(directory, "taskboard.sqlite"));
    installLinearProjection(database);
    await run(database);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function issue(overrides = {}) {
  return {
    id: "LINEAR:ORIGIN:issue-1",
    identifier: "LINEAR:ORIGIN:issue-1",
    title: "Implement Linear board",
    description: "Show the issue in Codex.",
    status: "todo",
    priority: "high",
    labels: ["codex-ready"],
    sortOrder: 1024,
    creator: {
      type: "user",
      id: "linear:user-1",
      name: "Owner",
      avatarUrl: null,
    },
    assignee: {
      type: "user",
      id: "linear:user-2",
      name: "Developer",
      avatarUrl: null,
    },
    dueDate: "2026-09-01",
    source: "linear",
    externalOrigin: "origin",
    externalId: "issue-1",
    externalKey: "RIB-100",
    externalUrl: "https://linear.app/example/issue/RIB-100/test",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
    nativeRef: {
      issueId: "issue-1",
      issueIdentifier: "RIB-100",
      stateId: "state-todo",
      stateType: "unstarted",
      teamId: "team-1",
      teamKey: "RIB",
      projectId: "project-1",
      projectName: "Linear Taskboard",
      parentId: null,
      parentIdentifier: null,
    },
    project: {
      id: "linear-project-1",
      externalId: "project-1",
      name: "Linear Taskboard",
      teamId: "team-1",
      teamKey: "RIB",
    },
    ...overrides,
  };
}

function snapshot(issues) {
  return {
    originId: "origin",
    organization: { id: "org-1", name: "Ribo" },
    projects: [{
      id: "linear-project-1",
      externalId: "project-1",
      name: "Linear Taskboard",
      teamId: "team-1",
      teamKey: "RIB",
      source: "linear",
      externalOrigin: "origin",
    }],
    issues,
  };
}

test("Linear projection decorates projected projects and tasks with native refs", async () => {
  await withDatabase(async (database) => {
    await database.syncLinearSnapshot(snapshot([issue()]));

    const project = database.getProject("linear-project-1");
    assert.equal(project.source, "linear");
    assert.equal(project.externalId, "project-1");
    assert.equal(project.nativeRef.organizationId, "org-1");

    const task = database.getTask("LINEAR:ORIGIN:issue-1");
    assert.equal(task.source, "linear");
    assert.equal(task.externalKey, "RIB-100");
    assert.equal(task.nativeRef.issueId, "issue-1");
    assert.equal(task.nativeRef.teamId, "team-1");

    const listed = database.listTasks({ projectId: "linear-project-1" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].source, "linear");
    assert.equal(listed[0].nativeRef.issueIdentifier, "RIB-100");
  });
});

test("Linear projection reconciles authoritative fields without replacing local identity", async () => {
  await withDatabase(async (database) => {
    await database.syncLinearSnapshot(snapshot([issue()]));
    const first = database.getTask("LINEAR:ORIGIN:issue-1");

    await database.syncLinearSnapshot(snapshot([issue({
      title: "Implement Linear board v2",
      status: "in_progress",
      priority: "urgent",
      labels: ["codex-ready", "phase-1"],
      updatedAt: "2026-08-27T00:02:00.000Z",
    })]));

    const second = database.getTask("LINEAR:ORIGIN:issue-1");
    assert.equal(second.id, first.id);
    assert.equal(second.identifier, first.identifier);
    assert.equal(second.title, "Implement Linear board v2");
    assert.equal(second.status, "in_progress");
    assert.equal(second.priority, "urgent");
    assert.deepEqual(second.labels, ["codex-ready", "phase-1"]);
    assert.ok(second.version > first.version);
  });
});

test("Linear projection archives issues missing from an authoritative refresh", async () => {
  await withDatabase(async (database) => {
    await database.syncLinearSnapshot(snapshot([issue()]));
    await database.syncLinearSnapshot(snapshot([]));

    const task = database.getTask("LINEAR:ORIGIN:issue-1");
    assert.equal(task.source, "linear");
    assert.ok(task.archivedAt);
  });
});
