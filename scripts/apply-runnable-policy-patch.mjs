import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./codex-injector.mjs", import.meta.url);
let source = await readFile(path, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

replaceOnce(
`import {
  parseTaskboardAutomationHostRequest,
  reconcileTaskboardAutomation,
  taskboardAutomationPolicyOperation,
} from "../shared/taskboard-automation.mjs";`,
`import {
  parseTaskboardAutomationHostRequest,
  reconcileTaskboardAutomation,
} from "../shared/taskboard-automation.mjs";
import {
  decideTaskboardAutomationPolicy,
  isTemporaryAutomationPauseReason,
  shouldDisableTaskboardAutomationPolicy,
} from "../shared/taskboard-automation-policy.mjs";
import { summarizeRunnableTodos } from "../shared/taskboard-runnable-todo.mjs";`,
"automation imports",
);

replaceOnce(
`async function applyTaskboardAutomationPolicy(
  request,
  rpc,
  stillCurrent = () => true,
  { explicit = false, previousQuotaState } = {},
) {
  const todoResponse = request.enabledByUser
    ? await fetch(
      \`${"${taskboardBaseUrl}"}/api/tasks?projectId=${"${encodeURIComponent(request.taskboardProjectId)}"}&status=todo\`,
      { cache: "no-store" },
    )
    : null;
  if (todoResponse && !todoResponse.ok) {
    throw new Error(\`Taskboard todo check returned HTTP ${"${todoResponse.status}"}\`);
  }
  const todoPayload = todoResponse ? await todoResponse.json() : null;
  if (todoPayload && !Array.isArray(todoPayload.tasks)) {
    throw new Error("Taskboard todo check returned invalid JSON");
  }
  const hasTodo = todoPayload ? todoPayload.tasks.length > 0 : null;
  const quota = request.quotaAware && hasTodo !== false
    ? await readCodexQuotaStatus(request.model)
    : null;
  if (!stillCurrent()) return { quota, stale: true };
  let listed = null;
  let currentItem;
  if (!explicit && request.enabledByUser) {
    listed = await reconcileTaskboardAutomation({ ...request, operation: "list" }, rpc);
    const items = Array.isArray(listed.items) ? listed.items : [];
    currentItem = (
      request.automationId
        ? items.find((item) => item.id === request.automationId)
        : null
    ) ?? items[0];
  }
  const operation = taskboardAutomationPolicyOperation(request, {
    explicit,
    hasTodo,
    previousQuotaState,
    quotaState: quota?.state,
    currentStatus: currentItem?.status,
  });
  const result = operation === "list"
    ? { item: currentItem, items: listed.items }
    : await reconcileTaskboardAutomation({ ...request, operation }, rpc);
  if (result?.error === "not-found") {
    return { operation, hasTodo, ...(quota ? { quota } : {}) };
  }
  return { ...result, operation, hasTodo, ...(quota ? { quota } : {}) };
}`,
`async function applyTaskboardAutomationPolicy(
  request,
  rpc,
  stillCurrent = () => true,
  { explicit = false, previousQuotaState, previousPauseReason = null } = {},
) {
  const todoResponse = request.enabledByUser
    ? await fetch(
      \`${"${taskboardBaseUrl}"}/api/tasks?projectId=${"${encodeURIComponent(request.taskboardProjectId)}"}&status=todo\`,
      { cache: "no-store" },
    )
    : null;
  if (todoResponse && !todoResponse.ok) {
    throw new Error(\`Taskboard todo check returned HTTP ${"${todoResponse.status}"}\`);
  }
  const todoPayload = todoResponse ? await todoResponse.json() : null;
  if (todoPayload && !Array.isArray(todoPayload.tasks)) {
    throw new Error("Taskboard todo check returned invalid JSON");
  }
  const { hasTodo, hasRunnableTodo } = todoPayload
    ? summarizeRunnableTodos(todoPayload.tasks)
    : { hasTodo: null, hasRunnableTodo: null };
  const quota = request.quotaAware && hasRunnableTodo !== false
    ? await readCodexQuotaStatus(request.model)
    : null;
  if (!stillCurrent()) return { quota, stale: true };
  let listed = null;
  let currentItem;
  if (!explicit && request.enabledByUser) {
    listed = await reconcileTaskboardAutomation({ ...request, operation: "list" }, rpc);
    const items = Array.isArray(listed.items) ? listed.items : [];
    currentItem = (
      request.automationId
        ? items.find((item) => item.id === request.automationId)
        : null
    ) ?? items[0];
  }
  const { operation, pauseReason } = decideTaskboardAutomationPolicy(request, {
    explicit,
    hasTodo,
    hasRunnableTodo,
    previousQuotaState,
    quotaState: quota?.state,
    currentStatus: currentItem?.status,
    previousPauseReason,
  });
  const result = operation === "list"
    ? { item: currentItem, items: listed.items }
    : await reconcileTaskboardAutomation({ ...request, operation }, rpc);
  if (result?.error === "not-found") {
    return {
      operation,
      pauseReason,
      hasTodo,
      hasRunnableTodo,
      ...(quota ? { quota } : {}),
    };
  }
  return {
    ...result,
    operation,
    pauseReason,
    hasTodo,
    hasRunnableTodo,
    ...(quota ? { quota } : {}),
  };
}`,
"applyTaskboardAutomationPolicy",
);

replaceOnce(
`function restoredAutomationPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { quota, ...stored } = value;
  const request = parseTaskboardAutomationHostRequest({
    ...stored,
    id: "restored-policy",
    action: "automation",
    requestId: "restored-policy",
    operation: "apply-policy",
  });
  return request ? { request, ...(quota ? { quota } : {}) } : null;
}`,
`function restoredAutomationPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { quota, pauseReason, ...stored } = value;
  const request = parseTaskboardAutomationHostRequest({
    ...stored,
    id: "restored-policy",
    action: "automation",
    requestId: "restored-policy",
    operation: "apply-policy",
  });
  return request ? {
    request,
    ...(quota ? { quota } : {}),
    ...(isTemporaryAutomationPauseReason(pauseReason) ? { pauseReason } : {}),
  } : null;
}`,
"restored automation policy",
);

replaceOnce(
`      {
        ...storedAutomationPolicy(record.request),
        ...(record.quota ? { quota: record.quota } : {}),
      },`,
`      {
        ...storedAutomationPolicy(record.request),
        ...(record.quota ? { quota: record.quota } : {}),
        ...(isTemporaryAutomationPauseReason(record.pauseReason)
          ? { pauseReason: record.pauseReason }
          : {}),
      },`,
"persisted pause reason",
);

replaceOnce(
`      const result = await applyTaskboardAutomationPolicy(
        current.request,
        rpc,
        () => quotaPolicyRecords.get(key)?.version === current.version,
        {
          explicit,
          previousQuotaState: current.quota?.state,
        },
      );
      if (result.stale) return result;
      if (result.hasTodo === false && result.operation === "pause") {
        current.version += 1;
        current.request = { ...current.request, enabledByUser: false };
      } else if (!explicit && result.operation === "list" && result.item?.status === "PAUSED") {
        current.version += 1;
        current.request = { ...current.request, enabledByUser: false };
      }
      if (result.item?.id) {
        current.request = { ...current.request, automationId: result.item.id };
      }
      if (current.request.quotaAware && result.quota) current.quota = result.quota;
      else if (!current.request.quotaAware) delete current.quota;
      await persistQuotaPolicies();`,
`      const result = await applyTaskboardAutomationPolicy(
        current.request,
        rpc,
        () => quotaPolicyRecords.get(key)?.version === current.version,
        {
          explicit,
          previousQuotaState: current.quota?.state,
          previousPauseReason: current.pauseReason ?? null,
        },
      );
      if (result.stale) return result;
      if (shouldDisableTaskboardAutomationPolicy({
        operation: result.operation,
        pauseReason: result.pauseReason,
        currentStatus: result.item?.status,
      })) {
        current.version += 1;
        current.request = { ...current.request, enabledByUser: false };
        delete current.pauseReason;
      } else if (isTemporaryAutomationPauseReason(result.pauseReason)) {
        current.pauseReason = result.pauseReason;
      } else {
        delete current.pauseReason;
      }
      if (result.item?.id) {
        current.request = { ...current.request, automationId: result.item.id };
      }
      if (current.request.quotaAware && result.quota) current.quota = result.quota;
      else if (!current.request.quotaAware) delete current.quota;
      await persistQuotaPolicies();`,
"quota policy state update",
);

await writeFile(path, source);
console.log("Applied runnable Todo automation policy patch.");
