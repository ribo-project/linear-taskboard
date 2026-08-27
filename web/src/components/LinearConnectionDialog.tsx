import { useEffect, useState, type FormEvent } from "react";

import { useTaskboardI18n } from "../i18n";
import type { LinearConnection } from "../linearApi";

interface LinearConnectionDialogProps {
  connection: LinearConnection | null;
  saving: boolean;
  syncing: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: {
    apiKey: string;
    teamIds: string[];
    projectIds: string[];
    assignedToMeOnly: boolean;
  }) => Promise<void>;
  onSync: () => Promise<void>;
}

function parseIds(value: string): string[] {
  return [...new Set(value
    .split(/[,，\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

export function LinearConnectionDialog({
  connection,
  saving,
  syncing,
  error,
  onClose,
  onSave,
  onSync,
}: LinearConnectionDialogProps) {
  const { text } = useTaskboardI18n();
  const [apiKey, setApiKey] = useState("");
  const [assignedToMeOnly, setAssignedToMeOnly] = useState(connection?.assignedToMeOnly ?? true);
  const [teamIdsText, setTeamIdsText] = useState(connection?.teamIds.join(", ") ?? "");
  const [projectIdsText, setProjectIdsText] = useState(connection?.projectIds.join(", ") ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setApiKey("");
    setAssignedToMeOnly(connection?.assignedToMeOnly ?? true);
    setTeamIdsText(connection?.teamIds.join(", ") ?? "");
    setProjectIdsText(connection?.projectIds.join(", ") ?? "");
    setAdvancedOpen(Boolean(connection?.teamIds.length || connection?.projectIds.length));
  }, [connection]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({
      apiKey,
      assignedToMeOnly,
      teamIds: parseIds(teamIdsText),
      projectIds: parseIds(projectIdsText),
    });
  }

  const busy = saving || syncing;

  return (
    <div
      className="delete-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="delete-dialog project-create-dialog jira-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="linear-connection-title"
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
      >
        <h2 id="linear-connection-title">
          {connection?.configured
            ? text("Linear 連線設定", "Linear settings")
            : text("連接 Linear", "Connect Linear")}
        </h2>

        {connection?.configured && connection.organization && (
          <p>
            {text("目前 Workspace：", "Current workspace: ")}
            {connection.organization.name}
            {connection.viewer ? ` · ${connection.viewer.name}` : ""}
          </p>
        )}

        <label>
          <span>{text("Personal API Key", "Personal API key")}</span>
          <input
            autoFocus
            required
            type="password"
            autoComplete="off"
            maxLength={4096}
            placeholder={connection?.configured
              ? text("重新儲存設定時請再次輸入", "Enter again when saving settings")
              : "lin_api_…"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <p className="jira-http-warning">
          {text(
            "API Key 只會儲存在這台裝置的 Taskboard 設定檔，不會回傳到瀏覽器狀態或寫進任務資料。",
            "The API key is stored only in this device's Taskboard config and is never returned in connection status or task data.",
          )}
        </p>

        <label className="linear-connection-checkbox">
          <input
            type="checkbox"
            checked={assignedToMeOnly}
            onChange={(event) => setAssignedToMeOnly(event.target.checked)}
          />
          <span>{text("只同步指派給我的 Issue", "Sync only issues assigned to me")}</span>
        </label>

        <button
          className="button secondary"
          type="button"
          disabled={busy}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          {advancedOpen
            ? text("隱藏進階範圍", "Hide advanced scope")
            : text("進階範圍", "Advanced scope")}
        </button>

        {advancedOpen && (
          <>
            <label>
              <span>{text("Team IDs（可留空）", "Team IDs (optional)")}</span>
              <input
                maxLength={2600}
                placeholder="team-id-1, team-id-2"
                value={teamIdsText}
                onChange={(event) => setTeamIdsText(event.target.value)}
              />
            </label>
            <label>
              <span>{text("Project IDs（可留空）", "Project IDs (optional)")}</span>
              <input
                maxLength={2600}
                placeholder="project-id-1, project-id-2"
                value={projectIdsText}
                onChange={(event) => setProjectIdsText(event.target.value)}
              />
            </label>
          </>
        )}

        {connection?.configured && (
          <p>
            {text("目前快取：", "Current projection: ")}
            {connection.projectCount} {text("個專案、", "projects, ")}
            {connection.issueCount} {text("個 Issue", "issues")}
            {connection.lastSyncedAt
              ? ` · ${text("最後同步", "last synced")} ${new Date(connection.lastSyncedAt).toLocaleString()}`
              : ""}
          </p>
        )}

        {error && <p className="project-dialog-error" role="alert">{error}</p>}

        <div>
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
            {text("取消", "Cancel")}
          </button>
          {connection?.configured && (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => void onSync()}
            >
              {syncing ? text("同步中…", "Syncing…") : text("立即同步", "Sync now")}
            </button>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={busy || !apiKey.trim()}
          >
            {saving
              ? text("連線中…", "Connecting…")
              : connection?.configured
                ? text("儲存並同步", "Save and sync")
                : text("連接並同步", "Connect and sync")}
          </button>
        </div>
      </form>
    </div>
  );
}
