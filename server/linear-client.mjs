const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const DEFAULT_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 20_000;

export class LinearApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "LinearApiError";
    this.code = code;
    this.details = details;
  }
}

function graphQlErrorCode(error) {
  return error?.extensions?.code ?? "LINEAR_GRAPHQL_ERROR";
}

function graphQlErrorMessage(error) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : "Linear GraphQL request failed";
}

function normalizeApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new LinearApiError("LINEAR_API_KEY_REQUIRED", "Linear API key is required");
  }
  return apiKey.trim();
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  dueDate
  url
  createdAt
  updatedAt
  state { id name type position }
  team { id key name }
  project { id name }
  labels { nodes { id name } }
  assignee { id name displayName avatarUrl }
  creator { id name displayName avatarUrl }
  parent { id identifier }
  inverseRelations(first: 100) {
    nodes {
      id
      type
      issue {
        id
        identifier
        title
        url
        state { id name type position }
        team { id key name }
        project { id name }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
`;

export function createLinearClient({
  apiKey,
  fetch: fetchImplementation = globalThis.fetch,
  endpoint = LINEAR_GRAPHQL_ENDPOINT,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const authorization = normalizeApiKey(apiKey);
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("fetch must be a function");
  }

  async function request(query, variables = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    let response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new LinearApiError(
        timedOut ? "LINEAR_TIMEOUT" : "LINEAR_UNAVAILABLE",
        timedOut ? "Linear request timed out" : "Unable to connect to Linear",
      );
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new LinearApiError(
        "INVALID_LINEAR_RESPONSE",
        `Linear returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
      throw new LinearApiError(
        firstError ? graphQlErrorCode(firstError) : "LINEAR_HTTP_ERROR",
        firstError ? graphQlErrorMessage(firstError) : `Linear request failed (HTTP ${response.status})`,
        payload?.errors ?? null,
      );
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const firstError = payload.errors[0];
      throw new LinearApiError(
        graphQlErrorCode(firstError),
        graphQlErrorMessage(firstError),
        payload.errors,
      );
    }

    if (!payload || typeof payload !== "object" || payload.data === undefined) {
      throw new LinearApiError("INVALID_LINEAR_RESPONSE", "Linear response is missing data");
    }

    return payload.data;
  }

  async function viewer() {
    const data = await request(`
      query LinearTaskboardViewer {
        viewer {
          id
          name
          displayName
          avatarUrl
          organization {
            id
            name
          }
        }
      }
    `);
    return data.viewer;
  }

  async function listIssues({ assignedToMeOnly = true, first = DEFAULT_PAGE_SIZE } = {}) {
    const nodes = [];
    let after = null;

    while (true) {
      const data = assignedToMeOnly
        ? await request(`
            query LinearTaskboardAssignedIssues($first: Int!, $after: String) {
              viewer {
                assignedIssues(first: $first, after: $after, includeArchived: false) {
                  nodes { ${ISSUE_FIELDS} }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          `, { first, after })
        : await request(`
            query LinearTaskboardIssues($first: Int!, $after: String) {
              issues(first: $first, after: $after, includeArchived: false, orderBy: updatedAt) {
                nodes { ${ISSUE_FIELDS} }
                pageInfo { hasNextPage endCursor }
              }
            }
          `, { first, after });

      const connection = assignedToMeOnly ? data.viewer?.assignedIssues : data.issues;
      const pageNodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
      nodes.push(...pageNodes);

      if (!connection?.pageInfo?.hasNextPage) break;
      after = connection.pageInfo.endCursor;
      if (!after) {
        throw new LinearApiError(
          "INVALID_LINEAR_PAGINATION",
          "Linear reported another issue page without an end cursor",
        );
      }
    }

    return nodes;
  }

  async function listComments(issueId, { first = DEFAULT_PAGE_SIZE } = {}) {
    const nodes = [];
    let after = null;
    while (true) {
      const data = await request(`
        query LinearTaskboardIssueComments($issueId: String!, $first: Int!, $after: String) {
          issue(id: $issueId) {
            comments(first: $first, after: $after) {
              nodes {
                id
                body
                createdAt
                updatedAt
                user { id name displayName avatarUrl }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      `, { issueId, first, after });
      const connection = data.issue?.comments;
      const pageNodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
      nodes.push(...pageNodes);
      if (!connection?.pageInfo?.hasNextPage) break;
      after = connection.pageInfo.endCursor;
      if (!after) {
        throw new LinearApiError(
          "INVALID_LINEAR_PAGINATION",
          "Linear reported another comment page without an end cursor",
        );
      }
    }
    return nodes;
  }

  async function listWorkflowStates(teamId) {
    const data = await request(`
      query LinearTaskboardWorkflowStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes { id name type position }
          }
        }
      }
    `, { teamId });
    return data.team?.states?.nodes ?? [];
  }

  async function updateIssue(issueId, input) {
    const data = await request(`
      mutation LinearTaskboardUpdateIssue($issueId: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $issueId, input: $input) {
          success
          issue { id identifier updatedAt }
        }
      }
    `, { issueId, input });
    if (!data.issueUpdate?.success) {
      throw new LinearApiError("LINEAR_UPDATE_REJECTED", "Linear rejected the issue update");
    }
    return data.issueUpdate.issue;
  }

  async function createComment(issueId, body) {
    const data = await request(`
      mutation LinearTaskboardCreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
            body
            createdAt
            updatedAt
            user { id name displayName avatarUrl }
          }
        }
      }
    `, { input: { issueId, body } });
    if (!data.commentCreate?.success) {
      throw new LinearApiError("LINEAR_COMMENT_REJECTED", "Linear rejected the comment");
    }
    return data.commentCreate.comment;
  }

  return {
    request,
    viewer,
    listIssues,
    listComments,
    listWorkflowStates,
    updateIssue,
    createComment,
  };
}

export { LINEAR_GRAPHQL_ENDPOINT };
