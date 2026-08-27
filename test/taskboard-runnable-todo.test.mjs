import assert from "node:assert/strict";
import test from "node:test";

import {
  isRunnableTodo,
  summarizeRunnableTodos,
} from "../shared/taskboard-runnable-todo.mjs";

function baseTodo(overrides = {}) {
  return {
    status: "todo",
    archivedAt: null,
    source: "local",
    threadId: null,
    threadBinding: null,
    relations: { blockedBy: [] },
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    threadId: "thread-1",
    codexProjectId: "project-1",
    codexProjectKind: "local",
    codexHostId: "local",
    workspacePath: "/workspace/project-1",
    ...overrides,
  };
}

test("non-Linear Todo is runnable only when every local blocker is done", () => {
  assert.equal(isRunnableTodo(baseTodo()), true);
  assert.equal(isRunnableTodo(baseTodo({
    relations: { blockedBy: [{ status: "in_progress" }] },
  })), false);
  assert.equal(isRunnableTodo(baseTodo({
    relations: { blockedBy: [{ status: "done" }, { status: "done" }] },
  })), true);
  assert.equal(isRunnableTodo(baseTodo({ relations: undefined })), false);
});

test("unbound Linear Todo requires claimEligibility eligible=true", () => {
  const task = baseTodo({
    source: "linear",
    claimEligibility: { eligible: true, reasons: [] },
  });
  assert.equal(isRunnableTodo(task), true);
  assert.equal(isRunnableTodo({ ...task, claimEligibility: undefined }), false);
  assert.equal(isRunnableTodo({
    ...task,
    claimEligibility: { eligible: false, reasons: ["MISSING_CODEX_READY"] },
  }), false);
});

test("bound Linear Todo uses continuationEligibility instead of claimEligibility", () => {
  const task = baseTodo({
    source: "linear",
    threadId: "thread-1",
    threadBinding: binding(),
    claimEligibility: { eligible: false, reasons: ["ALREADY_BOUND"] },
    continuationEligibility: { eligible: true, reasons: [] },
  });
  assert.equal(isRunnableTodo(task), true);
  assert.equal(isRunnableTodo({
    ...task,
    continuationEligibility: { eligible: false, reasons: ["BLOCKED_BY_DEPENDENCY"] },
  }), false);
});

test("legacy, incomplete, or inconsistent Linear bindings fail closed", () => {
  assert.equal(isRunnableTodo(baseTodo({
    source: "linear",
    threadId: "legacy-thread",
    claimEligibility: { eligible: true, reasons: [] },
  })), false);
  assert.equal(isRunnableTodo(baseTodo({
    source: "linear",
    threadBinding: binding({ workspacePath: "" }),
    continuationEligibility: { eligible: true, reasons: [] },
  })), false);
  assert.equal(isRunnableTodo(baseTodo({
    source: "linear",
    threadId: "thread-other",
    threadBinding: binding(),
    continuationEligibility: { eligible: true, reasons: [] },
  })), false);
});

test("non-Todo and archived tasks are never runnable", () => {
  assert.equal(isRunnableTodo(baseTodo({ status: "in_progress" })), false);
  assert.equal(isRunnableTodo(baseTodo({ archivedAt: "2026-08-27T00:00:00.000Z" })), false);
});

test("summary distinguishes Todo presence from runnable Todo presence", () => {
  const blockedLinear = baseTodo({
    source: "linear",
    claimEligibility: { eligible: false, reasons: ["MISSING_CODEX_READY"] },
  });
  assert.deepEqual(summarizeRunnableTodos([blockedLinear]), {
    hasTodo: true,
    hasRunnableTodo: false,
  });
  assert.deepEqual(summarizeRunnableTodos([
    blockedLinear,
    baseTodo({ source: "linear", claimEligibility: { eligible: true, reasons: [] } }),
  ]), {
    hasTodo: true,
    hasRunnableTodo: true,
  });
  assert.deepEqual(summarizeRunnableTodos([]), {
    hasTodo: false,
    hasRunnableTodo: false,
  });
  assert.deepEqual(summarizeRunnableTodos(null), {
    hasTodo: null,
    hasRunnableTodo: null,
  });
});
