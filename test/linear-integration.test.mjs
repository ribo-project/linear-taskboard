import assert from "node:assert/strict";
import test from "node:test";

import { createLinearIntegration } from "../server/linear-integration.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMemoryConfigStore(initial = null) {
  let value = initial;
  return {
    validate(input) {
      return {
        version: 1,
        apiKey: input.apiKey,
        teamIds: input.teamIds ?? [],
        projectIds: input.projectIds ?? [],
        assignedToMeOnly: input.assignedToMeOnly ?? true,
      };
    },
    async read() { return value; },
    async save(input) { value = input; return value; },
    async clear() { value = null; },
  };
}

function createLinearFetch() {
  const mutations = [];
  const fetch = async (_url, init) => {
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
              nodes: [
                {
                  id: "issue-1",
                  identifier: "RIB-1",
                  title: "Included",
                  description: "",
                  priority: 2,
                  dueDate: null,
                  url: "https://linear.app/rib/issue/RIB-1/included",
                  createdAt: "2026-08-20T00:00:00.000Z",
                  updatedAt: "2026-08-27T00:00:00.000Z",
                  state: { id: "todo", name: "Todo", type: "unstarted", position: 1 },
                  team: { id: "team-1", key: "RIB", name: "RIB" },
                  project: { id: "project-1", name: "Project 1" },
                  labels: { nodes: [{ id: "label-1", name: "codex-ready" }] },
                  assignee: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  creator: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  parent: null,
                },
                {
                  id: "issue-2",
                  identifier: "OTHER-2",
                  title: "Filtered",
                  description: "",
                  priority: 3,
                  dueDate: null,
                  url: "https://linear.app/other/issue/OTHER-2/filtered",
                  createdAt: "2026-08-20T00:00:00.000Z",
                  updatedAt: "2026-08-27T00:00:00.000Z",
                  state: { id: "todo-2", name: "Todo", type: "unstarted", position: 1 },
                  team: { id: "team-2", key: "OTHER", name: "Other" },
                  project: { id: "project-2", name: "Project 2" },
                  labels: { nodes: [] },
                  assignee: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  creator: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  parent: null,
                },
              ],
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
            states: {
              nodes: [
                { id: "state-progress", name: "In Progress", type: "started", position: 2 },
                { id: "state-review", name: "In Review", type: "started", position: 3 },
              ],
            },
          },
        },
      });
    }

    if (body.query.includes("LinearTaskboardUpdateIssue")) {
      mutations.push(body.variables);
      return jsonResponse({
        data: {
          issueUpdate: {
            success: true,
            issue: { id: body.variables.issueId, identifier: "RIB-1", updatedAt: "now" },
          },
        },
      });
    }

    if (body.query.includes("LinearTaskboardCreateComment")) {
      mutations.push(body.variables);
      return jsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: { id: "comment-1", body: body.variables.input.body, createdAt: "now", updatedAt: "now" },
          },
        },
      });
    }

    throw new Error("Unexpected Linear operation");
  };

  return { fetch, mutations };
}

test("configure validates live Linear identity, scopes issues, and does not expose credentials", async () => {
  const configStore = createMemoryConfigStore();
  const { fetch } = createLinearFetch();
  const projected = [];
  const integration = createLinearIntegration({
    configStore,
    fetch,
    projection: {
      async syncLinearSnapshot(snapshot) {
        projected.push(snapshot);
      },
    },
  });

  const connection = await integration.configure({
    apiKey: "test-linear-key",
    teamIds: ["team-1"],
    projectIds: ["project-1"],
    assignedToMeOnly: true,
  });

  assert.equal(connection.configured, true);
  assert.equal(connection.organization.name, "RIB");
  assert.equal(connection.issueCount, 1);
  assert.equal(connection.projectCount, 1);
  assert.equal(Object.hasOwn(connection, "apiKey"), false);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].issues[0].externalKey, "RIB-1");
  assert.deepEqual(projected[0].issues[0].labels, ["codex-ready"]);
});

test("moveIssue resolves a team workflow state before writing stateId", async () => {
  const configStore = createMemoryConfigStore({
    version: 1,
    apiKey: "test-linear-key",
    teamIds: [],
    projectIds: [],
    assignedToMeOnly: true,
  });
  const { fetch, mutations } = createLinearFetch();
  const integration = createLinearIntegration({ configStore, fetch });

  await integration.moveIssue({ issueId: "issue-1", teamId: "team-1" }, "in_progress");
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0], {
    issueId: "issue-1",
    input: { stateId: "state-progress" },
  });
});

test("priority and comment helpers write through to Linear", async () => {
  const configStore = createMemoryConfigStore({
    version: 1,
    apiKey: "test-linear-key",
    teamIds: [],
    projectIds: [],
    assignedToMeOnly: true,
  });
  const { fetch, mutations } = createLinearFetch();
  const integration = createLinearIntegration({ configStore, fetch });

  await integration.updatePriority({ issueId: "issue-1" }, "high");
  await integration.addComment({ issueId: "issue-1" }, "Implementation complete");

  assert.deepEqual(mutations[0], {
    issueId: "issue-1",
    input: { priority: 2 },
  });
  assert.deepEqual(mutations[1], {
    input: { issueId: "issue-1", body: "Implementation complete" },
  });
});
