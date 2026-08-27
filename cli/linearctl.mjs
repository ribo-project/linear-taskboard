#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TaskboardDatabase } from "../server/database.mjs";
import { createLinearConfigStore } from "../server/linear-config.mjs";
import { createLinearIntegration } from "../server/linear-integration.mjs";
import { installLinearProjection } from "../server/linear-projection.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveLinearCtlPaths(environment = process.env) {
  const dataDirectory = environment.CODEX_TASKBOARD_DATA_DIR
    ? path.resolve(environment.CODEX_TASKBOARD_DATA_DIR)
    : path.join(PROJECT_ROOT, ".data");
  return {
    dataDirectory,
    databasePath: path.join(dataDirectory, "taskboard.sqlite"),
    configPath: path.join(dataDirectory, "linear-connection.json"),
  };
}

function valuesAfter(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.push(value);
    index += 1;
  }
  return values;
}

function assertKnownFlags(args, command) {
  const allowed = command === "configure"
    ? new Set(["--all", "--team-id", "--project-id"])
    : new Set();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) continue;
    if (!allowed.has(value)) throw new Error(`Unknown option: ${value}`);
    if (value === "--team-id" || value === "--project-id") index += 1;
  }
}

export function parseLinearCtlArgs(argv) {
  const [command = "help", ...args] = argv;
  if (!["configure", "sync", "status", "clear", "help"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  assertKnownFlags(args, command);
  if (command !== "configure" && args.length > 0) {
    throw new Error(`${command} does not accept options`);
  }
  if (command !== "configure") return { command };
  return {
    command,
    assignedToMeOnly: !args.includes("--all"),
    teamIds: valuesAfter(args, "--team-id"),
    projectIds: valuesAfter(args, "--project-id"),
  };
}

export function createLinearCtlRuntime({
  environment = process.env,
  fetch: fetchImplementation = globalThis.fetch,
} = {}) {
  const paths = resolveLinearCtlPaths(environment);
  const database = new TaskboardDatabase(paths.databasePath);
  const projection = installLinearProjection(database);
  const configStore = createLinearConfigStore({ configPath: paths.configPath });
  const integration = createLinearIntegration({
    configStore,
    projection,
    fetch: fetchImplementation,
  });
  return { paths, database, configStore, integration };
}

function printHelp(output = process.stdout) {
  output.write([
    "Linear Taskboard sync CLI",
    "",
    "Usage:",
    "  LINEAR_API_KEY=... node cli/linearctl.mjs configure [--all] [--team-id ID] [--project-id ID]",
    "  node cli/linearctl.mjs sync",
    "  node cli/linearctl.mjs status",
    "  node cli/linearctl.mjs clear",
    "",
    "Notes:",
    "  - The API key is read from LINEAR_API_KEY and is never accepted as a command-line option.",
    "  - Default scope is issues assigned to the current Linear user.",
    "  - --all includes unassigned/other-assignee issues within the configured team/project scope.",
    "  - CODEX_TASKBOARD_DATA_DIR can override the shared Taskboard data directory.",
    "",
  ].join("\n"));
}

export async function runLinearCtl({
  argv = process.argv.slice(2),
  environment = process.env,
  fetch: fetchImplementation = globalThis.fetch,
  output = process.stdout,
} = {}) {
  const options = parseLinearCtlArgs(argv);
  if (options.command === "help") {
    printHelp(output);
    return { command: "help" };
  }

  const runtime = createLinearCtlRuntime({ environment, fetch: fetchImplementation });
  try {
    if (options.command === "configure") {
      const apiKey = environment.LINEAR_API_KEY;
      if (!apiKey) throw new Error("LINEAR_API_KEY is required for configure");
      const connection = await runtime.integration.configure({
        apiKey,
        teamIds: options.teamIds,
        projectIds: options.projectIds,
        assignedToMeOnly: options.assignedToMeOnly,
      });
      output.write(`${JSON.stringify({ command: "configure", connection }, null, 2)}\n`);
      return { command: "configure", connection };
    }

    if (options.command === "sync") {
      const result = await runtime.integration.sync({ force: true, archiveMissing: true });
      if (!result.connection.configured) throw new Error("Linear is not configured");
      output.write(`${JSON.stringify({ command: "sync", connection: result.connection }, null, 2)}\n`);
      return { command: "sync", connection: result.connection };
    }

    if (options.command === "status") {
      const connection = await runtime.integration.status();
      output.write(`${JSON.stringify({ command: "status", connection }, null, 2)}\n`);
      return { command: "status", connection };
    }

    await runtime.integration.clear();
    output.write(`${JSON.stringify({ command: "clear", configured: false }, null, 2)}\n`);
    return { command: "clear", configured: false };
  } finally {
    runtime.database.database.close?.();
  }
}

async function main() {
  try {
    await runLinearCtl();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
