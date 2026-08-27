import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskboardAutomationPrompt } from "../shared/taskboard-automation.mjs";

const request = {
  id: "host-request-linear",
  action: "automation",
  requestId: "iframe-request-linear",
  operation: "ensure-active",
  taskboardProjectId: "linear-project",
  codexProjectId: "codex-project-1",
  codexProjectKind: "local",
  codexHostId: "local",
  projectName: "Linear Project",
  workspacePath: "/workspace/linear-project",
  skillPath: "/workspace/taskboard/skills/manage-taskboard/SKILL.md",
  enabledByUser: true,
  quotaAware: false,
  intervalMinutes: 5,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
};

test("automation prompt uses server eligibility for Linear claims and continuations", () => {
  const prompt = buildTaskboardAutomationPrompt(request);

  assert.match(prompt, /source="linear"[\s\S]*claimEligibility\.eligible/);
  assert.match(prompt, /source="linear"[\s\S]*continuationEligibility\.eligible/);
  assert.match(prompt, /threadId、threadBinding 都为空[\s\S]*claimEligibility\.eligible/);
  assert.match(prompt, /已有完整 threadBinding[\s\S]*continuationEligibility\.eligible/);
  assert.match(prompt, /eligibility 字段缺失[\s\S]*fail closed/);
  assert.match(prompt, /reasons 只用于诊断，不得绕过/);
});

test("automation prompt keeps relations.blockedBy only as the non-Linear fallback", () => {
  const prompt = buildTaskboardAutomationPrompt(request);

  assert.match(prompt, /不要使用 relations\.blockedBy 单独判断 Linear 是否可执行/);
  assert.match(prompt, /只有非 Linear 议题才沿用 relations\.blockedBy/);
  assert.match(prompt, /任何 todo → in_progress 状态写入前[\s\S]*再次运行 issue get/);
  assert.match(prompt, /未绑定新认领[\s\S]*claimEligibility\.eligible/);
  assert.match(prompt, /完整 threadBinding 的续跑[\s\S]*continuationEligibility\.eligible/);
});
