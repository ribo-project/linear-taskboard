function completeThreadBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false;
  if (binding.codexProjectKind !== "local" && binding.codexProjectKind !== "remote") return false;
  return [
    binding.threadId,
    binding.codexProjectId,
    binding.codexHostId,
    binding.workspacePath,
  ].every((value) => typeof value === "string" && value.trim().length > 0);
}

function nonLinearDependenciesClear(task) {
  const blockers = task?.relations?.blockedBy;
  return Array.isArray(blockers)
    && blockers.every((blocker) => blocker?.status === "done");
}

export function isRunnableTodo(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return false;
  if (task.status !== "todo" || task.archivedAt !== null) return false;

  if (task.source !== "linear") {
    return nonLinearDependenciesClear(task);
  }

  if (completeThreadBinding(task.threadBinding)) {
    if (task.threadId !== task.threadBinding.threadId) return false;
    return task.continuationEligibility?.eligible === true;
  }

  if (task.threadId || task.threadBinding) return false;
  return task.claimEligibility?.eligible === true;
}

export function summarizeRunnableTodos(tasks) {
  if (!Array.isArray(tasks)) {
    return { hasTodo: null, hasRunnableTodo: null };
  }

  const todos = tasks.filter((task) => (
    task
    && typeof task === "object"
    && !Array.isArray(task)
    && task.status === "todo"
    && task.archivedAt === null
  ));

  return {
    hasTodo: todos.length > 0,
    hasRunnableTodo: todos.some(isRunnableTodo),
  };
}
