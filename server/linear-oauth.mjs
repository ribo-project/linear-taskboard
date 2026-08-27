import { createHash, randomBytes } from "node:crypto";

export const LINEAR_OAUTH_AUTHORIZE_ENDPOINT = "https://linear.app/oauth/authorize";
export const LINEAR_OAUTH_TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
export const LINEAR_OAUTH_REVOKE_ENDPOINT = "https://api.linear.app/oauth/revoke";
export const LINEAR_OAUTH_SCOPE = "read,write";
const MAX_TOKEN_LENGTH = 16_384;

export class LinearOAuthError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "LinearOAuthError";
    this.code = code;
    this.details = details;
  }
}

function requiredText(value, code, message) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_TOKEN_LENGTH) {
    throw new LinearOAuthError(code, message);
  }
  return value.trim();
}

function validateRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LinearOAuthError("INVALID_LINEAR_OAUTH_REDIRECT_URI", "Linear OAuth redirect URI is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LinearOAuthError("INVALID_LINEAR_OAUTH_REDIRECT_URI", "Linear OAuth redirect URI must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LinearOAuthError("INVALID_LINEAR_OAUTH_REDIRECT_URI", "Linear OAuth redirect URI cannot contain credentials, query parameters, or a fragment");
  }
  return url.href;
}

function base64Url(value) {
  return value.toString("base64url");
}

function createPkcePair() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function parseTokenPayload(payload, previousRefreshToken = null) {
  const accessToken = requiredText(
    payload?.access_token,
    "LINEAR_OAUTH_TOKEN_INVALID",
    "Linear OAuth did not return an access token",
  );
  const refreshToken = payload?.refresh_token === undefined
    ? previousRefreshToken
    : requiredText(
        payload.refresh_token,
        "LINEAR_OAUTH_TOKEN_INVALID",
        "Linear OAuth did not return a valid refresh token",
      );
  if (!refreshToken) {
    throw new LinearOAuthError("LINEAR_OAUTH_TOKEN_INVALID", "Linear OAuth did not return a refresh token");
  }
  const expiresIn = Number(payload?.expires_in);
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 31_536_000) {
    throw new LinearOAuthError("LINEAR_OAUTH_TOKEN_INVALID", "Linear OAuth returned an invalid token lifetime");
  }
  const scope = typeof payload?.scope === "string"
    ? payload.scope.trim()
    : Array.isArray(payload?.scope)
      ? payload.scope.filter((value) => typeof value === "string").join(" ")
      : LINEAR_OAUTH_SCOPE.replaceAll(",", " ");
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope,
  };
}

async function readOAuthResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new LinearOAuthError("LINEAR_OAUTH_INVALID_RESPONSE", `Linear OAuth returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const description = typeof payload?.error_description === "string" && payload.error_description.trim()
      ? payload.error_description.trim()
      : "Linear OAuth request failed";
    throw new LinearOAuthError("LINEAR_OAUTH_REQUEST_FAILED", description, {
      error: typeof payload?.error === "string" ? payload.error : null,
      status: response.status,
    });
  }
  return payload;
}

export function createLinearOAuthClient({
  clientId,
  clientSecret = "",
  redirectUri,
  fetch: fetchImplementation = globalThis.fetch,
} = {}) {
  const normalizedClientId = requiredText(
    clientId,
    "LINEAR_OAUTH_CLIENT_ID_REQUIRED",
    "LINEAR_OAUTH_CLIENT_ID is required for Linear OAuth",
  );
  const normalizedRedirectUri = validateRedirectUri(redirectUri);
  if (typeof fetchImplementation !== "function") throw new TypeError("fetch must be a function");
  const normalizedClientSecret = typeof clientSecret === "string" ? clientSecret.trim() : "";

  async function tokenRequest(parameters) {
    let response;
    try {
      response = await fetchImplementation(LINEAR_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(parameters),
      });
    } catch {
      throw new LinearOAuthError("LINEAR_OAUTH_UNAVAILABLE", "Unable to connect to Linear OAuth");
    }
    return readOAuthResponse(response);
  }

  return {
    clientId: normalizedClientId,
    redirectUri: normalizedRedirectUri,
    authorizationUrl({ state, scope = LINEAR_OAUTH_SCOPE } = {}) {
      const normalizedState = requiredText(state, "LINEAR_OAUTH_STATE_INVALID", "Linear OAuth state is invalid");
      const { verifier, challenge } = createPkcePair();
      const url = new URL(LINEAR_OAUTH_AUTHORIZE_ENDPOINT);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", normalizedClientId);
      url.searchParams.set("redirect_uri", normalizedRedirectUri);
      url.searchParams.set("scope", scope);
      url.searchParams.set("state", normalizedState);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return { url: url.href, verifier };
    },
    async exchangeCode({ code, verifier }) {
      const payload = await tokenRequest({
        code: requiredText(code, "LINEAR_OAUTH_CODE_INVALID", "Linear OAuth authorization code is invalid"),
        redirect_uri: normalizedRedirectUri,
        client_id: normalizedClientId,
        code_verifier: requiredText(verifier, "LINEAR_OAUTH_VERIFIER_INVALID", "Linear OAuth PKCE verifier is invalid"),
        grant_type: "authorization_code",
        ...(normalizedClientSecret ? { client_secret: normalizedClientSecret } : {}),
      });
      return parseTokenPayload(payload);
    },
    async refreshToken(refreshToken) {
      const normalizedRefreshToken = requiredText(
        refreshToken,
        "LINEAR_OAUTH_REFRESH_TOKEN_INVALID",
        "Linear OAuth refresh token is invalid",
      );
      const payload = await tokenRequest({
        refresh_token: normalizedRefreshToken,
        grant_type: "refresh_token",
        client_id: normalizedClientId,
        ...(normalizedClientSecret ? { client_secret: normalizedClientSecret } : {}),
      });
      return parseTokenPayload(payload, normalizedRefreshToken);
    },
    async revokeToken(token, tokenTypeHint = "refresh_token") {
      const normalizedToken = requiredText(token, "LINEAR_OAUTH_TOKEN_INVALID", "Linear OAuth token is invalid");
      let response;
      try {
        response = await fetchImplementation(LINEAR_OAUTH_REVOKE_ENDPOINT, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            token: normalizedToken,
            token_type_hint: tokenTypeHint,
          }),
        });
      } catch {
        throw new LinearOAuthError("LINEAR_OAUTH_UNAVAILABLE", "Unable to connect to Linear OAuth");
      }
      if (!response.ok && response.status !== 400) await readOAuthResponse(response);
      return { revoked: response.ok || response.status === 400 };
    },
  };
}
