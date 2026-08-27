import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_VERSION = 1;

export class LinearConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LinearConfigError";
    this.code = code;
  }
}

function validateApiKey(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new LinearConfigError(
      "INVALID_LINEAR_API_KEY",
      "Linear API key must be a non-empty string shorter than 4096 characters",
    );
  }
  return value.trim();
}

function validateIdList(value, fieldName) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new LinearConfigError(
      "INVALID_LINEAR_SCOPE",
      `${fieldName} must be an array containing at most 100 IDs`,
    );
  }

  const normalized = value.map((entry) => {
    if (
      typeof entry !== "string"
      || !entry.trim()
      || entry.length > 256
      || /[\u0000-\u001f\u007f]/.test(entry)
    ) {
      throw new LinearConfigError(
        "INVALID_LINEAR_SCOPE",
        `${fieldName} contains an invalid ID`,
      );
    }
    return entry.trim();
  });

  return [...new Set(normalized)];
}

function parseConfig(value) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.version !== CONFIG_VERSION
  ) {
    throw new LinearConfigError("INVALID_LINEAR_CONFIG", "Linear config file is invalid");
  }

  const allowedKeys = new Set([
    "version",
    "apiKey",
    "teamIds",
    "projectIds",
    "assignedToMeOnly",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new LinearConfigError(
      "INVALID_LINEAR_CONFIG",
      "Linear config file contains unknown fields",
    );
  }

  if (value.assignedToMeOnly !== undefined && typeof value.assignedToMeOnly !== "boolean") {
    throw new LinearConfigError(
      "INVALID_LINEAR_CONFIG",
      "assignedToMeOnly must be a boolean",
    );
  }

  return {
    version: CONFIG_VERSION,
    apiKey: validateApiKey(value.apiKey),
    teamIds: validateIdList(value.teamIds, "teamIds"),
    projectIds: validateIdList(value.projectIds, "projectIds"),
    assignedToMeOnly: value.assignedToMeOnly ?? true,
  };
}

export function createLinearConfigStore({ configPath }) {
  if (!configPath) throw new Error("configPath is required");
  let pendingWrite = Promise.resolve();

  async function readFromDisk() {
    try {
      return parseConfig(JSON.parse(await readFile(configPath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeAtomically(config) {
    await mkdir(path.dirname(configPath), { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, configPath);
    await chmod(configPath, 0o600);
  }

  return {
    async read() {
      await pendingWrite;
      return readFromDisk();
    },

    async save(input) {
      const config = parseConfig({ ...input, version: CONFIG_VERSION });
      const operation = pendingWrite.catch(() => {}).then(async () => {
        await writeAtomically(config);
        return config;
      });
      pendingWrite = operation.catch(() => {});
      return operation;
    },

    async clear() {
      await pendingWrite;
      try {
        await unlink(configPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    },

    validate(input) {
      return parseConfig({ ...input, version: CONFIG_VERSION });
    },
  };
}
