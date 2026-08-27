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
  const user = {
    id: "viewer-1",
    name: "Viewer",
    displayName: "Viewer",
    avatarUrl: null,
  };
  const comments = [{
    id: "comment-1",
    body: "Existing Linear comment",
    createdAt: "2026-08-27T00:02:00.000Z",
    updatedAt: "2026-08-27T00:02:00.000Z",
    user,
  }];
  const commentMutations = [];

  return {
    comments,
    commentMutations,
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      if (body.query.includes("LinearTaskboardViewer")) {
        return jsonResponse({
          data: {
            viewer: {
              ...user,
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
                  title: "Comment issue",
                  description: "Linear comments",
                  priority: 2,
                  dueDate: null,
                  url: "https://linear.app/rib/issue/RIB-1/comment-issue",
                  createdAt: "2026-08-27T00:00:00.000Z",
                  updatedAt: "2026-08-27T00:01:00.000Z",
                  state: { id: "state-todo", name: "Todo", type: "unstarted", position: 1 },
                  team: { id: "team-1", key: "RIB", name: "RIB" },
                  project: { id: "project-1", name: "Linear Taskboard" },
                  labels: { nodes: [] },
                  assignee: user,
                  creator: user,
                  parent: null,
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardIssueComments")) {
        return jsonResponse({
          data: {
            issue: {
              comments: {
                nodes: comments,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (body.query.includes("LinearTaskboardCreateComment")) {
        commentMutations.push(body.variables);
        const comment = {
          id: `comment-${comments.length + 1}`,
          body: body.variables.input.body,
          createdAt: "2026-08-27T00:03:00.000Z",
          updatedAt: "2026-08-27T00:03:00.000Z",
          user,
        };
        comments.push(comment);
        return jsonResponse({
          data: {
            commentCreate: {
              success: true,
              comment,
            },
          },
        });
      }
      throw new Error("Unexpected Linear operation");
    },
  };
}

async function withConfiguredServer(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-comments-"));
  const linear = createLinearFetch();
  const app = createTaskboardServer({ dataDirectory: directory, linearFetch: linear.fetch });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const configured = await fetch(`${baseUrl}/api/local/linear-connection`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "linear-comments-test-key",
        teamIds: ["team-1"],
        projectIds: ["project-1"],
        assignedToMeOnly: true,
      }),
    });
    assert.equal(configured.status, 200);
    const projects = await fetch(`${baseUrl}/api/projects`).then((response) => response.json());
    const project = projects.projects.find((candidate) => candidate.source === "linear");
    const tasks = await fetch(`${baseUrl}/api/tasks?projectId=${encodeURIComponent(project.id)}`)
      .then((response) => response.json());
    await run({ baseUrl, linear, task: tasks.tasks[0] });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("Linear issue comments are read live through the Taskboard comment contract", async () => {
  await withConfiguredServer(async ({ baseUrl, task }) => {
    const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/comments`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.comments.length, 1);
    assert.equal(body.comments[0].id, "linear-comment:comment-1");
    assert.equal(body.comments[0].taskId, task.id);
    assert.equal(body.comments[0].body, "Existing Linear comment");
    assert.equal(body.comments[0].authorId, "linear:viewer-1");
    assert.equal(body.comments[0].authorName, "Viewer");
    assert.equal(body.comments[0].threadBinding, null);
    assert.deepEqual(body.comments[0].attachments, []);
  });
});

test("Taskboard comment creation writes directly to Linear and appears on the next read", async () => {
  await withConfiguredServer(async ({ baseUrl, linear, task }) => {
    const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: "Implementation complete\n\nTests: green",
        threadId: "thread-report-1",
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.comment.body, "Implementation complete\n\nTests: green");
    assert.equal(created.comment.authorName, "Viewer");
    assert.equal(linear.commentMutations.length, 1);
    assert.deepEqual(linear.commentMutations[0], {
      input: {
        issueId: "issue-1",
        body: "Implementation complete\n\nTests: green",
      },
    });

    const next = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/comments`)
      .then((result) => result.json());
    assert.equal(next.comments.length, 2);
    assert.equal(next.comments[1].body, "Implementation complete\n\nTests: green");
  });
});
