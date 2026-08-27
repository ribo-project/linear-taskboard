import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseLinearCtlArgs, resolveLinearCtlPaths } from "../cli/linearctl.mjs";

test("linearctl configure defaults to assigned issues", () => {
  assert.deepEqual(parseLinearCtlArgs(["configure"]), {
    command: "configure",
    assignedToMeOnly: true,
    teamIds: [],
    projectIds: [],
  });
});

test("linearctl configure accepts repeated team/project scope", () => {
  assert.deepEqual(parseLinearCtlArgs([
    "configure",
    "--all",
    "--team-id", "team-1",
    "--team-id", "team-2",
    "--project-id", "project-1",
  ]), {
    command: "configure",
    assignedToMeOnly: false,
    teamIds: ["team-1", "team-2"],
    projectIds: ["project-1"],
  });
});

test("linearctl never accepts an API key command-line option", () => {
  assert.throws(
    () => parseLinearCtlArgs(["configure", "--api-key", "secret"]),
    /Unknown option: --api-key/,
  );
});

test("linearctl resolves the same shared data directory override", () => {
  const dataDirectory = path.resolve("tmp-linear-taskboard-data");
  const paths = resolveLinearCtlPaths({ CODEX_TASKBOARD_DATA_DIR: dataDirectory });
  assert.equal(paths.dataDirectory, dataDirectory);
  assert.equal(paths.databasePath, path.join(dataDirectory, "taskboard.sqlite"));
  assert.equal(paths.configPath, path.join(dataDirectory, "linear-connection.json"));
});
