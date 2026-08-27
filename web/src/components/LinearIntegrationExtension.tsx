import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { listProjects } from "../api";
import {
  configureLinearConnection,
  getLinearConnection,
  syncLinearConnection,
  type LinearConnection,
} from "../linearApi";
import type { Project } from "../types";
import { LinearConnectionDialog } from "./LinearConnectionDialog";
import { RefreshIcon, RelationIcon } from "./SemanticIcons";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Linear 連線失敗";
}

function selectedProjectId(): string | null {
  return new URL(window.location.href).searchParams.get("project");
}

export function LinearIntegrationExtension() {
  const [connection, setConnection] = useState<LinearConnection | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<HTMLElement | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [routeProjectId, setRouteProjectId] = useState(selectedProjectId);

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

  useEffect(() => {
    document.documentElement.dataset.linearProject = String(isLinearProject);
    return () => {
      delete document.documentElement.dataset.linearProject;
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
    </>
  );
}
