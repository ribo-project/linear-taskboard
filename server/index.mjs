import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createTaskboardServer, resolveHost, resolvePort } from "./app.mjs";
import { createLinearConfigStore } from "./linear-config.mjs";
import { createLinearIntegration } from "./linear-integration.mjs";
import { installLinearProjection } from "./linear-projection.mjs";

export { createTaskboardServer, resolveHost, resolvePort, resolveServerOptions } from "./app.mjs";

async function installLinearRuntime(app) {
  const projection = installLinearProjection(app.database);
  const configStore = createLinearConfigStore({
    configPath: path.join(app.options.dataDirectory, "linear-connection.json"),
  });
  const integration = createLinearIntegration({ configStore, projection });
  const connection = await integration.status();
  if (!connection.configured) return { integration, connection };

  try {
    const synced = await integration.sync({ force: true, archiveMissing: true });
    return { integration, connection: synced.connection };
  } catch (error) {
    console.warn(`Linear startup sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return { integration, connection };
  }
}

async function main() {
  const app = createTaskboardServer();
  await installLinearRuntime(app);
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
