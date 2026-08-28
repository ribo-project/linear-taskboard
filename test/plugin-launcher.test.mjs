import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const hook = await readFile(new URL("../plugins/linear-taskboard/hooks/hooks.json", import.meta.url), "utf8");
const launcher = await readFile(new URL("../plugins/linear-taskboard/scripts/ensure-plugin-launcher.mjs", import.meta.url), "utf8");
const shortcutInstaller = await readFile(new URL("../scripts/install-codex-cdp-shortcut.ps1", import.meta.url), "utf8");
const injector = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../plugins/linear-taskboard/.codex-plugin/plugin.json", import.meta.url), "utf8"));

test("the packaged Plugin ensures a resident launcher without opening Taskboard", () => {
  assert.equal(manifest.name, "linear-taskboard");
  assert.match(hook, /ensure-plugin-launcher\.mjs/);
  assert.doesNotMatch(hook, /start-taskboard\.mjs|--open/);
  assert.match(launcher, /process\.execPath/);
  assert.match(launcher, /--daemon/);
  assert.match(launcher, /--launch/);
  assert.match(launcher, /--port/);
  assert.match(launcher, /spawn\(/);
  assert.match(launcher, /detached: true/);
  assert.match(launcher, /child\.unref\(\)/);
  assert.match(launcher, /launcher-ensure\.lock/);
});

test("the Windows shortcut targets the main Codex profile with loopback CDP", () => {
  assert.match(shortcutInstaller, /Get-AppxPackage -Name "OpenAI\.Codex"/);
  assert.match(shortcutInstaller, /--remote-debugging-port=\$CdpPort/);
  assert.match(shortcutInstaller, /Codex\.lnk/);
  assert.match(shortcutInstaller, /User Pinned.*TaskBar/);
});

test("Windows launcher commands use PowerShell 7", () => {
  assert.match(injector, /where\.exe.*pwsh\.exe/s);
  assert.doesNotMatch(injector, /WindowsPowerShell/);
  assert.doesNotMatch(shortcutInstaller, /powershell\.exe/i);
});

test("Windows launch attaches to the main Codex CDP before starting a process", () => {
  assert.match(injector, /process\.platform === "win32"/);
  assert.match(injector, /Get-CimInstance Win32_Process/);
  assert.match(injector, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(injector, /Windows did not start the main Codex process with the requested CDP port/);
});
