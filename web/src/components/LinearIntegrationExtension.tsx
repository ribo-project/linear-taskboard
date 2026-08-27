import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { listProjects } from "../api";
import {
  configureLinearConnection,
  getLinearConnection,
  syncLinearConnection,
  type LinearConnection,
} from "../linearApi";
import { taskboardStorage } from "../storage";
import type { CodexProjectIdentity, HostContext, Project } from "../types";
import { LinearConnectionDialog } from "./LinearConnectionDialog";
import { RefreshIcon, RelationIcon } from "./SemanticIcons";

const PROJECT_CODEX_IDENTITIES_KEY = "taskboard.projectCodexIdentities.v1";
const DEVICE_WORKSPACE_PATHS_KEY = "taskboard.deviceWorkspacePaths.v1";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Linear 連線失敗";
}

function selectedProjectId(): string | null {
  return new URL(window.location.href).searchParams.get("project");
}

function readJsonRecord<T>(key: string): Record<string, T> {
  try {
    const value = JSON.parse(taskboardStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, T>
      : {};
  } catch {
    return {};
  }
}

function currentCodexIdentity(hostContext: HostContext | null): {
  identity: CodexProjectIdentity;
  name: string;
} | null {
  if (!hostContext) return null;
  const liveProject = hostContext.projects?.find((project) => project.id === hostContext.projectId)
    ?? hostContext.projects?.find((project) => (
      hostContext.workspacePath && project.workspacePath === hostContext.workspacePath
    ));
  if (!liveProject?.id) return null;
  const workspacePath = liveProject.workspacePath ?? hostContext.workspacePath;
  if (!workspacePath) return null;
  const codexProjectKind = liveProject.projectKind ?? "local";
  const codexHostId = liveProject.hostId ?? "local";
  if (codexProjectKind === "remote" && codexHostId === "local") return null;
  return {
    identity: {
      codexProjectId: liveProject.id,
      codexProjectKind,
      codexHostId,
      workspacePath,
    },
    name: liveProject.name || liveProject.id,
  };
}

function sameIdentity(left: CodexProjectIdentity | null, right: CodexProjectIdentity | null) {
  return Boolean(
    left
    && right
    && left.codexProjectId === right.codexProjectId
    && left.codexProjectKind === right.codexProjectKind
    && left.codexHostId === right.codexHostId
    && left.workspacePath === right.workspacePath,
  );
}

export function LinearIntegrationExtension() {
  const [connection, setConnection] = useState<LinearConnection | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<HTMLElement | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [routeProjectId, setRouteProjectId] = useState(selectedProjectId);
  const [hostContext, setHostContext] = useState<HostContext | null>(null);
  const [projectMappings, setProjectMappings] = useState<Record<string, CodexProjectIdentity>>(
    () => readJsonRecord<CodexProjectIdentity>(PROJECT_CODEX_IDENTITIES_KEY),
  );

  const refreshConnectionState = useCallback(async (signal?: AbortSignal) => {
    const [nextConnection, nextProjects] = await Promise.all([
      getLinearConnection(signal),
      listProjects(signal),
    ]);
    setConnection(nextConnection);
    setProjects(nextProjects);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshConnectionState(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [refreshConnectionState]);

  useEffect(() => {
    if (window.parent === window) return;
    const receiveHostMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: string; payload?: unknown };
      if (message.type !== "taskboard:host-context" || !message.payload) return;
      setHostContext(message.payload as HostContext);
    };
    window.addEventListener("message", receiveHostMessage);
    return () => window.removeEventListener("message", receiveHostMessage);
  }, []);

  useEffect(() => {
    const refreshTargets = () => {
      setMenuTarget(document.querySelector<HTMLElement>(".project-menu-actions"));
      setHeaderTarget(document.querySelector<HTMLElement>(".header-actions"));
    };
    refreshTargets();
    const observer = new MutationObserver(refreshTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = selectedProjectId();
      setRouteProjectId((current) => current === next ? current : next);
    }, 400);
    return () => window.clearInterval(timer);
  }, []);

  const linearProjectIds = useMemo(
    () => new Set(projects.filter((project) => project.source === "linear").map((project) => project.id)),
    [projects],
  );
  const isLinearProject = Boolean(routeProjectId && linearProjectIds.has(routeProjectId));
  const selectedLinearProject = routeProjectId
    ? projects.find((project) => project.id === routeProjectId && project.source === "linear") ?? null
    : null;
  const currentCodex = useMemo(() => currentCodexIdentity(hostContext), [hostContext]);
  const savedMapping = routeProjectId ? projectMappings[routeProjectId] ?? null : null;
  const mappedToCurrent = sameIdentity(savedMapping, currentCodex?.identity ?? null);

  useEffect(() => {
    document.documentElement.dataset.linearProject = String(isLinearProject);
    return () => {
      delete document.documentElement.dataset.linearProject;
    };
  }, [isLinearProject]);

  useEffect(() => {
    if (!isLinearProject) return;
    const isTaskCardEvent = (event: Event) => (
      event.target instanceof Element && Boolean(event.target.closest("[data-task-id]"))
    );
    const preventDrag = (event: Event) => {
      if (!isTaskCardEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const preventContextMenu = (event: Event) => {
      if (!isTaskCardEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("dragstart", preventDrag, true);
    document.addEventListener("contextmenu", preventContextMenu, true);
    return () => {
      document.removeEventListener("dragstart", preventDrag, true);
      document.removeEventListener("contextmenu", preventContextMenu, true);
    };
  }, [isLinearProject]);

  function openDialog() {
    setError(null);
    setDialogOpen(true);
  }

  async function saveConnection(input: {
    apiKey: string;
    teamIds: string[];
    projectIds: string[];
    assignedToMeOnly: boolean;
  }) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const nextConnection = await configureLinearConnection(input);
      setConnection(nextConnection);
      setDialogOpen(false);
      window.location.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function syncNow({ reload = true } = {}) {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const nextConnection = await syncLinearConnection();
      setConnection(nextConnection);
      if (reload) window.location.reload();
      else await refreshConnectionState();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  function saveCurrentCodexMapping() {
    if (!routeProjectId || !currentCodex) return;
    const nextMappings = {
      ...readJsonRecord<CodexProjectIdentity>(PROJECT_CODEX_IDENTITIES_KEY),
      [routeProjectId]: currentCodex.identity,
    };
    const nextWorkspacePaths = {
      ...readJsonRecord<string>(DEVICE_WORKSPACE_PATHS_KEY),
      [routeProjectId]: currentCodex.identity.workspacePath,
    };
    taskboardStorage.setItem(PROJECT_CODEX_IDENTITIES_KEY, JSON.stringify(nextMappings));
    taskboardStorage.setItem(DEVICE_WORKSPACE_PATHS_KEY, JSON.stringify(nextWorkspacePaths));
    setProjectMappings(nextMappings);
    setMappingDialogOpen(false);
    window.location.reload();
  }

  return (
    <>
      {menuTarget && createPortal(
        <button
          type="button"
          role="menuitem"
          onClick={openDialog}
        >
          <RelationIcon className="project-avatar" color="currentColor" size={16} />
          <span>{connection?.configured ? "Linear 設定" : "連接 Linear"}</span>
        </button>,
        menuTarget,
      )}

      {headerTarget && isLinearProject && createPortal(
        <>
          <span className="linear-readonly-badge" title="Linear 是此專案的任務來源">
            Linear · 唯讀
          </span>
          {currentCodex && (
            <button
              className={`linear-map-button${mappedToCurrent ? " is-mapped" : ""}`}
              type="button"
              onClick={() => setMappingDialogOpen(true)}
              title={mappedToCurrent
                ? `已綁定 ${currentCodex.name} · ${currentCodex.identity.workspacePath}`
                : `將此 Linear 專案綁定到 ${currentCodex.name}`}
            >
              {mappedToCurrent ? "Codex 已綁定" : savedMapping ? "重新綁定 Codex" : "綁定目前 Codex"}
            </button>
          )}
          <button
            className="icon-button linear-sync-button"
            type="button"
            disabled={syncing}
            onClick={() => void syncNow()}
            aria-label="同步 Linear"
            title="同步 Linear"
          >
            <RefreshIcon color="currentColor" />
          </button>
        </>,
        headerTarget,
      )}

      {dialogOpen && (
        <LinearConnectionDialog
          connection={connection}
          saving={saving}
          syncing={syncing}
          error={error}
          onClose={() => {
            if (!saving && !syncing) setDialogOpen(false);
          }}
          onSave={saveConnection}
          onSync={() => syncNow()}
        />
      )}

      {mappingDialogOpen && selectedLinearProject && currentCodex && (
        <div
          className="delete-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setMappingDialogOpen(false);
          }}
        >
          <div
            className="delete-dialog linear-mapping-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="linear-mapping-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setMappingDialogOpen(false);
            }}
          >
            <h2 id="linear-mapping-title">綁定 Linear 專案到 Codex</h2>
            <p>
              Linear 專案「{selectedLinearProject.name}」將使用目前 Codex 專案作為自動執行 workspace。
            </p>
            <dl className="linear-mapping-details">
              <div><dt>Codex 專案</dt><dd>{currentCodex.name}</dd></div>
              <div><dt>類型</dt><dd>{currentCodex.identity.codexProjectKind}</dd></div>
              <div><dt>Host</dt><dd>{currentCodex.identity.codexHostId}</dd></div>
              <div><dt>Workspace</dt><dd>{currentCodex.identity.workspacePath}</dd></div>
            </dl>
            <div>
              <button
                className="button secondary"
                type="button"
                onClick={() => setMappingDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                type="button"
                onClick={saveCurrentCodexMapping}
              >
                {savedMapping ? "更新綁定" : "確認綁定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
