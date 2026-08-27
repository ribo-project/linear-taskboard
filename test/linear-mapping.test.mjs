import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseLinearWorkflowState,
  linearOriginId,
  linearPriorityFromTask,
  normalizeLinearIssue,
  taskPriorityFromLinear,
  taskStatusFromLinear,
} from "../server/linear-mapping.mjs";

test("taskStatusFromLinear maps Linear workflow categories", () => {
  assert.equal(taskStatusFromLinear({ type: "backlog", name: "Backlog" }), "backlog");
  assert.equal(taskStatusFromLinear({ type: "unstarted", name: "Todo" }), "todo");
  assert.equal(taskStatusFromLinear({ type: "started", name: "In Progress" }), "in_progress");
  assert.equal(taskStatusFromLinear({ type: "started", name: "In Review" }), "in_review");
  assert.equal(taskStatusFromLinear({ type: "started", name: "Blocked" }), "blocked");
  assert.equal(taskStatusFromLinear({ type: "completed", name: "Done" }), "done");
  assert.equal(taskStatusFromLinear({ type: "canceled", name: "Canceled" }), "canceled");
});

test("Linear priority mapping round trips supported priorities", () => {
  const pairs = [
    ["none", 0],
    ["urgent", 1],
    ["high", 2],
    ["medium", 3],
    ["low", 4],
  ];
  for (const [taskPriority, linearPriority] of pairs) {
    assert.equal(linearPriorityFromTask(taskPriority), linearPriority);
    assert.equal(taskPriorityFromLinear(linearPriority), taskPriority);
  }
});

test("normalizeLinearIssue preserves Linear identity without making it the local primary key", () => {
  const issue = normalizeLinearIssue({
    id: "issue-uuid",
    identifier: "RIB-42",
    title: "Build Linear board",
    description: "Acceptance criteria",
    priority: 2,
    dueDate: "2026-09-01",
    url: "https://linear.app/example/issue/RIB-42/build-linear-board",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    state: { id: "state-review", name: "In Review", type: "started", position: 3 },
    team: { id: "team-uuid", key: "RIB", name: "RIB" },
    project: { id: "project-uuid", name: "Linear Taskboard" },
    labels: { nodes: [{ id: "label-1", name: "codex-ready" }, { id: "label-2", name: "backend" }] },
    assignee: { id: "user-1", displayName: "Developer", avatarUrl: null },
    creator: { id: "user-2", name: "Planner", avatarUrl: null },
    parent: { id: "parent-id", identifier: "RIB-40" },
  }, {
    organizationId: "org-uuid",
    organizationName: "RIB Workspace",
  });

  assert.match(issue.id, /^LINEAR:[A-F0-9]{64}:issue-uuid$/);
  assert.equal(issue.externalKey, "RIB-42");
  assert.equal(issue.status, "in_review");
  assert.equal(issue.priority, "high");
  assert.deepEqual(issue.labels, ["codex-ready", "backend"]);
  assert.equal(issue.nativeRef.teamId, "team-uuid");
  assert.equal(issue.nativeRef.projectId, "project-uuid");
  assert.equal(issue.nativeRef.parentIdentifier, "RIB-40");
  assert.equal(issue.project.name, "Linear Taskboard");
});

test("chooseLinearWorkflowState uses the earliest matching workflow position", () => {
  const states = [
    { id: "review", name: "In Review", type: "started", position: 4 },
    { id: "progress", name: "In Progress", type: "started", position: 2 },
    { id: "done", name: "Done", type: "completed", position: 5 },
  ];
  assert.equal(chooseLinearWorkflowState(states, "in_progress")?.id, "progress");
  assert.equal(chooseLinearWorkflowState(states, "done")?.id, "done");
  assert.equal(chooseLinearWorkflowState(states, "blocked"), null);
});

test("linearOriginId is stable and does not expose the organization id", () => {
  const first = linearOriginId("org-uuid");
  const second = linearOriginId("org-uuid");
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.doesNotMatch(first, /org-uuid/);
});
