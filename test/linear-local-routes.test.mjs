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
  let issueTitle = "Linear route issue";
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
              nodes: [{
                id: "issue-1",
                identifier: "RIB-1",
                title: issueTitle,
                description: "Projected from Linear",
                priority: 2,
                dueDate: null,
                url: "https://linear.app/rib/issue/RIB-1/linear-route-issue",
                createdAt: "2026-08-27T00:00:00.000Z",
                updatedAt: "2026-08-27T00:01:00.000Z",
                state: { id: "state-todo", name: "Todo", type: "unstarted", position: 1 },
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
    throw new Error("Unexpected Linear operation");
  };
  return {
    fetch,
    renameIssue(title) { issueTitle = title; },
  };
}

async function withServer(run, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-routes-"));
  const linear = createLinearFetch();
  const app = createTaskboardServer({
    dataDirectory: directory,
    linearFetch: linear.fetch,
    ...options,
  });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      linear,
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("Linear local connection routes configure, sync, and never expose the API key", async () => {
  await withServer(async ({ baseUrl, linear }) => {
    const initial = await fetch(`${baseUrl}/api/local/linear-connection`).then((response) => response.json());
    assert.equal(initial.connection.configured, false);

    const configuredResponse = await fetch(`${baseUrl}/api/local/linear-connection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "linear-route-test-key",
        teamIds: ["team-1"],
        projectIds: ["project-1"],
        assignedToMeOnly: true,
      }),
    });
    assert.equal(configuredResponse.status, 200);
    const configuredText = await configuredResponse.text();
    assert.equal(configuredText.includes("linear-route-test-key"), false);
    const configured = JSON.parse(configuredText);
    assert.equal(configured.connection.configured, true);
    assert.equal(configured.connection.organization.name, "RIB");
    assert.equal(configured.connection.issueCount, 1);

    const projects = await fetch(`${baseUrl}/api/projects`).then((response) => response.json());
    const linearProject = projects.projects.find((project) => project.source === "linear");
    assert.ok(linearProject);
    assert.equal(linearProject.name, "Linear Taskboard");

    const tasks = await fetch(
      `${baseUrl}/api/tasks?projectId=${encodeURIComponent(linearProject.id)}`,
    ).then((response) => response.json());
    assert.equal(tasks.tasks.length, 1);
    assert.equal(tasks.tasks[0].source, "linear");
    assert.equal(tasks.tasks[0].externalKey, "RIB-1");

    const localMutation = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(tasks.tasks[0].id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(localMutation.status, 409);
    const localMutationBody = await localMutation.json();
    assert.equal(localMutationBody.error.code, "LINEAR_READ_ONLY");

    linear.renameIssue("Synced title");
    const syncResponse = await fetch(`${baseUrl}/api/local/linear-connection/sync`, {
      method: "POST",
    });
    assert.equal(syncResponse.status, 200);

    const syncedTasks = await fetch(
      `${baseUrl}/api/tasks?projectId=${encodeURIComponent(linearProject.id)}`,
    ).then((response) => response.json());
    assert.equal(syncedTasks.tasks[0].title, "Synced title");

    const statusText = await fetch(`${baseUrl}/api/local/linear-connection`).then((response) => response.text());
    assert.equal(statusText.includes("linear-route-test-key"), false);
  });
});

test("Linear local routes reject unknown fields and query parameters", async () => {
  await withServer(async ({ baseUrl }) => {
    const queryResponse = await fetch(`${baseUrl}/api/local/linear-connection?secret=1`);
    assert.equal(queryResponse.status, 400);
    const queryBody = await queryResponse.json();
    assert.equal(queryBody.error.code, "UNKNOWN_QUERY_PARAMETER");

    const fieldResponse = await fetch(`${baseUrl}/api/local/linear-connection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "key", unexpected: true }),
    });
    assert.equal(fieldResponse.status, 400);
    const fieldBody = await fieldResponse.json();
    assert.equal(fieldBody.error.code, "UNKNOWN_FIELD");
  });
});

test("Linear OAuth routes complete the browser callback and revoke local credentials", async () => {
  const oauthRequests = [];
  await withServer(async ({ baseUrl }) => {
    const startResponse = await fetch(`${baseUrl}/api/local/linear-oauth/start`, { redirect: "manual" });
    assert.equal(startResponse.status, 302);
    const authorizationUrl = new URL(startResponse.headers.get("location"));
    assert.equal(authorizationUrl.hostname, "linear.app");
    assert.equal(authorizationUrl.searchParams.get("client_id"), "linear-client-id");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");

    const callbackResponse = await fetch(
      `${baseUrl}/api/local/linear-oauth/callback?code=authorization-code&state=${encodeURIComponent(authorizationUrl.searchParams.get("state"))}`,
    );
    assert.equal(callbackResponse.status, 200);
    assert.match(await callbackResponse.text(), /Linear 已連線/);

    const statusResponse = await fetch(`${baseUrl}/api/local/linear-connection`);
    const status = await statusResponse.json();
    assert.equal(status.connection.authType, "oauth");
    assert.equal(status.connection.configured, true);
    assert.equal(JSON.stringify(status).includes("oauth-access-token"), false);

    const revokeResponse = await fetch(`${baseUrl}/api/local/linear-oauth/revoke`, { method: "POST" });
    assert.equal(revokeResponse.status, 200);
    assert.equal((await revokeResponse.json()).connection.configured, false);
    assert.equal(oauthRequests.some(({ body }) => body.get("token") === "oauth-refresh-token"), true);
  }, {
    linearOAuthClientId: "linear-client-id",
    linearOAuthRedirectUri: "http://127.0.0.1:47823/api/local/linear-oauth/callback",
    linearOAuthFetch: async (url, init) => {
      const body = new URLSearchParams(init.body);
      oauthRequests.push({ url, body });
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          expires_in: 3600,
          scope: "read write",
        });
      }
      return new Response(null, { status: 200 });
    },
  });
});
