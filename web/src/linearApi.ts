import { ApiError, resolveTaskboardUrl } from "./api";

export interface LinearConnection {
  configured: boolean;
  assignedToMeOnly: boolean;
  teamIds: string[];
  projectIds: string[];
  viewer: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  organization: {
    id: string;
    name: string;
  } | null;
  lastSyncedAt: string | null;
  issueCount: number;
  projectCount: number;
}

const EMPTY_LINEAR_CONNECTION: LinearConnection = {
  configured: false,
  assignedToMeOnly: true,
  teamIds: [],
  projectIds: [],
  viewer: null,
  organization: null,
  lastSyncedAt: null,
  issueCount: 0,
  projectCount: 0,
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(resolveTaskboardUrl(path), { ...init, headers });
  } catch {
    throw new ApiError(0, {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The Taskboard service is temporarily unavailable.",
      },
    });
  }

  let body: T & { error?: { code?: string; message?: string; details?: unknown } };
  try {
    body = await response.json() as typeof body;
  } catch {
    body = {} as typeof body;
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

export async function getLinearConnection(signal?: AbortSignal): Promise<LinearConnection> {
  try {
    const data = await request<{ connection: LinearConnection }>("/api/local/linear-connection", { signal });
    return data.connection;
  } catch (error) {
    if (
      error instanceof ApiError
      && (
        error.code === "LOCAL_COMPANION_REQUIRED"
        || (error.status === 403 && error.code === "LOCAL_ONLY")
        || error.status === 404
      )
    ) {
      return { ...EMPTY_LINEAR_CONNECTION };
    }
    throw error;
  }
}

export async function configureLinearConnection(input: {
  apiKey: string;
  teamIds?: string[];
  projectIds?: string[];
  assignedToMeOnly?: boolean;
}): Promise<LinearConnection> {
  const data = await request<{ connection: LinearConnection }>("/api/local/linear-connection", {
    method: "PUT",
    body: JSON.stringify({
      apiKey: input.apiKey,
      teamIds: input.teamIds ?? [],
      projectIds: input.projectIds ?? [],
      assignedToMeOnly: input.assignedToMeOnly ?? true,
    }),
  });
  return data.connection;
}

export async function syncLinearConnection(): Promise<LinearConnection> {
  const data = await request<{ connection: LinearConnection }>("/api/local/linear-connection/sync", {
    method: "POST",
  });
  return data.connection;
}
