import assert from "node:assert/strict";
import test from "node:test";

import { installLinearClaimDecoration } from "../server/linear-claim-decoration.mjs";

function makeLinearTask(overrides = {}) {
  return {
    id: "task-1",
    source: "linear",
    status: "todo",
    labels: ["codex-ready"],
    archivedAt: null,
    threadId: null,
    threadBinding: null,
    linearDependencies: {
      complete: true,
      unblocked: true,
      unresolvedCount: 0,
      blockedBy: [],
    },
    ...overrides,
  };
}

function decoratedDatabase(tasks) {
  const database = {
    listTasks: () => tasks,
    getTask: (id) => tasks.find((task) => task.id === id) ?? null,
  };
  installLinearClaimDecoration(database);
  return database;
}

test("Linear decoration distinguishes new claims from bound continuations", () => {
  const binding = {
    threadId: "thread-1",
    codexProjectId: "project-1",
    codexProjectKind: "local",
    codexHostId: "local",
    workspacePath: "/workspace/project-1",
  };
  const task = makeLinearTask({
    threadId: binding.threadId,
    threadBinding: binding,
  });
  const database = decoratedDatabase([task]);

  const decorated = database.getTask(task.id);
  assert.deepEqual(decorated.claimEligibility, {
    eligible: false,
    reasons: ["ALREADY_BOUND"],
  });
  assert.deepEqual(decorated.continuationEligibility, {
    eligible: true,
    reasons: [],
  });
});

test("Linear continuation eligibility still fails closed on readiness and blockers", () => {
  const task = makeLinearTask({
    labels: [],
    threadId: "thread-1",
    threadBinding: {
      threadId: "thread-1",
      codexProjectId: "project-1",
      codexProjectKind: "local",
      codexHostId: "local",
      workspacePath: "/workspace/project-1",
    },
    linearDependencies: {
      complete: false,
      unblocked: false,
      unresolvedCount: 1,
      blockedBy: [],
    },
  });
  const database = decoratedDatabase([task]);

  const decorated = database.listTasks()[0];
  assert.equal(decorated.claimEligibility.eligible, false);
  assert.equal(decorated.continuationEligibility.eligible, false);
  assert.ok(decorated.continuationEligibility.reasons.includes("MISSING_CODEX_READY"));
  assert.ok(decorated.continuationEligibility.reasons.includes("DEPENDENCIES_INCOMPLETE"));
  assert.ok(!decorated.continuationEligibility.reasons.includes("ALREADY_BOUND"));
});
