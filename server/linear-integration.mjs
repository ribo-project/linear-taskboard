import { randomBytes } from "node:crypto";

import { createLinearClient } from "./linear-client.mjs";
import { createLinearOAuthClient, LINEAR_OAUTH_SCOPE } from "./linear-oauth.mjs";
import {
  chooseLinearWorkflowState,
  linearOriginId,
  linearPriorityFromTask,
  normalizeLinearIssue,
} from "./linear-mapping.mjs";

const SYNC_INTERVAL_MS = 60_000;
// Public OAuth clients use PKCE; the client ID is not a credential.
const DEFAULT_LINEAR_OAUTH_CLIENT_ID = "11542f79fcb6a9c01933cf5810673c29";
const CODEX_READY_LABEL = "codex-ready";
const CODEX_READY_LABEL_COLOR = "#5E6AD2";
const CODEX_READY_LABEL_DESCRIPTION = "Allows Codex Taskboard automation to claim this issue automatically.";

function inScope(issue, config) {
  if (config.teamIds.length > 0 && !config.teamIds.includes(issue.team?.id)) return false;
  if (config.projectIds.length > 0 && !config.projectIds.includes(issue.project?.id)) return false;
  return true;
}

function safeConnection(config, state = {}) {
  if (!config) {
    return {
      configured: false,
      authType: null,
      oauthClientConfigured: state.oauthClientConfigured ?? false,
      assignedToMeOnly: true,
      teamIds: [],
      projectIds: [],
      viewer: null,
      organization: null,
      lastSyncedAt: null,
      issueCount: 0,
      projectCount: 0,
    };
  }

  return {
    configured: true,
    authType: config.version === 2 ? "oauth" : "api-key",
    oauthClientConfigured: state.oauthClientConfigured ?? false,
    oauthScope: config.version === 2 ? config.oauth.scope : null,
    oauthExpiresAt: config.version === 2 ? config.oauth.expiresAt : null,
    assignedToMeOnly: config.assignedToMeOnly,
    teamIds: config.teamIds,
    projectIds: config.projectIds,
    viewer: state.viewer ?? null,
    organization: state.organization ?? null,
    lastSyncedAt: state.lastSyncedAt ?? null,
    issueCount: state.issueCount ?? 0,
    projectCount: state.projectCount ?? 0,
  };
}

function findIssueLabel(labels, name) {
  const normalized = name.toLocaleLowerCase("en-US");
  return labels.find((label) => label?.name?.toLocaleLowerCase("en-US") === normalized) ?? null;
}

