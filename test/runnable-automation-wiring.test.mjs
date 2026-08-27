import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../scripts/codex-injector.mjs", import.meta.url),
  "utf8",
);

test("injector derives runnable Todo state from the shared source-aware policy", () => {
  assert.match(source, /summarizeRunnableTodos/);
  assert.match(source, /const \{ hasTodo, hasRunnableTodo \} = todoPayload/);
  assert.match(source, /request\.quotaAware && hasRunnableTodo !== false/);
  assert.match(source, /decideTaskboardAutomationPolicy\(request/);
  assert.match(source, /hasRunnableTodo,/);
  assert.match(source, /previousPauseReason/);
});

test("temporary policy pauses are persisted without becoming user disablement", () => {
  assert.match(source, /isTemporaryAutomationPauseReason\(record\.pauseReason\)/);
  assert.match(source, /previousPauseReason: current\.pauseReason \?\? null/);
  assert.match(source, /shouldDisableTaskboardAutomationPolicy/);
  assert.match(source, /current\.pauseReason = result\.pauseReason/);
  assert.match(source, /delete current\.pauseReason/);
  assert.doesNotMatch(source, /result\.hasTodo === false && result\.operation === "pause"/);
});
