import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const hook = await readFile(new URL("../plugins/linear-taskboard/hooks/hooks.json", import.meta.url), "utf8");
const launcher = await readFile(new URL("../plugins/linear-taskboard/scripts/ensure-plugin-launcher.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../plugins/linear-taskboard/.codex-plugin/plugin.json", import.meta.url), "utf8"));

test("the packaged Plugin ensures a resident launcher without opening Taskboard", () => {
  assert.equal(manifest.name, "linear-taskboard");
  assert.match(hook, /ensure-plugin-launcher\.mjs/);
  assert.doesNotMatch(hook, /start-taskboard\.mjs|--open/);
  assert.match(launcher, /process\.execPath/);
  assert.match(launcher, /--daemon/);
  assert.match(launcher, /--launch/);
  assert.match(launcher, /--port/);
  assert.match(launcher, /spawnSync/);
  assert.match(launcher, /launcher-ensure\.lock/);
});