export function createLinearIntegration({
  configStore,
  projection = null,
  fetch: fetchImplementation = globalThis.fetch,
  endpoint,
  oauthClientId = process.env.LINEAR_OAUTH_CLIENT_ID || DEFAULT_LINEAR_OAUTH_CLIENT_ID,
  oauthClientSecret = process.env.LINEAR_OAUTH_CLIENT_SECRET,
  oauthRedirectUri = process.env.LINEAR_OAUTH_REDIRECT_URI
    ?? `http://127.0.0.1:${process.env.CODEX_TASKBOARD_PORT || "47823"}/api/local/linear-oauth/callback`,
  oauthFetch = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!configStore) throw new Error("configStore is required");

  let lastState = null;
  let pendingSync = null;
  let pendingOAuthRefresh = null;
  const oauthSessions = new Map();
  const oauthClient = oauthClientId
    ? createLinearOAuthClient({
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        redirectUri: oauthRedirectUri,
        fetch: oauthFetch,
      })
    : null;

  function connectionState() {
    return { ...(lastState ?? {}), oauthClientConfigured: Boolean(oauthClient) };
  }

  function clientFor(config) {
    return createLinearClient({
      apiKey: config.apiKey,
      accessToken: config.oauth?.accessToken,
      fetch: fetchImplementation,
      ...(endpoint ? { endpoint } : {}),
    });
  }

  async function refreshOAuthConfig(config) {
    if (config?.version !== 2) return config;
    if (!oauthClient) {
      throw new Error("Linear OAuth is not configured; set LINEAR_OAUTH_CLIENT_ID");
    }
    if (config.oauth.expiresAt > now() + 60_000) return config;
    if (pendingOAuthRefresh) return pendingOAuthRefresh;
    pendingOAuthRefresh = oauthClient.refreshToken(config.oauth.refreshToken)
      .then((tokens) => configStore.save({
        ...config,
        oauth: tokens,
      }))
      .finally(() => {
        pendingOAuthRefresh = null;
      });
    return pendingOAuthRefresh;
  }

  async function fetchSnapshot(config) {
    const client = clientFor(config);
    const viewer = await client.viewer();
    const organizationId = viewer?.organization?.id;
    const organizationName = viewer?.organization?.name ?? "Linear";
    if (!organizationId) {
      throw new Error("Linear viewer response is missing organization identity");
    }

    const rawIssues = await client.listIssues({ assignedToMeOnly: config.assignedToMeOnly });
    const scopedIssues = rawIssues.filter((issue) => inScope(issue, config));
    const issues = scopedIssues.map((issue, index) => normalizeLinearIssue(issue, {
      organizationId,
      organizationName,
      index,
    }));

    const projects = [...new Map(issues.map((issue) => [issue.project.id, {
      ...issue.project,
      source: "linear",
      externalOrigin: issue.externalOrigin,
    }])).values()];

    return {
      client,
      originId: linearOriginId(organizationId),
      viewer: {
        id: viewer.id,
        name: viewer.displayName ?? viewer.name ?? "Linear user",
        avatarUrl: viewer.avatarUrl ?? null,
      },
      organization: {
        id: organizationId,
        name: organizationName,
      },
      projects,
      issues,
    };
  }

  async function applyProjection(snapshot, { archiveMissing = true } = {}) {
    if (!projection?.syncLinearSnapshot) return;
    await projection.syncLinearSnapshot({
      originId: snapshot.originId,
      organization: snapshot.organization,
      projects: snapshot.projects,
      issues: snapshot.issues,
      archiveMissing,
    });
  }

  function recordState(snapshot) {
    lastState = {
      viewer: snapshot.viewer,
      organization: snapshot.organization,
      lastSyncedAt: new Date().toISOString(),
      issueCount: snapshot.issues.length,
      projectCount: snapshot.projects.length,
    };
    return lastState;
  }

  async function syncWithConfig(config, { archiveMissing = true } = {}) {
    const snapshot = await fetchSnapshot(config);
    await applyProjection(snapshot, { archiveMissing });
    recordState(snapshot);
    return { connection: safeConnection(config, connectionState()), snapshot };
  }

  async function sync({ force = false, archiveMissing = true } = {}) {
    const config = await refreshOAuthConfig(await configStore.read());
    if (!config) return { connection: safeConnection(null, connectionState()), snapshot: null };

    if (
      !force
      && lastState?.lastSyncedAt
      && Date.now() - new Date(lastState.lastSyncedAt).getTime() < SYNC_INTERVAL_MS
    ) {
      return { connection: safeConnection(config, connectionState()), snapshot: null };
    }

    if (pendingSync) return pendingSync;
    pendingSync = syncWithConfig(config, { archiveMissing }).finally(() => {
      pendingSync = null;
    });
    return pendingSync;
  }

  async function withClient(operation) {
    const config = await refreshOAuthConfig(await configStore.read());
    if (!config) throw new Error("Linear is not configured");
    return operation(clientFor(config));
  }

  return {
    async status() {
      return safeConnection(await configStore.read(), connectionState());
    },

    async configure(input) {
      const candidate = configStore.validate(input);
      const snapshot = await fetchSnapshot(candidate);
      await applyProjection(snapshot, { archiveMissing: true });
      const saved = await configStore.save(candidate);
      recordState(snapshot);
      return safeConnection(saved, connectionState());
    },

    oauthStart() {
      if (!oauthClient) {
        throw new Error("Linear OAuth is not configured; set LINEAR_OAUTH_CLIENT_ID");
      }
      const state = randomBytes(32).toString("base64url");
      const authorization = oauthClient.authorizationUrl({ state, scope: LINEAR_OAUTH_SCOPE });
      oauthSessions.set(state, { verifier: authorization.verifier, createdAt: now() });
      for (const [key, session] of oauthSessions) {
        if (now() - session.createdAt > 10 * 60_000) oauthSessions.delete(key);
      }
      while (oauthSessions.size > 20) oauthSessions.delete(oauthSessions.keys().next().value);
      return authorization.url;
    },

    async oauthCallback({ code, state }) {
      const session = oauthSessions.get(state);
      oauthSessions.delete(state);
      if (!session || now() - session.createdAt > 10 * 60_000) {
        throw new Error("Linear OAuth state is invalid or expired");
      }
      const tokens = await oauthClient.exchangeCode({ code, verifier: session.verifier });
      const candidate = {
        version: 2,
        authType: "oauth",
        oauth: tokens,
        teamIds: [],
        projectIds: [],
        assignedToMeOnly: true,
      };
      const previous = await configStore.read();
      if (previous) {
        candidate.teamIds = previous.teamIds;
        candidate.projectIds = previous.projectIds;
        candidate.assignedToMeOnly = previous.assignedToMeOnly;
      }
      const snapshot = await fetchSnapshot(candidate);
      await applyProjection(snapshot, { archiveMissing: true });
      const saved = await configStore.save(candidate);
      recordState(snapshot);
      return safeConnection(saved, connectionState());
    },

    async oauthRevoke() {
      const config = await configStore.read();
      if (!config || config.version !== 2) return safeConnection(config, connectionState());
      let revokeError = null;
      try {
        if (!oauthClient) {
          throw new Error("Linear OAuth is not configured; set LINEAR_OAUTH_CLIENT_ID");
        }
        await oauthClient.revokeToken(config.oauth.refreshToken, "refresh_token");
      } catch (error) {
        revokeError = error;
      } finally {
        await configStore.clear();
        lastState = null;
        pendingSync = null;
      }
      if (revokeError) throw revokeError;
      return safeConnection(null, connectionState());
    },

    async clear() {
      await configStore.clear();
      lastState = null;
      pendingSync = null;
      return safeConnection(null, connectionState());
    },

    sync,

    async reconcile() {
      const config = await configStore.read();
      if (!config) throw new Error("Linear is not configured");
      return syncWithConfig(config, { archiveMissing: false });
    },

    async listComments(nativeRef) {
      if (!nativeRef?.issueId) throw new Error("Linear issue native reference is incomplete");
      return withClient((client) => client.listComments(nativeRef.issueId));
    },

    async moveIssue(nativeRef, targetStatus) {
      if (!nativeRef?.issueId || !nativeRef?.teamId) {
        throw new Error("Linear issue native reference is incomplete");
      }
      return withClient(async (client) => {
        const states = await client.listWorkflowStates(nativeRef.teamId);
        const target = chooseLinearWorkflowState(states, targetStatus);
        if (!target) {
          throw new Error(`Linear team has no workflow state mapped to ${targetStatus}`);
        }
        return client.updateIssue(nativeRef.issueId, { stateId: target.id });
      });
    },

    async updatePriority(nativeRef, taskPriority) {
      if (!nativeRef?.issueId) throw new Error("Linear issue native reference is incomplete");
      return withClient((client) => client.updateIssue(nativeRef.issueId, {
        priority: linearPriorityFromTask(taskPriority),
      }));
    },

    async setCodexReady(nativeRef, enabled) {
      if (!nativeRef?.issueId) throw new Error("Linear issue native reference is incomplete");
      if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      return withClient(async (client) => {
        const labels = await client.listIssueLabels();
        let label = findIssueLabel(labels, CODEX_READY_LABEL);
        if (!label && !enabled) {
          return { changed: false, enabled: false, label: null };
        }
        if (!label) {
          label = await client.createIssueLabel({
            name: CODEX_READY_LABEL,
            color: CODEX_READY_LABEL_COLOR,
            description: CODEX_READY_LABEL_DESCRIPTION,
          });
        }
        await client.updateIssue(nativeRef.issueId, enabled
          ? { addedLabelIds: [label.id] }
          : { removedLabelIds: [label.id] });
        return { changed: true, enabled, label };
      });
    },

    async addComment(nativeRef, body) {
      if (!nativeRef?.issueId) throw new Error("Linear issue native reference is incomplete");
      return withClient((client) => client.createComment(nativeRef.issueId, body));
    },
  };
}

export {
  CODEX_READY_LABEL,
  CODEX_READY_LABEL_COLOR,
  CODEX_READY_LABEL_DESCRIPTION,
};
