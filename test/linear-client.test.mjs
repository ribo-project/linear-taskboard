import assert from "node:assert/strict";
import test from "node:test";

import { createLinearClient, LinearApiError } from "../server/linear-client.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Linear client sends the personal API key in Authorization", async () => {
  let seenAuthorization = null;
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async (_url, init) => {
      seenAuthorization = init.headers.authorization;
      return jsonResponse({
        data: {
          viewer: {
            id: "user-1",
            name: "User",
            displayName: "User",
            avatarUrl: null,
            organization: { id: "org-1", name: "Workspace" },
          },
        },
      });
    },
  });

  const viewer = await client.viewer();
  assert.equal(seenAuthorization, "lin_api_test");
  assert.equal(viewer.organization.id, "org-1");
});

test("Linear client follows cursor pagination for assigned issues and requests incoming blocker relations", async () => {
  const variablesSeen = [];
  const queriesSeen = [];
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      variablesSeen.push(body.variables);
      queriesSeen.push(body.query);
      const after = body.variables.after;
      return jsonResponse({
        data: {
          viewer: {
            assignedIssues: after === null
              ? {
                  nodes: [{
                    id: "issue-1",
                    identifier: "RIB-1",
                    inverseRelations: {
                      nodes: [{
                        id: "rel-1",
                        type: "blocks",
                        issue: { id: "blocker-1", identifier: "RIB-0" },
                      }],
                      pageInfo: { hasNextPage: false, endCursor: "rel-1" },
                    },
                  }],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                }
              : {
                  nodes: [{
                    id: "issue-2",
                    identifier: "RIB-2",
                    inverseRelations: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  }],
                  pageInfo: { hasNextPage: false, endCursor: "cursor-2" },
                },
          },
        },
      });
    },
  });

  const issues = await client.listIssues();
  assert.deepEqual(issues.map((issue) => issue.identifier), ["RIB-1", "RIB-2"]);
  assert.deepEqual(variablesSeen.map((entry) => entry.after), [null, "cursor-1"]);
  assert.ok(queriesSeen.every((query) => query.includes("inverseRelations(first: 100)")));
  assert.equal(issues[0].inverseRelations.nodes[0].type, "blocks");
});

test("Linear client turns GraphQL errors into LinearApiError even on HTTP 200", async () => {
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async () => jsonResponse({
      errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }],
      data: null,
    }),
  });

  await assert.rejects(
    () => client.viewer(),
    (error) => error instanceof LinearApiError
      && error.code === "RATELIMITED"
      && error.message === "Rate limit exceeded",
  );
});

test("Linear client rejects pagination without an end cursor", async () => {
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async () => jsonResponse({
      data: {
        viewer: {
          assignedIssues: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      },
    }),
  });

  await assert.rejects(
    () => client.listIssues(),
    (error) => error instanceof LinearApiError && error.code === "INVALID_LINEAR_PAGINATION",
  );
});

test("Linear client exposes issue update and comment mutations", async () => {
  const operations = [];
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      operations.push(body);
      if (body.query.includes("issueUpdate")) {
        return jsonResponse({
          data: {
            issueUpdate: {
              success: true,
              issue: { id: "issue-1", identifier: "RIB-1", updatedAt: "2026-08-27T00:00:00.000Z" },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: { id: "comment-1", body: "done", createdAt: "now", updatedAt: "now" },
          },
        },
      });
    },
  });

  const updated = await client.updateIssue("RIB-1", { priority: 2 });
  const comment = await client.createComment("issue-1", "done");

  assert.equal(updated.identifier, "RIB-1");
  assert.equal(comment.id, "comment-1");
  assert.equal(operations.length, 2);
});

test("Linear client lists issue labels with pagination and creates a workspace label", async () => {
  const operations = [];
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      operations.push(body);
      if (body.query.includes("LinearTaskboardIssueLabels")) {
        const after = body.variables.after;
        return jsonResponse({
          data: {
            issueLabels: after === null
              ? {
                  nodes: [{ id: "label-1", name: "bug", color: "#ff0000", description: null }],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                }
              : {
                  nodes: [{ id: "label-2", name: "codex-ready", color: "#5E6AD2", description: "ready" }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
          },
        });
      }
      if (body.query.includes("LinearTaskboardCreateIssueLabel")) {
        return jsonResponse({
          data: {
            issueLabelCreate: {
              success: true,
              issueLabel: {
                id: "label-created",
                name: body.variables.input.name,
                color: body.variables.input.color ?? null,
                description: body.variables.input.description ?? null,
              },
            },
          },
        });
      }
      throw new Error("Unexpected operation");
    },
  });

  const labels = await client.listIssueLabels();
  const created = await client.createIssueLabel({
    name: "codex-ready",
    color: "#5E6AD2",
    description: "Allows Codex Taskboard automation to claim this issue automatically.",
  });

  assert.deepEqual(labels.map((label) => label.name), ["bug", "codex-ready"]);
  assert.deepEqual(
    operations.filter((operation) => operation.query.includes("LinearTaskboardIssueLabels"))
      .map((operation) => operation.variables.after),
    [null, "cursor-1"],
  );
  assert.equal(created.id, "label-created");
  assert.equal(Object.hasOwn(operations.at(-1).variables.input, "teamId"), false);
});

test("Linear client supports incremental issue label updates", async () => {
  let variables = null;
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      variables = body.variables;
      return jsonResponse({
        data: {
          issueUpdate: {
            success: true,
            issue: { id: "issue-1", identifier: "RIB-1", updatedAt: "now" },
          },
        },
      });
    },
  });

  await client.updateIssue("issue-1", { addedLabelIds: ["label-1"], removedLabelIds: ["label-2"] });
  assert.deepEqual(variables, {
    issueId: "issue-1",
    input: { addedLabelIds: ["label-1"], removedLabelIds: ["label-2"] },
  });
});
