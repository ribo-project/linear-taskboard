import { createHash } from "node:crypto";

function includesAny(value, terms) {
  const normalized = String(value ?? "").toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function limitedString(value, fallback, maxLength) {
  const result = String(value ?? fallback).trim();
  return (result || fallback).slice(0, maxLength);
}

export function taskStatusFromLinear(state) {
  const type = String(state?.type ?? "").toLowerCase();
  const name = String(state?.name ?? "");

  if (type === "completed") return "done";
  if (type === "canceled" || type === "cancelled" || type === "duplicate") return "canceled";
  if (type === "backlog" || type === "triage") return "backlog";
  if (type === "unstarted") return "todo";

  if (type === "started") {
    if (includesAny(name, ["review", "verify", "verification", "test", "qa", "驗收", "審查", "測試"])) {
      return "in_review";
    }
    if (includesAny(name, ["block", "blocked", "hold", "waiting", "阻塞", "暫停", "等待"])) {
      return "blocked";
    }
    return "in_progress";
  }

  if (includesAny(name, ["cancel", "won't", "wont", "duplicate", "取消", "不處理"])) return "canceled";
  if (includesAny(name, ["done", "complete", "完成"])) return "done";
  if (includesAny(name, ["review", "verify", "test", "驗收", "審查", "測試"])) return "in_review";
  if (includesAny(name, ["block", "hold", "waiting", "阻塞", "暫停", "等待"])) return "blocked";
  return "todo";
}

export function taskPriorityFromLinear(priority) {
  switch (Number(priority)) {
    case 1: return "urgent";
    case 2: return "high";
    case 3: return "medium";
    case 4: return "low";
    default: return "none";
  }
}

export function linearPriorityFromTask(priority) {
  switch (priority) {
    case "urgent": return 1;
    case "high": return 2;
    case "medium": return 3;
    case "low": return 4;
    default: return 0;
  }
}

export function linearOriginId(organizationId) {
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    throw new TypeError("organizationId is required");
  }
  return createHash("sha256").update(organizationId.trim()).digest("hex");
}

export function linearProjectKey(projectId) {
  if (!projectId) return "linear-no-project";
  const digest = createHash("sha256").update(String(projectId)).digest("hex").slice(0, 16);
  return `linear-${digest}`;
}

function actorFromLinear(user, fallback) {
  const id = limitedString(user?.id, fallback, 240);
  return {
    type: "user",
    id: `linear:${id}`,
    name: limitedString(user?.displayName ?? user?.name, fallback, 120),
    avatarUrl: typeof user?.avatarUrl === "string" ? user.avatarUrl : null,
  };
}

export function normalizeLinearIssue(issue, {
  organizationId,
  organizationName = "Linear",
  index = 0,
} = {}) {
  if (!issue?.id) throw new TypeError("Linear issue is missing id");
  if (!issue?.identifier) throw new TypeError("Linear issue is missing identifier");

  const originId = linearOriginId(organizationId);
  const externalId = String(issue.id);
  const externalKey = limitedString(issue.identifier, "LINEAR", 128);
  const internalId = `LINEAR:${originId.toUpperCase()}:${externalId}`;
  const labels = Array.isArray(issue.labels?.nodes)
    ? [...new Set(issue.labels.nodes.flatMap((label) => {
      if (typeof label?.name !== "string") return [];
      const normalized = label.name.trim().slice(0, 64);
      return normalized ? [normalized] : [];
    }))].slice(0, 50)
    : [];

  const projectId = issue.project?.id ?? null;
  const projectName = issue.project?.name ?? null;
  const teamId = issue.team?.id ?? null;
  const teamKey = issue.team?.key ?? null;

  return {
    id: internalId,
    identifier: internalId,
    title: limitedString(issue.title, externalKey, 240),
    description: typeof issue.description === "string" ? issue.description.slice(0, 100_000) : "",
    status: taskStatusFromLinear(issue.state),
    priority: taskPriorityFromLinear(issue.priority),
    labels,
    sortOrder: (index + 1) * 1024,
    creator: actorFromLinear(issue.creator, organizationName),
    assignee: actorFromLinear(issue.assignee, "Unassigned"),
    dueDate: typeof issue.dueDate === "string" ? issue.dueDate : null,
    source: "linear",
    externalOrigin: originId,
    externalId,
    externalKey,
    externalUrl: typeof issue.url === "string" ? issue.url : null,
    createdAt: typeof issue.createdAt === "string" ? issue.createdAt : new Date().toISOString(),
    updatedAt: typeof issue.updatedAt === "string" ? issue.updatedAt : new Date().toISOString(),
    nativeRef: {
      issueId: externalId,
      issueIdentifier: externalKey,
      stateId: issue.state?.id ?? null,
      stateType: issue.state?.type ?? null,
      teamId,
      teamKey,
      projectId,
      projectName,
      parentId: issue.parent?.id ?? null,
      parentIdentifier: issue.parent?.identifier ?? null,
    },
    project: {
      id: linearProjectKey(projectId),
      externalId: projectId,
      name: projectName ?? `${organizationName} · No project`,
      teamId,
      teamKey,
    },
  };
}

export function chooseLinearWorkflowState(states, targetStatus) {
  const candidates = Array.isArray(states) ? states : [];
  const mapped = candidates.filter((state) => taskStatusFromLinear(state) === targetStatus);
  if (mapped.length === 0) return null;

  return [...mapped].sort((left, right) => {
    const leftPosition = Number.isFinite(Number(left?.position)) ? Number(left.position) : Number.MAX_SAFE_INTEGER;
    const rightPosition = Number.isFinite(Number(right?.position)) ? Number(right.position) : Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition;
  })[0];
}
