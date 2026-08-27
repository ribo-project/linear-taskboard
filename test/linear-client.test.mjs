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

test("Linear client follows cursor pagination for assigned issues", async () => {
  const variablesSeen = [];
  const client = createLinearClient({
    apiKey: "lin_api_test",
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      variablesSeen.push(body.variables);
      const after = body.variables.after;
      return jsonResponse({
        data: {
          viewer: {
            assignedIssues: after === null
              ? {
                  nodes: [{ id: "issue-1", identifier: "RIB-1" }],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                }
              : {
                  nodes: [{ id: "issue-2", identifier: "RIB-2" }],
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
