import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_VERSION = 1;
const OAUTH_CONFIG_VERSION = 2;

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

function validateSecret(value, fieldName) {
  if (typeof value !== "string" || !value.trim() || value.length > 16_384) {
    throw new LinearConfigError("INVALID_LINEAR_OAUTH", `${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function validateExpiresAt(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > Date.now() + 31_536_000_000) {
    throw new LinearConfigError("INVALID_LINEAR_OAUTH", "oauth.expiresAt is invalid");
  }
  return value;
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
    || (value.version !== CONFIG_VERSION && value.version !== OAUTH_CONFIG_VERSION)
  ) {
    throw new LinearConfigError("INVALID_LINEAR_CONFIG", "Linear config file is invalid");
  }

  const allowedKeys = new Set([
    "version",
    "apiKey",
    "authType",
    "oauth",
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

  if (value.version === OAUTH_CONFIG_VERSION) {
    if (value.authType !== "oauth" || value.apiKey !== undefined) {
      throw new LinearConfigError("INVALID_LINEAR_CONFIG", "OAuth config must use authType oauth");
    }
    if (value.assignedToMeOnly !== undefined && typeof value.assignedToMeOnly !== "boolean") {
      throw new LinearConfigError("INVALID_LINEAR_CONFIG", "assignedToMeOnly must be a boolean");
    }
    if (
      !value.oauth
      || typeof value.oauth !== "object"
      || Array.isArray(value.oauth)
      || Object.keys(value.oauth).some((key) => !new Set(["accessToken", "refreshToken", "expiresAt", "scope"]).has(key))
    ) {
      throw new LinearConfigError("INVALID_LINEAR_CONFIG", "Linear OAuth config is invalid");
    }
    return {
      version: OAUTH_CONFIG_VERSION,
      authType: "oauth",
      oauth: {
        accessToken: validateSecret(value.oauth.accessToken, "oauth.accessToken"),
        refreshToken: validateSecret(value.oauth.refreshToken, "oauth.refreshToken"),
        expiresAt: validateExpiresAt(value.oauth.expiresAt),
        scope: validateSecret(value.oauth.scope, "oauth.scope"),
      },
      teamIds: validateIdList(value.teamIds, "teamIds"),
      projectIds: validateIdList(value.projectIds, "projectIds"),
      assignedToMeOnly: value.assignedToMeOnly ?? true,
    };
  }

  if (value.authType !== undefined || value.oauth !== undefined) {
    throw new LinearConfigError("INVALID_LINEAR_CONFIG", "Legacy Linear config cannot contain OAuth fields");
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
      const config = parseConfig({
        ...input,
        version: input?.oauth ? OAUTH_CONFIG_VERSION : CONFIG_VERSION,
      });
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
      return parseConfig({
        ...input,
        version: input?.oauth ? OAUTH_CONFIG_VERSION : CONFIG_VERSION,
      });
    },
  };
}
