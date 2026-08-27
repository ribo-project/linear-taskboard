const JSON_BODY_LIMIT = 1024 * 1024;

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
      throw Object.assign(new Error("Request body is too large"), {
        status: 413,
        code: "BODY_TOO_LARGE",
      });
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
    throw Object.assign(new Error("Request body must be valid JSON object"), {
      status: 400,
      code: "INVALID_BODY",
    });
  }
}

function assertNoQuery(url) {
  if ([...url.searchParams.keys()].length > 0) {
    throw Object.assign(new Error("Linear connection routes do not accept query parameters"), {
      status: 400,
      code: "UNKNOWN_QUERY_PARAMETER",
    });
  }
}

function assertConfigureBody(body) {
  const allowed = new Set(["apiKey", "teamIds", "projectIds", "assignedToMeOnly"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw Object.assign(new Error(`Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`), {
      status: 400,
      code: "UNKNOWN_FIELD",
    });
  }
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

      const connectionRoute = url.pathname === "/api/local/linear-connection";
      const syncRoute = url.pathname === "/api/local/linear-connection/sync";
      if (!connectionRoute && !syncRoute) {
        return baseRequestHandler.call(app.server, request, response);
      }

      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        return sendError(response, 403, "LOCAL_ONLY", "Linear connection settings are only available on this device");
      }

      try {
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
          throw Object.assign(new Error("Linear sync does not accept a request body"), {
            status: 400,
            code: "INVALID_BODY",
          });
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
