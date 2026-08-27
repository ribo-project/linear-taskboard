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
  let codexReady = false;
  let readyLabelExists = false;
  const mutations = [];

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
                  title: "Explicit Codex readiness",
                  description: "Only explicit user action may toggle codex-ready.",
                  priority: 2,
                  dueDate: null,
                  url: "https://linear.app/rib/issue/RIB-1/explicit-codex-readiness",
                  createdAt: "2026-08-27T00:00:00.000Z",
                  updatedAt: "2026-08-27T00:01:00.000Z",
                  state: { id: "state-todo", name: "Todo", type: "unstarted", position: 1 },
                  team: { id: "team-1", key: "RIB", name: "RIB" },
                  project: { id: "project-1", name: "Linear Taskboard" },
                  labels: {
                    nodes: [
                      { id: "label-other", name: "customer-facing" },
                      ...(codexReady ? [{ id: "label-ready", name: "codex-ready" }] : []),
                    ],
                  },
                  assignee: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  creator: { id: "viewer-1", displayName: "Viewer", avatarUrl: null },
                  parent: null,
                  inverseRelations: {
                    nodes: [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardIssueLabels")) {
        return jsonResponse({
          data: {
            issueLabels: {
              nodes: [
                { id: "label-other", name: "customer-facing", color: "#888888", description: null },
                ...(readyLabelExists
                  ? [{ id: "label-ready", name: "codex-ready", color: "#5E6AD2", description: "ready" }]
                  : []),
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardCreateIssueLabel")) {
        readyLabelExists = true;
        mutations.push({ kind: "label-create", variables: body.variables });
        return jsonResponse({
          data: {
            issueLabelCreate: {
              success: true,
              issueLabel: {
                id: "label-ready",
                name: "codex-ready",
                color: body.variables.input.color,
                description: body.variables.input.description,
              },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardUpdateIssue")) {
        mutations.push({ kind: "issue-update", variables: body.variables });
        if (body.variables.input.addedLabelIds?.includes("label-ready")) codexReady = true;
        if (body.variables.input.removedLabelIds?.includes("label-ready")) codexReady = false;
        return jsonResponse({
          data: {
            issueUpdate: {
              success: true,
              issue: { id: "issue-1", identifier: "RIB-1", updatedAt: "now" },
            },
          },
        });
      }
      throw new Error(`Unexpected Linear operation: ${body.query}`);
    },
  };
}

async function withConfiguredServer(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-ready-"));
  const linear = createLinearFetch();
  const app = createTaskboardServer({ dataDirectory: directory, linearFetch: linear.fetch });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const configured = await fetch(`${baseUrl}/api/local/linear-connection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "linear-ready-test-key",
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

async function firstLinearTask(baseUrl) {
  const projects = await fetch(`${baseUrl}/api/projects`).then((response) => response.json());
  const project = projects.projects.find((candidate) => candidate.source === "linear");
  assert.ok(project);
  const tasks = await fetch(`${baseUrl}/api/tasks?projectId=${encodeURIComponent(project.id)}`)
    .then((response) => response.json());
  assert.equal(tasks.tasks.length, 1);
  return tasks.tasks[0];
}

async function setReady(baseUrl, task, enabled) {
  return fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/linear-codex-ready`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: task.version, enabled }),
  });
}

test("explicit codex-ready write-through creates the Linear label, reconciles, and changes claim eligibility", async () => {
  await withConfiguredServer(async ({ baseUrl, linear }) => {
    const initial = await firstLinearTask(baseUrl);
    assert.deepEqual(initial.labels, ["customer-facing"]);
    assert.equal(initial.claimEligibility.eligible, false);
    assert.ok(initial.claimEligibility.reasons.includes("MISSING_CODEX_READY"));

    const enabledResponse = await setReady(baseUrl, initial, true);
    assert.equal(enabledResponse.status, 200);
    const enabled = (await enabledResponse.json()).task;
    assert.deepEqual(enabled.labels.sort(), ["codex-ready", "customer-facing"]);
    assert.equal(enabled.claimEligibility.eligible, true);
    assert.deepEqual(enabled.claimEligibility.reasons, []);
    assert.equal(linear.mutations.length, 2);
    assert.equal(linear.mutations[0].kind, "label-create");
    assert.equal(linear.mutations[0].variables.input.name, "codex-ready");
    assert.equal(Object.hasOwn(linear.mutations[0].variables.input, "teamId"), false);
    assert.deepEqual(linear.mutations[1], {
      kind: "issue-update",
      variables: {
        issueId: "issue-1",
        input: { addedLabelIds: ["label-ready"] },
      },
    });

    const disabledResponse = await setReady(baseUrl, enabled, false);
    assert.equal(disabledResponse.status, 200);
    const disabled = (await disabledResponse.json()).task;
    assert.deepEqual(disabled.labels, ["customer-facing"]);
    assert.equal(disabled.claimEligibility.eligible, false);
    assert.ok(disabled.claimEligibility.reasons.includes("MISSING_CODEX_READY"));
    assert.deepEqual(linear.mutations.at(-1), {
      kind: "issue-update",
      variables: {
        issueId: "issue-1",
        input: { removedLabelIds: ["label-ready"] },
      },
    });
  });
});

test("codex-ready route is versioned and idempotent before touching Linear", async () => {
  await withConfiguredServer(async ({ baseUrl, linear }) => {
    const task = await firstLinearTask(baseUrl);

    const stale = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/linear-codex-ready`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: task.version + 1, enabled: true }),
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "VERSION_CONFLICT");
    assert.equal(linear.mutations.length, 0);

    const alreadyDisabled = await setReady(baseUrl, task, false);
    assert.equal(alreadyDisabled.status, 200);
    assert.equal((await alreadyDisabled.json()).task.version, task.version);
    assert.equal(linear.mutations.length, 0);
  });
});
