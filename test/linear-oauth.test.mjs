import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLinearOAuthClient,
  LINEAR_OAUTH_REVOKE_ENDPOINT,
  LINEAR_OAUTH_TOKEN_ENDPOINT,
} from "../server/linear-oauth.mjs";
import { createLinearConfigStore } from "../server/linear-config.mjs";
import { createLinearIntegration } from "../server/linear-integration.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Linear OAuth builds PKCE authorization and exchanges or refreshes tokens", async () => {
  const requests = [];
  const client = createLinearOAuthClient({
    clientId: "linear-client-id",
    redirectUri: "http://127.0.0.1:47823/api/local/linear-oauth/callback",
    fetch: async (url, init) => {
      requests.push({ url, body: new URLSearchParams(init.body) });
      const body = new URLSearchParams(init.body);
      if (url === LINEAR_OAUTH_TOKEN_ENDPOINT && body.get("grant_type") === "authorization_code") {
        return jsonResponse({
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          expires_in: 3600,
          scope: "read write",
          token_type: "Bearer",
        });
      }
      return jsonResponse({
        access_token: "oauth-access-token-2",
        refresh_token: "oauth-refresh-token-2",
        expires_in: 3600,
        scope: "read write",
        token_type: "Bearer",
      });
    },
  });

  const authorization = client.authorizationUrl({ state: "state-value" });
  const authorizationUrl = new URL(authorization.url);
  assert.equal(authorizationUrl.searchParams.get("client_id"), "linear-client-id");
  assert.equal(authorizationUrl.searchParams.get("state"), "state-value");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.match(authorization.verifier, /^[A-Za-z0-9_-]{43}$/);

  const exchanged = await client.exchangeCode({ code: "authorization-code", verifier: authorization.verifier });
  assert.equal(exchanged.accessToken, "oauth-access-token");
  assert.equal(exchanged.refreshToken, "oauth-refresh-token");

  const refreshed = await client.refreshToken(exchanged.refreshToken);
  assert.equal(refreshed.accessToken, "oauth-access-token-2");
  assert.equal(refreshed.refreshToken, "oauth-refresh-token-2");
  assert.equal(requests[0].body.get("code_verifier"), authorization.verifier);
  assert.equal(requests[1].body.get("refresh_token"), "oauth-refresh-token");
});

test("Linear OAuth config stores tokens locally without exposing them in the public shape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-taskboard-oauth-"));
  try {
    const store = createLinearConfigStore({ configPath: path.join(directory, "linear-connection.json") });
    const config = await store.save({
      authType: "oauth",
      oauth: {
        accessToken: "oauth-access-token",
        refreshToken: "oauth-refresh-token",
        expiresAt: Date.now() + 3_600_000,
        scope: "read write",
      },
      teamIds: ["team-1"],
      projectIds: [],
      assignedToMeOnly: true,
    });
    assert.equal(config.version, 2);
    assert.equal((await store.read()).oauth.refreshToken, "oauth-refresh-token");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Linear OAuth revoke sends the refresh token in the token field", async () => {
  let requestBody = null;
  const client = createLinearOAuthClient({
    clientId: "linear-client-id",
    redirectUri: "http://127.0.0.1:47823/api/local/linear-oauth/callback",
    fetch: async (url, init) => {
      assert.equal(url, LINEAR_OAUTH_REVOKE_ENDPOINT);
      requestBody = new URLSearchParams(init.body);
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(await client.revokeToken("oauth-refresh-token"), { revoked: true });
  assert.equal(requestBody.get("token"), "oauth-refresh-token");
  assert.equal(requestBody.get("token_type_hint"), "refresh_token");
});

test("Linear integration completes OAuth and keeps token fields out of connection status", async () => {
  let config = null;
  const configStore = {
    async read() { return config; },
    async save(input) { config = input; return input; },
    async clear() { config = null; },
    validate(input) { return input; },
  };
  const integration = createLinearIntegration({
    configStore,
    oauthClientId: "linear-client-id",
    oauthRedirectUri: "http://127.0.0.1:47823/api/local/linear-oauth/callback",
    oauthFetch: async (_url, init) => {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("code_verifier")?.length, 43);
      return jsonResponse({
        access_token: "oauth-access-token",
        refresh_token: "oauth-refresh-token",
        expires_in: 3600,
        scope: "read write",
      });
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.query.includes("LinearTaskboardViewer")) {
        return jsonResponse({
          data: {
            viewer: {
              id: "viewer-1",
              name: "Viewer",
              displayName: "Viewer",
              avatarUrl: null,
              organization: { id: "org-1", name: "RIB" },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          viewer: {
            assignedIssues: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    },
  });

  const authorizationUrl = new URL(integration.oauthStart());
  const status = await integration.oauthCallback({
    code: "authorization-code",
    state: authorizationUrl.searchParams.get("state"),
  });
  assert.equal(status.authType, "oauth");
  assert.equal(status.oauthClientConfigured, true);
  assert.equal(Object.hasOwn(status, "accessToken"), false);
  assert.equal(Object.hasOwn(status, "refreshToken"), false);
  assert.equal(config.oauth.accessToken, "oauth-access-token");
});
