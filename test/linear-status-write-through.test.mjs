import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskboardServer } from "../server/index.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createLinearFetch() {
  let state = { id: "state-todo", name: "Todo", type: "unstarted", position: 1 };
  const mutations = [];
  const states = [
    { id: "state-todo", name: "Todo", type: "unstarted", position: 1 },
    { id: "state-progress", name: "In Progress", type: "started", position: 2 },
    { id: "state-review", name: "In Review", type: "started", position: 3 },
    { id: "state-done", name: "Done", type: "completed", position: 4 },
  ];

  return {
    mutations,
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      if (body.query.includes("LinearTaskboardViewer")) {
        return jsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              name: "Viewer",
              displayName: "Viewer",
              avatarUrl: null,
              organization: { id: "org-1", name: "RIB" },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardAssignedIssues")) {
        return jsonResponse({
          data: {
            viewer: {
              assignedIssues: {
                nodes: [{
                  id: "issue-1",
                  identifier: "RIB-1",
                  title: "Claim me",
                  description: "Linear status write-through",
                  priority: 2,
                  dueDate: null,
                  url: "https://linear.app/rib/issue/RIB-1/claim-me",
                  createdAt: "2026-08-27T00:00:00.000Z",
                  updatedAt: "2026-08-27T00:01:00.000Z",
                  state,
                  team: { id: "team-1", key: "RIB", name: "RIB" },
                  project: { id: "project-1", name: "Linear Taskboard" },
                  labels: { nodes: [{ id: "label-1", name: "codex-ready" }] },
                  assignee: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  creator: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  parent: null,
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardWorkflowStates")) {
        return jsonResponse({
          data: {
            team: {
              id: "team-1",
              states: { nodes: states },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardUpdateIssue")) {
        mutations.push(body.variables);
        const next = states.find((candidate) => candidate.id === body.variables.input.stateId);
        if (next) state = next;
        return jsonResponse({
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: "issue-1",
                identifier: "RIB-1",
                updatedAt: "2026-08-27T00:02:00.000Z",
              },
            },
          },
        });
      }
      throw new Error("Unexpected Linear operation");
    },
  };
}

async function withConfiguredServer(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-status-"));
  const linear = createLinearFetch();
  const app = createTaskboardServer({ dataDirectory: directory, linearFetch: linear.fetch });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const configured = await fetch(`${baseUrl}/api/local/linear-connection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "linear-status-test-key",
        teamIds: ["team-1"],
        projectIds: ["project-1"],
        assignedToMeOnly: true,
      }),
    });
    assert.equal(configured.status, 200);
    await run({ app, baseUrl, linear });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("Linear issue move writes status to Linear, reconciles, and preserves Codex claim binding", async () => {
  await withConfiguredServer(async ({ baseUrl, linear }) => {
    const projects = await fetch(`${baseUrl}/api/projects`).then((response) => response.json());
    const project = projects.projects.find((candidate) => candidate.source === "linear");
    assert.ok(project);
    const tasks = await fetch(`${baseUrl}/api/tasks?projectId=${encodeURIComponent(project.id)}`)
      .then((response) => response.json());
    const task = tasks.tasks[0];
    assert.equal(task.status, "todo");

    const threadBinding = {
      threadId: "thread-claim-1",
      codexProjectId: "codex-project-1",
      codexProjectKind: "local",
      codexHostId: "host-1",
      workspacePath: "/workspace/project-1",
    };
    const movedResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: task.version,
        status: "in_progress",
        threadBinding,
      }),
    });
    assert.equal(movedResponse.status, 200);
    const moved = await movedResponse.json();
    assert.equal(moved.task.status, "in_progress");
    assert.deepEqual(moved.task.threadBinding, threadBinding);
    assert.equal(linear.mutations.length, 1);
    assert.deepEqual(linear.mutations[0], {
      issueId: "issue-1",
      input: { stateId: "state-progress" },
    });

    const reviewResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: moved.task.version,
        status: "in_review",
        threadBinding,
      }),
    });
    assert.equal(reviewResponse.status, 200);
    const review = await reviewResponse.json();
    assert.equal(review.task.status, "in_review");
    assert.deepEqual(review.task.threadBinding, threadBinding);
    assert.equal(linear.mutations.length, 2);
    assert.deepEqual(linear.mutations[1], {
      issueId: "issue-1",
      input: { stateId: "state-review" },
    });
  });
});

test("Linear issue move rejects stale versions before touching Linear", async () => {
  await withConfiguredServer(async ({ baseUrl, linear }) => {
    const projects = await fetch(`${baseUrl}/api/projects`).then((response) => response.json());
    const project = projects.projects.find((candidate) => candidate.source === "linear");
    const tasks = await fetch(`${baseUrl}/api/tasks?projectId=${encodeURIComponent(project.id)}`)
      .then((response) => response.json());
    const task = tasks.tasks[0];

    const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: task.version + 1, status: "in_progress" }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error.code, "VERSION_CONFLICT");
    assert.equal(linear.mutations.length, 0);
  });
});
