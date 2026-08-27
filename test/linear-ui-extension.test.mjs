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
  assert.match(extensionSource, /Linear · 來源/);
  assert.match(extensionSource, /configureLinearConnection/);
  assert.match(extensionSource, /syncLinearConnection/);
});

test("Linear project can map to the current Codex workspace using the upstream storage contract", () => {
  assert.match(extensionSource, /taskboard\.projectCodexIdentities\.v1/);
  assert.match(extensionSource, /taskboard\.deviceWorkspacePaths\.v1/);
  assert.match(extensionSource, /taskboard:host-context/);
  assert.match(extensionSource, /綁定目前 Codex/);
  assert.match(extensionSource, /saveCurrentCodexMapping/);
  assert.match(extensionSource, /codexProjectId/);
  assert.match(extensionSource, /codexProjectKind/);
  assert.match(extensionSource, /codexHostId/);
  assert.match(extensionSource, /workspacePath/);
});

test("Linear issue detail exposes explicit codex-ready write-through without changing the upstream detail component", () => {
  assert.match(extensionSource, /\.detail-primary-actions/);
  assert.match(extensionSource, /\.detail-copy-identifier/);
  assert.match(extensionSource, /listTasks\(routeProjectId/);
  assert.match(extensionSource, /setLinearCodexReady/);
  assert.match(extensionSource, /允許 Codex/);
  assert.match(extensionSource, /取消 Codex/);
  assert.match(extensionSource, /codex-ready/);
  assert.match(extensionSource, /detailTask\.version/);
  assert.match(extensionSource, /claimEligibility/);
  assert.match(extensionSource, /continuationEligibility/);
});

test("Linear source presentation hides unsupported local mutations while keeping controlled write-through actions", () => {
  assert.match(styleSource, /data-linear-project="true"/);
  assert.match(styleSource, /\.header-create-button/);
  assert.match(styleSource, /\.add-task-button/);
  assert.match(styleSource, /\.issue-title-input/);
  assert.match(styleSource, /\.issue-description-read/);
  assert.match(styleSource, /\.detail-property-picker/);
  assert.match(styleSource, /\.issue-relation-add/);
  assert.match(styleSource, /\.issue-relation-remove/);
  assert.match(styleSource, /\.attachment-add-button/);
  assert.match(styleSource, /\.comment-attach-button/);
  assert.match(styleSource, /\.linear-source-badge/);
  assert.match(styleSource, /\.linear-map-button/);
  assert.match(styleSource, /\.linear-codex-ready-action/);
  assert.match(styleSource, /\.linear-mapping-dialog/);
});
