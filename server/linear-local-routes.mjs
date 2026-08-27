import { isTaskStatus } from "../shared/domain.mjs";
import { assertLinearClaimable } from "./linear-claim.mjs";

const JSON_BODY_LIMIT = 1024 * 1024;
const COMMENT_BODY_LIMIT = 100_000;
const CODEX_READY_LABEL = "codex-ready";
const LOCAL_CODEX_ACTOR = {
  type: "agent",
  id: "codex-agent",
  name: "Codex Agent",
  avatarUrl: null,
};

function requestError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function isLoopbackAddress(value) {
  if (typeof value !== "string") return false;
  const address = value.toLowerCase().split("%", 1)[0];
  return address === "::1"
    || address === "127.0.0.1"
    || address.startsWith("127.")
    || address === "::ffff:127.0.0.1"
    || address.startsWith("::ffff:127.");
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function sendEmpty(response, status) {
  response.writeHead(status, { "cache-control": "no-store" });
  response.end();
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_BODY_LIMIT) {
      throw requestError(413, "BODY_TOO_LARGE", "Request body is too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }
    return value;
  } catch (error) {
    if (error?.code === "BODY_TOO_LARGE") throw error;
    throw requestError(400, "INVALID_BODY", "Request body must be valid JSON object");
  }
}

function assertNoQuery(url, label = "Linear connection routes") {
  if ([...url.searchParams.keys()].length > 0) {
    throw requestError(400, "UNKNOWN_QUERY_PARAMETER", `${label} do not accept query parameters`);
  }
}

function assertAllowedKeys(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw requestError(
      400,
      "UNKNOWN_FIELD",
      `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
    );
  }
}

function assertConfigureBody(body) {
  assertAllowedKeys(body, new Set(["apiKey", "teamIds", "projectIds", "assignedToMeOnly"]));
}

function assertVersion(current, version) {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw requestError(400, "INVALID_FIELD", "'version' must be a positive integer");
  }
  if (current.version !== version) {
    throw requestError(409, "VERSION_CONFLICT", "Task changed since it was last read");
  }
}

function optionalString(value, name, maxLength) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
    throw requestError(400, "INVALID_FIELD", `'${name}' is invalid`);
  }
  return value.trim();
}

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.includes("\0")) {
    throw requestError(400, "INVALID_FIELD", `'${name}' is invalid`);
  }
  return value;
}

function parseThreadBinding(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw requestError(400, "INVALID_FIELD", "'threadBinding' must be an object or null");
  }
  assertAllowedKeys(
    value,
    new Set(["threadId", "codexProjectId", "codexProjectKind", "codexHostId", "workspacePath"]),
  );
  const threadId = optionalString(value.threadId, "threadBinding.threadId", 256);
  const codexProjectId = optionalString(value.codexProjectId, "threadBinding.codexProjectId", 512);
  const codexHostId = optionalString(value.codexHostId, "threadBinding.codexHostId", 512);
  const workspacePath = optionalString(value.workspacePath, "threadBinding.workspacePath", 4096);
  if (value.codexProjectKind !== "local" && value.codexProjectKind !== "remote") {
    throw requestError(
      400,
      "INVALID_FIELD",
      "'threadBinding.codexProjectKind' must be local or remote",
    );
  }
  if (!threadId || !codexProjectId || !codexHostId || !workspacePath) {
    throw requestError(400, "INVALID_FIELD", "'threadBinding' is incomplete");
  }
  return {
    threadId,
    codexProjectId,
    codexProjectKind: value.codexProjectKind,
    codexHostId,
    workspacePath,
  };
}

function sameThreadBinding(left, right) {
  if (!left || !right) return false;
  return left.threadId === right.threadId
    && left.codexProjectId === right.codexProjectId
    && left.codexProjectKind === right.codexProjectKind
    && left.codexHostId === right.codexHostId
    && left.workspacePath === right.workspacePath;
}

function hasLabel(task, labelName) {
  return Array.isArray(task?.labels)
    && task.labels.some((label) => label.toLocaleLowerCase("en-US") === labelName);
}

function errorResponse(error) {
  if (Number.isInteger(error?.status)) {
    return {
      status: error.status,
      code: error.code ?? "LINEAR_REQUEST_FAILED",
      message: error.message ?? "Linear request failed",
    };
  }
  if (typeof error?.code === "string" && error.code.startsWith("INVALID_LINEAR_")) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error?.name === "LinearApiError") {
    return {
      status: 502,
      code: error.code ?? "LINEAR_API_ERROR",
      message: error.message ?? "Linear request failed",
    };
  }
  return {
    status: 502,
    code: "LINEAR_CONNECTION_FAILED",
    message: error instanceof Error ? error.message : "Linear connection failed",
  };
}

function decodeRouteId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeLinearComment(task, comment, fallbackViewer = null) {
  const user = comment?.user ?? fallbackViewer;
  const userId = user?.id ?? "unknown";
  return {
    id: `linear-comment:${comment.id}`,
    taskId: task.id,
    body: comment.body ?? "",
    authorType: "user",
    authorId: `linear:${userId}`,
    authorName: user?.displayName ?? user?.name ?? fallbackViewer?.name ?? "Linear",
    authorAvatarUrl: user?.avatarUrl ?? fallbackViewer?.avatarUrl ?? null,
    threadId: null,
    threadBinding: null,
    legacyLocalThreadId: null,
    attachments: [],
    version: 1,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt ?? comment.createdAt,
  };
}

async function listLinearComments(integration, url, response, task) {
  assertNoQuery(url, "Linear comment routes");
  const comments = await integration.listComments(task.nativeRef);
  const connection = await integration.status();
  sendJson(response, 200, {
    comments: comments.map((comment) => normalizeLinearComment(task, comment, connection.viewer)),
    nextCursor: "0",
  });
}

async function createLinearComment(integration, request, url, response, task) {
  assertNoQuery(url, "Linear comment routes");
  const body = await readJson(request);
  assertAllowedKeys(body, new Set(["body", "threadId", "threadBinding"]));
  const text = requiredText(body.body, "body", COMMENT_BODY_LIMIT);
  if (body.threadId !== undefined) optionalString(body.threadId, "threadId", 256);
  if (body.threadBinding !== undefined) parseThreadBinding(body.threadBinding);
  const comment = await integration.addComment(task.nativeRef, text);
  const connection = await integration.status();
  sendJson(response, 201, {
    comment: normalizeLinearComment(task, comment, connection.viewer),
  });
}

async function setLinearCodexReady(app, integration, request, url, response, task) {
  assertNoQuery(url, "Linear codex-ready routes");
  const body = await readJson(request);
  assertAllowedKeys(body, new Set(["version", "enabled"]));
  assertVersion(task, body.version);
  if (typeof body.enabled !== "boolean") {
    throw requestError(400, "INVALID_FIELD", "'enabled' must be a boolean");
  }
  if (task.archivedAt !== null) {
    throw requestError(409, "TASK_ARCHIVED", "Archived tasks cannot change Codex readiness");
  }

  const alreadyEnabled = hasLabel(task, CODEX_READY_LABEL);
  if (alreadyEnabled === body.enabled) {
    return sendJson(response, 200, { task });
  }

  await integration.setCodexReady(task.nativeRef, body.enabled);
  try {
    await integration.reconcile();
  } catch {
    throw requestError(
      502,
      "LINEAR_RECONCILE_FAILED",
      "Linear was updated but Taskboard could not refresh the projection; sync Linear manually",
    );
  }

  const refreshed = app.database.getTask(task.id);
  if (!refreshed) throw requestError(404, "TASK_NOT_FOUND", `Task '${task.id}' does not exist`);
  sendJson(response, 200, { task: refreshed });
}

async function moveLinearTask(app, integration, request, url, response, task) {
  assertNoQuery(url, "Linear issue move routes");
  const body = await readJson(request);
  assertAllowedKeys(body, new Set(["version", "status", "sortOrder", "threadId", "threadBinding"]));
  assertVersion(task, body.version);
  if (!isTaskStatus(body.status)) {
    throw requestError(400, "INVALID_FIELD", "'status' is invalid");
  }
  if (task.archivedAt !== null) {
    throw requestError(409, "TASK_ARCHIVED", "Archived tasks cannot be moved");
  }

  const threadId = optionalString(body.threadId, "threadId", 256);
  const threadBinding = parseThreadBinding(body.threadBinding);
  if (threadId && threadBinding && threadId !== threadBinding.threadId) {
    throw requestError(400, "INVALID_FIELD", "'threadId' must match 'threadBinding.threadId'");
  }

  if (task.status === "todo" && body.status === "in_progress") {
    if (task.threadId && !task.threadBinding) {
      throw requestError(
        409,
        "LINEAR_LEGACY_BINDING",
        "A Linear issue with a legacy thread binding cannot be claimed until that binding is reconciled",
      );
    }
    const continuingBoundTask = Boolean(task.threadBinding);
    if (continuingBoundTask && !sameThreadBinding(task.threadBinding, threadBinding)) {
      throw requestError(
        409,
        "LINEAR_BINDING_MISMATCH",
        "A bound Linear issue can only continue with its existing Codex thread binding",
      );
    }
    assertLinearClaimable(task, { allowExistingBinding: continuingBoundTask });
  }

  if (body.status !== task.status) {
    await integration.moveIssue(task.nativeRef, body.status);
    try {
      await integration.reconcile();
    } catch {
      throw requestError(
        502,
        "LINEAR_RECONCILE_FAILED",
        "Linear was updated but Taskboard could not refresh the projection; sync Linear manually",
      );
    }
  }

  let refreshed = app.database.getTask(task.id);
  if (!refreshed) throw requestError(404, "TASK_NOT_FOUND", `Task '${task.id}' does not exist`);

  if (threadId !== undefined || threadBinding !== undefined) {
    refreshed = app.database.moveTask(
      refreshed.id,
      refreshed.version,
      refreshed.status,
      refreshed.sortOrder,
      threadId,
      threadBinding,
      LOCAL_CODEX_ACTOR,
    );
  }

  sendJson(response, 200, { task: refreshed });
}

async function handleLinearProjectionRoute(app, integration, request, url, response) {
  const method = request.method ?? "GET";
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(move|archive|restore|comments|attachments|linear-codex-ready))?/);
  if (taskMatch) {
    const taskId = decodeRouteId(taskMatch[1]);
    const task = taskId ? app.database.getTask(taskId) : null;
    if (task?.source === "linear") {
      const action = taskMatch[2];
      if (action === "comments" && method === "GET") {
        await listLinearComments(integration, url, response, task);
        return true;
      }
      if (action === "comments" && method === "POST") {
        await createLinearComment(integration, request, url, response, task);
        return true;
      }
      if (method === "GET" || method === "HEAD") return false;
      if (action === "move" && method === "POST") {
        await moveLinearTask(app, integration, request, url, response, task);
        return true;
      }
      if (action === "linear-codex-ready" && method === "POST") {
        await setLinearCodexReady(app, integration, request, url, response, task);
        return true;
      }
      sendError(
        response,
        409,
        "LINEAR_READ_ONLY",
        "This Linear issue field is read-only in Taskboard until its write-through path is enabled",
      );
      return true;
    }
  }

  if (method === "GET" || method === "HEAD") return false;
  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)/);
  if (projectMatch) {
    const projectId = decodeRouteId(projectMatch[1]);
    const project = projectId ? app.database.getProject(projectId) : null;
    if (project?.source === "linear") {
      sendError(
        response,
        409,
        "LINEAR_READ_ONLY",
        "Linear projects are read-only projections and cannot be edited locally",
      );
      return true;
    }
  }

  return false;
}

export function installLinearLocalRoutes(app, integration) {
  if (!app?.server) throw new TypeError("Taskboard app server is required");
  if (!integration) throw new TypeError("Linear integration is required");

  const existing = app.server.listeners("request");
  if (existing.length !== 1) {
    throw new Error(`Expected exactly one Taskboard request listener, found ${existing.length}`);
  }
  const baseRequestHandler = existing[0];
  app.server.removeAllListeners("request");

  app.server.on("request", (request, response) => {
    void (async () => {
      let url;
      try {
        url = new URL(request.url ?? "/", "http://127.0.0.1");
      } catch {
        return baseRequestHandler.call(app.server, request, response);
      }

      try {
        if (await handleLinearProjectionRoute(app, integration, request, url, response)) return;

        const connectionRoute = url.pathname === "/api/local/linear-connection";
        const syncRoute = url.pathname === "/api/local/linear-connection/sync";
        if (!connectionRoute && !syncRoute) {
          return baseRequestHandler.call(app.server, request, response);
        }

        if (!isLoopbackAddress(request.socket.remoteAddress)) {
          return sendError(response, 403, "LOCAL_ONLY", "Linear connection settings are only available on this device");
        }

        assertNoQuery(url);
        if (connectionRoute) {
          if (request.method === "GET") {
            return sendJson(response, 200, { connection: await integration.status() });
          }
          if (request.method === "PUT") {
            const body = await readJson(request);
            assertConfigureBody(body);
            const connection = await integration.configure(body);
            return sendJson(response, 200, { connection });
          }
          response.setHeader("allow", "GET, PUT");
          return sendEmpty(response, 405);
        }

        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          return sendEmpty(response, 405);
        }
        const contentLength = Number(request.headers["content-length"] ?? 0);
        if (contentLength > 0) {
          throw requestError(400, "INVALID_BODY", "Linear sync does not accept a request body");
        }
        const result = await integration.sync({ force: true, archiveMissing: true });
        return sendJson(response, 200, { connection: result.connection });
      } catch (error) {
        const failure = errorResponse(error);
        if (!response.headersSent) {
          sendError(response, failure.status, failure.code, failure.message);
        } else if (!response.writableEnded) {
          response.end();
        }
      }
    })();
  });
}
