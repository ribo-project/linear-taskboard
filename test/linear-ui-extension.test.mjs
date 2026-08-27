import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../web/src/main.tsx", import.meta.url), "utf8");
const extensionSource = await readFile(
  new URL("../web/src/components/LinearIntegrationExtension.tsx", import.meta.url),
  "utf8",
);
const styleSource = await readFile(new URL("../web/src/linearIntegration.css", import.meta.url), "utf8");

test("Linear integration UI mounts outside the upstream App core", () => {
  assert.match(mainSource, /<App \/>/);
  assert.match(mainSource, /<LinearIntegrationExtension \/>/);
  assert.match(mainSource, /TaskboardLanguageProvider/);
});

test("Linear integration attaches to the existing project menu and header", () => {
  assert.match(extensionSource, /\.project-menu-actions/);
  assert.match(extensionSource, /\.header-actions/);
  assert.match(extensionSource, /連接 Linear/);
  assert.match(extensionSource, /Linear · 唯讀/);
  assert.match(extensionSource, /configureLinearConnection/);
  assert.match(extensionSource, /syncLinearConnection/);
});

test("Linear read-only presentation hides local issue creation controls", () => {
  assert.match(styleSource, /data-linear-project="true"/);
  assert.match(styleSource, /\.header-create-button/);
  assert.match(styleSource, /\.add-task-button/);
});
