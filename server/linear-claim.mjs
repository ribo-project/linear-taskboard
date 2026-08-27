const CODEX_READY_LABEL = "codex-ready";

function hasCodexReadyLabel(task) {
  return Array.isArray(task?.labels)
    && task.labels.some((label) => String(label).trim().toLowerCase() === CODEX_READY_LABEL);
}

export function linearClaimEligibility(task) {
  const reasons = [];

  if (!task || task.source !== "linear") reasons.push("NOT_LINEAR");
  if (task?.archivedAt !== null) reasons.push("ARCHIVED");
  if (task?.status !== "todo") reasons.push("STATUS_NOT_TODO");
  if (!hasCodexReadyLabel(task)) reasons.push("MISSING_CODEX_READY");

  const dependencies = task?.linearDependencies;
  if (!dependencies || dependencies.complete !== true) {
    reasons.push("DEPENDENCIES_INCOMPLETE");
  } else if (dependencies.unblocked !== true || Number(dependencies.unresolvedCount ?? 0) > 0) {
    reasons.push("BLOCKED_BY_DEPENDENCY");
  }

  if (task?.threadBinding || task?.threadId) reasons.push("ALREADY_BOUND");

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export function assertLinearClaimable(task) {
  const eligibility = linearClaimEligibility(task);
  if (eligibility.eligible) return eligibility;

  const error = new Error(`Linear issue is not claimable: ${eligibility.reasons.join(", ")}`);
  error.name = "LinearClaimError";
  error.status = 409;
  error.code = "LINEAR_NOT_CLAIMABLE";
  error.details = eligibility;
  throw error;
}
