import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillSource = await readFile(
  new URL("../skills/manage-taskboard/SKILL.md", import.meta.url),
  "utf8",
);

test("manage-taskboard treats Linear as authoritative and requires explicit autonomous readiness", () => {
  assert.match(skillSource, /## Linear source-of-truth issues/i);
  assert.match(skillSource, /Linear is authoritative for issue workflow data/i);
  assert.match(skillSource, /`claimEligibility` is present[\s\S]*server-computed autonomous[\s\S]*new-claim[\s\S]*gate/i);
  assert.match(skillSource, /`claimEligibility\.eligible` is exactly `true`/i);
  assert.match(skillSource, /`claimEligibility\.reasons` is diagnostic output[\s\S]*never override/i);
  assert.match(skillSource, /labels contain `codex-ready`/i);
  assert.match(skillSource, /`linearDependencies\.complete` is exactly `true`/i);
  assert.match(skillSource, /`linearDependencies\.unblocked` is exactly `true`/i);
  assert.match(skillSource, /`linearDependencies\.unresolvedCount` is `0`/i);
});

test("manage-taskboard fails closed for incomplete Linear blockers and preserves bound continuations", () => {
  assert.match(skillSource, /`linearDependencies\.blockedBy` is the authoritative blocker snapshot/i);
  assert.match(skillSource, /another Linear project or team/i);
  assert.match(skillSource, /fail closed/i);
  assert.match(skillSource, /do not infer that the issue is unblocked/i);
  assert.match(skillSource, /complete `threadBinding`[\s\S]*continuation rather than a new claim/i);
  assert.match(skillSource, /`continuationEligibility` gate[\s\S]*`continuationEligibility\.eligible` is exactly `true`/i);
  assert.match(skillSource, /preserve the exact saved five-field binding/i);
  assert.match(skillSource, /LINEAR_NOT_CLAIMABLE/i);
  assert.match(skillSource, /LINEAR_BINDING_MISMATCH/i);
  assert.match(skillSource, /LINEAR_LEGACY_BINDING/i);
});

test("manage-taskboard supersedes legacy local-relation selection for Linear automation", () => {
  assert.match(skillSource, /older automation prompt[\s\S]*`relations\.blockedBy`/i);
  assert.match(skillSource, /supersedes that instruction for `source: "linear"` issues/i);
  assert.match(skillSource, /Use `claimEligibility` for an unbound new claim/i);
  assert.match(skillSource, /`continuationEligibility` for a complete bound continuation/i);
  assert.match(skillSource, /Keep `relations\.blockedBy` as the dependency rule only for non-Linear issues/i);
});
