import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLinearConfigStore, LinearConfigError } from "../server/linear-config.mjs";

test("Linear config store persists scope without exposing extra fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-config-"));
  const configPath = path.join(directory, "linear-connection.json");
  const store = createLinearConfigStore({ configPath });

  await store.save({
    apiKey: "test-linear-key",
    teamIds: ["team-1", "team-1"],
    projectIds: ["project-1"],
    assignedToMeOnly: false,
  });

  const config = await store.read();
  assert.deepEqual(config, {
    version: 1,
    apiKey: "test-linear-key",
    teamIds: ["team-1"],
    projectIds: ["project-1"],
    assignedToMeOnly: false,
  });

  if (process.platform !== "win32") {
    const metadata = await stat(configPath);
    assert.equal(metadata.mode & 0o777, 0o600);
  }
});

test("Linear config validation rejects unknown fields", () => {
  const store = createLinearConfigStore({ configPath: "/tmp/unused-linear-config.json" });
  assert.throws(
    () => store.validate({ apiKey: "test-linear-key", unexpected: true }),
    (error) => error instanceof LinearConfigError && error.code === "INVALID_LINEAR_CONFIG",
  );
});

test("Linear config clear removes the stored connection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-config-"));
  const configPath = path.join(directory, "linear-connection.json");
  const store = createLinearConfigStore({ configPath });

  await store.save({ apiKey: "test-linear-key" });
  await store.clear();

  assert.equal(await store.read(), null);
});
