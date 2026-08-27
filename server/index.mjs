import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createTaskboardServer as createBaseTaskboardServer,
  resolveHost,
  resolvePort,
} from "./app.mjs";
import { installLinearClaimDecoration } from "./linear-claim-decoration.mjs";
import { createLinearConfigStore } from "./linear-config.mjs";
import { createLinearIntegration } from "./linear-integration.mjs";
import { installLinearLocalRoutes } from "./linear-local-routes.mjs";
import { installLinearProjection } from "./linear-projection.mjs";

export { resolveHost, resolvePort, resolveServerOptions } from "./app.mjs";

export function createTaskboardServer(options = {}) {
  const app = createBaseTaskboardServer(options);
  const projection = installLinearProjection(app.database);
  installLinearClaimDecoration(app.database);
  const configStore = options.linearConfigStore ?? createLinearConfigStore({
    configPath: options.linearConfigPath
      ?? path.join(app.options.dataDirectory, "linear-connection.json"),
  });
  const integration = createLinearIntegration({
    configStore,
    projection,
    fetch: options.linearFetch ?? globalThis.fetch,
    ...(options.linearEndpoint ? { endpoint: options.linearEndpoint } : {}),
  });

  installLinearLocalRoutes(app, integration);
  app.linearIntegration = integration;

  const listen = app.listen.bind(app);
  let startupSync = null;
  app.listen = async (...args) => {
    if (!startupSync) {
      startupSync = (async () => {
        const connection = await integration.status();
        if (!connection.configured) return connection;
        try {
          const synced = await integration.sync({ force: true, archiveMissing: true });
          return synced.connection;
        } catch (error) {
          console.warn(`Linear startup sync failed: ${error instanceof Error ? error.message : String(error)}`);
          return connection;
        }
      })();
    }
    await startupSync;
    return listen(...args);
  };

  return app;
}

async function main() {
  const app = createTaskboardServer();
  const host = resolveHost();
  const listenFd = process.env.CODEX_TASKBOARD_LISTEN_FD === undefined
    ? null
    : Number(process.env.CODEX_TASKBOARD_LISTEN_FD);
  const address = await app.listen({ host, port: resolvePort(), fd: listenFd });
  console.log(`Codex Taskboard listening on http://127.0.0.1:${address.port}`);
  if (host === "0.0.0.0") {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry?.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address);
    for (const lanAddress of [...new Set(addresses)]) {
      console.log(`Codex Taskboard available on LAN at http://${lanAddress}:${address.port}`);
    }
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", () => close().then(() => process.exit(0)));
  process.once("SIGTERM", () => close().then(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
