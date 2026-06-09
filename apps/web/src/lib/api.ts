import { clearSession, getSession, updateTokens } from "./session.js";

const apiBaseUrl =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export interface ApiEnvelope<T> {
  data: T;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
}

export interface Template {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  html: string;
  text?: string | null;
}

export interface SMTPConnection {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  fromEmail: string;
  fromName?: string | null;
  isDefault: boolean;
}

interface ApiErrorIssue {
  path?: (string | number)[];
  message?: string;
}

interface ApiErrorBody {
  error?: { message?: string; issues?: ApiErrorIssue[] };
}

export class ApiError extends Error {
  status: number;
  issues?: ApiErrorIssue[];

  constructor(message: string, status: number, issues?: ApiErrorIssue[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

function buildErrorMessage(status: number, body: ApiErrorBody | null) {
  const error = body?.error;

  // Zod validation errors come back generic; surface the field-level issues.
  if (error?.issues?.length) {
    const detail = error.issues
      .map((issue) => {
        const field = issue.path?.filter((part) => part !== "").join(".");
        return field ? `${field}: ${issue.message}` : issue.message;
      })
      .filter(Boolean)
      .join("; ");
    if (detail) {
      return detail;
    }
  }

  if (error?.message) {
    return error.message;
  }

  if (status === 0) {
    return "Cannot reach the API. Is the server running?";
  }

  return `Request failed (${status})`;
}

const AUTH_PREFIX = "/api/v1/auth/";

// Exchange the stored refresh token for a fresh pair. Returns true on success.
async function refreshTokens(): Promise<boolean> {
  const { refreshToken } = getSession();
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json().catch(() => null)) as {
      data?: { tokens?: { accessToken: string; refreshToken: string } };
    } | null;
    const tokens = body?.data?.tokens;
    if (!tokens?.accessToken) {
      return false;
    }
    updateTokens(tokens);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin() {
  clearSession();
  if (
    typeof window !== "undefined" &&
    window.location.pathname !== "/login" &&
    window.location.pathname !== "/register"
  ) {
    window.location.href = "/login";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOnUnauthorized = true
): Promise<T> {
  const { accessToken } = getSession();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new ApiError("Cannot reach the API. Is the server running?", 0);
  }

  // Access tokens are short-lived: on a 401, try a one-time refresh + retry
  // before giving up and bouncing the user to the login screen.
  if (
    response.status === 401 &&
    retryOnUnauthorized &&
    !path.startsWith(AUTH_PREFIX)
  ) {
    if (await refreshTokens()) {
      return request<T>(path, options, false);
    }
    redirectToLogin();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | ApiErrorBody
    | null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new ApiError(
      buildErrorMessage(response.status, errorBody),
      response.status,
      errorBody?.error?.issues
    );
  }

  return (body as ApiEnvelope<T>).data;
}

export const api = {
  register(input: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
  }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organization: Organization;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  login(input: { email: string; password: string }) {
    return request<{
      user: { id: string; email: string; name?: string | null };
      organizations: Array<{ id: string; name: string; role: string }>;
      tokens: { accessToken: string; refreshToken: string };
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  listOrganizations() {
    return request<Organization[]>("/api/v1/organizations");
  },

  createOrganization(input: { name: string }) {
    return request<Organization>("/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  listSMTPConnections(organizationId: string) {
    return request<SMTPConnection[]>(
      `/api/v1/smtp-connections?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createSMTPConnection(input: Record<string, unknown>) {
    return request<SMTPConnection>("/api/v1/smtp-connections", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateSMTPConnection(id: string, input: Record<string, unknown>) {
    return request<SMTPConnection>(`/api/v1/smtp-connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteSMTPConnection(id: string) {
    return request<void>(`/api/v1/smtp-connections/${id}`, { method: "DELETE" });
  },

  testSMTPConnection(id: string) {
    return request<{ id: string; ok: boolean }>(
      `/api/v1/smtp-connections/${id}/test`,
      { method: "POST" }
    );
  },

  listContacts(organizationId: string) {
    return request<Contact[]>(
      `/api/v1/contacts?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createContact(input: Record<string, unknown>) {
    return request<Contact>("/api/v1/contacts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateContact(id: string, input: Record<string, unknown>) {
    return request<Contact>(`/api/v1/contacts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteContact(id: string) {
    return request<void>(`/api/v1/contacts/${id}`, { method: "DELETE" });
  },

  listTemplates(organizationId: string) {
    return request<Template[]>(
      `/api/v1/templates?organizationId=${encodeURIComponent(organizationId)}`
    );
  },

  createTemplate(input: Record<string, unknown>) {
    return request<Template>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  updateTemplate(id: string, input: Record<string, unknown>) {
    return request<Template>(`/api/v1/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },

  deleteTemplate(id: string) {
    return request<void>(`/api/v1/templates/${id}`, { method: "DELETE" });
  },

  sendEmail(input: Record<string, unknown>) {
    return request<{ emailJob: { id: string; status: string } }>(
      "/api/v1/transactional-email/send",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  }
};
