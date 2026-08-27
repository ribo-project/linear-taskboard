const TEMPORARY_PAUSE_REASONS = new Set(["no-runnable", "quota"]);

export function isTemporaryAutomationPauseReason(value) {
  return TEMPORARY_PAUSE_REASONS.has(value);
}

export function decideTaskboardAutomationPolicy(request, {
  explicit = false,
  hasTodo = null,
  hasRunnableTodo = null,
  previousQuotaState,
  quotaState,
  currentStatus,
  previousPauseReason = null,
} = {}) {
  if (!request?.enabledByUser) {
    return { operation: "pause", pauseReason: "user-disabled" };
  }

  if (hasTodo === false) {
    return { operation: "pause", pauseReason: "no-todo" };
  }

  if (hasRunnableTodo === false) {
    return { operation: "pause", pauseReason: "no-runnable" };
  }

  if (!explicit && currentStatus === "PAUSED") {
    if (previousPauseReason === "no-runnable") {
      if (request.quotaAware && quotaState !== "available") {
        return { operation: "pause", pauseReason: "quota" };
      }
      return { operation: "ensure-active", pauseReason: null };
    }

    if (previousPauseReason === "quota") {
      if (request.quotaAware && quotaState !== "available") {
        return { operation: "pause", pauseReason: "quota" };
      }
      return { operation: "ensure-active", pauseReason: null };
    }

    if (!request.quotaAware || previousQuotaState === "available") {
      return { operation: "list", pauseReason: "external-paused" };
    }
  }

  if (request.quotaAware && quotaState !== "available") {
    return { operation: "pause", pauseReason: "quota" };
  }

  return { operation: "ensure-active", pauseReason: null };
}

export function shouldDisableTaskboardAutomationPolicy({
  operation,
  pauseReason,
  currentStatus,
} = {}) {
  if (operation === "pause" && pauseReason === "no-todo") return true;
  return operation === "list"
    && pauseReason === "external-paused"
    && currentStatus === "PAUSED";
}
