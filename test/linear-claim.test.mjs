import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { linearClaimEligibility } from "../server/linear-claim.mjs";
import { createTaskboardServer } from "../server/index.mjs";

function task(overrides = {}) {
  return {
    source: "linear",
    status: "todo",
    archivedAt: null,
    labels: ["codex-ready"],
    threadId: null,
    threadBinding: null,
    linearDependencies: {
      complete: true,
      blockedBy: [],
      unresolvedCount: 0,
      unblocked: true,
    },
    ...overrides,
  };
}

test("Linear claim eligibility is explicit and fail-closed", () => {
  assert.deepEqual(linearClaimEligibility(task()), {
    eligible: true,
    reasons: [],
  });

  assert.deepEqual(linearClaimEligibility(task({ labels: [] })), {
    eligible: false,
    reasons: ["MISSING_CODEX_READY"],
  });

  assert.deepEqual(linearClaimEligibility(task({
    linearDependencies: {
      complete: true,
      blockedBy: [{ identifier: "RIB-1", resolved: false }],
      unresolvedCount: 1,
      unblocked: false,
    },
  })), {
    eligible: false,
    reasons: ["BLOCKED_BY_DEPENDENCY"],
  });

  assert.deepEqual(linearClaimEligibility(task({
    linearDependencies: {
      complete: false,
      blockedBy: [],
      unresolvedCount: 0,
      unblocked: false,
    },
  })), {
    eligible: false,
    reasons: ["DEPENDENCIES_INCOMPLETE"],
  });
});

test("existing Linear binding is excluded from new claims but allowed for explicit continuation checks", () => {
  const bound = task({
    threadId: "thread-1",
    threadBinding: {
      threadId: "thread-1",
      codexProjectId: "project-1",
      codexProjectKind: "local",
      codexHostId: "local",
      workspacePath: "/workspace/project-1",
    },
  });

  assert.deepEqual(linearClaimEligibility(bound), {
    eligible: false,
    reasons: ["ALREADY_BOUND"],
  });
  assert.deepEqual(linearClaimEligibility(bound, { allowExistingBinding: true }), {
    eligible: true,
    reasons: [],
  });
});

function projectedIssue(overrides = {}) {
  return {
    id: "LINEAR:ORIGIN:issue-1",
    identifier: "LINEAR:ORIGIN:issue-1",
    title: "Ready issue",
    description: "Ready for Codex",
    status: "todo",
    priority: "high",
    labels: ["codex-ready"],
    sortOrder: 1024,
    creator: { type: "user", id: "linear:owner", name: "Owner", avatarUrl: null },
    assignee: { type: "user", id: "linear:dev", name: "Developer", avatarUrl: null },
    dueDate: null,
    source: "linear",
    externalOrigin: "origin",
    externalId: "issue-1",
    externalKey: "RIB-1",
    externalUrl: "https://linear.app/example/issue/RIB-1/ready",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
    linearDependencies: { complete: true, blockedBy: [] },
    nativeRef: {
      issueId: "issue-1",
      issueIdentifier: "RIB-1",
      stateId: "todo",
      stateType: "unstarted",
      teamId: "team-1",
      teamKey: "RIB",
      projectId: "project-1",
      projectName: "Project",
      parentId: null,
      parentIdentifier: null,
      dependenciesComplete: true,
    },
    project: {
      id: "linear-project-1",
      externalId: "project-1",
      name: "Project",
      teamId: "team-1",
      teamKey: "RIB",
    },
    ...overrides,
  };
}

test("Taskboard task reads expose server-computed claimEligibility for Linear projections", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-claim-decoration-"));
  const app = createTaskboardServer({ dataDirectory: directory });
  try {
    await app.database.syncLinearSnapshot({
      originId: "origin",
      organization: { id: "org-1", name: "RIB" },
      projects: [{
        id: "linear-project-1",
        externalId: "project-1",
        name: "Project",
        teamId: "team-1",
        teamKey: "RIB",
      }],
      issues: [projectedIssue()],
    });

    const single = app.database.getTask("LINEAR:ORIGIN:issue-1");
    assert.deepEqual(single.claimEligibility, { eligible: true, reasons: [] });

    const listed = app.database.listTasks({ projectId: "linear-project-1", status: "todo" });
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0].claimEligibility, { eligible: true, reasons: [] });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
