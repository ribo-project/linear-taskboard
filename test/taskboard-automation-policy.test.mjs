import assert from "node:assert/strict";
import test from "node:test";

import {
  decideTaskboardAutomationPolicy,
  isTemporaryAutomationPauseReason,
  shouldDisableTaskboardAutomationPolicy,
} from "../shared/taskboard-automation-policy.mjs";

const request = { enabledByUser: true, quotaAware: false };

test("user-off policy returns pause", () => {
  assert.deepEqual(decideTaskboardAutomationPolicy(
    { enabledByUser: false, quotaAware: false },
    { hasTodo: true, hasRunnableTodo: true, currentStatus: "ACTIVE" },
  ), { operation: "pause", pauseReason: "user-disabled" });
});

test("empty Todo set keeps the prior stop behavior", () => {
  const decision = decideTaskboardAutomationPolicy(request, {
    hasTodo: false,
    hasRunnableTodo: false,
    currentStatus: "ACTIVE",
  });
  assert.deepEqual(decision, { operation: "pause", pauseReason: "no-todo" });
  assert.equal(shouldDisableTaskboardAutomationPolicy({ ...decision, currentStatus: "ACTIVE" }), true);
});

test("Todo set with no runnable task is a temporary pause", () => {
  const decision = decideTaskboardAutomationPolicy(request, {
    hasTodo: true,
    hasRunnableTodo: false,
    currentStatus: "ACTIVE",
  });
  assert.deepEqual(decision, { operation: "pause", pauseReason: "no-runnable" });
  assert.equal(isTemporaryAutomationPauseReason(decision.pauseReason), true);
  assert.equal(shouldDisableTaskboardAutomationPolicy({ ...decision, currentStatus: "ACTIVE" }), false);
});

test("temporary runnable pause resumes when work becomes runnable", () => {
  assert.deepEqual(decideTaskboardAutomationPolicy(request, {
    hasTodo: true,
    hasRunnableTodo: true,
    currentStatus: "PAUSED",
    previousPauseReason: "no-runnable",
  }), { operation: "ensure-active", pauseReason: null });
});

test("quota pause resumes after quota is available", () => {
  const quotaRequest = { enabledByUser: true, quotaAware: true };
  assert.deepEqual(decideTaskboardAutomationPolicy(quotaRequest, {
    hasTodo: true,
    hasRunnableTodo: true,
    quotaState: "blocked",
    currentStatus: "ACTIVE",
  }), { operation: "pause", pauseReason: "quota" });
  assert.deepEqual(decideTaskboardAutomationPolicy(quotaRequest, {
    hasTodo: true,
    hasRunnableTodo: true,
    quotaState: "available",
    currentStatus: "PAUSED",
    previousPauseReason: "quota",
  }), { operation: "ensure-active", pauseReason: null });
});

test("native paused state without a Taskboard pause reason remains distinguishable", () => {
  const decision = decideTaskboardAutomationPolicy(request, {
    hasTodo: true,
    hasRunnableTodo: true,
    currentStatus: "PAUSED",
    previousPauseReason: null,
  });
  assert.deepEqual(decision, { operation: "list", pauseReason: "external-paused" });
  assert.equal(shouldDisableTaskboardAutomationPolicy({ ...decision, currentStatus: "PAUSED" }), true);
});

test("quota status still gates resume after a temporary runnable pause", () => {
  assert.deepEqual(decideTaskboardAutomationPolicy(
    { enabledByUser: true, quotaAware: true },
    {
      hasTodo: true,
      hasRunnableTodo: true,
      quotaState: "unknown",
      currentStatus: "PAUSED",
      previousPauseReason: "no-runnable",
    },
  ), { operation: "pause", pauseReason: "quota" });
});
